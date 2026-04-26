import type { CiphersImportPayload } from '@/lib/api/vault';
import {
  addFolder,
  addLoginUri,
  cardBrand,
  convertToNoteIfNeeded,
  extractTotpValue,
  isTotpFieldName,
  makeLoginCipher,
  normalizeUri,
  parseCardExpiry,
  parseCsv,
  parseEpochMaybe,
  processKvp,
  setLoginUris,
  txt,
  val,
} from '@/lib/import-format-shared';

function onePasswordTypeHints(typeName: string): 1 | 2 | 3 | 4 {
  const t = txt(typeName).toLowerCase();
  if (t.includes('creditcard') || t.includes('credit card')) return 3;
  if (t.includes('identity')) return 4;
  if (t.includes('securenote') || t.includes('secure note')) return 2;
  return 1;
}

function onePasswordCategoryType(categoryUuid: string): 1 | 2 | 3 | 4 | 5 {
  const c = txt(categoryUuid);
  if (['002', '101'].includes(c)) return 3;
  if (['004', '103', '104', '105', '106', '107', '108'].includes(c)) return 4;
  if (['003', '100', '111', '113'].includes(c)) return 2;
  if (c === '114') return 5;
  return 1;
}

function onePasswordCsvFieldLabel(property: string): string {
  return txt(property)
    .toLowerCase()
    .replace(/^.*?:\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isOnePasswordUriField(property: string): boolean {
  const label = onePasswordCsvFieldLabel(property);
  return ['url', 'urls', 'website', 'web site'].includes(label);
}

function isOnePasswordUsernameField(property: string): boolean {
  return ['username', 'user name', 'email', 'e-mail', 'login'].includes(onePasswordCsvFieldLabel(property));
}

function isOnePasswordPasswordField(property: string): boolean {
  return ['password', 'passphrase'].includes(onePasswordCsvFieldLabel(property));
}

function readOnePasswordFieldValue(rawValue: unknown): { value: string; kind: string; raw: unknown } {
  if (!rawValue || typeof rawValue !== 'object' || Array.isArray(rawValue)) {
    return { value: txt(rawValue), kind: '', raw: rawValue };
  }

  const obj = rawValue as Record<string, unknown>;
  const keys = Object.keys(obj);
  const kind = keys.find((key) => obj[key] !== null && obj[key] !== undefined && txt(obj[key]) !== '') || keys[0] || '';
  const raw = kind ? obj[kind] : undefined;
  if (kind === 'date') {
    const iso = parseEpochMaybe(raw);
    return { value: iso ? new Date(iso).toUTCString() : txt(raw), kind, raw };
  }
  if (kind === 'monthYear') return { value: txt(raw), kind, raw };
  if (kind === 'email' && raw && typeof raw === 'object') {
    return { value: txt((raw as Record<string, unknown>).email_address), kind, raw };
  }
  if (kind === 'address' || kind === 'sshKey') return { value: '', kind, raw };
  return { value: txt(raw), kind, raw };
}

export function parseOnePasswordCsv(textRaw: string, isMac: boolean): CiphersImportPayload {
  const rows = parseCsv(textRaw);
  const result: CiphersImportPayload = { ciphers: [], folders: [], folderRelationships: [] };
  const ignored = new Set(['ainfo', 'autosubmit', 'notesplain', 'ps', 'scope', 'tags', 'title', 'uuid', 'notes', 'type']);
  for (const row of rows) {
    const title = txt(row.title || row.Title);
    if (!title) continue;
    const cipher = makeLoginCipher();
    cipher.name = title || '--';
    cipher.notes = `${txt(row.notesPlain)}\n${txt(row.notes)}`.trim() || null;

    let type: 1 | 2 | 3 | 4 = 1;
    if (isMac) {
      const t = txt(row.type).toLowerCase();
      if (t === 'credit card') type = 3;
      else if (t === 'identity') type = 4;
      else if (t === 'secure note') type = 2;
    } else {
      const values = Object.keys(row).map((k) => `${k}:${txt(row[k])}`.toLowerCase());
      const hasCard = values.some((x) => /number/i.test(x)) && values.some((x) => /expiry date/i.test(x));
      const hasIdentity = values.some((x) => /first name|initial|last name|email/.test(x));
      if (hasCard) type = 3;
      else if (hasIdentity) type = 4;
    }
    if (type === 2) {
      cipher.type = 2;
      cipher.login = null;
      cipher.secureNote = { type: 0 };
    } else if (type === 3) {
      cipher.type = 3;
      cipher.login = null;
      cipher.card = { cardholderName: null, number: null, brand: null, expMonth: null, expYear: null, code: null };
    } else if (type === 4) {
      cipher.type = 4;
      cipher.login = null;
      cipher.identity = {
        firstName: null,
        middleName: null,
        lastName: null,
        username: null,
        email: null,
        phone: null,
        company: null,
      };
    }

    let altUsername: string | null = null;
    for (const property of Object.keys(row)) {
      const rawVal = txt(row[property]);
      if (!rawVal) continue;
      const lower = property.toLowerCase();

      if (Number(cipher.type) === 1) {
        const login = cipher.login as Record<string, unknown>;
        if (!txt(login.username) && isOnePasswordUsernameField(lower)) {
          login.username = rawVal;
          continue;
        }
        if (!txt(login.password) && isOnePasswordPasswordField(lower)) {
          login.password = rawVal;
          continue;
        }
        if (isOnePasswordUriField(lower)) {
          addLoginUri(login, rawVal);
          continue;
        }
        if (!txt(login.totp) && isTotpFieldName(onePasswordCsvFieldLabel(lower))) {
          login.totp = rawVal;
          continue;
        }
      } else if (Number(cipher.type) === 3 && cipher.card) {
        const card = cipher.card as Record<string, unknown>;
        if (!txt(card.number) && lower.includes('number')) {
          card.number = rawVal;
          card.brand = cardBrand(rawVal);
          continue;
        }
        if (!txt(card.code) && lower.includes('verification number')) {
          card.code = rawVal;
          continue;
        }
        if (!txt(card.cardholderName) && lower.includes('cardholder name')) {
          card.cardholderName = rawVal;
          continue;
        }
        if ((!txt(card.expMonth) || !txt(card.expYear)) && lower.includes('expiry date')) {
          const { month, year } = parseCardExpiry(rawVal);
          card.expMonth = month;
          card.expYear = year;
          continue;
        }
      } else if (Number(cipher.type) === 4 && cipher.identity) {
        const identity = cipher.identity as Record<string, unknown>;
        if (!txt(identity.firstName) && lower.includes('first name')) {
          identity.firstName = rawVal;
          continue;
        }
        if (!txt(identity.middleName) && lower.includes('initial')) {
          identity.middleName = rawVal;
          continue;
        }
        if (!txt(identity.lastName) && lower.includes('last name')) {
          identity.lastName = rawVal;
          continue;
        }
        if (!txt(identity.username) && lower.includes('username')) {
          identity.username = rawVal;
          continue;
        }
        if (!txt(identity.email) && lower.includes('email')) {
          identity.email = rawVal;
          continue;
        }
        if (!txt(identity.phone) && lower.includes('default phone')) {
          identity.phone = rawVal;
          continue;
        }
        if (!txt(identity.company) && lower.includes('company')) {
          identity.company = rawVal;
          continue;
        }
      }

      if (!ignored.has(lower) && !isTotpFieldName(onePasswordCsvFieldLabel(lower)) && !lower.startsWith('section:') && !lower.startsWith('section ')) {
        if (!altUsername && lower === 'email') altUsername = rawVal;
        if (lower === 'created date' || lower === 'modified date') {
          const readable = parseEpochMaybe(rawVal);
          processKvp(cipher, `1Password ${property}`, readable || rawVal, false);
        } else {
          const hidden = lower.includes('password') || lower.includes('key') || lower.includes('secret');
          processKvp(cipher, property, rawVal, hidden);
        }
      }
    }
    if (Number(cipher.type) === 1 && !txt((cipher.login as Record<string, unknown>).username) && altUsername && !altUsername.includes('://')) {
      (cipher.login as Record<string, unknown>).username = altUsername;
    }
    convertToNoteIfNeeded(cipher);
    result.ciphers.push(cipher);
  }
  return result;
}

function parseOnePasswordFieldsIntoCipher(
  cipher: Record<string, unknown>,
  fields: any[],
  designationKey: string,
  valueKey: string,
  nameKey: string
): void {
  for (const field of fields || []) {
    const raw = field?.[valueKey];
    if (raw === null || raw === undefined || txt(raw) === '') continue;
    const designation = txt(field?.[designationKey]).toLowerCase();
    const k = txt(field?.k).toLowerCase();
    const fieldName = txt(field?.[nameKey] ?? field?.t ?? field?.title) || 'no_name';
    let value = txt(raw);
    if (k === 'date') {
      const asDate = parseEpochMaybe(raw);
      value = asDate ? new Date(asDate).toUTCString() : value;
    }
    if (Number(cipher.type) === 1) {
      const login = cipher.login as Record<string, unknown>;
      if (!txt(login.username) && designation === 'username') {
        login.username = value;
        continue;
      }
      if (!txt(login.password) && designation === 'password') {
        login.password = value;
        continue;
      }
      if (!txt(login.totp) && (designation.startsWith('totp_') || isTotpFieldName(designation) || isTotpFieldName(fieldName))) {
        login.totp = extractTotpValue(raw) || value;
        continue;
      }
    } else if (Number(cipher.type) === 3 && cipher.card) {
      const card = cipher.card as Record<string, unknown>;
      if (!txt(card.number) && designation === 'ccnum') {
        card.number = value;
        card.brand = cardBrand(value);
        continue;
      }
      if (!txt(card.code) && designation === 'cvv') {
        card.code = value;
        continue;
      }
      if (!txt(card.cardholderName) && designation === 'cardholder') {
        card.cardholderName = value;
        continue;
      }
      if ((!txt(card.expMonth) || !txt(card.expYear)) && designation === 'expiry') {
        const { month, year } = parseCardExpiry(value);
        card.expMonth = month;
        card.expYear = year;
        continue;
      }
      if (designation === 'type') continue;
    } else if (Number(cipher.type) === 4 && cipher.identity) {
      const identity = cipher.identity as Record<string, unknown>;
      if (!txt(identity.firstName) && designation === 'firstname') {
        identity.firstName = value;
        continue;
      }
      if (!txt(identity.lastName) && designation === 'lastname') {
        identity.lastName = value;
        continue;
      }
      if (!txt(identity.middleName) && designation === 'initial') {
        identity.middleName = value;
        continue;
      }
      if (!txt(identity.phone) && designation === 'defphone') {
        identity.phone = value;
        continue;
      }
      if (!txt(identity.company) && designation === 'company') {
        identity.company = value;
        continue;
      }
      if (!txt(identity.email) && designation === 'email') {
        identity.email = value;
        continue;
      }
      if (!txt(identity.username) && designation === 'username') {
        identity.username = value;
        continue;
      }
      if (designation === 'address' && raw && typeof raw === 'object') {
        const addr = raw as Record<string, unknown>;
        identity.address1 = val(addr.street);
        identity.city = val(addr.city);
        identity.country = txt(addr.country) ? txt(addr.country).toUpperCase() : null;
        identity.postalCode = val(addr.zip);
        identity.state = val(addr.state);
        continue;
      }
    }
    processKvp(cipher, fieldName, value, k === 'concealed');
  }
}

function parseOnePasswordPasswordHistory(cipher: Record<string, unknown>, history: any[]): void {
  const parsed = (history || [])
    .map((h) => ({ password: val(h?.value), lastUsedDate: parseEpochMaybe(h?.time) }))
    .filter((x) => !!x.password && !!x.lastUsedDate)
    .sort((a, b) => String(b.lastUsedDate).localeCompare(String(a.lastUsedDate)))
    .slice(0, 5);
  cipher.passwordHistory = parsed.length ? parsed : null;
}

export function parseOnePassword1Pif(textRaw: string): CiphersImportPayload {
  const lines = textRaw.split(/\r?\n/);
  const result: CiphersImportPayload = { ciphers: [], folders: [], folderRelationships: [] };
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith('{')) continue;
    let item: any;
    try {
      item = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (item?.trashed === true) continue;
    const cipher = makeLoginCipher();
    cipher.name = val(item?.title || item?.overview?.title, '--');
    cipher.favorite = !!item?.openContents?.faveIndex;

    let type = onePasswordTypeHints(item?.typeName);
    const details = item?.details || item?.secureContents || {};
    if (details?.ccnum || details?.cvv) type = 3;
    if (details?.firstname || details?.address1) type = 4;
    if (type === 2) {
      cipher.type = 2;
      cipher.login = null;
      cipher.secureNote = { type: 0 };
    } else if (type === 3) {
      cipher.type = 3;
      cipher.login = null;
      cipher.card = { cardholderName: null, number: null, brand: null, expMonth: null, expYear: null, code: null };
    } else if (type === 4) {
      cipher.type = 4;
      cipher.login = null;
      cipher.identity = {
        firstName: null,
        middleName: null,
        lastName: null,
        phone: null,
        email: null,
        username: null,
        company: null,
      };
    }

    const uris: string[] = [];
    const locationUri = normalizeUri(item?.location || '');
    if (locationUri) uris.push(locationUri);
    for (const u of item?.URLs || item?.secureContents?.URLs || item?.overview?.URLs || []) {
      const uri = normalizeUri(u?.url || u?.u || '');
      if (uri) uris.push(uri);
    }
    if (Number(cipher.type) === 1) {
      setLoginUris(cipher.login as Record<string, unknown>, uris);
      (cipher.login as Record<string, unknown>).password = val(details?.password);
    }
    cipher.notes = val(details?.notesPlain);
    parseOnePasswordPasswordHistory(cipher, details?.passwordHistory || []);
    parseOnePasswordFieldsIntoCipher(cipher, details?.fields || [], 'designation', 'value', 'name');
    for (const section of details?.sections || []) {
      parseOnePasswordFieldsIntoCipher(cipher, section?.fields || [], 'n', 'v', 't');
    }
    convertToNoteIfNeeded(cipher);
    result.ciphers.push(cipher);
  }
  return result;
}

export function parseOnePassword1PuxJson(textRaw: string): CiphersImportPayload {
  const parsed = JSON.parse(textRaw) as { accounts?: any[] };
  const result: CiphersImportPayload = { ciphers: [], folders: [], folderRelationships: [] };
  const accounts = Array.isArray(parsed?.accounts) ? parsed.accounts : [];
  for (const account of accounts) {
    for (const vault of account?.vaults || []) {
      const vaultName = txt(vault?.attrs?.name);
      for (const item of vault?.items || []) {
        if (txt(item?.state) === 'archived') continue;
        const cipher = makeLoginCipher();
        const categoryType = onePasswordCategoryType(item?.categoryUuid);
        if (categoryType === 2) {
          cipher.type = 2;
          cipher.login = null;
          cipher.secureNote = { type: 0 };
        } else if (categoryType === 3) {
          cipher.type = 3;
          cipher.login = null;
          cipher.card = { cardholderName: null, number: null, brand: null, expMonth: null, expYear: null, code: null };
        } else if (categoryType === 4) {
          cipher.type = 4;
          cipher.login = null;
          cipher.identity = {
            firstName: null,
            middleName: null,
            lastName: null,
            phone: null,
            email: null,
            username: null,
            company: null,
            address1: null,
            city: null,
            state: null,
            postalCode: null,
            country: null,
            passportNumber: null,
            ssn: null,
            licenseNumber: null,
          };
        } else if (categoryType === 5) {
          cipher.type = 5;
          cipher.login = null;
          cipher.sshKey = {
            privateKey: null,
            publicKey: null,
            keyFingerprint: null,
            fingerprint: null,
          };
        }
        cipher.favorite = Number(item?.favIndex) === 1;
        cipher.name = val(item?.overview?.title, '--');
        cipher.notes = val(item?.details?.notesPlain);

        if (Number(cipher.type) === 1) {
          const urls: string[] = [];
          for (const u of item?.overview?.urls || []) {
            const uri = normalizeUri(u?.url || '');
            if (uri) urls.push(uri);
          }
          if (!urls.length) {
            const fallbackUrl = normalizeUri(item?.overview?.url || '');
            if (fallbackUrl) urls.push(fallbackUrl);
          }
          setLoginUris(cipher.login as Record<string, unknown>, urls);
          if (txt(item?.categoryUuid) === '005' && !txt((cipher.login as Record<string, unknown>).password)) {
            (cipher.login as Record<string, unknown>).password = val(item?.details?.password);
          }
        }

        for (const loginField of item?.details?.loginFields || []) {
          const lv = txt(loginField?.value);
          if (!lv) continue;
          const designation = txt(loginField?.designation).toLowerCase();
          const fieldName = txt(loginField?.name);
          const fieldLabel = onePasswordCsvFieldLabel(fieldName || designation);
          const fieldType = txt(loginField?.fieldType);
          if (Number(cipher.type) === 1) {
            const login = cipher.login as Record<string, unknown>;
            if (designation === 'username' || isOnePasswordUsernameField(fieldLabel)) {
              login.username = lv;
              continue;
            }
            if (designation === 'password' || isOnePasswordPasswordField(fieldLabel)) {
              login.password = lv;
              continue;
            }
            if (designation.includes('totp') || isTotpFieldName(fieldName) || isTotpFieldName(fieldType)) {
              login.totp = lv;
              continue;
            }
          }
          processKvp(cipher, fieldName || designation || 'field', lv, fieldType === 'P');
        }

        for (const section of item?.details?.sections || []) {
          const fieldTitle = txt(section?.title);
          for (const field of section?.fields || []) {
            const fieldId = txt(field?.id);
            const parsedField = readOnePasswordFieldValue(field?.value);
            const fieldType = parsedField.kind.toLowerCase();
            const fieldTitleLocal = txt(field?.title) || fieldTitle;
            const fieldValueObj = parsedField.raw;
            const fieldValue = parsedField.value;
            if (!fieldValue && !(fieldValueObj && typeof fieldValueObj === 'object')) continue;

            if (Number(cipher.type) === 3 && cipher.card) {
              const card = cipher.card as Record<string, unknown>;
              if (fieldId === 'creditCardNumber' || fieldType === 'creditcardnumber') {
                card.number = fieldValue;
                card.brand = cardBrand(fieldValue);
                continue;
              }
              if (fieldId === 'creditCardVerificationNumber') {
                card.code = fieldValue;
                continue;
              }
              if (fieldId === 'creditCardCardholder') {
                card.cardholderName = fieldValue;
                continue;
              }
              if (fieldId === 'creditCardExpiry') {
                const { month, year } = parseCardExpiry(fieldValue);
                card.expMonth = month;
                card.expYear = year;
                continue;
              }
            } else if (Number(cipher.type) === 4 && cipher.identity) {
              const identity = cipher.identity as Record<string, unknown>;
              if (fieldId === 'firstName') {
                identity.firstName = fieldValue;
                continue;
              }
              if (fieldId === 'lastName') {
                identity.lastName = fieldValue;
                continue;
              }
              if (fieldId === 'initial') {
                identity.middleName = fieldValue;
                continue;
              }
              if (fieldId === 'company') {
                identity.company = fieldValue;
                continue;
              }
              if (fieldId === 'email') {
                identity.email = fieldValue;
                continue;
              }
              if (fieldId === 'phone') {
                identity.phone = fieldValue;
                continue;
              }
              if (fieldId === 'username') {
                identity.username = fieldValue;
                continue;
              }
              if (fieldId === 'address' && fieldValueObj && typeof fieldValueObj === 'object') {
                const addr = fieldValueObj as Record<string, unknown>;
                identity.address1 = val(addr.street);
                identity.city = val(addr.city);
                identity.state = val(addr.state);
                identity.postalCode = val(addr.zip);
                identity.country = txt(addr.country) ? txt(addr.country).toUpperCase() : null;
                continue;
              }
              if (fieldId === 'socialSecurityNumber') {
                identity.ssn = fieldValue;
                continue;
              }
              if (fieldId === 'passportNumber') {
                identity.passportNumber = fieldValue;
                continue;
              }
              if (fieldId === 'licenseNumber') {
                identity.licenseNumber = fieldValue;
                continue;
              }
            } else if (Number(cipher.type) === 1) {
              const login = cipher.login as Record<string, unknown>;
              if (fieldId === 'url' || fieldType === 'url') {
                addLoginUri(login, fieldValue);
                continue;
              }
              if ((fieldId === 'username' || onePasswordCsvFieldLabel(fieldTitleLocal) === 'username') && !txt(login.username)) {
                login.username = fieldValue;
                continue;
              }
              if ((fieldId === 'password' || onePasswordCsvFieldLabel(fieldTitleLocal) === 'password') && !txt(login.password)) {
                login.password = fieldValue;
                continue;
              }
              if (txt(item?.categoryUuid) === '112' && onePasswordCsvFieldLabel(fieldTitleLocal) === 'credential' && !txt(login.password)) {
                login.password = fieldValue;
                continue;
              }
              if (txt(item?.categoryUuid) === '112' && onePasswordCsvFieldLabel(fieldTitleLocal) === 'hostname') {
                addLoginUri(login, fieldValue);
                continue;
              }
              if (
                (fieldId === 'oneTimePassword' || fieldId === 'totp' || fieldId.startsWith('TOTP_') || fieldType === 'totp' || fieldType === 'otp' || isTotpFieldName(fieldTitleLocal)) &&
                !txt(login.totp)
              ) {
                login.totp = extractTotpValue(fieldValueObj) || fieldValue;
                continue;
              }
            } else if (Number(cipher.type) === 5 && cipher.sshKey && fieldType === 'sshkey' && fieldValueObj && typeof fieldValueObj === 'object') {
              const ssh = fieldValueObj as Record<string, any>;
              const metadata = ssh.metadata && typeof ssh.metadata === 'object' ? ssh.metadata : {};
              cipher.sshKey = {
                privateKey: val(metadata.privateKey ?? ssh.privateKey),
                publicKey: val(metadata.publicKey),
                keyFingerprint: val(metadata.fingerprint),
                fingerprint: val(metadata.fingerprint),
              };
              continue;
            }

            const hidden = fieldType === 'concealed' || fieldType === 'totp' || fieldType === 'otp';
            processKvp(cipher, fieldTitleLocal || fieldId || 'field', fieldValue, hidden);
          }
        }
        parseOnePasswordPasswordHistory(cipher, item?.details?.passwordHistory || []);
        convertToNoteIfNeeded(cipher);
        const idx = result.ciphers.push(cipher) - 1;
        const tagFolder = Array.isArray(item?.overview?.tags) ? txt(item.overview.tags[0]) : '';
        if (tagFolder) addFolder(result, tagFolder, idx);
        else if (vaultName) addFolder(result, vaultName, idx);
      }
    }
  }
  return result;
}
