import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import { URL } from 'url';
import { verifyJWT } from '../utils/jwt';

const SIGNALR_RECORD_SEPARATOR = String.fromCharCode(0x1e);
const SIGNALR_HANDSHAKE_ACK = JSON.stringify({}) + SIGNALR_RECORD_SEPARATOR;
const SIGNALR_UPDATE_TYPE_SYNC_VAULT = 5;
const SIGNALR_UPDATE_TYPE_LOG_OUT = 11;
const SIGNALR_UPDATE_TYPE_DEVICE_STATUS = 12;
const SIGNALR_UPDATE_TYPE_BACKUP_RESTORE_PROGRESS = 13;

interface WsAttachment {
  userId: string;
  handshakeComplete: boolean;
  deviceIdentifier: string | null;
}

interface HubUser {
  sockets: Set<WebSocket>;
  deviceIdentifiers: Map<WebSocket, string | null>;
}

function extractAccessToken(req: http.IncomingMessage): string | null {
  const url = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
  const queryToken = String(url.searchParams.get('access_token') || '').trim();
  if (queryToken) return queryToken;

  const authHeader = String(req.headers['authorization'] || '').trim();
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

export class NotificationsHubServer {
  private wss: WebSocketServer;
  private users: Map<string, HubUser> = new Map();
  private jwtSecret: string;

  constructor(server: http.Server, jwtSecret: string, path: string = '/notifications/hub') {
    this.jwtSecret = jwtSecret;
    this.wss = new WebSocketServer({ server, path });
    this.setupWebSocket();
  }

  private setupWebSocket(): void {
    this.wss.on('connection', async (ws: WebSocket, req) => {
      const accessToken = extractAccessToken(req);
      
      if (!accessToken) {
        ws.close(1008, 'Unauthorized');
        return;
      }

      let userId: string;
      let deviceIdentifier: string | null = null;

      try {
        const payload = await verifyJWT(accessToken, this.jwtSecret);
        if (!payload?.sub) {
          ws.close(1008, 'Unauthorized');
          return;
        }
        userId = payload.sub;
        deviceIdentifier = payload.did || null;
      } catch {
        ws.close(1008, 'Unauthorized');
        return;
      }

      const attachment: WsAttachment = {
        userId,
        handshakeComplete: false,
        deviceIdentifier,
      };

      (ws as any).__attachment = attachment;

      this.addUserSocket(userId, ws, deviceIdentifier);

      ws.on('message', (data: Buffer) => {
        this.handleMessage(ws, data, attachment);
      });

      ws.on('close', () => {
        this.removeUserSocket(userId, ws);
        this.broadcastDeviceStatus(userId);
      });

      ws.on('error', () => {
        this.removeUserSocket(userId, ws);
      });
    });
  }

  private addUserSocket(userId: string, ws: WebSocket, deviceIdentifier: string | null): void {
    if (!this.users.has(userId)) {
      this.users.set(userId, {
        sockets: new Set(),
        deviceIdentifiers: new Map(),
      });
    }
    const user = this.users.get(userId)!;
    user.sockets.add(ws);
    user.deviceIdentifiers.set(ws, deviceIdentifier);
  }

  private removeUserSocket(userId: string, ws: WebSocket): void {
    const user = this.users.get(userId);
    if (user) {
      user.sockets.delete(ws);
      user.deviceIdentifiers.delete(ws);
      if (user.sockets.size === 0) {
        this.users.delete(userId);
      }
    }
  }

  private handleMessage(ws: WebSocket, data: Buffer, attachment: WsAttachment): void {
    const text = data.toString('utf-8');

    if (!attachment.handshakeComplete) {
      const frames = text.split(SIGNALR_RECORD_SEPARATOR).filter(Boolean);
      for (const frame of frames) {
        try {
          JSON.parse(frame);
          attachment.handshakeComplete = true;
          ws.send(SIGNALR_HANDSHAKE_ACK);
          this.broadcastDeviceStatus(attachment.userId);
          return;
        } catch {
          // ignore
        }
      }
      return;
    }

    try {
      const ping = JSON.parse(text);
      if (ping.type === 6) {
        ws.send(JSON.stringify({ type: 6 }) + SIGNALR_RECORD_SEPARATOR);
      }
    } catch {
      // ignore
    }
  }

  private buildSignalRMessage(
    updateType: number,
    payload: Record<string, unknown>,
    contextId: string | null
  ): string {
    return (
      JSON.stringify({
        type: 1,
        target: 'ReceiveMessage',
        arguments: [
          {
            ContextId: contextId,
            Type: updateType,
            Payload: payload,
          },
        ],
      }) + SIGNALR_RECORD_SEPARATOR
    );
  }

  private broadcastDeviceStatus(userId: string): void {
    this.broadcastMessage(userId, SIGNALR_UPDATE_TYPE_DEVICE_STATUS, {
      UserId: userId,
      Date: new Date().toISOString(),
    });
  }

  broadcastMessage(
    userId: string,
    updateType: number,
    payload: Record<string, unknown>,
    contextId: string | null = null,
    targetDeviceIdentifier: string | null = null
  ): void {
    const user = this.users.get(userId);
    if (!user) return;

    const message = this.buildSignalRMessage(updateType, payload, contextId);

    for (const ws of user.sockets) {
      if (ws.readyState !== WebSocket.OPEN) continue;

      const attachment = (ws as any).__attachment as WsAttachment | undefined;
      if (!attachment?.handshakeComplete) continue;

      if (targetDeviceIdentifier && attachment.deviceIdentifier !== targetDeviceIdentifier) {
        continue;
      }

      try {
        ws.send(message);
      } catch {
        // ignore
      }
    }
  }

  notifyVaultSync(userId: string, revisionDate: string, contextId?: string | null): void {
    this.broadcastMessage(
      userId,
      SIGNALR_UPDATE_TYPE_SYNC_VAULT,
      {
        UserId: userId,
        Date: revisionDate,
      },
      contextId ?? null
    );
  }

  notifyLogout(userId: string, targetDeviceIdentifier?: string | null): void {
    this.broadcastMessage(
      userId,
      SIGNALR_UPDATE_TYPE_LOG_OUT,
      {
        UserId: userId,
        Date: new Date().toISOString(),
      },
      null,
      targetDeviceIdentifier ?? null
    );
  }

  notifyBackupProgress(
    userId: string,
    progress: {
      operation: 'backup-restore' | 'backup-export' | 'backup-remote-run';
      source?: 'local' | 'remote';
      step: string;
      fileName: string;
      stageTitle?: string;
      stageDetail?: string;
      replaceExisting?: boolean;
      done?: boolean;
      ok?: boolean;
      error?: string | null;
      timestamp?: string;
    },
    targetDeviceIdentifier?: string | null
  ): void {
    this.broadcastMessage(
      userId,
      SIGNALR_UPDATE_TYPE_BACKUP_RESTORE_PROGRESS,
      {
        UserId: userId,
        Date: progress.timestamp || new Date().toISOString(),
        ...progress,
      },
      null,
      targetDeviceIdentifier ?? null
    );
  }

  getOnlineDeviceIdentifiers(userId: string): string[] {
    const user = this.users.get(userId);
    if (!user) return [];

    const identifiers = new Set<string>();
    for (const [ws, deviceId] of user.deviceIdentifiers) {
      if (deviceId && ws.readyState === WebSocket.OPEN) {
        const attachment = (ws as any).__attachment as WsAttachment | undefined;
        if (attachment?.handshakeComplete) {
          identifiers.add(deviceId);
        }
      }
    }
    return Array.from(identifiers);
  }

  close(): void {
    this.wss.close();
  }
}

export class NotificationsHubNamespace {
  private server: NotificationsHubServer;

  constructor(server: NotificationsHubServer) {
    this.server = server;
  }

  idFromName(_name: string): string {
    return _name;
  }

  get(id: string): NotificationsHubStub {
    return new NotificationsHubStub(id, this.server);
  }
}

export class NotificationsHubStub {
  private userId: string;
  private server: NotificationsHubServer;

  constructor(userId: string, server: NotificationsHubServer) {
    this.userId = userId;
    this.server = server;
  }

  async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = typeof input === 'string' ? new URL(input, 'http://localhost') : new URL(input.toString());
    const pathname = url.pathname;

    if (pathname === '/internal/notify' || pathname === 'https://notifications/internal/notify') {
      const body = init?.body ? JSON.parse(init.body as string) : {};
      const updateType = body.updateType || SIGNALR_UPDATE_TYPE_SYNC_VAULT;
      const contextId = body.contextId || null;
      const targetDeviceIdentifier = body.targetDeviceIdentifier || null;
      const payload = body.payload || {};

      this.server.broadcastMessage(this.userId, updateType, payload, contextId, targetDeviceIdentifier);

      return new Response(null, { status: 204 });
    }

    if (pathname === '/internal/online' || pathname === 'https://notifications/internal/online') {
      const deviceIdentifiers = this.server.getOnlineDeviceIdentifiers(this.userId);
      return new Response(JSON.stringify({ deviceIdentifiers }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response('Not found', { status: 404 });
  }
}

export function createNotificationsHub(server: http.Server, jwtSecret: string, path?: string): NotificationsHubServer {
  return new NotificationsHubServer(server, jwtSecret, path);
}

export function createNotificationsHubNamespace(server: NotificationsHubServer): NotificationsHubNamespace {
  return new NotificationsHubNamespace(server);
}

export type DurableObjectNamespace = NotificationsHubNamespace;
