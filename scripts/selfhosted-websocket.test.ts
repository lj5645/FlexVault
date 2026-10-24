import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';

import {
  createNotificationsHub,
  NotificationsHubServer,
} from '../src/selfhosted/websocket';
import { createJWT } from '../src/utils/jwt';

const secret = 'selfhosted-websocket-test-secret-32-bytes';
const hubPath = '/notifications/hub';

async function accessToken(userId: string): Promise<string> {
  return createJWT(
    {
      sub: userId,
      email: 'user@example.test',
      name: 'Test User',
      sstamp: 'security-stamp',
    },
    secret
  );
}

async function startHub(options?: { allowLegacyQueryToken?: boolean }): Promise<{
  server: http.Server;
  hub: NotificationsHubServer;
  url: string;
}> {
  const server = http.createServer();
  const hub = createNotificationsHub(server, secret, hubPath, options);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return { server, hub, url: `ws://127.0.0.1:${port}${hubPath}` };
}

async function stop(server: http.Server, hub: NotificationsHubServer): Promise<void> {
  hub.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

/**
 * The server always completes the websocket handshake before validating the
 * token, so a rejected client still sees `open` before the 1008 close frame.
 */
function waitOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
    ws.once('close', () => reject(new Error('closed before opening')));
  });
}

function waitClose(ws: WebSocket): Promise<number> {
  return new Promise((resolve, reject) => {
    ws.once('close', (code) => resolve(code));
    ws.once('error', () => resolve(-1));
  });
}

function closeClient(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    if (ws.readyState === WebSocket.CLOSED) return resolve();
    ws.once('close', () => resolve());
    ws.close();
  });
}

test('raw access tokens in the query string are rejected by default', async (t) => {
  const { server, hub, url } = await startHub();
  t.after(() => stop(server, hub));

  const token = await accessToken('user-1');
  const ws = new WebSocket(`${url}?access_token=${encodeURIComponent(token)}`);
  t.after(() => ws.terminate());

  assert.equal(await waitClose(ws), 1008);
});

test('deprecated query tokens still work when explicitly enabled', async (t) => {
  const { server, hub, url } = await startHub({ allowLegacyQueryToken: true });
  t.after(() => stop(server, hub));

  const token = await accessToken('user-1');
  const ws = new WebSocket(`${url}?access_token=${encodeURIComponent(token)}`);
  t.after(() => ws.terminate());

  await waitOpen(ws);
  await closeClient(ws);
});

test('Authorization bearer tokens authenticate the websocket', async (t) => {
  const { server, hub, url } = await startHub();
  t.after(() => stop(server, hub));

  const token = await accessToken('user-1');
  const ws = new WebSocket(url, { headers: { Authorization: `Bearer ${token}` } });
  t.after(() => ws.terminate());

  await waitOpen(ws);
  await closeClient(ws);
});

test('one-time connection tokens are accepted only once', async (t) => {
  const { server, hub, url } = await startHub();
  t.after(() => stop(server, hub));

  hub.storeWsConnectionToken('ticket-1', {
    userId: 'user-2',
    deviceIdentifier: 'device-1',
    expiresAt: Date.now() + 60_000,
  });

  const first = new WebSocket(`${url}?id=ticket-1`);
  t.after(() => first.terminate());
  await waitOpen(first);
  await closeClient(first);

  const second = new WebSocket(`${url}?id=ticket-1`);
  t.after(() => second.terminate());
  assert.equal(await waitClose(second), 1008);
});

test('expired connection tokens are rejected', async (t) => {
  const { server, hub, url } = await startHub();
  t.after(() => stop(server, hub));

  hub.storeWsConnectionToken('ticket-expired', {
    userId: 'user-2',
    deviceIdentifier: null,
    expiresAt: Date.now() - 1000,
  });

  const ws = new WebSocket(`${url}?id=ticket-expired`);
  t.after(() => ws.terminate());
  assert.equal(await waitClose(ws), 1008);
});
