import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createClient } from '@libsql/client';

import { createStorageAdapter } from '../src/selfhosted/storage';
import { createDatabaseAdapter } from '../src/selfhosted/database';

async function tempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

/**
 * Windows keeps SQLite/attachment file handles locked briefly after close.
 * Retry once or twice, then leave the temp directory for the OS to reclaim
 * rather than letting a cleanup race fail the test.
 */
function cleanup(dir: string): Promise<void> {
  return fs
    .rm(dir, { recursive: true, force: true, maxRetries: 2, retryDelay: 50 })
    .catch(() => undefined);
}

function toStream(buffer: Buffer): ReadableStream {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(buffer));
      controller.close();
    },
  });
}

test('attachments stream to disk and read back without buffering in memory', async (t) => {
  const root = await tempDir('nodewarden-storage-');
  t.after(() => cleanup(root));

  const bucket = createStorageAdapter(root);
  const payload = Buffer.from('encrypted attachment payload');
  const md5 = crypto.createHash('md5').update(payload).digest('hex');

  const put = await bucket.put('cipher-1/attachment-1', toStream(payload), {
    httpMetadata: { contentType: 'application/octet-stream' },
    customMetadata: { cipherId: 'cipher-1' },
  });

  assert.equal(put.size, payload.length);
  assert.equal(put.etag, md5);

  const object = await bucket.get('cipher-1/attachment-1');
  assert.ok(object);
  assert.equal(object.size, payload.length);
  assert.equal(object.etag, md5);
  assert.equal(object.httpMetadata?.contentType, 'application/octet-stream');
  assert.deepEqual(object.customMetadata, { cipherId: 'cipher-1' });
  assert.equal(await new Response(object.body).text(), payload.toString());

  const head = await bucket.head('cipher-1/attachment-1');
  assert.equal(head?.size, payload.length);

  const listed = await bucket.list({ prefix: 'cipher-1/' });
  assert.equal(listed.objects.length, 1);
  assert.equal(listed.objects[0].size, payload.length);

  // The temp file used for the atomic rename must not survive.
  const files = await fs.readdir(path.join(root, 'cipher-1'));
  assert.deepEqual(files, ['attachment-1']);

  await bucket.delete('cipher-1/attachment-1');
  assert.equal(await bucket.get('cipher-1/attachment-1'), null);
  assert.equal(await bucket.head('cipher-1/attachment-1'), null);
});

test('attachments can be written from strings and ArrayBuffers', async (t) => {
  const root = await tempDir('nodewarden-storage-');
  t.after(() => cleanup(root));

  const bucket = createStorageAdapter(root);
  await bucket.put('a.txt', 'hello');
  const view = await bucket.get('a.txt');
  assert.equal(await new Response(view!.body).text(), 'hello');

  await bucket.put('b.bin', new TextEncoder().encode('binary').buffer);
  const bin = await bucket.get('b.bin');
  assert.equal(await new Response(bin!.body).text(), 'binary');
});

test('paths that escape the storage root are rejected', async (t) => {
  const root = await tempDir('nodewarden-storage-');
  t.after(() => cleanup(root));

  const bucket = createStorageAdapter(root);
  await assert.rejects(() => bucket.put('../../escape.txt', 'nope'), /path traversal/);
  assert.equal(await bucket.get('../../escape.txt'), null);
});

test('database dumps are consistent SQLite snapshots', async (t) => {
  const root = await tempDir('nodewarden-db-');

  const dbPath = path.join(root, 'live.db');
  const db = createDatabaseAdapter(dbPath);
  // Close the SQLite handle before removing its directory, otherwise Windows
  // reports EBUSY.
  t.after(async () => {
    db.close();
    await cleanup(root);
  });

  await db.exec('CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL)');
  await db.prepare('INSERT INTO items (name) VALUES (?)').bind('alice').run();

  const dump = Buffer.from(await db.dump());
  assert.ok(dump.length > 0);
  assert.equal(dump.subarray(0, 16).toString('latin1'), 'SQLite format 3\u0000');

  // The snapshot must be a valid database containing the committed row, even
  // though the live database is in WAL mode.
  const snapshotPath = path.join(root, 'snapshot.db');
  await fs.writeFile(snapshotPath, dump);
  const snapshot = createClient({ url: `file:${snapshotPath}` });
  try {
    const rows = await snapshot.execute('SELECT name FROM items');
    assert.equal(rows.rows.length, 1);
    assert.equal(rows.rows[0].name, 'alice');
  } finally {
    snapshot.close();
  }

  // No temporary dump files should be left behind.
  const leftovers = (await fs.readdir(root)).filter((name) => name.startsWith('.dump-'));
  assert.deepEqual(leftovers, []);
});
