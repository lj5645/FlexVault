import type { AdminInvite, AdminUser, ListResponse } from '../types';
import { parseJson, type AuthedFetch } from './shared';

export async function listAdminUsers(authedFetch: AuthedFetch): Promise<AdminUser[]> {
  const resp = await authedFetch('/api/admin/users');
  if (!resp.ok) throw new Error('Failed to load users');
  const body = await parseJson<ListResponse<AdminUser>>(resp);
  return body?.data || [];
}

export async function listAdminInvites(authedFetch: AuthedFetch): Promise<AdminInvite[]> {
  const resp = await authedFetch('/api/admin/invites?includeInactive=true');
  if (!resp.ok) throw new Error('Failed to load invites');
  const body = await parseJson<ListResponse<AdminInvite>>(resp);
  return body?.data || [];
}

export async function createInvite(authedFetch: AuthedFetch, hours: number): Promise<void> {
  const resp = await authedFetch('/api/admin/invites', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expiresInHours: hours }),
  });
  if (!resp.ok) throw new Error('Create invite failed');
}

export async function revokeInvite(authedFetch: AuthedFetch, code: string): Promise<void> {
  const resp = await authedFetch(`/api/admin/invites/${encodeURIComponent(code)}`, { method: 'DELETE' });
  if (!resp.ok) throw new Error('Revoke invite failed');
}

export async function deleteAllInvites(authedFetch: AuthedFetch): Promise<void> {
  const resp = await authedFetch('/api/admin/invites', { method: 'DELETE' });
  if (!resp.ok) throw new Error('Delete all invites failed');
}

export async function setUserStatus(
  authedFetch: AuthedFetch,
  userId: string,
  status: 'active' | 'banned'
): Promise<void> {
  const resp = await authedFetch(`/api/admin/users/${encodeURIComponent(userId)}/status`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });
  if (!resp.ok) throw new Error('Update user status failed');
}

export async function deleteUser(authedFetch: AuthedFetch, userId: string): Promise<void> {
  const resp = await authedFetch(`/api/admin/users/${encodeURIComponent(userId)}`, { method: 'DELETE' });
  if (!resp.ok) throw new Error('Delete user failed');
}
