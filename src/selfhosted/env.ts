import { SQLiteD1Adapter, createDatabaseAdapter } from './database';
import { FileSystemR2Adapter, createStorageAdapter } from './storage';
import {
  NotificationsHubOptions,
  NotificationsHubServer,
  NotificationsHubNamespace,
  createNotificationsHub,
  createNotificationsHubNamespace,
} from './websocket';
import { BackupTransferRunnerStub } from './backup-transfer-stub';
import http from 'http';
import path from 'path';
import fs from 'fs';

export interface SelfHostedEnv {
  DB: SQLiteD1Adapter;
  ATTACHMENTS: FileSystemR2Adapter;
  ATTACHMENTS_KV?: any;
  NOTIFICATIONS_HUB: NotificationsHubNamespace;
  BACKUP_TRANSFER_RUNNER: BackupTransferRunnerStub;
  JWT_SECRET: string;
  WEBAUTHN_RP_ID?: string;
  WEBAUTHN_RP_NAME?: string;
  WEBAUTHN_ALLOWED_ORIGINS?: string;
  YUBICO_VALIDATION_URLS?: string;
  'globalSettings__yubico__validationUrls'?: string;
  HIDE_WEB_VAULT?: string;
  ASSETS?: {
    fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  };
}

export interface AppConfig {
  jwtSecret: string;
  databasePath: string;
  storagePath: string;
  port: number;
  host: string;
  frontendPath?: string;
  /** Trust X-Forwarded-* headers. Only enable behind a proxy you control. */
  trustProxy: boolean;
  /** Deprecated: accept access JWTs in the WebSocket query string. */
  allowLegacyWsQueryToken: boolean;
  /** Hard cap for a single request body / attachment upload. */
  maxUploadBytes: number;
}

export const DEFAULT_CONFIG = {
  port: 3000,
  host: '0.0.0.0',
  databasePath: './data/nodewarden.db',
  storagePath: './data/attachments',
  maxUploadBytes: 100 * 1024 * 1024,
  websocketPath: '/notifications/hub',
} as const;

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function createEnv(config: AppConfig): SelfHostedEnv {
  ensureDir(path.dirname(config.databasePath));
  ensureDir(config.storagePath);

  const db = createDatabaseAdapter(config.databasePath);
  const attachments = createStorageAdapter(config.storagePath);

  const env: SelfHostedEnv = {
    DB: db,
    ATTACHMENTS: attachments,
    NOTIFICATIONS_HUB: null as any,
    BACKUP_TRANSFER_RUNNER: new BackupTransferRunnerStub(),
    JWT_SECRET: config.jwtSecret,
    // These are read directly from the environment in self-hosted mode; on
    // Cloudflare they come from bindings instead.
    WEBAUTHN_RP_ID: process.env.WEBAUTHN_RP_ID,
    WEBAUTHN_RP_NAME: process.env.WEBAUTHN_RP_NAME,
    WEBAUTHN_ALLOWED_ORIGINS: process.env.WEBAUTHN_ALLOWED_ORIGINS,
    YUBICO_VALIDATION_URLS: process.env.YUBICO_VALIDATION_URLS,
    'globalSettings__yubico__validationUrls':
      process.env['globalSettings__yubico__validationUrls'],
    HIDE_WEB_VAULT: process.env.HIDE_WEB_VAULT,
  };

  return env;
}

export function setupNotificationsHub(
  server: http.Server,
  env: SelfHostedEnv,
  jwtSecret: string,
  hubPath?: string,
  options: NotificationsHubOptions = {}
): NotificationsHubServer {
  const hubServer = createNotificationsHub(server, jwtSecret, hubPath, options);
  const namespace = createNotificationsHubNamespace(hubServer);
  (env as any).NOTIFICATIONS_HUB = namespace;
  return hubServer;
}

function parseBooleanEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function parsePositiveIntEnv(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadConfigFromEnv(): AppConfig {
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret || jwtSecret.length < 32) {
    throw new Error('JWT_SECRET environment variable must be at least 32 characters');
  }

  return {
    jwtSecret,
    databasePath: process.env.DATABASE_PATH || DEFAULT_CONFIG.databasePath,
    storagePath: process.env.STORAGE_PATH || DEFAULT_CONFIG.storagePath,
    port: parseInt(process.env.PORT || '', 10) || DEFAULT_CONFIG.port,
    host: process.env.HOST || DEFAULT_CONFIG.host,
    frontendPath: process.env.FRONTEND_PATH,
    trustProxy: parseBooleanEnv(process.env.TRUST_PROXY, false),
    allowLegacyWsQueryToken: parseBooleanEnv(process.env.ALLOW_LEGACY_WS_QUERY_TOKEN, false),
    maxUploadBytes: parsePositiveIntEnv(process.env.MAX_UPLOAD_BYTES, DEFAULT_CONFIG.maxUploadBytes),
  };
}

const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';
const NO_CACHE = 'no-cache';
const DEFAULT_STATIC_CACHE = 'public, max-age=86400';

function staticCacheControl(pathname: string): string {
  if (pathname.startsWith('/assets/')) return IMMUTABLE_CACHE;

  const base = path.basename(pathname).toLowerCase();
  if (
    base === 'index.html' ||
    base === 'sw.js' ||
    base === 'manifest.webmanifest' ||
    base === 'robots.txt' ||
    base.endsWith('-connector.html') ||
    base.endsWith('-connector.js')
  ) {
    return NO_CACHE;
  }

  return DEFAULT_STATIC_CACHE;
}

function getContentType(ext: string): string {
  const types: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.mjs': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.webmanifest': 'application/manifest+json; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.xml': 'application/xml; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
    '.wasm': 'application/wasm',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
    '.avif': 'image/avif',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.otf': 'font/otf',
    '.eot': 'application/vnd.ms-fontobject',
  };
  return types[ext] || 'application/octet-stream';
}

function buildETag(size: number, mtimeMs: number): string {
  return `W/"${size.toString(16)}-${Math.floor(mtimeMs).toString(16)}"`;
}

function isNotModified(request: Request, etag: string): boolean {
  const header = request.headers.get('If-None-Match');
  if (!header) return false;
  return header.split(',').some((candidate) => candidate.trim() === etag);
}

/**
 * Map a request pathname to a file inside `basePath`, or return an HTTP error.
 * Exported for tests: the containment check must reject sibling prefixes such
 * as `/srv/dist-evil` when the base is `/srv/dist`.
 */
export function resolveAssetFilePath(
  basePath: string,
  pathname: string
): { filePath: string } | { error: 400 | 403 } {
  if (pathname.includes('\0')) return { error: 400 };

  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return { error: 400 };
  }
  if (decoded.includes('\0')) return { error: 400 };

  const relativePath = decoded.replace(/^\/+/, '') || 'index.html';
  const filePath = path.resolve(basePath, relativePath);
  const relativeToBase = path.relative(basePath, filePath);

  if (
    relativeToBase === '' ||
    relativeToBase === '..' ||
    relativeToBase.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeToBase)
  ) {
    return { error: 403 };
  }

  return { filePath };
}

export function createAssetsHandler(frontendPath?: string): SelfHostedEnv['ASSETS'] | undefined {
  if (!frontendPath) return undefined;

  const absPath = path.resolve(frontendPath);
  if (!fs.existsSync(absPath)) return undefined;

  const serveIndex = async (request: Request): Promise<Response> => {
    const indexPath = path.join(absPath, 'index.html');
    try {
      const stat = await fs.promises.stat(indexPath);
      const etag = buildETag(stat.size, stat.mtimeMs);
      if (isNotModified(request, etag)) {
        return new Response(null, {
          status: 304,
          headers: { ETag: etag, 'Cache-Control': NO_CACHE },
        });
      }
      return new Response(await fs.promises.readFile(indexPath), {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': NO_CACHE,
          ETag: etag,
        },
      });
    } catch {
      return new Response('Not Found', { status: 404 });
    }
  };

  return {
    async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      const request =
        input instanceof Request
          ? input
          : new Request(typeof input === 'string' ? input : input.toString(), init);

      const url = new URL(request.url);
      let pathname = url.pathname || '/';
      if (pathname === '/') pathname = '/index.html';

      const resolved = resolveAssetFilePath(absPath, pathname);
      if ('error' in resolved) {
        return new Response(resolved.error === 403 ? 'Forbidden' : 'Bad Request', {
          status: resolved.error,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
      }

      try {
        const stat = await fs.promises.stat(resolved.filePath);
        if (!stat.isFile()) throw Object.assign(new Error('Not a file'), { code: 'ENOENT' });

        const etag = buildETag(stat.size, stat.mtimeMs);
        const cacheControl = staticCacheControl(pathname);

        if (isNotModified(request, etag)) {
          return new Response(null, {
            status: 304,
            headers: { ETag: etag, 'Cache-Control': cacheControl },
          });
        }

        const content = await fs.promises.readFile(resolved.filePath);
        return new Response(content, {
          status: 200,
          headers: {
            'Content-Type': getContentType(path.extname(resolved.filePath).toLowerCase()),
            'Cache-Control': cacheControl,
            ETag: etag,
          },
        });
      } catch {
        // Only navigation-style requests fall back to the SPA shell. Missing
        // assets must return 404 so browsers do not parse index.html as JS.
        if (path.extname(pathname) !== '') {
          return new Response('Not Found', { status: 404 });
        }
        return serveIndex(request);
      }
    },
  };
}
