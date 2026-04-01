import type { Env, User } from './types';
import {
  handleAdminListUsers,
  handleAdminCreateInvite,
  handleAdminListInvites,
  handleAdminDeleteAllInvites,
  handleAdminRevokeInvite,
  handleAdminSetUserStatus,
  handleAdminDeleteUser,
} from './handlers/admin';
import { handleAdminBackupRoute } from './router-admin-backup';

export async function handleAdminRoute(
  request: Request,
  env: Env,
  actorUser: User,
  path: string,
  method: string
): Promise<Response | null> {
  if (path === '/api/admin/users' && method === 'GET') {
    return handleAdminListUsers(request, env, actorUser);
  }

  const adminBackupResponse = await handleAdminBackupRoute(request, env, actorUser, path, method);
  if (adminBackupResponse) return adminBackupResponse;

  if (path === '/api/admin/invites') {
    if (method === 'GET') return handleAdminListInvites(request, env, actorUser);
    if (method === 'POST') return handleAdminCreateInvite(request, env, actorUser);
    if (method === 'DELETE') return handleAdminDeleteAllInvites(request, env, actorUser);
    return null;
  }

  const adminInviteMatch = path.match(/^\/api\/admin\/invites\/([^/]+)$/i);
  if (adminInviteMatch && method === 'DELETE') {
    const inviteCode = decodeURIComponent(adminInviteMatch[1]);
    return handleAdminRevokeInvite(request, env, actorUser, inviteCode);
  }

  const adminUserStatusMatch = path.match(/^\/api\/admin\/users\/([a-f0-9-]+)\/status$/i);
  if (adminUserStatusMatch && (method === 'PUT' || method === 'POST')) {
    return handleAdminSetUserStatus(request, env, actorUser, adminUserStatusMatch[1]);
  }

  const adminUserDeleteMatch = path.match(/^\/api\/admin\/users\/([a-f0-9-]+)$/i);
  if (adminUserDeleteMatch && method === 'DELETE') {
    return handleAdminDeleteUser(request, env, actorUser, adminUserDeleteMatch[1]);
  }

  return null;
}
