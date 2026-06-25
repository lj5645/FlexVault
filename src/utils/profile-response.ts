import type { Env, ProfileResponse, User } from '../types';
import { buildAccountKeys } from './user-decryption';

export function buildProfileResponse(user: User, env?: Env): ProfileResponse {
  void env;
  const organizations: any[] = [];
  const accountKeys = buildAccountKeys(user);

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    emailVerified: true,
    premium: true,
    premiumFromOrganization: false,
    usesKeyConnector: false,
    masterPasswordHint: user.masterPasswordHint,
    culture: 'en-US',
    twoFactorEnabled: !!user.totpSecret,
    key: user.key,
    privateKey: user.privateKey,
    accountKeys,
    securityStamp: user.securityStamp || user.id,
    organizations,
    organizationsNew: organizations,
    providers: [],
    providerOrganizations: [],
    forcePasswordReset: false,
    avatarColor: null,
    creationDate: user.createdAt,
    verifyDevices: user.verifyDevices !== false,
    role: user.role,
    status: user.status,
    object: 'profile',
  };
}
