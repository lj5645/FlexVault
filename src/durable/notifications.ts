import type { Env } from '../types';

const SIGNALR_UPDATE_TYPE_SYNC_VAULT = 5;
const SIGNALR_UPDATE_TYPE_LOG_OUT = 11;
const SIGNALR_UPDATE_TYPE_BACKUP_RESTORE_PROGRESS = 13;

export async function notifyUserVaultSync(
  env: Env,
  userId: string,
  revisionDate: string,
  contextId?: string | null
): Promise<void> {
  return notifyUserUpdate(env, userId, SIGNALR_UPDATE_TYPE_SYNC_VAULT, revisionDate, contextId ?? null, null);
}

export async function notifyUserLogout(
  env: Env,
  userId: string,
  targetDeviceIdentifier?: string | null
): Promise<void> {
  return notifyUserUpdate(env, userId, SIGNALR_UPDATE_TYPE_LOG_OUT, new Date().toISOString(), null, targetDeviceIdentifier ?? null);
}

export async function getOnlineUserDevices(env: Env, userId: string): Promise<string[]> {
  try {
    const id = env.NOTIFICATIONS_HUB.idFromName(userId);
    const stub = env.NOTIFICATIONS_HUB.get(id);
    const response = await stub.fetch('https://notifications/internal/online');
    if (!response.ok) return [];
    const body = (await response.json().catch(() => null)) as { deviceIdentifiers?: string[] } | null;
    return Array.isArray(body?.deviceIdentifiers) ? body.deviceIdentifiers.filter((value) => !!String(value || '').trim()) : [];
  } catch {
    return [];
  }
}

async function notifyUserUpdate(
  env: Env,
  userId: string,
  updateType: number,
  revisionDate: string,
  contextId: string | null,
  targetDeviceIdentifier: string | null
): Promise<void> {
  try {
    const id = env.NOTIFICATIONS_HUB.idFromName(userId);
    const stub = env.NOTIFICATIONS_HUB.get(id);
    await stub.fetch('https://notifications/internal/notify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-NodeWarden-UserId': userId,
      },
      body: JSON.stringify({
        revisionDate,
        contextId: contextId || null,
        updateType,
        targetDeviceIdentifier: targetDeviceIdentifier || null,
        payload: {
          UserId: userId,
          Date: revisionDate,
        },
      }),
    });
  } catch (error) {
    console.error('Failed to broadcast realtime notification:', error);
  }
}

export async function notifyUserBackupProgress(
  env: Env,
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
): Promise<void> {
  const revisionDate = progress.timestamp || new Date().toISOString();
  try {
    const id = env.NOTIFICATIONS_HUB.idFromName(userId);
    const stub = env.NOTIFICATIONS_HUB.get(id);
    await stub.fetch('https://notifications/internal/notify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-NodeWarden-UserId': userId,
      },
      body: JSON.stringify({
        revisionDate,
        contextId: null,
        updateType: SIGNALR_UPDATE_TYPE_BACKUP_RESTORE_PROGRESS,
        targetDeviceIdentifier: targetDeviceIdentifier || null,
        payload: {
          UserId: userId,
          Date: revisionDate,
          ...progress,
        },
      }),
    });
  } catch (error) {
    console.error('Failed to broadcast backup progress:', error);
  }
}

export async function notifyUserBackupRestoreProgress(
  env: Env,
  userId: string,
  progress: {
    operation: 'backup-restore';
    source: 'local' | 'remote';
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
): Promise<void> {
  return notifyUserBackupProgress(env, userId, progress, targetDeviceIdentifier);
}
