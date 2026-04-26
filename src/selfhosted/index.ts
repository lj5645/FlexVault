import { config } from 'dotenv';
config();

import { webcrypto } from 'crypto';
import http from 'http';
import { URL } from 'url';

if (typeof (globalThis as unknown as { crypto?: unknown }).crypto === 'undefined') {
  (globalThis as unknown as { crypto: typeof webcrypto }).crypto = webcrypto;
}

import './cache-polyfill';
import { loadConfigFromEnv, createEnv, setupNotificationsHub, createAssetsHandler, SelfHostedEnv } from './env';
import { StorageService } from '../services/storage';
import { handleRequest } from '../router';
import { applyCors } from '../utils/response';
import { runScheduledBackupIfDue } from '../handlers/backup';
import cron from 'node-cron';

let dbInitialized = false;
let dbInitError: string | null = null;
let dbInitPromise: Promise<void> | null = null;

function normalizeRequestUrl(request: Request): Request {
  const url = new URL(request.url);
  const normalizedPathname = url.pathname.length <= 1 ? url.pathname : url.pathname.replace(/\/+$/, '');
  if (normalizedPathname === url.pathname) return request;

  url.pathname = normalizedPathname;
  return new Request(url.toString(), request);
}

function isWorkerHandledPath(path: string): boolean {
  return (
    path.startsWith('/api/') ||
    path.startsWith('/identity/') ||
    path.startsWith('/icons/') ||
    path.startsWith('/notifications/') ||
    path.startsWith('/.well-known/') ||
    path === '/config' ||
    path === '/api/config' ||
    path === '/api/version'
  );
}

async function maybeServeAsset(request: Request, env: SelfHostedEnv): Promise<Response | null> {
  if (!env.ASSETS) return null;
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;
  const url = new URL(request.url);
  if (isWorkerHandledPath(url.pathname)) return null;

  return env.ASSETS.fetch(request);
}

async function ensureDatabaseInitialized(env: SelfHostedEnv): Promise<void> {
  if (dbInitialized) return;

  if (!dbInitPromise) {
    dbInitPromise = (async () => {
      const storage = new StorageService(env.DB as any);
      await storage.initializeDatabase();
      dbInitialized = true;
      dbInitError = null;
    })()
      .catch((error: unknown) => {
        console.error('Failed to initialize database:', error);
        dbInitError = error instanceof Error ? error.message : 'Unknown database initialization error';
      })
      .finally(() => {
        dbInitPromise = null;
      });
  }

  await dbInitPromise;
}

async function handleHttpRequest(request: Request, env: SelfHostedEnv): Promise<Response> {
  const normalizedRequest = normalizeRequestUrl(request);
  const assetResponse = await maybeServeAsset(normalizedRequest, env);
  if (assetResponse) {
    return applyCors(normalizedRequest, assetResponse);
  }

  await ensureDatabaseInitialized(env);
  if (dbInitError) {
    console.error('DB init error (not forwarded to client):', dbInitError);
    const resp = new Response(
      JSON.stringify({
        error: 'Database not initialized',
        error_description: 'Database initialization failed. Check server logs for details.',
        ErrorModel: {
          Message: 'Service temporarily unavailable',
          Object: 'error',
        },
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
    return applyCors(normalizedRequest, resp);
  }

  const resp = await handleRequest(normalizedRequest, env as any);
  return applyCors(normalizedRequest, resp);
}

function nodeRequestToWebRequest(req: http.IncomingMessage, body?: Buffer): Request {
  const protocol = (req.socket as any).encrypted ? 'https' : 'http';
  const host = req.headers.host || 'localhost';
  const url = `${protocol}://${host}${req.url}`;

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value !== undefined) {
      if (Array.isArray(value)) {
        for (const v of value) {
          headers.append(key, v);
        }
      } else {
        headers.set(key, value);
      }
    }
  }

  const method = req.method || 'GET';
  const hasBody = method !== 'GET' && method !== 'HEAD' && body && body.length > 0;

  return new Request(url, {
    method,
    headers,
    body: hasBody ? body : undefined,
  });
}

async function webResponseToNodeResponse(response: Response, res: http.ServerResponse): Promise<void> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });

  res.writeHead(response.status, headers);

  if (response.body) {
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
  }

  res.end();
}

export async function startServer(): Promise<void> {
  const config = loadConfigFromEnv();
  const env = createEnv(config);

  if (config.frontendPath) {
    (env as any).ASSETS = createAssetsHandler(config.frontendPath);
  }

  const server = http.createServer(async (req: http.IncomingMessage, res: http.ServerResponse) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(chunk);
      }
      const body = Buffer.concat(chunks);

      const webRequest = nodeRequestToWebRequest(req, body);
      const webResponse = await handleHttpRequest(webRequest, env);
      await webResponseToNodeResponse(webResponse, res);
    } catch (error) {
      console.error('Request error:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  });

  setupNotificationsHub(server, env, config.jwtSecret);

  await new Promise<void>((resolve) => {
    server.listen(config.port, config.host, () => {
      console.log(`NodeWarden self-hosted server running at http://${config.host}:${config.port}`);
      resolve();
    });
  });

  cron.schedule('*/5 * * * *', async () => {
    try {
      await ensureDatabaseInitialized(env);
      if (dbInitError) {
        console.error('Skipping scheduled backup because DB init failed:', dbInitError);
        return;
      }
      await runScheduledBackupIfDue(env as any);
    } catch (error) {
      console.error('Scheduled backup failed:', error);
    }
  });

  const shutdown = async () => {
    console.log('\nShutting down...');
    server.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

export type { SelfHostedEnv } from './env';
export { SQLiteD1Adapter } from './database';
export { FileSystemR2Adapter } from './storage';
export { NotificationsHubNamespace } from './websocket';

startServer().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
