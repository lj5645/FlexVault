import type { CiphersImportPayload } from '@/lib/api/vault';
import { addFolder, cardBrand, makeLoginCipher, nameFromUrl, normalizeUri, parseCsv, parseSerializedUris, txt, val } from '@/lib/import-format-shared';

export function parseChromeCsv(textRaw: string): CiphersImportPayload {
  const rows = parseCsv(textRaw);
  const result: CiphersImportPayload = { ciphers: [], folders: [], folderRelationships: [] };
  for (const row of rows) {
    const cipher = makeLoginCipher();
    const m = txt(row.url).match(/^android:\/\/.*@([^/]+)\//);
    const uri = m ? `androidapp://${m[1]}` : normalizeUri(row.url || '');
    cipher.name = val(row.name, m?.[1] || '--');
    const login = cipher.login as Record<string, unknown>;
    login.username = val(row.username);
    login.password = val(row.password);
    login.uris = uri ? [{ uri, match: null }] : null;
    cipher.notes = val(row.note);
    result.ciphers.push(cipher);
  }
  return result;
}

export function parseFirefoxCsv(textRaw: string): CiphersImportPayload {
  const rows = parseCsv(textRaw).filter((r) => txt(r.url) !== 'chrome://FirefoxAccounts');
  const result: CiphersImportPayload = { ciphers: [], folders: [], folderRelationships: [] };
  for (const row of rows) {
    const cipher = makeLoginCipher();
    const raw = val(row.url, val(row.hostname, '') || '') || '';
    let name: string | null = null;
    try {
      const host = new URL(normalizeUri(raw) || '').hostname || '';
      name = host.startsWith('www.') ? host.slice(4) : host || null;
    } catch {}
    cipher.name = val(name, '--');
    const login = cipher.login as Record<string, unknown>;
    login.username = val(row.username);
    login.password = val(row.password);
    const uri = normalizeUri(raw);
    login.uris = uri ? [{ uri, match: null }] : null;
    result.ciphers.push(cipher);
  }
  return result;
}

export function parseSafariCsv(textRaw: string): CiphersImportPayload {
  const rows = parseCsv(textRaw);
  const result: CiphersImportPayload = { ciphers: [], folders: [], folderRelationships: [] };
  for (const row of rows) {
    const cipher = makeLoginCipher();
    cipher.name = val(row.Title, '--');
    const login = cipher.login as Record<string, unknown>;
    login.username = val(row.Username);
    login.password = val(row.Password);
    const uri = normalizeUri(row.Url || row.URL || '');
    login.uris = uri ? [{ uri, match: null }] : null;
    login.totp = val(row.OTPAuth);
    cipher.notes = val(row.Notes);
    result.ciphers.push(cipher);
  }
  return result;
}

export function parseBitwardenCsv(textRaw: string): CiphersImportPayload {
  const rows = parseCsv(textRaw);
  const result: CiphersImportPayload = { ciphers: [], folders: [], folderRelationships: [] };
  for (const row of rows) {
    const type = txt(row.type).toLowerCase() || 'login';
    if (type === 'note') {
      const idx =
        result.ciphers.push({
          type: 2,
          name: val(row.name, '--'),
          notes: val(row.notes),
          favorite: txt(row.favorite) === '1',
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
      addFolder(result, row.folder, idx);
      continue;
    }
    const cipher = makeLoginCipher();
    cipher.name = val(row.name, '--');
    cipher.notes = val(row.notes);
    cipher.favorite = txt(row.favorite) === '1';
    const login = cipher.login as Record<string, unknown>;
    login.username = val(row.login_username);
    login.password = val(row.login_password);
    login.totp = val(row.login_totp);
    const uris = parseSerializedUris(row.login_uri || '');
    login.uris = uris.length ? uris.map((uri) => ({ uri, match: null })) : null;
    const idx = result.ciphers.push(cipher) - 1;
    addFolder(result, row.folder, idx);
  }
  return result;
}

export function parseAviraCsv(textRaw: string): CiphersImportPayload {
  const rows = parseCsv(textRaw);
  const result: CiphersImportPayload = { ciphers: [], folders: [], folderRelationships: [] };
  for (const row of rows) {
    const cipher = makeLoginCipher();
    cipher.name = val(row.name, val(nameFromUrl(row.website), '--'));
    const login = cipher.login as Record<string, unknown>;
    login.uris = normalizeUri(row.website || '') ? [{ uri: normalizeUri(row.website || ''), match: null }] : null;
    login.password = val(row.password);
    if (!txt(row.username) && txt(row.secondary_username)) {
      login.username = val(row.secondary_username);
    } else {
      login.username = val(row.username);
      cipher.notes = val(row.secondary_username);
    }
    result.ciphers.push(cipher);
  }
  return result;
}

export function parseAvastCsv(textRaw: string): CiphersImportPayload {
  const rows = parseCsv(textRaw);
  const result: CiphersImportPayload = { ciphers: [], folders: [], folderRelationships: [] };
  for (const row of rows) {
    const cipher = makeLoginCipher();
    cipher.name = val(row.name, '--');
    const login = cipher.login as Record<string, unknown>;
    login.uris = normalizeUri(row.web || '') ? [{ uri: normalizeUri(row.web || ''), match: null }] : null;
    login.password = val(row.password);
    login.username = val(row.login);
    result.ciphers.push(cipher);
  }
  return result;
}

export function parseAvastJson(textRaw: string): CiphersImportPayload {
  const parsed = JSON.parse(textRaw) as { logins?: any[]; notes?: any[]; cards?: any[] };
  const result: CiphersImportPayload = { ciphers: [], folders: [], folderRelationships: [] };
  for (const value of parsed.logins || []) {
    const cipher = makeLoginCipher();
    cipher.name = val(value?.custName, '--');
    cipher.notes = val(value?.note);
    const login = cipher.login as Record<string, unknown>;
    const uri = normalizeUri(value?.url || '');
    login.uris = uri ? [{ uri, match: null }] : null;
    login.password = val(value?.pwd);
    login.username = val(value?.loginName);
    result.ciphers.push(cipher);
  }
  for (const value of parsed.notes || []) {
    result.ciphers.push({
      type: 2,
      name: val(value?.label, '--'),
      notes: val(value?.text),
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
    });
  }
  for (const value of parsed.cards || []) {
    result.ciphers.push({
      type: 3,
      name: val(value?.custName, '--'),
      notes: val(value?.note),
      favorite: false,
      reprompt: 0,
      key: null,
      login: null,
      card: {
        cardholderName: val(value?.holderName),
        number: val(value?.cardNumber),
        code: val(value?.cvv),
        brand: cardBrand(val(value?.cardNumber)),
        expMonth: val(value?.expirationDate?.month),
        expYear: val(value?.expirationDate?.year),
      },
      identity: null,
      secureNote: null,
      fields: null,
      passwordHistory: null,
      sshKey: null,
    });
  }
  return result;
}
