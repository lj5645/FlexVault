import type { Cipher, Folder } from '../types';

function mapFolderRow(row: any): Folder {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getFolder(db: D1Database, id: string): Promise<Folder | null> {
  const row = await db
    .prepare('SELECT id, user_id, name, created_at, updated_at FROM folders WHERE id = ?')
    .bind(id)
    .first<any>();
  if (!row) return null;
  return mapFolderRow(row);
}

export async function saveFolder(db: D1Database, folder: Folder): Promise<void> {
  await db
    .prepare(
      'INSERT INTO folders(id, user_id, name, created_at, updated_at) VALUES(?, ?, ?, ?, ?) ' +
      'ON CONFLICT(id) DO UPDATE SET user_id=excluded.user_id, name=excluded.name, updated_at=excluded.updated_at'
    )
    .bind(folder.id, folder.userId, folder.name, folder.createdAt, folder.updatedAt)
    .run();
}

export async function deleteFolder(db: D1Database, id: string, userId: string): Promise<void> {
  await db.prepare('DELETE FROM folders WHERE id = ? AND user_id = ?').bind(id, userId).run();
}

export async function clearFolderFromCiphers(
  db: D1Database,
  userId: string,
  folderId: string,
  saveCipher: (cipher: Cipher) => Promise<void>
): Promise<void> {
  const now = new Date().toISOString();
  const res = await db
    .prepare('SELECT data FROM ciphers WHERE user_id = ? AND folder_id = ?')
    .bind(userId, folderId)
    .all<{ data: string }>();

  for (const row of (res.results || [])) {
    let cipher: Cipher;
    try {
      cipher = JSON.parse(row.data) as Cipher;
    } catch {
      continue;
    }
    cipher.folderId = null;
    cipher.updatedAt = now;
    await saveCipher(cipher);
  }
}

export async function bulkDeleteFolders(
  db: D1Database,
  userId: string,
  ids: string[],
  sqlChunkSize: (fixedBindCount: number) => number,
  saveCipher: (cipher: Cipher) => Promise<void>,
  updateRevisionDate: (userId: string) => Promise<string>
): Promise<string | null> {
  const uniqueIds = Array.from(new Set(ids.map((id) => String(id || '').trim()).filter(Boolean)));
  if (!uniqueIds.length) return null;

  const chunkSize = sqlChunkSize(1);
  const now = new Date().toISOString();

  for (let i = 0; i < uniqueIds.length; i += chunkSize) {
    const chunk = uniqueIds.slice(i, i + chunkSize);
    const placeholders = chunk.map(() => '?').join(',');
    const res = await db
      .prepare(`SELECT data FROM ciphers WHERE user_id = ? AND folder_id IN (${placeholders})`)
      .bind(userId, ...chunk)
      .all<{ data: string }>();

    for (const row of res.results || []) {
      let cipher: Cipher;
      try {
        cipher = JSON.parse(row.data) as Cipher;
      } catch {
        continue;
      }
      cipher.folderId = null;
      cipher.updatedAt = now;
      await saveCipher(cipher);
    }

    await db
      .prepare(`DELETE FROM folders WHERE user_id = ? AND id IN (${placeholders})`)
      .bind(userId, ...chunk)
      .run();
  }

  return updateRevisionDate(userId);
}

export async function getAllFolders(db: D1Database, userId: string): Promise<Folder[]> {
  const res = await db
    .prepare('SELECT id, user_id, name, created_at, updated_at FROM folders WHERE user_id = ? ORDER BY updated_at DESC')
    .bind(userId)
    .all<any>();
  return (res.results || []).map((row) => mapFolderRow(row));
}

export async function getFoldersPage(db: D1Database, userId: string, limit: number, offset: number): Promise<Folder[]> {
  const res = await db
    .prepare(
      'SELECT id, user_id, name, created_at, updated_at FROM folders WHERE user_id = ? ORDER BY updated_at DESC LIMIT ? OFFSET ?'
    )
    .bind(userId, limit, offset)
    .all<any>();
  return (res.results || []).map((row) => mapFolderRow(row));
}
