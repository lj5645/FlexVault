type ShouldRunPeriodicCleanup = (lastRunAt: number, intervalMs: number) => boolean;

export async function ensureUsedAttachmentDownloadTokenTable(db: D1Database): Promise<void> {
  await db
    .prepare(
      'CREATE TABLE IF NOT EXISTS used_attachment_download_tokens (' +
        'jti TEXT PRIMARY KEY, ' +
        'expires_at INTEGER NOT NULL' +
        ')'
    )
    .run();
}

export async function consumeAttachmentDownloadToken(
  db: D1Database,
  shouldRunPeriodicCleanup: ShouldRunPeriodicCleanup,
  lastCleanupAt: number,
  cleanupIntervalMs: number,
  jti: string,
  expUnixSeconds: number
): Promise<{ consumed: boolean; cleanedUpAt: number | null }> {
  const nowMs = Date.now();
  let cleanedUpAt: number | null = null;

  if (shouldRunPeriodicCleanup(lastCleanupAt, cleanupIntervalMs)) {
    await db
      .prepare('DELETE FROM used_attachment_download_tokens WHERE expires_at < ?')
      .bind(nowMs)
      .run();
    cleanedUpAt = nowMs;
  }

  const expiresAtMs = expUnixSeconds * 1000;
  const result = await db
    .prepare(
      'INSERT INTO used_attachment_download_tokens(jti, expires_at) VALUES(?, ?) ' +
        'ON CONFLICT(jti) DO NOTHING'
    )
    .bind(jti, expiresAtMs)
    .run();

  return {
    consumed: (result.meta.changes ?? 0) > 0,
    cleanedUpAt,
  };
}
