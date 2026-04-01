export async function getRevisionDate(db: D1Database, userId: string): Promise<string> {
  const row = await db
    .prepare('SELECT revision_date FROM user_revisions WHERE user_id = ?')
    .bind(userId)
    .first<{ revision_date: string }>();

  if (row?.revision_date) return row.revision_date;

  const date = new Date().toISOString();
  await db
    .prepare(
      'INSERT INTO user_revisions(user_id, revision_date) VALUES(?, ?) ' +
        'ON CONFLICT(user_id) DO NOTHING'
    )
    .bind(userId, date)
    .run();

  return date;
}

export async function updateRevisionDate(db: D1Database, userId: string): Promise<string> {
  const date = new Date().toISOString();
  await db
    .prepare(
      'INSERT INTO user_revisions(user_id, revision_date) VALUES(?, ?) ' +
        'ON CONFLICT(user_id) DO UPDATE SET revision_date = excluded.revision_date'
    )
    .bind(userId, date)
    .run();
  return date;
}
