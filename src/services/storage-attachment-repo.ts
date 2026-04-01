import type { Attachment, Cipher } from '../types';

type SafeBind = (stmt: D1PreparedStatement, ...values: any[]) => D1PreparedStatement;
type SqlChunkSize = (fixedBindCount: number) => number;
type GetCipher = (id: string) => Promise<Cipher | null>;
type SaveCipher = (cipher: Cipher) => Promise<void>;
type UpdateRevisionDate = (userId: string) => Promise<string>;

export async function getAttachment(db: D1Database, id: string): Promise<Attachment | null> {
  const row = await db
    .prepare('SELECT id, cipher_id, file_name, size, size_name, key FROM attachments WHERE id = ?')
    .bind(id)
    .first<any>();
  if (!row) return null;
  return {
    id: row.id,
    cipherId: row.cipher_id,
    fileName: row.file_name,
    size: row.size,
    sizeName: row.size_name,
    key: row.key,
  };
}

export async function saveAttachment(db: D1Database, safeBind: SafeBind, attachment: Attachment): Promise<void> {
  const stmt = db.prepare(
    'INSERT INTO attachments(id, cipher_id, file_name, size, size_name, key) VALUES(?, ?, ?, ?, ?, ?) ' +
    'ON CONFLICT(id) DO UPDATE SET cipher_id=excluded.cipher_id, file_name=excluded.file_name, size=excluded.size, size_name=excluded.size_name, key=excluded.key'
  );
  await safeBind(stmt, attachment.id, attachment.cipherId, attachment.fileName, attachment.size, attachment.sizeName, attachment.key).run();
}

export async function deleteAttachment(db: D1Database, id: string): Promise<void> {
  await db.prepare('DELETE FROM attachments WHERE id = ?').bind(id).run();
}

export async function getAttachmentsByCipher(db: D1Database, cipherId: string): Promise<Attachment[]> {
  const res = await db
    .prepare('SELECT id, cipher_id, file_name, size, size_name, key FROM attachments WHERE cipher_id = ?')
    .bind(cipherId)
    .all<any>();
  return (res.results || []).map((r) => ({
    id: r.id,
    cipherId: r.cipher_id,
    fileName: r.file_name,
    size: r.size,
    sizeName: r.size_name,
    key: r.key,
  }));
}

export async function getAttachmentsByCipherIds(
  db: D1Database,
  sqlChunkSize: SqlChunkSize,
  cipherIds: string[]
): Promise<Map<string, Attachment[]>> {
  const grouped = new Map<string, Attachment[]>();
  if (cipherIds.length === 0) return grouped;

  const uniqueCipherIds = [...new Set(cipherIds)];
  const chunkSize = sqlChunkSize(0);

  for (let i = 0; i < uniqueCipherIds.length; i += chunkSize) {
    const chunk = uniqueCipherIds.slice(i, i + chunkSize);
    const placeholders = chunk.map(() => '?').join(',');
    const res = await db
      .prepare(`SELECT id, cipher_id, file_name, size, size_name, key FROM attachments WHERE cipher_id IN (${placeholders})`)
      .bind(...chunk)
      .all<any>();

    for (const row of res.results || []) {
      const item: Attachment = {
        id: row.id,
        cipherId: row.cipher_id,
        fileName: row.file_name,
        size: row.size,
        sizeName: row.size_name,
        key: row.key,
      };
      const list = grouped.get(item.cipherId);
      if (list) list.push(item);
      else grouped.set(item.cipherId, [item]);
    }
  }

  return grouped;
}

export async function getAttachmentsByUserId(db: D1Database, userId: string): Promise<Map<string, Attachment[]>> {
  const grouped = new Map<string, Attachment[]>();
  const res = await db
    .prepare(
      `SELECT a.id, a.cipher_id, a.file_name, a.size, a.size_name, a.key
       FROM attachments a
       INNER JOIN ciphers c ON c.id = a.cipher_id
       WHERE c.user_id = ?`
    )
    .bind(userId)
    .all<any>();

  for (const row of res.results || []) {
    const item: Attachment = {
      id: row.id,
      cipherId: row.cipher_id,
      fileName: row.file_name,
      size: row.size,
      sizeName: row.size_name,
      key: row.key,
    };
    const list = grouped.get(item.cipherId);
    if (list) list.push(item);
    else grouped.set(item.cipherId, [item]);
  }

  return grouped;
}

export async function addAttachmentToCipher(db: D1Database, cipherId: string, attachmentId: string): Promise<void> {
  await db.prepare('UPDATE attachments SET cipher_id = ? WHERE id = ?').bind(cipherId, attachmentId).run();
}

export async function removeAttachmentFromCipher(cipherId: string, attachmentId: string): Promise<void> {
  void cipherId;
  void attachmentId;
}

export async function deleteAllAttachmentsByCipher(db: D1Database, cipherId: string): Promise<void> {
  await db.prepare('DELETE FROM attachments WHERE cipher_id = ?').bind(cipherId).run();
}

export async function updateCipherRevisionDate(
  getCipherById: GetCipher,
  saveCipherRecord: SaveCipher,
  updateRevisionDate: UpdateRevisionDate,
  cipherId: string
): Promise<{ userId: string; revisionDate: string } | null> {
  const cipher = await getCipherById(cipherId);
  if (!cipher) return null;
  cipher.updatedAt = new Date().toISOString();
  await saveCipherRecord(cipher);
  const revisionDate = await updateRevisionDate(cipher.userId);
  return { userId: cipher.userId, revisionDate };
}
