import type { CiphersImportPayload } from '@/lib/api/vault';
import {
  addFolder,
  cardBrand,
  type CsvRow,
  convertToNoteIfNeeded,
  makeLoginCipher,
  normalizeUri,
  parseCsv,
  parseCsvRows,
  processKvp,
  txt,
  val,
} from '@/lib/import-format-shared';

function splitPipedField(raw: string): string {
  const s = txt(raw);
  if (!s) return '';
  const p = s.split('|');
  if (p.length <= 2) return s;
  return [...p.slice(0, 2), p.slice(2).join('|')].pop() || '';
}

export function parseMSecureCsv(textRaw: string): CiphersImportPayload {
  const rows = parseCsvRows(textRaw);
  const result: CiphersImportPayload = { ciphers: [], folders: [], folderRelationships: [] };
  for (const row of rows) {
    if (row.length < 3) continue;
    const folderName = txt(row[2]) && txt(row[2]) !== 'Unassigned' ? row[2] : '';
    const type = txt(row[1]);
    const cipher = makeLoginCipher();
    cipher.name = val(txt(row[0]).split('|')[0], '--');

    if (type === 'Web Logins' || type === 'Login') {
      const login = cipher.login as Record<string, unknown>;
      login.username = val(splitPipedField(row[5] || ''));
      login.password = val(splitPipedField(row[6] || ''));
      const uri = normalizeUri(splitPipedField(row[4] || '') || '');
      login.uris = uri ? [{ uri, match: null }] : null;
      cipher.notes = val((row[3] || '').split('\\n').join('\n'));
    } else if (type === 'Credit Card') {
      cipher.type = 3;
      cipher.login = null;
      const cardNumber = val(splitPipedField(row[4] || ''));
      let expMonth: string | null = null;
      let expYear: string | null = null;
      const exp = splitPipedField(row[5] || '');
      const m = exp.match(/^(\d{1,2})\s*\/\s*(\d{2,4})$/);
      if (m) {
        expMonth = m[1];
        expYear = m[2].length === 2 ? `20${m[2]}` : m[2];
      }
      let code: string | null = null;
      let holder: string | null = null;
      for (const entry of row) {
        if (/^Security Code\|\d*\|/.test(entry)) code = val(splitPipedField(entry));
        if (/^Name on Card\|\d*\|/.test(entry)) holder = val(splitPipedField(entry));
      }
      const noteRegex = /\|\d*\|/;
      const rawNotes = row.slice(2).filter((entry) => txt(entry) && !noteRegex.test(entry));
      const indexedNotes = [8, 10, 11]
        .filter((idx) => row[idx] && noteRegex.test(row[idx]))
        .map((idx) => `${txt(row[idx]).split('|')[0]}: ${splitPipedField(row[idx])}`);
      cipher.notes = [...rawNotes, ...indexedNotes].join('\n') || null;
      cipher.card = {
        number: cardNumber,
        cardholderName: holder,
        code,
        expMonth,
        expYear,
        brand: cardBrand(cardNumber),
      };
    } else if (row.length > 3) {
      cipher.type = 2;
      cipher.login = null;
      cipher.secureNote = { type: 0 };
      const noteLines: string[] = [];
      for (let i = 3; i < row.length; i++) {
        if (txt(row[i])) noteLines.push(row[i]);
      }
      cipher.notes = noteLines.join('\n') || null;
    }

    if (txt(type) && Number(cipher.type) !== 1 && Number(cipher.type) !== 3) {
      cipher.name = `${type}: ${txt(cipher.name)}`;
    }
    const idx = result.ciphers.push(cipher) - 1;
    addFolder(result, folderName, idx);
  }
  return result;
}

export function parseMykiCsv(textRaw: string): CiphersImportPayload {
  const rows = parseCsv(textRaw);
  const result: CiphersImportPayload = { ciphers: [], folders: [], folderRelationships: [] };
  const mappedBase = new Set(['nickname', 'additionalInfo']);

  function unmapped(cipher: Record<string, unknown>, row: CsvRow, mapped: Set<string>): void {
    for (const key of Object.keys(row)) {
      if (mapped.has(key)) continue;
      processKvp(cipher, key, row[key], false);
    }
  }

  for (const row of rows) {
    const cipher = makeLoginCipher();
    cipher.name = val(row.nickname, '--');
    cipher.notes = val(txt(row.additionalInfo).replace(/\s+$/g, ''));

    if (row.url !== undefined) {
      const mapped = new Set([...mappedBase, 'url', 'username', 'password', 'twofaSecret']);
      const login = cipher.login as Record<string, unknown>;
      const uri = normalizeUri(row.url || '');
      login.uris = uri ? [{ uri, match: null }] : null;
      login.username = val(row.username);
      login.password = val(row.password);
      login.totp = val(row.twofaSecret);
      unmapped(cipher, row, mapped);
    } else if (row.authToken !== undefined) {
      const mapped = new Set([...mappedBase, 'authToken']);
      (cipher.login as Record<string, unknown>).totp = val(row.authToken);
      unmapped(cipher, row, mapped);
    } else if (row.cardNumber !== undefined) {
      const mapped = new Set([...mappedBase, 'cardNumber', 'cardName', 'exp_month', 'exp_year', 'cvv']);
      cipher.type = 3;
      cipher.login = null;
      cipher.card = {
        cardholderName: val(row.cardName),
        number: val(row.cardNumber),
        brand: cardBrand(val(row.cardNumber)),
        expMonth: val(row.exp_month),
        expYear: val(row.exp_year),
        code: val(row.cvv),
      };
      unmapped(cipher, row, mapped);
    } else if (row.firstName !== undefined) {
      const mapped = new Set([
        ...mappedBase,
        'title',
        'firstName',
        'middleName',
        'lastName',
        'email',
        'firstAddressLine',
        'secondAddressLine',
        'city',
        'country',
        'zipCode',
      ]);
      cipher.type = 4;
      cipher.login = null;
      cipher.identity = {
        title: val(row.title),
        firstName: val(row.firstName),
        middleName: val(row.middleName),
        lastName: val(row.lastName),
        phone: val((row as Record<string, string>).number),
        email: val(row.email),
        address1: val(row.firstAddressLine),
        address2: val(row.secondAddressLine),
        city: val(row.city),
        country: val(row.country),
        postalCode: val(row.zipCode),
      };
      unmapped(cipher, row, mapped);
    } else if (row.idType !== undefined) {
      const mapped = new Set([...mappedBase, 'idName', 'idNumber', 'idCountry']);
      const fullName = txt((row as Record<string, string>).idName);
      const parts = fullName.split(/\s+/).filter(Boolean);
      const idType = txt((row as Record<string, string>).idType);
      const idNumber = val((row as Record<string, string>).idNumber);
      cipher.type = 4;
      cipher.login = null;
      cipher.identity = {
        firstName: parts[0] || null,
        middleName: parts.length >= 3 ? parts[1] : null,
        lastName: parts.length >= 2 ? parts.slice(parts.length >= 3 ? 2 : 1).join(' ') : null,
        country: val((row as Record<string, string>).idCountry),
        passportNumber: idType === 'Passport' ? idNumber : null,
        ssn: idType === 'Social Security' ? idNumber : null,
        licenseNumber: idType !== 'Passport' && idType !== 'Social Security' ? idNumber : null,
      };
      unmapped(cipher, row, mapped);
    } else if (row.content !== undefined) {
      const mapped = new Set([...mappedBase, 'content']);
      cipher.type = 2;
      cipher.login = null;
      cipher.secureNote = { type: 0 };
      cipher.notes = val(txt(row.content).replace(/\s+$/g, ''));
      unmapped(cipher, row, mapped);
    } else {
      continue;
    }
    result.ciphers.push(cipher);
  }
  return result;
}

export function parseNetwrixCsv(textRaw: string): CiphersImportPayload {
  const rows = parseCsv(textRaw);
  const result: CiphersImportPayload = { ciphers: [], folders: [], folderRelationships: [] };
  const mapped = new Set(['Organisationseinheit', 'Informationen', 'Beschreibung', 'Benutzername', 'Passwort', 'Internetseite', 'One-Time Passwort']);
  for (const row of rows) {
    const cipher = makeLoginCipher();
    cipher.notes = val(txt(row.Informationen).replace(/\s+$/g, ''));
    cipher.name = val(row.Beschreibung, '--');
    const login = cipher.login as Record<string, unknown>;
    login.username = val(row.Benutzername);
    login.password = val(row.Passwort);
    login.totp = val((row as Record<string, string>)['One-Time Passwort']);
    const uri = normalizeUri(row.Internetseite || '');
    login.uris = uri ? [{ uri, match: null }] : null;
    for (const key of Object.keys(row)) {
      if (mapped.has(key)) continue;
      processKvp(cipher, key, row[key], false);
    }
    const idx = result.ciphers.push(cipher) - 1;
    addFolder(result, row.Organisationseinheit, idx);
  }
  return result;
}

export function parseRoboFormCsv(textRaw: string): CiphersImportPayload {
  const rows = parseCsv(textRaw);
  const result: CiphersImportPayload = { ciphers: [], folders: [], folderRelationships: [] };
  for (const row of rows) {
    const cipher = makeLoginCipher();
    const folder = txt(row.Folder).startsWith('/') ? txt(row.Folder).slice(1) : txt(row.Folder);
    cipher.notes = val(row.Note);
    cipher.name = val(row.Name, '--');
    const login = cipher.login as Record<string, unknown>;
    login.username = val(row.Login);
    login.password = val(row.Pwd, val(row.Password));
    const uri = normalizeUri(row.Url || row.URL || '');
    login.uris = uri ? [{ uri, match: null }] : null;
    if (txt(row.Rf_fields)) processKvp(cipher, 'Rf_fields', txt(row.Rf_fields), true);
    if (txt(row.RfFieldsV2)) processKvp(cipher, 'RfFieldsV2', txt(row.RfFieldsV2), true);

    convertToNoteIfNeeded(cipher);
    const idx = result.ciphers.push(cipher) - 1;
    addFolder(result, folder, idx);
  }
  return result;
}

export function parseZohoVaultCsv(textRaw: string): CiphersImportPayload {
  const rows = parseCsv(textRaw);
  const result: CiphersImportPayload = { ciphers: [], folders: [], folderRelationships: [] };
  for (const row of rows) {
    if (!txt(row['Password Name']) && !txt(row['Secret Name'])) continue;
    const cipher = makeLoginCipher();
    cipher.favorite = txt(row.Favorite) === '1';
    cipher.notes = val(row.Notes);
    cipher.name = val(row['Password Name'], val(row['Secret Name'], '--'));
    const login = cipher.login as Record<string, unknown>;
    const uri = normalizeUri(txt(row['Password URL']) || txt(row['Secret URL']));
    login.uris = uri ? [{ uri, match: null }] : null;
    login.totp = val(row.login_totp);

    const parseData = (data: string) => {
      if (!txt(data)) return;
      for (const line of data.split(/\r?\n/)) {
        const pos = line.indexOf(':');
        if (pos < 0) continue;
        const key = txt(line.slice(0, pos));
        const value = txt(line.slice(pos + 1));
        if (!key || !value || key === 'SecretType') continue;
        const low = key.toLowerCase();
        if (!txt(login.username) && ['username', 'user', 'email', 'login', 'id'].includes(low)) login.username = value;
        else if (!txt(login.password) && ['password', 'pass', 'passwd'].includes(low)) login.password = value;
        else processKvp(cipher, key, value, false);
      }
    };
    parseData(txt(row.SecretData));
    parseData(txt(row.CustomData));

    convertToNoteIfNeeded(cipher);
    const idx = result.ciphers.push(cipher) - 1;
    addFolder(result, row['Folder Name'], idx);
  }
  return result;
}

export function parseNordpassCsv(textRaw: string): CiphersImportPayload {
  const rows = parseCsv(textRaw);
  const result: CiphersImportPayload = { ciphers: [], folders: [], folderRelationships: [] };
  for (const r of rows) {
    const t = txt(r.type);
    if (!t) continue;
    if (t === 'password') {
      const cipher = makeLoginCipher();
      cipher.name = val(r.name, '--');
      cipher.notes = val(r.note);
      const login = cipher.login as Record<string, unknown>;
      login.username = val(r.username);
      login.password = val(r.password);
      const uris: string[] = [];
      const main = normalizeUri(r.url || '');
      if (main) uris.push(main);
      if (txt(r.additional_urls)) {
        try {
          const extra = JSON.parse(r.additional_urls) as string[];
          for (const u of extra || []) {
            const n = normalizeUri(u || '');
            if (n) uris.push(n);
          }
        } catch {}
      }
      login.uris = uris.length ? uris.map((u) => ({ uri: u, match: null })) : null;
      if (txt(r.custom_fields)) {
        try {
          const cfs = JSON.parse(r.custom_fields) as any[];
          for (const cf of cfs || []) processKvp(cipher, cf.label || '', cf.value || '', cf.type === 'hidden');
        } catch {}
      }
      const idx = result.ciphers.push(cipher) - 1;
      addFolder(result, r.folder, idx);
      continue;
    }
    if (t === 'note') {
      const idx =
        result.ciphers.push({
          type: 2,
          name: val(r.name, '--'),
          notes: val(r.note),
          favorite: false,
          reprompt: 0,
          key: null,
          login: null,
          card: null,
          identity: null,
          secureNote: { type: 0 },
          fields: null,
          passwordHistory: null,
          sshKey: null,
        }) - 1;
      addFolder(result, r.folder, idx);
      continue;
    }
    if (t === 'credit_card') {
      const idx =
        result.ciphers.push({
          type: 3,
          name: val(r.name, '--'),
          notes: val(r.note),
          favorite: false,
          reprompt: 0,
          key: null,
          login: null,
          card: {
            cardholderName: val(r.cardholdername),
            number: val(r.cardnumber),
            brand: cardBrand(val(r.cardnumber)),
            code: val(r.cvc),
            expMonth: val(r.expiry_month),
            expYear: val(r.expiry_year),
          },
          identity: null,
          secureNote: null,
          fields: null,
          passwordHistory: null,
          sshKey: null,
        }) - 1;
      addFolder(result, r.folder, idx);
      continue;
    }
    if (t === 'personal_info') {
      const identity = {
        title: val(r.title),
        firstName: val(r.first_name),
        middleName: val(r.middle_name),
        lastName: val(r.last_name),
        phone: val(r.phone_number),
        email: val(r.email),
        address1: val(r.address1),
        address2: val(r.address2),
        city: val(r.city),
        state: val(r.state),
        postalCode: val(r.postal_code),
        country: val(r.country),
        username: val(r.username),
        company: val(r.company),
      };
      const idx =
        result.ciphers.push({
          type: 4,
          name: val(r.name, '--'),
          notes: val(r.note),
          favorite: false,
          reprompt: 0,
          key: null,
          login: null,
          card: null,
          identity,
          secureNote: null,
          fields: null,
          passwordHistory: null,
          sshKey: null,
        }) - 1;
      addFolder(result, r.folder, idx);
    }
  }
  return result;
}

export function parsePassmanJson(textRaw: string): CiphersImportPayload {
  const rows = JSON.parse(textRaw) as any[];
  const result: CiphersImportPayload = { ciphers: [], folders: [], folderRelationships: [] };
  for (const c of rows || []) {
    const cipher = makeLoginCipher();
    cipher.name = val(c.label, '--');
    const login = cipher.login as Record<string, unknown>;
    login.username = val(c.username, val(c.email));
    login.password = val(c.password);
    const uri = normalizeUri(c.url || '');
    login.uris = uri ? [{ uri, match: null }] : null;
    login.totp = val(c?.otp?.secret);
    const email = txt(c.email);
    const desc = txt(c.description);
    cipher.notes = `${login.username && email && txt(login.username) !== email ? `Email: ${email}\n` : ''}${desc}` || null;
    for (const cf of c.custom_fields || []) {
      const t = txt(cf.field_type);
      if (t === 'text' || t === 'password') processKvp(cipher, cf.label || '', cf.value || '', false);
    }
    const idx = result.ciphers.push(cipher) - 1;
    const folder = c?.tags?.[0]?.text;
    if (folder) addFolder(result, String(folder), idx);
  }
  return result;
}

export function parsePasskyJson(textRaw: string): CiphersImportPayload {
  const parsed = JSON.parse(textRaw) as { encrypted?: boolean; passwords?: any[] };
  if (parsed.encrypted === true) throw new Error('Unable to import an encrypted passky backup.');
  const list = Array.isArray(parsed.passwords) ? parsed.passwords : [];
  const result: CiphersImportPayload = { ciphers: [], folders: [], folderRelationships: [] };
  for (const p of list) {
    const cipher = makeLoginCipher();
    cipher.name = val(p.website, '--');
    const login = cipher.login as Record<string, unknown>;
    login.username = val(p.username);
    login.password = val(p.password);
    const uri = normalizeUri(String(p.website || ''));
    login.uris = uri ? [{ uri, match: null }] : null;
    cipher.notes = val(p.message);
    result.ciphers.push(cipher);
  }
  return result;
}

export function parsePsonoJson(textRaw: string): CiphersImportPayload {
  const parsed = JSON.parse(textRaw) as any;
  const result: CiphersImportPayload = { ciphers: [], folders: [], folderRelationships: [] };

  function parseItem(item: any, folderName: string | null) {
    if (!item || typeof item !== 'object') return;
    const type = txt(item.type);
    const cipher = makeLoginCipher();
    if (type === 'website_password') {
      cipher.name = val(item.website_password_title, '--');
      cipher.notes = val(item.website_password_notes);
      const login = cipher.login as Record<string, unknown>;
      login.username = val(item.website_password_username);
      login.password = val(item.website_password_password);
      const uri = normalizeUri(item.website_password_url || '');
      login.uris = uri ? [{ uri, match: null }] : null;
      const idx = result.ciphers.push(cipher) - 1;
      if (folderName) addFolder(result, folderName, idx);
      return;
    }
    if (type === 'application_password') {
      cipher.name = val(item.application_password_title, '--');
      cipher.notes = val(item.application_password_notes);
      const login = cipher.login as Record<string, unknown>;
      login.username = val(item.application_password_username);
      login.password = val(item.application_password_password);
      const idx = result.ciphers.push(cipher) - 1;
      if (folderName) addFolder(result, folderName, idx);
      return;
    }
    if (type === 'totp') {
      cipher.name = val(item.totp_title, '--');
      cipher.notes = val(item.totp_notes);
      (cipher.login as Record<string, unknown>).totp = val(item.totp_code);
      const idx = result.ciphers.push(cipher) - 1;
      if (folderName) addFolder(result, folderName, idx);
      return;
    }
    if (type === 'bookmark') {
      cipher.name = val(item.bookmark_title, '--');
      cipher.notes = val(item.bookmark_notes);
      const uri = normalizeUri(item.bookmark_url || '');
      (cipher.login as Record<string, unknown>).uris = uri ? [{ uri, match: null }] : null;
      const idx = result.ciphers.push(cipher) - 1;
      if (folderName) addFolder(result, folderName, idx);
      return;
    }
    if (type === 'note' || type === 'environment_variables') {
      const secure = {
        type: 2,
        name: val(type === 'note' ? item.note_title : item.environment_variables_title, '--'),
        notes: val(type === 'note' ? item.note_notes : item.environment_variables_notes),
        favorite: false,
        reprompt: 0,
        key: null,
        login: null,
        card: null,
        identity: null,
        secureNote: { type: 0 },
        fields: null,
        passwordHistory: null,
        sshKey: null,
      } as Record<string, unknown>;
      const idx = result.ciphers.push(secure) - 1;
      if (folderName) addFolder(result, folderName, idx);
    }
  }

  function walkFolders(folders: any[], parent: string | null) {
    for (const f of folders || []) {
      const name = parent ? `${parent}/${txt(f.name)}` : txt(f.name);
      for (const item of f.items || []) parseItem(item, name);
      if (Array.isArray(f.folders)) walkFolders(f.folders, name);
    }
  }

  for (const item of parsed.items || []) parseItem(item, null);
  walkFolders(parsed.folders || [], null);
  return result;
}

export function parsePasswordBossJson(textRaw: string): CiphersImportPayload {
  const parsed = JSON.parse(textRaw) as { folders?: any[]; items?: any[] };
  const result: CiphersImportPayload = { ciphers: [], folders: [], folderRelationships: [] };
  const folderNameById = new Map<string, string>();
  for (const f of parsed.folders || []) {
    if (f?.id && f?.name) folderNameById.set(String(f.id), String(f.name));
  }
  for (const item of parsed.items || []) {
    const ids = item?.identifiers || {};
    const isCard = txt(item?.type) === 'CreditCard';
    const base = isCard
      ? {
          type: 3,
          name: val(item?.name, '--'),
          notes: val(ids.notes),
          favorite: false,
          reprompt: 0,
          key: null,
          login: null,
          card: {
            number: val(ids.cardNumber),
            cardholderName: val(ids.nameOnCard),
            code: val(ids.security_code),
            brand: cardBrand(val(ids.cardNumber)),
            expMonth: null,
            expYear: null,
          },
          identity: null,
          secureNote: null,
          fields: [],
          passwordHistory: null,
          sshKey: null,
        }
      : makeLoginCipher();
    if (!isCard) {
      base.name = val(item?.name, '--');
      base.notes = val(ids.notes);
      const login = base.login as Record<string, unknown>;
      login.username = val(ids.username, val(ids.email));
      login.password = val(ids.password);
      login.totp = val(ids.totp);
      const uri = normalizeUri(item?.login_url || ids.url || '');
      login.uris = uri ? [{ uri, match: null }] : null;
    }
    if (Array.isArray(ids.custom_fields)) {
      for (const cf of ids.custom_fields) processKvp(base as Record<string, unknown>, cf?.name || '', cf?.value || '', false);
    }
    const idx = result.ciphers.push(base as Record<string, unknown>) - 1;
    const folderId = item?.folder;
    if (folderId && folderNameById.has(String(folderId))) addFolder(result, folderNameById.get(String(folderId)) || '', idx);
  }
  return result;
}
