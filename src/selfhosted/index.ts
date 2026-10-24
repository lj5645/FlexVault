import { config } from 'dotenv';
config();

import { webcrypto } from 'crypto';
import http from 'http';
import path from 'path';
import { URL, fileURLToPath } from 'url';

if (typeof (globalThis as unknown as { crypto?: unknown }).crypto === 'undefined') {
  (globalThis as unknown as { crypto: typeof webcrypto }).crypto = webcrypto;
}

import './cache-polyfill';
import {
  loadConfigFromEnv,
  createEnv,
  setupNotificationsHub,
  createAssetsHandler,
  DEFAULT_CONFIG,
  SelfHostedEnv,
} from './env';
import { nodeRequestToWebRequest, webResponseToNodeResponse } from './http';
import { StorageService } from '../services/storage';
import { handleRequest } from '../router';
import { applyCors } from '../utils/response';
import { runScheduledBackupIfDue } from '../handlers/backup';
import {
  isBackendRequestPath,
  isWebVaultHidden,
  webVaultNotFoundResponse,
} from '../web-vault-visibility';
import cron from 'node-cron';

let dbInitialized = false;
let dbInitError: string | null = null;
let dbInitPromise: Promise<void> | null = null;

function normalizeRequestUrl(request: Request): Request {
  const url = new URL(request.url);
  const normalizedPathname = url.pathname.length <= 1 ? url.pathname : url.pathname.replace(/\/+$/, '');
  if (normalizedPathname === url.pathname) return request;

  url.pathname = normalizedPathname;

  // Rebuilding a request with a streaming body requires duplex: 'half' in Node,
  // otherwise the Request constructor throws for every upload.
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD' && request.body !== null;
  const init: RequestInit & { duplex?: 'half' } = {
    method: request.method,
    headers: request.headers,
    body: hasBody ? request.body : undefined,
    redirect: request.redirect,
  };
  if (hasBody) init.duplex = 'half';
  return new Request(url.toString(), init);
}

async function maybeServeAsset(request: Request, env: SelfHostedEnv): Promise<Response | null> {
  if (!env.ASSETS) return null;
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;
  const url = new URL(request.url);
  if (isBackendRequestPath(url.pathname)) return null;

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
  const requestPath = new URL(normalizedRequest.url).pathname;

  // Match the Workers entrypoint: HIDE_WEB_VAULT only hides the UI, never the
  // API, and returns a non-cacheable 404 for everything else.
  if (isWebVaultHidden(env as any) && !isBackendRequestPath(requestPath)) {
    return applyCors(normalizedRequest, webVaultNotFoundResponse(normalizedRequest), env as any);
  }

  const assetResponse = await maybeServeAsset(normalizedRequest, env);
  if (assetResponse) {
    return applyCors(normalizedRequest, assetResponse, env as any);
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
    return applyCors(normalizedRequest, resp, env as any);
  }

  const resp = await handleRequest(normalizedRequest, env as any);
  return applyCors(normalizedRequest, resp, env as any);
}

export async function startServer(): Promise<void> {
  const config = loadConfigFromEnv();
  const env = createEnv(config);

  if (config.frontendPath) {
    (env as any).ASSETS = createAssetsHandler(config.frontendPath);
  }

  const server = http.createServer(async (req: http.IncomingMessage, res: http.ServerResponse) => {
    try {
      const { request, rejection } = nodeRequestToWebRequest(req, {
        trustProxy: config.trustProxy,
        maxUploadBytes: config.maxUploadBytes,
      });

      const webResponse = rejection
        ? applyCors(request, rejection, env as any)
        : await handleHttpRequest(request, env);
      await webResponseToNodeResponse(webResponse, res);
    } catch (error) {
      console.error('Request error:', error);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal server error' }));
      } else if (!res.destroyed) {
        res.destroy();
      }
    }
  });

  const notificationsHub = setupNotificationsHub(
    server,
    env,
    config.jwtSecret,
    DEFAULT_CONFIG.websocketPath,
    { allowLegacyQueryToken: config.allowLegacyWsQueryToken }
  );

  await new Promise<void>((resolve) => {
    server.listen(config.port, config.host, () => {
      console.log(`NodeWarden self-hosted server running at http://${config.host}:${config.port}`);
      resolve();
    });
  });

  let backupRunning = false;
  const backupTask = cron.schedule('*/5 * * * *', async () => {
    // A slow backup must not overlap with the next tick, otherwise two jobs can
    // write to the same remote path at once.
    if (backupRunning) return;
    backupRunning = true;
    try {
      await ensureDatabaseInitialized(env);
      if (dbInitError) {
        console.error('Skipping scheduled backup because DB init failed:', dbInitError);
        return;
      }
      await runScheduledBackupIfDue(env as any);
    } catch (error) {
      console.error('Scheduled backup failed:', error);
    } finally {
      backupRunning = false;
    }
  });

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('\nShutting down...');

    // Stop new work first, then drain connections, and only close the database
    // once in-flight requests can no longer use it.
    backupTask.stop();
    try {
      notificationsHub.close();
    } catch {
      // Ignore hub close errors during shutdown
    }

    // Gracefully close the HTTP server: stop accepting new connections and
    // wait for in-flight requests to finish. Force-exit after 10s timeout
    // to avoid hanging on stuck connections.
    await Promise.race([
      new Promise<void>((resolve) => server.close(() => resolve())),
      new Promise<void>((resolve) => setTimeout(() => resolve(), 10000)),
    ]);

    try {
      env.DB.close();
    } catch {
      // Ignore close errors during shutdown
    }
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

export type { SelfHostedEnv } from './env';
export { SQLiteD1Adapter } from './database';
export { FileSystemR2Adapter } from './storage';
export { NotificationsHubNamespace } from './websocket';

function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return path.resolve(entry) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isMainModule()) {
  startServer().catch((error) => {
    console.error('Failed to start server:', error);
    process.exit(1);
  });
}
