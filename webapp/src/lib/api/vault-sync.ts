import type { Cipher, Folder, Send } from '../types';
import { parseJson, type AuthedFetch } from './shared';

interface VaultSyncResponse {
  ciphers?: Cipher[];
  folders?: Folder[];
  sends?: Send[];
}

const pendingVaultCoreRequests = new WeakMap<AuthedFetch, Promise<VaultSyncResponse>>();

export async function loadVaultCoreSyncSnapshot(authedFetch: AuthedFetch): Promise<VaultSyncResponse> {
  const existing = pendingVaultCoreRequests.get(authedFetch);
  if (existing) return existing;

  const request = (async () => {
    const resp = await authedFetch('/api/sync?excludeSends=true&excludeDomains=true', {
      cache: 'no-store',
      headers: {
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
      },
    });
    if (!resp.ok) throw new Error('Failed to load vault');
    const body = await parseJson<VaultSyncResponse>(resp);
    return body || {};
  })();

  pendingVaultCoreRequests.set(authedFetch, request);
  try {
    return await request;
  } finally {
    if (pendingVaultCoreRequests.get(authedFetch) === request) {
      pendingVaultCoreRequests.delete(authedFetch);
    }
  }
}
