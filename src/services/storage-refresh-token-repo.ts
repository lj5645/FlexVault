import type { RefreshTokenRecord } from '../types';

type RefreshTokenKeyFn = (token: string) => Promise<string>;
type CleanupExpiredFn = (nowMs: number) => Promise<void>;

export async function saveRefreshToken(
  db: D1Database,
  refreshTokenKey: RefreshTokenKeyFn,
  maybeCleanupExpiredRefreshTokens: CleanupExpiredFn,
  token: string,
  userId: string,
  expiresAtMs: number,
  deviceIdentifier?: string | null,
  deviceSessionStamp?: string | null
): Promise<void> {
  await maybeCleanupExpiredRefreshTokens(Date.now());
  const tokenKey = await refreshTokenKey(token);
  await db
    .prepare(
      'INSERT INTO refresh_tokens(token, user_id, expires_at, device_identifier, device_session_stamp) VALUES(?, ?, ?, ?, ?) ' +
        'ON CONFLICT(token) DO UPDATE SET user_id=excluded.user_id, expires_at=excluded.expires_at, device_identifier=excluded.device_identifier, device_session_stamp=excluded.device_session_stamp'
    )
    .bind(tokenKey, userId, expiresAtMs, deviceIdentifier ?? null, deviceSessionStamp ?? null)
    .run();
}

export async function getRefreshTokenRecord(
  db: D1Database,
  refreshTokenKey: RefreshTokenKeyFn,
  maybeCleanupExpiredRefreshTokens: CleanupExpiredFn,
  saveRefreshTokenRecord: (
    token: string,
    userId: string,
    expiresAtMs?: number,
    deviceIdentifier?: string | null,
    deviceSessionStamp?: string | null
  ) => Promise<void>,
  deleteRefreshTokenRecord: (token: string) => Promise<void>,
  token: string
): Promise<RefreshTokenRecord | null> {
  const now = Date.now();
  await maybeCleanupExpiredRefreshTokens(now);
  const tokenKey = await refreshTokenKey(token);

  let row = await db
    .prepare('SELECT user_id, expires_at, device_identifier, device_session_stamp FROM refresh_tokens WHERE token = ?')
    .bind(tokenKey)
    .first<{ user_id: string; expires_at: number; device_identifier: string | null; device_session_stamp: string | null }>();

  if (!row) {
    const legacyRow = await db
      .prepare('SELECT user_id, expires_at, device_identifier, device_session_stamp FROM refresh_tokens WHERE token = ?')
      .bind(token)
      .first<{ user_id: string; expires_at: number; device_identifier: string | null; device_session_stamp: string | null }>();

    if (legacyRow) {
      if (legacyRow.expires_at && legacyRow.expires_at < now) {
        await deleteRefreshTokenRecord(token);
        return null;
      }
      await saveRefreshTokenRecord(
        token,
        legacyRow.user_id,
        legacyRow.expires_at,
        legacyRow.device_identifier ?? null,
        legacyRow.device_session_stamp ?? null
      );
      await db.prepare('DELETE FROM refresh_tokens WHERE token = ?').bind(token).run();
      return {
        userId: legacyRow.user_id,
        expiresAt: legacyRow.expires_at,
        deviceIdentifier: legacyRow.device_identifier ?? null,
        deviceSessionStamp: legacyRow.device_session_stamp ?? null,
      };
    }
  }

  if (!row) return null;
  if (row.expires_at && row.expires_at < now) {
    await deleteRefreshTokenRecord(token);
    return null;
  }
  return {
    userId: row.user_id,
    expiresAt: row.expires_at,
    deviceIdentifier: row.device_identifier ?? null,
    deviceSessionStamp: row.device_session_stamp ?? null,
  };
}

export async function deleteRefreshToken(db: D1Database, refreshTokenKey: RefreshTokenKeyFn, token: string): Promise<void> {
  const tokenKey = await refreshTokenKey(token);
  await db.prepare('DELETE FROM refresh_tokens WHERE token = ?').bind(token).run();
  await db.prepare('DELETE FROM refresh_tokens WHERE token = ?').bind(tokenKey).run();
}

export async function deleteRefreshTokensByUserId(db: D1Database, userId: string): Promise<number> {
  const result = await db.prepare('DELETE FROM refresh_tokens WHERE user_id = ?').bind(userId).run();
  return Number(result.meta.changes ?? 0);
}

export async function deleteRefreshTokensByDevice(db: D1Database, userId: string, deviceIdentifier: string): Promise<number> {
  const result = await db
    .prepare('DELETE FROM refresh_tokens WHERE user_id = ? AND device_identifier = ?')
    .bind(userId, deviceIdentifier)
    .run();
  return Number(result.meta.changes ?? 0);
}

export async function constrainRefreshTokenExpiry(
  db: D1Database,
  refreshTokenKey: RefreshTokenKeyFn,
  token: string,
  maxExpiresAtMs: number
): Promise<void> {
  const tokenKey = await refreshTokenKey(token);

  await db
    .prepare(
      'UPDATE refresh_tokens ' +
        'SET expires_at = CASE WHEN expires_at > ? THEN ? ELSE expires_at END ' +
        'WHERE token = ?'
    )
    .bind(maxExpiresAtMs, maxExpiresAtMs, tokenKey)
    .run();

  await db
    .prepare(
      'UPDATE refresh_tokens ' +
        'SET expires_at = CASE WHEN expires_at > ? THEN ? ELSE expires_at END ' +
        'WHERE token = ?'
    )
    .bind(maxExpiresAtMs, maxExpiresAtMs, token)
    .run();
}
