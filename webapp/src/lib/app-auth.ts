import {
  createAuthedFetch,
  deriveLoginHashLocally,
  getAccountPasskeyAssertionOptions,
  getProfile,
  loadProfileSnapshot,
  loadSession,
  loginWithAccountPasskeyAssertion,
  loginWithPassword,
  refreshAccessToken,
  recoverTwoFactor,
  registerAccount,
  unlockVaultKey,
} from '@/lib/api/auth';
import {
  assertAccountPasskey,
  unlockVaultKeyWithAccountPasskeyPrf,
} from '@/lib/account-passkeys';
import { readInviteCodeFromUrl } from '@/lib/app-support';
import { t, translateServerError } from '@/lib/i18n';
import {
  getOfflineUnlockKdfIterations,
  hasOfflineUnlockRecord,
  kdfIterationsFromLogin,
  loadOfflineProfileSnapshot,
  saveOfflineUnlockRecord,
  unlockOfflineVaultWithMasterKey,
} from '@/lib/offline-auth';
import { probeNodeWardenService } from '@/lib/network-status';
import type { AccountPasskeyPrfOption, AppPhase, Profile, SessionState, TokenSuccess, WebBootstrapResponse } from '@/lib/types';

export interface PendingTotp {
  email: string;
  passwordHash: string;
  masterKey: Uint8Array;
  kdfIterations: number;
}

export interface PendingPasskeyPassword {
  token: TokenSuccess;
  email: string;
  kdfIterations: number;
}

export type JwtUnsafeReason = 'missing' | 'default' | 'too_short';

export interface BootstrapAppResult {
  defaultKdfIterations: number;
  registrationInviteRequired?: boolean;
  jwtWarning: { reason: JwtUnsafeReason; minLength: number } | null;
  session: SessionState | null;
  profile: Profile | null;
  phase: AppPhase;
  needsBackgroundHydration?: boolean;
}

export interface InitialAppBootstrapState {
  defaultKdfIterations: number;
  registrationInviteRequired?: boolean;
  jwtWarning: { reason: JwtUnsafeReason; minLength: number } | null;
  session: SessionState | null;
  phase: AppPhase;
}

export interface CompletedLogin {
  session: SessionState;
  profile: Profile;
  profilePromise: Promise<Profile>;
  freshMasterPasswordHash?: string | null;
  freshUserVerificationToken?: string | null;
}

function readTokenUserVerificationToken(token: TokenSuccess): string | null {
  return String(token.UserVerificationToken || token.userVerificationToken || '').trim() || null;
}

export type PasswordLoginResult =
  | { kind: 'success'; login: CompletedLogin }
  | { kind: 'totp'; pendingTotp: PendingTotp }
  | { kind: 'error'; message: string };

export type PasskeyLoginResult =
  | { kind: 'success'; login: CompletedLogin }
  | { kind: 'password'; pendingPasskeyPassword: PendingPasskeyPassword }
  | { kind: 'error'; message: string };

export interface RecoverTwoFactorResult {
  login: CompletedLogin | null;
  newRecoveryCode: string | null;
}

function decodeJwtExp(accessToken: string | undefined): number | null {
  try {
    if (!accessToken) return null;
    const parts = accessToken.split('.');
    if (parts.length < 2) return null;
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = payload.padEnd(Math.ceil(payload.length / 4) * 4, '=');
    const json = JSON.parse(atob(padded)) as { exp?: unknown };
    const exp = Number(json.exp);
    return Number.isFinite(exp) ? exp : null;
  } catch {
    return null;
  }
}

async function maybeRefreshSession(session: SessionState): Promise<SessionState | null> {
  if (!session.refreshToken && session.authMode !== 'web-cookie') return session.accessToken ? session : null;
  const exp = decodeJwtExp(session.accessToken);
  const nowSeconds = Math.floor(Date.now() / 1000);

  if (session.accessToken && exp !== null && exp - nowSeconds > 60) {
    return session;
  }

  const refreshed = await refreshAccessToken(session);
  if (!refreshed.ok) {
    if (refreshed.transient) return session;
    return session.accessToken && exp !== null && exp > nowSeconds ? session : null;
  }

  return {
    ...session,
    accessToken: refreshed.token.access_token,
    refreshToken: refreshed.token.refresh_token || session.refreshToken,
    authMode: refreshed.token.web_session ? 'web-cookie' : (session.authMode || 'token'),
  };
}

function browserReportsOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

function readWindowBootstrap(): WebBootstrapResponse {
  if (typeof window === 'undefined') return {};
  const raw = (window as Window & { __NW_BOOT__?: WebBootstrapResponse }).__NW_BOOT__;
  return raw && typeof raw === 'object' ? raw : {};
}

function normalizeBootstrapResponse(boot: WebBootstrapResponse): Pick<InitialAppBootstrapState, 'defaultKdfIterations' | 'registrationInviteRequired' | 'jwtWarning'> {
  const defaultKdfIterations = Number(boot.defaultKdfIterations || 600000);
  const registrationInviteRequired =
    typeof boot.registrationInviteRequired === 'boolean' ? boot.registrationInviteRequired : undefined;
  const jwtUnsafeReason = boot.jwtUnsafeReason || null;
  const jwtWarning = jwtUnsafeReason
    ? {
        reason: jwtUnsafeReason,
        minLength: Number(boot.jwtSecretMinLength || 32),
      }
    : null;

  return {
    defaultKdfIterations,
    registrationInviteRequired,
    jwtWarning,
  };
}

async function fetchBootstrapConfig(): Promise<WebBootstrapResponse> {
  try {
    const resp = await fetch('/api/web-bootstrap', {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (!resp.ok) return {};
    return ((await resp.json()) as WebBootstrapResponse) || {};
  } catch {
    return {};
  }
}

interface AccessTokenClaims {
  sub?: string;
  email?: string;
  name?: string | null;
  premium?: boolean;
}

function decodeAccessTokenClaims(accessToken: string): AccessTokenClaims {
  try {
    const parts = accessToken.split('.');
    if (parts.length < 2) return {};
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = payload.padEnd(Math.ceil(payload.length / 4) * 4, '=');
    return (JSON.parse(atob(padded)) as AccessTokenClaims) || {};
  } catch {
    return {};
  }
}

function buildTransientProfile(token: TokenSuccess, email: string, fallbackProfile: Profile | null = null): Profile {
  const claims = decodeAccessTokenClaims(token.access_token);
  const normalizedEmail = String(claims.email || email || '').trim().toLowerCase();
  const accountKeys = token.accountKeys ?? token.AccountKeys ?? null;
  return {
    id: String(claims.sub || ''),
    email: normalizedEmail,
    name: String(claims.name || normalizedEmail || ''),
    key: String(token.Key || ''),
    privateKey: token.PrivateKey ?? null,
    role: fallbackProfile?.role === 'admin' ? 'admin' : 'user',
    premium: !!claims.premium,
    accountKeys,
    masterPasswordHint: fallbackProfile?.masterPasswordHint ?? null,
    publicKey: fallbackProfile?.publicKey ?? null,
    object: 'profile',
  };
}

function resolveUnauthenticatedPhase(registrationInviteRequired: boolean | undefined, fallback: AppPhase): AppPhase {
  return registrationInviteRequired === false ? 'register' : fallback;
}

export function readInitialAppBootstrapState(): InitialAppBootstrapState {
  const { defaultKdfIterations, registrationInviteRequired, jwtWarning } = normalizeBootstrapResponse(readWindowBootstrap());
  const session = loadSession();
  const hasInviteCode = !!readInviteCodeFromUrl();
  const unauthenticatedPhase = hasInviteCode ? 'register' : 'login';

  return {
    defaultKdfIterations,
    registrationInviteRequired,
    jwtWarning,
    session,
    phase: jwtWarning ? 'login' : session ? 'locked' : resolveUnauthenticatedPhase(registrationInviteRequired, unauthenticatedPhase),
  };
}

export async function bootstrapAppSession(initial: InitialAppBootstrapState = readInitialAppBootstrapState()): Promise<BootstrapAppResult> {
  const remoteBoot = await fetchBootstrapConfig();
  const normalizedBoot = normalizeBootstrapResponse(remoteBoot);
  const defaultKdfIterations = normalizedBoot.defaultKdfIterations || initial.defaultKdfIterations;
  const registrationInviteRequired = normalizedBoot.registrationInviteRequired ?? initial.registrationInviteRequired;
  const jwtWarning = normalizedBoot.jwtWarning ?? initial.jwtWarning;

  if (jwtWarning) {
    return {
      defaultKdfIterations,
      registrationInviteRequired,
      jwtWarning,
      session: null,
      profile: null,
      phase: 'login',
    };
  }

  const loaded = initial.session;
  if (!loaded) {
    return {
      defaultKdfIterations,
      registrationInviteRequired,
      jwtWarning: null,
      session: null,
      profile: null,
      phase: resolveUnauthenticatedPhase(registrationInviteRequired, initial.phase),
    };
  }

  const cachedProfile = loadProfileSnapshot(loaded.email);
  if (cachedProfile) {
    return {
      defaultKdfIterations,
      registrationInviteRequired,
      jwtWarning: null,
      session: loaded,
      profile: cachedProfile,
      phase: 'locked',
      needsBackgroundHydration: true,
    };
  }

  return {
    defaultKdfIterations,
    registrationInviteRequired,
    jwtWarning: null,
    session: loaded,
    profile: null,
    phase: 'locked',
    needsBackgroundHydration: true,
  };
}

export async function hydrateLockedSession(
  session: SessionState,
  fallbackProfile: Profile | null = null
): Promise<{ session: SessionState | null; profile: Profile | null }> {
  const hasOfflineUnlock = hasOfflineUnlockRecord(session.email);
  if (hasOfflineUnlock && browserReportsOffline()) {
    return {
      session,
      profile: fallbackProfile || loadOfflineProfileSnapshot(session.email),
    };
  }

  const refreshedSession = await maybeRefreshSession(session);
  if (!refreshedSession?.accessToken) {
    if (hasOfflineUnlock && (browserReportsOffline() || !(await probeNodeWardenService()))) {
      return {
        session,
        profile: fallbackProfile || loadOfflineProfileSnapshot(session.email),
      };
    }
    return { session: null, profile: null };
  }
  try {
    const profile = await getProfile(
      createAuthedFetch(
        () => refreshedSession,
        () => {}
      )
    );
    return {
      session: refreshedSession,
      profile,
    };
  } catch {
    return {
      session: refreshedSession,
      profile: fallbackProfile,
    };
  }
}

export async function completeLogin(
  token: TokenSuccess,
  email: string,
  masterKey: Uint8Array,
  fallbackKdfIterations: number,
  freshMasterPasswordHash?: string | null
): Promise<CompletedLogin> {
  const normalizedEmail = email.trim().toLowerCase();
  const fallbackProfile = loadProfileSnapshot(normalizedEmail);
  const baseSession: SessionState = {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    email: normalizedEmail,
    authMode: token.web_session ? 'web-cookie' : 'token',
  };
  const tempFetch = createAuthedFetch(
    () => baseSession,
    () => {}
  );
  const profile = buildTransientProfile(token, normalizedEmail, fallbackProfile);
  if (!profile.key) {
    throw new Error('Missing profile key');
  }
  const keys = await unlockVaultKey(profile.key, masterKey);
  saveOfflineUnlockRecord({
    email: normalizedEmail,
    profile,
    profileKey: profile.key,
    kdfIterations: kdfIterationsFromLogin(token, fallbackKdfIterations),
  });
  return {
    session: { ...baseSession, ...keys },
    profile,
    profilePromise: getProfile(tempFetch),
    freshMasterPasswordHash: freshMasterPasswordHash || null,
    freshUserVerificationToken: readTokenUserVerificationToken(token),
  };
}

function readPasskeyPrfOption(token: TokenSuccess): AccountPasskeyPrfOption | null {
  const options = (token.UserDecryptionOptions || token.userDecryptionOptions || null) as any;
  return options?.WebAuthnPrfOption || options?.webAuthnPrfOption || null;
}

async function completeLoginWithVaultKeys(
  token: TokenSuccess,
  email: string,
  keys: { symEncKey: string; symMacKey: string },
  fallbackKdfIterations: number,
  freshMasterPasswordHash?: string | null
): Promise<CompletedLogin> {
  const normalizedEmail = email.trim().toLowerCase();
  const fallbackProfile = loadProfileSnapshot(normalizedEmail);
  const baseSession: SessionState = {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    email: normalizedEmail,
    authMode: token.web_session ? 'web-cookie' : 'token',
  };
  const tempFetch = createAuthedFetch(
    () => baseSession,
    () => {}
  );
  const profile = buildTransientProfile(token, normalizedEmail, fallbackProfile);
  saveOfflineUnlockRecord({
    email: normalizedEmail,
    profile,
    profileKey: profile.key,
    kdfIterations: kdfIterationsFromLogin(token, fallbackKdfIterations),
  });
  return {
    session: { ...baseSession, ...keys },
    profile,
    profilePromise: getProfile(tempFetch),
    freshMasterPasswordHash: freshMasterPasswordHash || null,
    freshUserVerificationToken: readTokenUserVerificationToken(token),
  };
}

export async function performPasswordLogin(
  email: string,
  password: string,
  fallbackIterations: number
): Promise<PasswordLoginResult> {
  const normalizedEmail = email.trim().toLowerCase();
  const derived = await deriveLoginHashLocally(normalizedEmail, password, fallbackIterations);
  const token = await loginWithPassword(normalizedEmail, derived.hash, { useRememberToken: true });

  if ('access_token' in token && token.access_token) {
    return {
      kind: 'success',
      login: await completeLogin(token, normalizedEmail, derived.masterKey, derived.kdfIterations, derived.hash),
    };
  }

  const tokenError = token as { TwoFactorProviders?: unknown; error_description?: string; error?: string };
  if (tokenError.TwoFactorProviders) {
    return {
      kind: 'totp',
      pendingTotp: {
        email: normalizedEmail,
        passwordHash: derived.hash,
        masterKey: derived.masterKey,
        kdfIterations: derived.kdfIterations,
      },
    };
  }

  return {
    kind: 'error',
    message: translateServerError(tokenError.error_description || tokenError.error, t('txt_login_failed')),
  };
}

export async function performPasskeyLogin(fallbackIterations: number, expectedEmail?: string): Promise<PasskeyLoginResult> {
  try {
    const options = await getAccountPasskeyAssertionOptions();
    const assertion = await assertAccountPasskey(options);
    const token = await loginWithAccountPasskeyAssertion(assertion);

    if (!('access_token' in token) || !token.access_token) {
      const tokenError = token as { error_description?: string; error?: string };
      return {
        kind: 'error',
        message: translateServerError(tokenError.error_description || tokenError.error, t('txt_login_failed')),
      };
    }

    const email = (decodeAccessTokenClaims(token.access_token).email || '').trim().toLowerCase();
    if (!email) {
      return { kind: 'error', message: t('txt_login_failed') };
    }
    const normalizedExpectedEmail = String(expectedEmail || '').trim().toLowerCase();
    if (normalizedExpectedEmail && email !== normalizedExpectedEmail) {
      return { kind: 'error', message: t('txt_passkey_not_for_locked_account') };
    }

    const prfOption = readPasskeyPrfOption(token);
    if (prfOption && assertion.prfKey) {
      const keys = await unlockVaultKeyWithAccountPasskeyPrf(assertion.prfKey, prfOption);
      return {
        kind: 'success',
        login: await completeLoginWithVaultKeys(token, email, keys, fallbackIterations),
      };
    }

    return {
      kind: 'password',
      pendingPasskeyPassword: {
        token,
        email,
        kdfIterations: kdfIterationsFromLogin(token, fallbackIterations),
      },
    };
  } catch (error) {
    return {
      kind: 'error',
      message: error instanceof Error ? translateServerError(error.message, error.message) : t('txt_login_failed'),
    };
  }
}

export async function completePasskeyPasswordLogin(
  pending: PendingPasskeyPassword,
  password: string
): Promise<CompletedLogin> {
  const derived = await deriveLoginHashLocally(pending.email, password, pending.kdfIterations);
  return completeLogin(pending.token, pending.email, derived.masterKey, pending.kdfIterations, derived.hash);
}

export async function performTotpLogin(
  pendingTotp: PendingTotp,
  totpCode: string,
  rememberDevice: boolean
): Promise<CompletedLogin> {
  const token = await loginWithPassword(pendingTotp.email, pendingTotp.passwordHash, {
    totpCode: totpCode.trim(),
    rememberDevice,
  });
  if ('access_token' in token && token.access_token) {
    return completeLogin(token, pendingTotp.email, pendingTotp.masterKey, pendingTotp.kdfIterations, pendingTotp.passwordHash);
  }
  const tokenError = token as { error_description?: string; error?: string };
  throw new Error(translateServerError(tokenError.error_description || tokenError.error, t('txt_totp_verify_failed')));
}

export async function performRecoverTwoFactorLogin(
  email: string,
  password: string,
  recoveryCode: string,
  fallbackIterations: number
): Promise<RecoverTwoFactorResult> {
  const normalizedEmail = email.trim().toLowerCase();
  const derived = await deriveLoginHashLocally(normalizedEmail, password, fallbackIterations);
  const recovered = await recoverTwoFactor(normalizedEmail, derived.hash, recoveryCode.trim());
  const token = await loginWithPassword(normalizedEmail, derived.hash, { useRememberToken: false });

  if ('access_token' in token && token.access_token) {
    return {
      login: await completeLogin(token, normalizedEmail, derived.masterKey, derived.kdfIterations, derived.hash),
      newRecoveryCode: recovered.newRecoveryCode || null,
    };
  }

  return {
    login: null,
    newRecoveryCode: recovered.newRecoveryCode || null,
  };
}

export async function performRegistration(args: {
  email: string;
  name: string;
  password: string;
  masterPasswordHint: string;
  inviteCode: string;
  fallbackIterations: number;
}) {
  return registerAccount({
    email: args.email.trim().toLowerCase(),
    name: args.name.trim(),
    password: args.password,
    masterPasswordHint: args.masterPasswordHint.trim(),
    inviteCode: args.inviteCode.trim(),
    fallbackIterations: args.fallbackIterations,
  });
}

export async function performUnlock(
  session: SessionState,
  profile: Profile | null,
  password: string,
  fallbackIterations: number
): Promise<PasswordLoginResult> {
  const normalizedEmail = (profile?.email || session.email).trim().toLowerCase();
  const offlineIterations = getOfflineUnlockKdfIterations(normalizedEmail);
  const hasOfflineUnlock = !!offlineIterations;
  const kdfIterations = offlineIterations || fallbackIterations;
  const derived = await deriveLoginHashLocally(normalizedEmail, password, kdfIterations);
  const unlockOffline = async (): Promise<PasswordLoginResult> => {
    try {
      const offline = await unlockOfflineVaultWithMasterKey(session, profile, derived.masterKey);
      return {
        kind: 'success',
        login: {
          session: offline.session,
          profile: offline.profile,
          profilePromise: Promise.resolve(offline.profile),
          freshMasterPasswordHash: null,
        },
      };
    } catch {
      return {
        kind: 'error',
        message: t('txt_unlock_failed_master_password_is_incorrect'),
      };
    }
  };

  if (hasOfflineUnlock && browserReportsOffline()) {
    return unlockOffline();
  }

  let token: TokenSuccess | { TwoFactorProviders?: unknown; error_description?: string; error?: string };
  try {
    token = await loginWithPassword(normalizedEmail, derived.hash, {
      useRememberToken: true,
    });
  } catch {
    if (hasOfflineUnlock && (browserReportsOffline() || !(await probeNodeWardenService()))) {
      return unlockOffline();
    }
    return {
      kind: 'error',
      message: t('txt_unlock_failed_master_password_is_incorrect'),
    };
  }

  if ('access_token' in token && token.access_token) {
    return {
      kind: 'success',
      login: await completeLogin(token, normalizedEmail, derived.masterKey, derived.kdfIterations, derived.hash),
    };
  }

  const tokenError = token as { TwoFactorProviders?: unknown; error_description?: string; error?: string };
  if (tokenError.TwoFactorProviders) {
    return {
      kind: 'totp',
      pendingTotp: {
        email: normalizedEmail,
        passwordHash: derived.hash,
        masterKey: derived.masterKey,
        kdfIterations: derived.kdfIterations,
      },
    };
  }

  return {
    kind: 'error',
    message: translateServerError(tokenError.error_description || tokenError.error, t('txt_unlock_failed')),
  };
}

