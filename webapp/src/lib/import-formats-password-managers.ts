import type { CiphersImportPayload } from '@/lib/api/vault';
import {
  addFolder,
  cardBrand,
  makeLoginCipher,
  normalizeUri,
  parseCardExpiry,
  parseCsv,
  parseCsvRows,
  processKvp,
  splitFullName,
  txt,
  val,
} from '@/lib/import-format-shared';

export function parseEnpassCsv(textRaw: string): CiphersImportPayload {
  const rows = parseCsvRows(textRaw);
  const result: CiphersImportPayload = { ciphers: [], folders: [], folderRelationships: [] };
  let first = true;
  for (const r of rows) {
    if (r.length < 2 || (first && (r[0] === 'Title' || r[0] === 'title'))) {
      first = false;
      continue;
    }
    const cipher = makeLoginCipher();
    cipher.name = val(r[0], '--');
    cipher.notes = val(r[r.length - 1]);
    const hasLoginHints = r.some((x) => ['username', 'password', 'email', 'url'].includes(txt(x).toLowerCase()));
    const hasCardHints = r.some((x) => ['cardholder', 'number', 'expiry date'].includes(txt(x).toLowerCase()));
    if (r.length === 2 || !hasLoginHints) {
      cipher.type = 2;
      cipher.login = null;
      cipher.secureNote = { type: 0 };
    }
    if (hasCardHints) {
      cipher.type = 3;
      cipher.login = null;
      cipher.card = { cardholderName: null, number: null, brand: null, expMonth: null, expYear: null, code: null };
    }
    if (r.length > 2 && r.length % 2 === 0) {
      for (let i = 0; i < r.length - 2; i += 2) {
        const fieldName = txt(r[i + 1]);
        const fieldValue = txt(r[i + 2]);
        if (!fieldValue) continue;
        const low = fieldName.toLowerCase();
        if (cipher.type === 1) {
          const login = cipher.login as Record<string, unknown>;
          if (low === 'url' && !Array.isArray(login.uris)) {
            const uri = normalizeUri(fieldValue);
            login.uris = uri ? [{ uri, match: null }] : null;
            continue;
          }
          if ((low === 'username' || low === 'email') && !txt(login.username)) {
            login.username = fieldValue;
            continue;
          }
          if (low === 'password' && !txt(login.password)) {
            login.password = fieldValue;
            continue;
          }
          if (low === 'totp' && !txt(login.totp)) {
            login.totp = fieldValue;
            continue;
          }
        } else if (cipher.type === 3 && cipher.card) {
          const card = cipher.card as Record<string, unknown>;
          if (low === 'cardholder' && !txt(card.cardholderName)) {
            card.cardholderName = fieldValue;
            continue;
          }
          if (low === 'number' && !txt(card.number)) {
            card.number = fieldValue;
            card.brand = cardBrand(fieldValue);
            continue;
          }
          if (low === 'cvc' && !txt(card.code)) {
            card.code = fieldValue;
            continue;
          }
          if (low === 'expiry date' && !txt(card.expMonth) && !txt(card.expYear)) {
            const m = fieldValue.match(/^0?([1-9]|1[0-2])\/((?:[1-2][0-9])?[0-9]{2})$/);
            if (m) {
              card.expMonth = m[1];
              card.expYear = m[2].length === 2 ? `20${m[2]}` : m[2];
              continue;
            }
          }
          if (low === 'type') continue;
        }
        processKvp(cipher, fieldName, fieldValue, false);
      }
    }
    result.ciphers.push(cipher);
  }
  return result;
}

export function parseEnpassJson(textRaw: string): CiphersImportPayload {
  const parsed = JSON.parse(textRaw) as { folders?: any[]; items?: any[] };
  const result: CiphersImportPayload = { ciphers: [], folders: [], folderRelationships: [] };
  const folderTitleById = new Map<string, string>();
  for (const f of parsed.folders || []) {
    if (f?.uuid && f?.title) folderTitleById.set(String(f.uuid), String(f.title).trim());
  }

  for (const item of parsed.items || []) {
    const cipher = makeLoginCipher();
    cipher.name = val(item?.title, '--');
    cipher.favorite = Number(item?.favorite || 0) > 0;
    cipher.notes = val(item?.note);
    const templateType = txt(item?.template_type);
    const fields = Array.isArray(item?.fields) ? item.fields : [];

    if (templateType.startsWith('creditcard.')) {
      cipher.type = 3;
      cipher.login = null;
      const card: Record<string, unknown> = {
        cardholderName: null,
        number: null,
        code: null,
        expMonth: null,
        expYear: null,
        brand: null,
      };
      for (const field of fields) {
        const t = txt(field?.type);
        const v = txt(field?.value);
        if (!v || t === 'section' || t === 'ccType') continue;
        if (t === 'ccName' && !txt(card.cardholderName)) card.cardholderName = v;
        else if (t === 'ccNumber' && !txt(card.number)) {
          card.number = v;
          card.brand = cardBrand(v);
        } else if (t === 'ccCvc' && !txt(card.code)) card.code = v;
        else if (t === 'ccExpiry' && !txt(card.expYear)) {
          const m = v.match(/^0?([1-9]|1[0-2])\/((?:[1-2][0-9])?[0-9]{2})$/);
          if (m) {
            card.expMonth = m[1];
            card.expYear = m[2].length === 2 ? `20${m[2]}` : m[2];
          } else {
            processKvp(cipher, txt(field?.label), v, Number(field?.sensitive || 0) === 1);
          }
        } else {
          processKvp(cipher, txt(field?.label), v, Number(field?.sensitive || 0) === 1);
        }
      }
      cipher.card = card;
    } else if (
      templateType.startsWith('login.') ||
      templateType.startsWith('password.') ||
      fields.some((f: any) => txt(f?.type) === 'password' && txt(f?.value))
    ) {
      const login = cipher.login as Record<string, unknown>;
      const urls: string[] = [];
      for (const field of fields) {
        const t = txt(field?.type);
        const v = txt(field?.value);
        if (!v || t === 'section') continue;
        if ((t === 'username' || t === 'email') && !txt(login.username)) login.username = v;
        else if (t === 'password' && !txt(login.password)) login.password = v;
        else if (t === 'totp' && !txt(login.totp)) login.totp = v;
        else if (t === 'url') {
          const n = normalizeUri(v);
          if (n) urls.push(n);
        } else if (t === '.Android#') {
          let cleaned = v.startsWith('androidapp://') ? v : `androidapp://${v}`;
          cleaned = cleaned.replace('android://', '').replace(/androidapp:\/\/.*==@/g, 'androidapp://');
          const n = normalizeUri(cleaned) || cleaned;
          urls.push(n);
        } else {
          processKvp(cipher, txt(field?.label), v, Number(field?.sensitive || 0) === 1);
        }
      }
      login.uris = urls.length ? urls.map((u) => ({ uri: u, match: null })) : null;
    } else {
      cipher.type = 2;
      cipher.login = null;
      cipher.secureNote = { type: 0 };
      for (const field of fields) {
        const v = txt(field?.value);
        if (!v || txt(field?.type) === 'section') continue;
        processKvp(cipher, txt(field?.label), v, Number(field?.sensitive || 0) === 1);
      }
    }

    const idx = result.ciphers.push(cipher) - 1;
    const folderId = Array.isArray(item?.folders) && item.folders.length ? String(item.folders[0]) : '';
    if (folderId && folderTitleById.has(folderId)) addFolder(result, folderTitleById.get(folderId) || '', idx);
  }
  return result;
}

export function parseKeeperCsv(textRaw: string): CiphersImportPayload {
  const rows = parseCsvRows(textRaw);
  const result: CiphersImportPayload = { ciphers: [], folders: [], folderRelationships: [] };
  for (const row of rows) {
    if (row.length < 6) continue;
    const cipher = makeLoginCipher();
    cipher.name = val(row[1], '--');
    const login = cipher.login as Record<string, unknown>;
    login.username = val(row[2]);
    login.password = val(row[3]);
    const uri = normalizeUri(row[4] || '');
    login.uris = uri ? [{ uri, match: null }] : null;
    cipher.notes = val(row[5]);
    if (row.length > 7) {
      for (let i = 7; i < row.length; i += 2) {
        const k = txt(row[i]);
        const v = txt(row[i + 1]);
        if (!k) continue;
        if (k === 'TFC:Keeper') (cipher.login as Record<string, unknown>).totp = val(v);
        else processKvp(cipher, k, v, false);
      }
    }
    const idx = result.ciphers.push(cipher) - 1;
    addFolder(result, row[0], idx);
  }
  return result;
}

export function parseKeeperJson(textRaw: string): CiphersImportPayload {
  const parsed = JSON.parse(textRaw) as { records?: any[] };
  const records = Array.isArray(parsed.records) ? parsed.records : [];
  const result: CiphersImportPayload = { ciphers: [], folders: [], folderRelationships: [] };
  for (const record of records) {
    const cipher = makeLoginCipher();
    cipher.name = val(record.title, '--');
    const login = cipher.login as Record<string, unknown>;
    login.username = val(record.login);
    login.password = val(record.password);
    const uri = normalizeUri(record.login_url || '');
    login.uris = uri ? [{ uri, match: null }] : null;
    cipher.notes = val(record.notes);
    const cf = record.custom_fields || {};
    if (cf['TFC:Keeper']) login.totp = val(cf['TFC:Keeper']);
    for (const key of Object.keys(cf)) {
      if (key === 'TFC:Keeper') continue;
      processKvp(cipher, key, String(cf[key] ?? ''), false);
    }
    if (Array.isArray(record.folders)) {
      const idx = result.ciphers.push(cipher) - 1;
      for (const f of record.folders) {
        const folderName = f?.folder || f?.shared_folder;
        if (folderName) addFolder(result, String(folderName), idx);
      }
    } else {
      result.ciphers.push(cipher);
    }
  }
  return result;
}

export function parseLogMeOnceCsv(textRaw: string): CiphersImportPayload {
  const rows = parseCsvRows(textRaw);
  const result: CiphersImportPayload = { ciphers: [], folders: [], folderRelationships: [] };
  for (const row of rows) {
    if (row.length < 4) continue;
    const cipher = makeLoginCipher();
    cipher.name = val(row[0], '--');
    const login = cipher.login as Record<string, unknown>;
    login.username = val(row[2]);
    login.password = val(row[3]);
    const uri = normalizeUri(row[1] || '');
    login.uris = uri ? [{ uri, match: null }] : null;
    result.ciphers.push(cipher);
  }
  return result;
}

export function parseMeldiumCsv(textRaw: string): CiphersImportPayload {
  const rows = parseCsv(textRaw);
  const result: CiphersImportPayload = { ciphers: [], folders: [], folderRelationships: [] };
  for (const row of rows) {
    const cipher = makeLoginCipher();
    cipher.name = val(row.DisplayName, '--');
    cipher.notes = val(row.Notes);
    const login = cipher.login as Record<string, unknown>;
    login.username = val(row.UserName);
    login.password = val(row.Password);
    const uri = normalizeUri(row.Url || '');
    login.uris = uri ? [{ uri, match: null }] : null;
    result.ciphers.push(cipher);
  }
  return result;
}

export function parseProtonPassJson(textRaw: string): CiphersImportPayload {
  const parsed = JSON.parse(textRaw) as { encrypted?: boolean; vaults?: Record<string, any> };
  if (parsed?.encrypted) throw new Error('Unable to import an encrypted Proton Pass export.');
  const result: CiphersImportPayload = { ciphers: [], folders: [], folderRelationships: [] };
  const vaults = parsed?.vaults && typeof parsed.vaults === 'object' ? parsed.vaults : {};
  for (const vault of Object.values(vaults)) {
    const vaultName = txt((vault as Record<string, unknown>).name);
    const items = Array.isArray((vault as Record<string, unknown>).items) ? ((vault as Record<string, unknown>).items as any[]) : [];
    for (const item of items) {
      if (Number(item?.state) === 2) continue;
      const itemType = txt(item?.data?.type);
      const cipher = makeLoginCipher();
      cipher.name = val(item?.data?.metadata?.name, '--');
      cipher.notes = val(item?.data?.metadata?.note);
      cipher.favorite = !!item?.pinned;

      if (itemType === 'login') {
        const content = item?.data?.content || {};
        const login = cipher.login as Record<string, unknown>;
        const urls: string[] = [];
        for (const u of content?.urls || []) {
          const uri = normalizeUri(u || '');
          if (uri) urls.push(uri);
        }
        login.uris = urls.length ? urls.map((uri) => ({ uri, match: null })) : null;
        const username = val(content?.itemUsername);
        const email = val(content?.itemEmail);
        login.username = username || email;
        if (username && email) processKvp(cipher, 'email', email, false);
        login.password = val(content?.password);
        login.totp = val(content?.totpUri);
        for (const extra of item?.data?.extraFields || []) {
          const t = txt(extra?.type);
          const fieldValue = t === 'totp' ? val(extra?.data?.totpUri) : val(extra?.data?.content);
          processKvp(cipher, txt(extra?.fieldName), fieldValue || '', t !== 'text');
        }
      } else if (itemType === 'note') {
        cipher.type = 2;
        cipher.login = null;
        cipher.secureNote = { type: 0 };
      } else if (itemType === 'creditCard') {
        const content = item?.data?.content || {};
        const { month, year } = parseCardExpiry(txt(content?.expirationDate));
        cipher.type = 3;
        cipher.login = null;
        cipher.card = {
          cardholderName: val(content?.cardholderName),
          number: val(content?.number),
          brand: cardBrand(val(content?.number)),
          code: val(content?.verificationNumber),
          expMonth: month,
          expYear: year,
        };
        if (txt(content?.pin)) processKvp(cipher, 'PIN', txt(content.pin), true);
      } else if (itemType === 'identity') {
        const content = item?.data?.content || {};
        const name = splitFullName(val(content?.fullName));
        cipher.type = 4;
        cipher.login = null;
        cipher.identity = {
          firstName: val(content?.firstName) || name.firstName,
          middleName: val(content?.middleName) || name.middleName,
          lastName: val(content?.lastName) || name.lastName,
          email: val(content?.email),
          phone: val(content?.phoneNumber),
          company: val(content?.company),
          ssn: val(content?.socialSecurityNumber),
          passportNumber: val(content?.passportNumber),
          licenseNumber: val(content?.licenseNumber),
          address1: val(content?.organization),
          address2: val(content?.streetAddress),
          address3: `${txt(content?.floor)} ${txt(content?.county)}`.trim() || null,
          city: val(content?.city),
          state: val(content?.stateOrProvince),
          postalCode: val(content?.zipOrPostalCode),
          country: val(content?.countryOrRegion),
        };
        for (const key of Object.keys(content || {})) {
          if (
            [
              'fullName',
              'firstName',
              'middleName',
              'lastName',
              'email',
              'phoneNumber',
              'company',
              'socialSecurityNumber',
              'passportNumber',
              'licenseNumber',
              'organization',
              'streetAddress',
              'floor',
              'county',
              'city',
              'stateOrProvince',
              'zipOrPostalCode',
              'countryOrRegion',
            ].includes(key)
          ) {
            continue;
          }
          if (key === 'extraSections' && Array.isArray(content[key])) {
            for (const section of content[key]) {
              for (const extra of section?.sectionFields || []) {
                processKvp(cipher, txt(extra?.fieldName), txt(extra?.data?.content), txt(extra?.type) === 'hidden');
              }
            }
            continue;
          }
          if (Array.isArray(content[key])) {
            for (const extra of content[key]) {
              processKvp(cipher, txt(extra?.fieldName), txt(extra?.data?.content), txt(extra?.type) === 'hidden');
            }
            continue;
          }
          processKvp(cipher, key, txt(content[key]), false);
        }
        for (const extra of item?.data?.extraFields || []) {
          processKvp(cipher, txt(extra?.fieldName), txt(extra?.data?.content), txt(extra?.type) === 'hidden');
        }
      } else {
        continue;
      }

      const idx = result.ciphers.push(cipher) - 1;
      if (vaultName) addFolder(result, vaultName, idx);
    }
  }
  return result;
}
