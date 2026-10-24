import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createAssetsHandler, resolveAssetFilePath } from '../src/selfhosted/env';

async function createDist(t: TestContext): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nodewarden-assets-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const dist = path.join(root, 'dist');
  await fs.mkdir(path.join(dist, 'assets'), { recursive: true });
  await fs.writeFile(path.join(dist, 'index.html'), '<!doctype html><div id="root"></div>');
  await fs.writeFile(path.join(dist, 'assets', 'app.js'), 'console.log("app")');
  await fs.writeFile(path.join(dist, 'sw.js'), 'self.addEventListener("fetch", () => {})');
  await fs.writeFile(path.join(dist, 'manifest.webmanifest'), '{"name":"FlexVault"}');
  return dist;
}

test('asset path resolution cannot escape the frontend directory', async (t) => {
  const dist = await createDist(t);
  const parent = path.dirname(dist);

  assert.equal('error' in resolveAssetFilePath(dist, '/../../etc/passwd'), true);
  assert.equal('error' in resolveAssetFilePath(dist, '/%2e%2e/%2e%2e/etc/passwd'), true);
  assert.equal('error' in resolveAssetFilePath(dist, '/index.html%00.js'), true);
  assert.equal('error' in resolveAssetFilePath(dist, '/%E0%A4%A'), true);

  // A sibling directory sharing the prefix must not be reachable either.
  const sibling = await fs.mkdtemp(path.join(parent, 'dist-evil-'));
  try {
    await fs.writeFile(path.join(sibling, 'secret.txt'), 'secret');
    assert.deepEqual(resolveAssetFilePath(dist, `/../${path.basename(sibling)}/secret.txt`), {
      error: 403,
    });
  } finally {
    await fs.rm(sibling, { recursive: true, force: true });
  }

  const allowed = resolveAssetFilePath(dist, '/assets/app.js');
  assert.ok('filePath' in allowed);
});

test('serves the SPA shell, hashed assets and the manifest with correct caching', async (t) => {
  const dist = await createDist(t);
  const assets = createAssetsHandler(dist);
  assert.ok(assets);

  const root = await assets.fetch(new Request('http://localhost/'));
  assert.equal(root.status, 200);
  assert.equal(root.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.equal(root.headers.get('cache-control'), 'no-cache');
  assert.match(await root.text(), /id="root"/);

  const app = await assets.fetch(new Request('http://localhost/assets/app.js'));
  assert.equal(app.status, 200);
  assert.equal(app.headers.get('content-type'), 'application/javascript; charset=utf-8');
  assert.equal(app.headers.get('cache-control'), 'public, max-age=31536000, immutable');

  const serviceWorker = await assets.fetch(new Request('http://localhost/sw.js'));
  assert.equal(serviceWorker.status, 200);
  assert.equal(serviceWorker.headers.get('cache-control'), 'no-cache');

  const manifest = await assets.fetch(new Request('http://localhost/manifest.webmanifest'));
  assert.equal(manifest.status, 200);
  assert.equal(manifest.headers.get('content-type'), 'application/manifest+json; charset=utf-8');
});

test('navigation paths fall back to index.html but missing assets return 404', async (t) => {
  const dist = await createDist(t);
  const assets = createAssetsHandler(dist);
  assert.ok(assets);

  const navigation = await assets.fetch(new Request('http://localhost/vault/items'));
  assert.equal(navigation.status, 200);
  assert.match(await navigation.text(), /id="root"/);

  const missingAsset = await assets.fetch(new Request('http://localhost/assets/missing.js'));
  assert.equal(missingAsset.status, 404);
  assert.doesNotMatch(await missingAsset.text(), /id="root"/);
});

test('conditional requests return 304 with the same etag', async (t) => {
  const dist = await createDist(t);
  const assets = createAssetsHandler(dist);
  assert.ok(assets);

  const first = await assets.fetch(new Request('http://localhost/assets/app.js'));
  const etag = first.headers.get('etag');
  assert.ok(etag);

  const second = await assets.fetch(
    new Request('http://localhost/assets/app.js', { headers: { 'if-none-match': etag } })
  );
  assert.equal(second.status, 304);
  assert.equal(second.headers.get('etag'), etag);
  assert.equal(await second.text(), '');
});
