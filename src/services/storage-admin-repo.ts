import type { AuditLog, Invite } from '../types';

export async function createInvite(db: D1Database, invite: Invite): Promise<void> {
  await db
    .prepare(
      'INSERT INTO invites(code, created_by, used_by, expires_at, status, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?)'
    )
    .bind(invite.code, invite.createdBy, invite.usedBy, invite.expiresAt, invite.status, invite.createdAt, invite.updatedAt)
    .run();
}

export async function getInvite(db: D1Database, code: string): Promise<Invite | null> {
  const row = await db
    .prepare('SELECT code, created_by, used_by, expires_at, status, created_at, updated_at FROM invites WHERE code = ?')
    .bind(code)
    .first<any>();
  if (!row) return null;
  return {
    code: row.code,
    createdBy: row.created_by,
    usedBy: row.used_by ?? null,
    expiresAt: row.expires_at,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listInvites(db: D1Database, includeInactive: boolean = false): Promise<Invite[]> {
  const now = new Date().toISOString();
  const predicate = includeInactive
    ? '1 = 1'
    : "(status = 'active' AND expires_at > ?)";
  const query =
    'SELECT code, created_by, used_by, expires_at, status, created_at, updated_at FROM invites ' +
    `WHERE ${predicate} ORDER BY created_at DESC`;
  const res = includeInactive
    ? await db.prepare(query).all<any>()
    : await db.prepare(query).bind(now).all<any>();

  return (res.results || []).map((row) => ({
    code: row.code,
    createdBy: row.created_by,
    usedBy: row.used_by ?? null,
    expiresAt: row.expires_at,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function markInviteUsed(db: D1Database, code: string, userId: string): Promise<boolean> {
  const now = new Date().toISOString();
  const result = await db
    .prepare(
      "UPDATE invites SET status = 'used', used_by = ?, updated_at = ? WHERE code = ? AND status = 'active' AND expires_at > ?"
    )
    .bind(userId, now, code, now)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

export async function revokeInvite(db: D1Database, code: string): Promise<boolean> {
  const now = new Date().toISOString();
  const result = await db
    .prepare("UPDATE invites SET status = 'revoked', updated_at = ? WHERE code = ? AND status = 'active'")
    .bind(now, code)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

export async function deleteAllInvites(db: D1Database): Promise<number> {
  const result = await db.prepare('DELETE FROM invites').run();
  return Number(result.meta.changes ?? 0);
}

export async function createAuditLog(db: D1Database, log: AuditLog): Promise<void> {
  await db
    .prepare(
      'INSERT INTO audit_logs(id, actor_user_id, action, target_type, target_id, metadata, created_at) VALUES(?, ?, ?, ?, ?, ?, ?)'
    )
    .bind(log.id, log.actorUserId, log.action, log.targetType, log.targetId, log.metadata, log.createdAt)
    .run();
}
