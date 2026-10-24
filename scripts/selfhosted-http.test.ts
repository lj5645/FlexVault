import assert from 'node:assert/strict';
import test from 'node:test';
import { Readable } from 'node:stream';
import type http from 'node:http';

import { nodeRequestToWebRequest } from '../src/selfhosted/http';

interface FakeRequestOptions {
  method?: string;
  url?: string;
  headers?: Record<string, string | string[]>;
  body?: string;
  /** Mimic a chunked upload: no Content-Length header. */
  chunked?: boolean;
  remoteAddress?: string;
}

function createRequest(options: FakeRequestOptions = {}): http.IncomingMessage {
  const stream = Readable.from(options.body === undefined ? [] : [Buffer.from(options.body)]);
  const lengthHeaders = options.body === undefined
    ? {}
    : options.chunked
      ? { 'transfer-encoding': 'chunked' }
      : { 'content-length': String(Buffer.byteLength(options.body)) };

  return Object.assign(stream, {
    method: options.method ?? 'GET',
    url: options.url ?? '/',
    headers: {
      host: 'vault.example.test',
      ...lengthHeaders,
      ...(options.headers ?? {}),
    },
    socket: { remoteAddress: options.remoteAddress ?? '203.0.113.9' },
  }) as unknown as http.IncomingMessage;
}

const options = { trustProxy: false, maxUploadBytes: 1024 };

test('untrusted proxy headers are stripped and the socket address wins', () => {
  const req = createRequest({
    headers: {
      'x-forwarded-for': '10.0.0.1',
      'x-real-ip': '10.0.0.2',
      'cf-connecting-ip': '10.0.0.3',
      'x-forwarded-proto': 'https',
      'x-forwarded-host': 'evil.example.test',
    },
  });

  const { request } = nodeRequestToWebRequest(req, options);

  assert.equal(request.headers.get('x-forwarded-for'), null);
  assert.equal(request.headers.get('cf-connecting-ip'), null);
  assert.equal(request.headers.get('x-forwarded-proto'), null);
  assert.equal(request.headers.get('x-forwarded-host'), null);
  assert.equal(request.headers.get('x-real-ip'), '203.0.113.9');
  assert.equal(new URL(request.url).protocol, 'http:');
  assert.equal(new URL(request.url).host, 'vault.example.test');
});

test('proxy headers are honoured only when the proxy is trusted', () => {
  const req = createRequest({
    headers: {
      'x-forwarded-for': '198.51.100.7',
      'x-forwarded-proto': 'https',
      'x-forwarded-host': 'vault.example.test',
      // Not overwritten by the documented proxy config, so it must never be
      // treated as authoritative for rate limiting.
      'cf-connecting-ip': '10.0.0.3',
    },
  });

  const { request } = nodeRequestToWebRequest(req, { ...options, trustProxy: true });

  assert.equal(request.headers.get('x-forwarded-for'), '198.51.100.7');
  assert.equal(new URL(request.url).protocol, 'https:');
  assert.equal(new URL(request.url).host, 'vault.example.test');
  assert.equal(request.headers.get('cf-connecting-ip'), null);
  // The real client address is only injected when the headers are not trusted.
  assert.equal(request.headers.get('x-real-ip'), null);
});

test('request bodies are streamed rather than buffered', async () => {
  const req = createRequest({ method: 'POST', url: '/api/ciphers', body: 'payload' });

  const { request, rejection } = nodeRequestToWebRequest(req, options);

  assert.equal(rejection, undefined);
  assert.equal(await request.text(), 'payload');
});

test('oversized bodies are rejected with 413 before reading the stream', async () => {
  const req = createRequest({
    method: 'POST',
    body: 'x'.repeat(2048),
  });

  const { request, rejection } = nodeRequestToWebRequest(req, options);

  assert.ok(rejection);
  assert.equal(rejection.status, 413);
  const body = await rejection.json() as { error: string };
  assert.equal(body.error, 'Payload too large');
  // The rejection request carries no body, so the socket can be drained/closed.
  assert.equal(request.body, null);
});

test('chunked bodies cannot bypass the upload limit', async () => {
  const req = createRequest({
    method: 'POST',
    body: 'x'.repeat(2048),
    chunked: true,
  });

  const { request, rejection } = nodeRequestToWebRequest(req, options);

  assert.equal(rejection, undefined);
  await assert.rejects(() => request.text(), /byte limit/);
});

test('GET requests never attach a body', () => {
  const req = createRequest({ method: 'GET', url: '/api/sync' });

  const { request } = nodeRequestToWebRequest(req, options);

  assert.equal(request.body, null);
  assert.equal(request.method, 'GET');
});
