import { SQLiteD1Adapter, createDatabaseAdapter } from './database';
import { FileSystemR2Adapter, createStorageAdapter } from './storage';
import { NotificationsHubServer, NotificationsHubNamespace, createNotificationsHub, createNotificationsHubNamespace } from './websocket';
import http from 'http';
import path from 'path';
import fs from 'fs';

export interface SelfHostedEnv {
  DB: SQLiteD1Adapter;
  ATTACHMENTS: FileSystemR2Adapter;
  NOTIFICATIONS_HUB: NotificationsHubNamespace;
  JWT_SECRET: string;
  TOTP_SECRET?: string;
  ASSETS?: {
    fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  };
}

export interface AppConfig {
  jwtSecret: string;
  totpSecret?: string;
  databasePath: string;
  storagePath: string;
  port: number;
  host: string;
  frontendPath?: string;
}

export const DEFAULT_CONFIG = {
  port: 3000,
  host: '0.0.0.0',
  databasePath: './data/nodewarden.db',
  storagePath: './data/attachments',
  maxFileSize: 100 * 1024 * 1024,
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
    JWT_SECRET: config.jwtSecret,
    TOTP_SECRET: config.totpSecret,
  };

  return env;
}

export function setupNotificationsHub(
  server: http.Server,
  env: SelfHostedEnv,
  jwtSecret: string,
  path?: string
): NotificationsHubServer {
  const hubServer = createNotificationsHub(server, jwtSecret, path);
  const namespace = createNotificationsHubNamespace(hubServer);
  (env as any).NOTIFICATIONS_HUB = namespace;
  return hubServer;
}

export function loadConfigFromEnv(): AppConfig {
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret || jwtSecret.length < 32) {
    throw new Error('JWT_SECRET environment variable must be at least 32 characters');
  }

  return {
    jwtSecret,
    totpSecret: process.env.TOTP_SECRET,
    databasePath: process.env.DATABASE_PATH || DEFAULT_CONFIG.databasePath,
    storagePath: process.env.STORAGE_PATH || DEFAULT_CONFIG.storagePath,
    port: parseInt(process.env.PORT || '', 10) || DEFAULT_CONFIG.port,
    host: process.env.HOST || DEFAULT_CONFIG.host,
    frontendPath: process.env.FRONTEND_PATH,
  };
}

export function createAssetsHandler(frontendPath?: string): SelfHostedEnv['ASSETS'] | undefined {
  if (!frontendPath) return undefined;

  const absPath = path.resolve(frontendPath);
  if (!fs.existsSync(absPath)) return undefined;

  return {
    async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      const url = typeof input === 'string' ? new URL(input, 'http://localhost') : new URL(input.toString());
      let pathname = url.pathname;

      if (pathname === '/' || pathname === '') {
        pathname = '/index.html';
      }

      const filePath = path.join(absPath, pathname);
      const normalizedPath = path.normalize(filePath);

      if (!normalizedPath.startsWith(absPath)) {
        return new Response('Forbidden', { status: 403 });
      }

      try {
        const content = await fs.promises.readFile(normalizedPath);
        const ext = path.extname(normalizedPath).toLowerCase();
        const contentType = getContentType(ext);

        return new Response(content, {
          status: 200,
          headers: {
            'Content-Type': contentType,
            'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000',
          },
        });
      } catch {
        const indexPath = path.join(absPath, 'index.html');
        if (fs.existsSync(indexPath)) {
          const indexContent = await fs.promises.readFile(indexPath);
          return new Response(indexContent, {
            status: 200,
            headers: {
              'Content-Type': 'text/html; charset=utf-8',
            },
          });
        }
        return new Response('Not Found', { status: 404 });
      }
    },
  };
}

function getContentType(ext: string): string {
  const types: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.mjs': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.eot': 'application/vnd.ms-fontobject',
    '.webp': 'image/webp',
  };
  return types[ext] || 'application/octet-stream';
}
