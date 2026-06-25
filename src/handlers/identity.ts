import { Env, TokenResponse } from '../types';
import { StorageService } from '../services/storage';
import { AuthService } from '../services/auth';
import { RateLimitService, getClientIdentifier } from '../services/ratelimit';
import { jsonResponse, errorResponse, identityErrorResponse } from '../utils/response';
import { LIMITS } from '../config/limits';
import { findMatchingTotpCounter, isTotpEnabled } from '../utils/totp';
import { createRefreshToken } from '../utils/jwt';
import { readAuthRequestDeviceInfo } from '../utils/device';
import { createRecoveryCode, recoveryCodeEquals } from '../utils/recovery-code';
import { generateUUID } from '../utils/uuid';
import { issueSendAccessToken } from './sends';
import { registerMobilePushDevice } from '../services/push-relay';
import {
  buildAccountKeys,
  buildUserDecryptionOptions,
} from '../utils/user-decryption';
import { auditRequestMetadata, safeWriteAuditEvent } from '../services/audit-events';
import {
  assertAccountPasskeyCredential,
  buildAccountPasskeyTokenUserDecryptionOption,
} from './account-passkeys';
import { isAuthRequestExpired } from '../services/storage-auth-request-repo';
import { createPasskeyUserVerificationToken } from '../utils/user-verification-token';

const TWO_FACTOR_REMEMBER_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const TWO_FACTOR_PROVIDER_AUTHENTICATOR = 0;
const TWO_FACTOR_PROVIDER_REMEMBER = 5;
const TWO_FACTOR_PROVIDER_RECOVERY_CODE = 8;
const WEB_REFRESH_COOKIE = 'nodewarden_web_refresh';
// Some UI surfaces use -1 for the recovery-code settings dialog. Login itself follows
// the official Identity provider enum (RecoveryCode = 8), while request parsing remains
// compatible with older/local provider values.
const TWO_FACTOR_PROVIDER_RECOVERY_CODE_RESPONSE = '-1';
const TWO_FACTOR_PROVIDER_RECOVERY_CODE_ANDROID_REQUEST = 100;

function resolveTotpSecret(userSecret: string | null): string | null {
  if (userSecret && isTotpEnabled(userSecret)) {
    return userSecret;
  }
  return null;
}

async function resolveDeviceSession(
  storage: StorageService,
  userId: string,
  deviceInfo: ReturnType<typeof readAuthRequestDeviceInfo>
): Promise<{ identifier: string; sessionStamp: string } | null> {
  if (!deviceInfo.deviceIdentifier) return null;
  const existingDevice = await storage.getDevice(userId, deviceInfo.deviceIdentifier);
  const sessionStamp = String(existingDevice?.sessionStamp || '').trim() || generateUUID();
  return { identifier: deviceInfo.deviceIdentifier, sessionStamp };
}

function readDevicePushToken(body: Record<string, string>): string {
  return String(readBodyValue(body, ['devicePushToken', 'DevicePushToken', 'device_push_token']) || '').trim();
}

async function persistIdentityDevicePushToken(
  env: Env,
  storage: StorageService,
  userId: string,
  deviceSession: { identifier: string; sessionStamp: string } | null,
  deviceType: number,
  body: Record<string, string>
): Promise<void> {
  if (!deviceSession) return;
  const pushToken = readDevicePushToken(body);
  if (!pushToken) return;

  const device = await storage.getDevice(userId, deviceSession.identifier);
  if (!device) return;

  const pushUuid = device.pushUuid || generateUUID();
  await storage.updateDevicePushToken(userId, deviceSession.identifier, pushUuid, pushToken);
  const registered = await registerMobilePushDevice(env, {
    userId,
    deviceIdentifier: deviceSession.identifier,
    type: device.type || deviceType,
    pushUuid,
    pushToken,
  });
  console.info('Mobile push token updated from identity token request', {
    userId,
    deviceIdentifier: deviceSession.identifier,
    deviceType: device.type || deviceType,
    pushUuid,
    pushTokenLength: pushToken.length,
    relayRegistered: registered,
  });
}

function shouldUseWebSession(request: Request): boolean {
  return String(request.headers.get('X-NodeWarden-Web-Session') || '').trim() === '1';
}

function parseCookieValue(request: Request, name: string): string | null {
  const rawCookie = String(request.headers.get('Cookie') || '').trim();
  if (!rawCookie) return null;
  for (const part of rawCookie.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key !== name) continue;
    const value = rest.join('=').trim();
    return value ? decodeURIComponent(value) : null;
  }
  return null;
}

function constantTimeEquals(a: string, b: string): boolean {
  const encA = new TextEncoder().encode(a);
  const encB = new TextEncoder().encode(b);
  if (encA.length !== encB.length) return false;

  let diff = 0;
  for (let i = 0; i < encA.length; i++) {
    diff |= encA[i] ^ encB[i];
  }
  return diff === 0;
}

function readBodyValue(body: Record<string, string>, names: string[]): string | undefined {
  for (const name of names) {
    const value = body[name];
    if (value != null) return value;
  }
  return undefined;
}

function buildRefreshCookie(request: Request, refreshToken: string, maxAgeSeconds: number): string {
  const isHttps = new URL(request.url).protocol === 'https:';
  const parts = [
    `${WEB_REFRESH_COOKIE}=${encodeURIComponent(refreshToken)}`,
    'Path=/identity/connect',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
  ];
  if (isHttps) parts.push('Secure');
  return parts.join('; ');
}

function buildClearedRefreshCookie(request: Request): string {
  return buildRefreshCookie(request, '', 0);
}

function withWebRefreshCookie(request: Request, response: Response, refreshToken: string | null): Response {
  const headers = new Headers(response.headers);
  headers.append(
    'Set-Cookie',
    refreshToken
      ? buildRefreshCookie(request, refreshToken, Math.floor(LIMITS.auth.refreshTokenTtlMs / 1000))
      : buildClearedRefreshCookie(request)
  );
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function buildPreloginResponse(
  email: string,
  kdfType: number,
  kdfIterations: number,
  kdfMemory: number | null,
  kdfParallelism: number | null
): Record<string, unknown> {
  return {
    kdf: kdfType,
    kdfIterations,
    kdfMemory,
    kdfParallelism,
    KdfSettings: {
      KdfType: kdfType,
      Iterations: kdfIterations,
      Memory: kdfMemory,
      Parallelism: kdfParallelism,
    },
    Salt: email.toLowerCase(),
  };
}

function masterPasswordPolicyResponse(): TokenResponse['MasterPasswordPolicy'] {
  return {
    minComplexity: 0,
    minLength: 0,
    requireUpper: false,
    requireLower: false,
    requireNumbers: false,
    requireSpecial: false,
    enforceOnLogin: false,
    Object: 'masterPasswordPolicy',
    object: 'masterPasswordPolicy',
  };
}

function twoFactorRequiredResponse(message: string = 'Two factor required.'): Response {
  // Match Bitwarden Identity: TwoFactorProviders2 lists enabled 2FA providers only.
  // Clients expose recovery-code entry points themselves; Android 2026.4 fails to
  // parse the challenge if an unknown recovery provider key such as "8" is included.
  const providers = [String(TWO_FACTOR_PROVIDER_AUTHENTICATOR)];
  const providers2: Record<string, { Email: null }> = {};
  for (const provider of providers) providers2[provider] = { Email: null };
  const customResponse = {
    TwoFactorProviders: providers,
    TwoFactorProviders2: providers2,
    SsoEmail2faSessionToken: null,
    MasterPasswordPolicy: masterPasswordPolicyResponse(),
  };

  // Bitwarden clients rely on these fields to trigger the 2FA UI flow.
  return jsonResponse(
    {
      error: 'invalid_grant',
      error_description: message,
      Error: 'invalid_grant',
      ErrorDescription: message,
      ErrorMessage: message,
      TwoFactorProviders: customResponse.TwoFactorProviders,
      TwoFactorProviders2: customResponse.TwoFactorProviders2,
      // Required by current Android parser (nullable value is acceptable).
      SsoEmail2faSessionToken: customResponse.SsoEmail2faSessionToken,
      MasterPasswordPolicy: customResponse.MasterPasswordPolicy,
      CustomResponse: customResponse,
      ErrorModel: {
        Message: message,
        Object: 'error',
      },
    },
    400
  );
}

async function recordFailedLoginAndBuildResponse(
  rateLimit: RateLimitService,
  loginIdentifier: string,
  message: string
): Promise<Response> {
  const result = await rateLimit.recordFailedLogin(loginIdentifier);
  if (result.locked) {
    return identityErrorResponse(
      `Too many failed login attempts. Account locked for ${Math.ceil(result.retryAfterSeconds! / 60)} minutes.`,
      'TooManyRequests',
      429
    );
  }
  return identityErrorResponse(message, 'invalid_grant', 400);
}

async function recordFailedTwoFactorAndBuildResponse(
  rateLimit: RateLimitService,
  loginIdentifier: string
): Promise<Response> {
  const failed = await rateLimit.recordFailedLogin(loginIdentifier);
  if (failed.locked) {
    return identityErrorResponse(
      `Too many failed login attempts. Account locked for ${Math.ceil(failed.retryAfterSeconds! / 60)} minutes.`,
      'TooManyRequests',
      429
    );
  }
  return identityErrorResponse('Two-step token is invalid. Try again.', 'invalid_grant', 400);
}

// POST /identity/connect/token
export async function handleToken(request: Request, env: Env): Promise<Response> {
  const storage = new StorageService(env.DB);
  const auth = new AuthService(env);
  const rateLimit = new RateLimitService(env.DB);

  let body: Record<string, string>;
  const contentType = request.headers.get('content-type') || '';
  try {
    if (contentType.includes('application/x-www-form-urlencoded')) {
      const formData = await request.formData();
      body = Object.fromEntries(formData.entries()) as Record<string, string>;
    } else {
      body = await request.json();
    }
  } catch {
    return identityErrorResponse('Invalid request payload', 'invalid_request', 400);
  }

  const grantType = body.grant_type;
  const clientIdentifier = getClientIdentifier(request);
  if (!clientIdentifier) {
    return identityErrorResponse('Client IP is required', 'invalid_request', 403);
  }

  if (grantType === 'password') {
    // Login with password
    const email = body.username?.toLowerCase();
    const passwordHash = body.password;
    const authRequestId = readBodyValue(body, ['authRequest', 'AuthRequest']);
    const twoFactorToken = readBodyValue(body, ['twoFactorToken', 'TwoFactorToken']);
    const twoFactorProvider = readBodyValue(body, ['twoFactorProvider', 'TwoFactorProvider']);
    const twoFactorRemember = readBodyValue(body, ['twoFactorRemember', 'TwoFactorRemember']);
    const loginIdentifier = clientIdentifier;
    const deviceInfo = readAuthRequestDeviceInfo(body, request);

    if (!email || !passwordHash) {
      // Bitwarden clients expect OAuth-style error fields.
      return identityErrorResponse('Email and password are required', 'invalid_request', 400);
    }

    // Check login lockout before user lookup to reduce user-enumeration signal
    const loginCheck = await rateLimit.checkLoginAttempt(loginIdentifier);
    if (!loginCheck.allowed) {
      return identityErrorResponse(
        `Too many failed login attempts. Try again in ${Math.ceil(loginCheck.retryAfterSeconds! / 60)} minutes.`,
        'TooManyRequests',
        429
      );
    }

    const user = await storage.getUser(email);
    if (!user) {
      await rateLimit.recordFailedLogin(loginIdentifier);
      return identityErrorResponse('Username or password is incorrect. Try again', 'invalid_grant', 400);
    }
    if (user.status !== 'active') {
      await rateLimit.recordFailedLogin(loginIdentifier);
      await safeWriteAuditEvent(env, {
        actorUserId: user.id,
        action: 'auth.login.failed.user_inactive',
        category: 'auth',
        level: 'warn',
        targetType: 'user',
        targetId: user.id,
        metadata: {
          grantType,
          deviceIdentifier: deviceInfo.deviceIdentifier,
          ...auditRequestMetadata(request),
        },
      });
      return identityErrorResponse('Account is disabled', 'invalid_grant', 400);
    }

    let validatedAuthRequestId: string | null = null;
    let authRequestLoginKey: string | null = null;
    let valid = false;
    const normalizedAuthRequestId = String(authRequestId || '').trim();
    if (normalizedAuthRequestId) {
      const authRequest = await storage.getAuthRequestById(normalizedAuthRequestId);
      valid = !!(
        authRequest &&
        authRequest.userId === user.id &&
        authRequest.type === 0 &&
        authRequest.approved === true &&
        authRequest.responseDate &&
        !authRequest.authenticationDate &&
        !isAuthRequestExpired(authRequest) &&
        !!authRequest.key &&
        constantTimeEquals(authRequest.accessCode, passwordHash)
      );
      if (valid) {
        validatedAuthRequestId = authRequest!.id;
        authRequestLoginKey = authRequest!.key;
      }
    } else {
      valid = await auth.verifyPassword(passwordHash, user.masterPasswordHash, user.email);
    }
    if (!valid) {
      await safeWriteAuditEvent(env, {
        actorUserId: user.id,
        action: normalizedAuthRequestId ? 'auth.login.failed.bad_auth_request' : 'auth.login.failed.bad_password',
        category: 'auth',
        level: 'warn',
        targetType: 'user',
        targetId: user.id,
        metadata: {
          grantType,
          deviceIdentifier: deviceInfo.deviceIdentifier,
          ...auditRequestMetadata(request),
        },
      });
      return recordFailedLoginAndBuildResponse(
        rateLimit,
        loginIdentifier,
        'Username or password is incorrect. Try again'
      );
    }

    // Optional 2FA: enabled only by per-user secret.
    let trustedTwoFactorTokenToReturn: string | undefined;
    const effectiveTotpSecret = resolveTotpSecret(user.totpSecret);
    if (effectiveTotpSecret) {
      const normalizedTwoFactorProvider = String(twoFactorProvider ?? '').trim();
      const normalizedTwoFactorToken = String(twoFactorToken ?? '').trim();
      let rememberRequested = ['1', 'true', 'True', 'TRUE', 'on', 'yes', 'Yes', 'YES'].includes(String(twoFactorRemember || '').trim());
      const hasProvider = normalizedTwoFactorProvider.length > 0;
      const hasToken = normalizedTwoFactorToken.length > 0;

      // Upstream-compatible behavior: if 2FA is required and either provider or token is missing,
      // respond with a 2FA challenge payload.
      if (!hasProvider || !hasToken) {
        return twoFactorRequiredResponse('Two factor required.');
      }

      let passedByRememberToken = false;
      if (normalizedTwoFactorProvider === String(TWO_FACTOR_PROVIDER_REMEMBER)) {
        if (deviceInfo.deviceIdentifier) {
          const trustedUserId = await storage.getTrustedTwoFactorDeviceTokenUserId(
            normalizedTwoFactorToken,
            deviceInfo.deviceIdentifier
          );
          passedByRememberToken = trustedUserId === user.id;
        }

        // Remember token missing/invalid/expired should re-enter the 2FA challenge flow.
        if (!passedByRememberToken) {
          return twoFactorRequiredResponse('Two factor required.');
        }
      } else if (normalizedTwoFactorProvider === String(TWO_FACTOR_PROVIDER_AUTHENTICATOR)) {
        const matchedCounter = await findMatchingTotpCounter(effectiveTotpSecret, normalizedTwoFactorToken);
        if (matchedCounter == null) {
          return recordFailedTwoFactorAndBuildResponse(rateLimit, loginIdentifier);
        }
        const consumed = await storage.consumeTotpLoginCounter(user.id, matchedCounter);
        if (!consumed) {
          return recordFailedTwoFactorAndBuildResponse(rateLimit, loginIdentifier);
        }
      } else if (
        normalizedTwoFactorProvider === TWO_FACTOR_PROVIDER_RECOVERY_CODE_RESPONSE ||
        normalizedTwoFactorProvider === String(TWO_FACTOR_PROVIDER_RECOVERY_CODE) ||
        normalizedTwoFactorProvider === String(TWO_FACTOR_PROVIDER_RECOVERY_CODE_ANDROID_REQUEST)
      ) {
        if (!recoveryCodeEquals(normalizedTwoFactorToken, user.totpRecoveryCode)) {
          return recordFailedTwoFactorAndBuildResponse(rateLimit, loginIdentifier);
        }
        user.totpSecret = null;
        user.totpRecoveryCode = createRecoveryCode();
        user.updatedAt = new Date().toISOString();
        await storage.saveUser(user);
        await storage.deleteRefreshTokensByUserId(user.id);
        rememberRequested = false;
      } else {
        // Unsupported provider for this server profile behaves as an invalid 2FA attempt.
        return recordFailedTwoFactorAndBuildResponse(rateLimit, loginIdentifier);
      }

      // Upstream behavior: do not issue a new remember token when auth itself used remember provider.
      if (rememberRequested && !passedByRememberToken && deviceInfo.deviceIdentifier) {
        trustedTwoFactorTokenToReturn = createRefreshToken();
        await storage.saveTrustedTwoFactorDeviceToken(
          trustedTwoFactorTokenToReturn,
          user.id,
          deviceInfo.deviceIdentifier,
          Date.now() + TWO_FACTOR_REMEMBER_TTL_MS
        );
      }
    }

    // Persist device only after successful password + (optional) 2FA verification.
    const deviceSession = await resolveDeviceSession(storage, user.id, deviceInfo);
    if (deviceSession) {
      await storage.upsertDevice(
        user.id,
        deviceSession.identifier,
        deviceInfo.deviceName,
        deviceInfo.deviceType,
        deviceSession.sessionStamp
      );
      await persistIdentityDevicePushToken(env, storage, user.id, deviceSession, deviceInfo.deviceType, body);
    }

    // Successful login - clear failed attempts
    await rateLimit.clearLoginAttempts(loginIdentifier);
    if (validatedAuthRequestId) {
      await storage.markAuthRequestAuthenticated(validatedAuthRequestId);
    }

    const accessToken = await auth.generateAccessToken(user, deviceSession);
    const refreshToken = await auth.generateRefreshToken(user.id, deviceSession);
    const accountKeys = buildAccountKeys(user);
    const userDecryptionOptions = buildUserDecryptionOptions(user);
    await safeWriteAuditEvent(env, {
      actorUserId: user.id,
      action: 'auth.login.success',
      category: 'auth',
      level: 'info',
      targetType: 'user',
      targetId: user.id,
      metadata: {
        grantType,
        webSession: shouldUseWebSession(request),
        deviceIdentifier: deviceSession?.identifier ?? deviceInfo.deviceIdentifier,
        deviceType: deviceInfo.deviceType,
        ...auditRequestMetadata(request),
      },
    });

    const response: TokenResponse = {
      access_token: accessToken,
      expires_in: LIMITS.auth.accessTokenTtlSeconds,
      token_type: 'Bearer',
      ...(shouldUseWebSession(request) ? { web_session: true } : { refresh_token: refreshToken }),
      ...(trustedTwoFactorTokenToReturn ? { TwoFactorToken: trustedTwoFactorTokenToReturn } : {}),
      Key: authRequestLoginKey || user.key,
      PrivateKey: user.privateKey,
      AccountKeys: accountKeys,
      accountKeys: accountKeys,
      Kdf: user.kdfType,
      KdfIterations: user.kdfIterations,
      KdfMemory: user.kdfMemory,
      KdfParallelism: user.kdfParallelism,
      ForcePasswordReset: false,
      ResetMasterPassword: false,
      MasterPasswordPolicy: masterPasswordPolicyResponse(),
      ApiUseKeyConnector: false,
      scope: 'api offline_access',
      unofficialServer: true,
      UserDecryptionOptions: userDecryptionOptions,
      userDecryptionOptions: userDecryptionOptions,
    };

    const baseResponse = jsonResponse(response);
    return shouldUseWebSession(request)
      ? withWebRefreshCookie(request, baseResponse, refreshToken)
      : baseResponse;

  } else if (grantType === 'webauthn') {
    const loginIdentifier = clientIdentifier;
    const loginCheck = await rateLimit.checkLoginAttempt(loginIdentifier);
    if (!loginCheck.allowed) {
      return identityErrorResponse(
        `Too many failed login attempts. Try again in ${Math.ceil(loginCheck.retryAfterSeconds! / 60)} minutes.`,
        'TooManyRequests',
        429
      );
    }

    const token = String(body.token || '').trim();
    let deviceResponse: unknown = body.deviceResponse;
    if (typeof deviceResponse === 'string') {
      try {
        deviceResponse = JSON.parse(deviceResponse);
      } catch {
        return identityErrorResponse('Invalid passkey response', 'invalid_request', 400);
      }
    }
    if (!token || !deviceResponse) {
      return identityErrorResponse('Passkey token and deviceResponse are required', 'invalid_request', 400);
    }

    let asserted: Awaited<ReturnType<typeof assertAccountPasskeyCredential>>;
    try {
      asserted = await assertAccountPasskeyCredential(request, env, storage, {
        token,
        deviceResponse,
        scope: 'Authentication',
      });
    } catch (error) {
      await rateLimit.recordFailedLogin(loginIdentifier);
      await safeWriteAuditEvent(env, {
        actorUserId: null,
        action: 'auth.passkey.login.failed',
        category: 'auth',
        level: 'warn',
        targetType: 'accountPasskey',
        targetId: null,
        metadata: {
          grantType,
          reason: error instanceof Error ? error.message : 'assertion_failed',
          ...auditRequestMetadata(request),
        },
      });
      return identityErrorResponse('Passkey is invalid. Try again', 'invalid_grant', 400);
    }

    const { user, credential } = asserted;
    if (user.status !== 'active') {
      await rateLimit.recordFailedLogin(loginIdentifier);
      return identityErrorResponse('Account is disabled', 'invalid_grant', 400);
    }

    const deviceInfo = readAuthRequestDeviceInfo(body, request);
    const deviceSession = await resolveDeviceSession(storage, user.id, deviceInfo);
    if (deviceSession) {
      await storage.upsertDevice(
        user.id,
        deviceSession.identifier,
        deviceInfo.deviceName,
        deviceInfo.deviceType,
        deviceSession.sessionStamp
      );
      await persistIdentityDevicePushToken(env, storage, user.id, deviceSession, deviceInfo.deviceType, body);
    }

    await rateLimit.clearLoginAttempts(loginIdentifier);

    const accessToken = await auth.generateAccessToken(user, deviceSession);
    const refreshToken = await auth.generateRefreshToken(user.id, deviceSession);
    const userVerificationToken = await createPasskeyUserVerificationToken(env, user.id, 'backup.settings.repair');
    const accountKeys = buildAccountKeys(user);
    const webAuthnPrfOption = buildAccountPasskeyTokenUserDecryptionOption(credential);
    const userDecryptionOptions = buildUserDecryptionOptions(user, webAuthnPrfOption);
    await safeWriteAuditEvent(env, {
      actorUserId: user.id,
      action: 'auth.passkey.login.success',
      category: 'auth',
      level: 'info',
      targetType: 'accountPasskey',
      targetId: credential.id,
      metadata: {
        grantType,
        webSession: shouldUseWebSession(request),
        deviceIdentifier: deviceSession?.identifier ?? deviceInfo.deviceIdentifier,
        deviceType: deviceInfo.deviceType,
        ...auditRequestMetadata(request),
      },
    });

    const response: TokenResponse = {
      access_token: accessToken,
      expires_in: LIMITS.auth.accessTokenTtlSeconds,
      token_type: 'Bearer',
      ...(shouldUseWebSession(request) ? { web_session: true } : { refresh_token: refreshToken }),
      Key: user.key,
      PrivateKey: user.privateKey,
      AccountKeys: accountKeys,
      accountKeys: accountKeys,
      Kdf: user.kdfType,
      KdfIterations: user.kdfIterations,
      KdfMemory: user.kdfMemory,
      KdfParallelism: user.kdfParallelism,
      ForcePasswordReset: false,
      ResetMasterPassword: false,
      MasterPasswordPolicy: masterPasswordPolicyResponse(),
      ApiUseKeyConnector: false,
      scope: 'api offline_access',
      unofficialServer: true,
      UserVerificationToken: userVerificationToken,
      userVerificationToken,
      UserDecryptionOptions: userDecryptionOptions,
      userDecryptionOptions: userDecryptionOptions,
    };

    const baseResponse = jsonResponse(response);
    return shouldUseWebSession(request)
      ? withWebRefreshCookie(request, baseResponse, refreshToken)
      : baseResponse;

  } else if (grantType === 'client_credentials') {
    // Login with client credentials
    const clientId = body.client_id;
    const clientSecret = body.client_secret;
    const scope = body.scope;
    const deviceInfo = readAuthRequestDeviceInfo(body, request);

    const loginIdentifier = clientIdentifier;
    const parmValid = checkClientCredentialsParam(clientId, clientSecret, scope);
    if (!parmValid) {
      return identityErrorResponse('Parameter error', 'invalid_request', 400);
    }

    // Check login lockout before user lookup to reduce user-enumeration signal
    const loginCheck = await rateLimit.checkLoginAttempt(loginIdentifier);
    if (!loginCheck.allowed) {
      return identityErrorResponse(
        `Too many failed login attempts. Try again in ${Math.ceil(loginCheck.retryAfterSeconds! / 60)} minutes.`,
        'TooManyRequests',
        429
      );
    }

    const uid = clientId.slice(5);
    const user = await storage.getUserById(uid);
    if (!user) {
      await rateLimit.recordFailedLogin(loginIdentifier);
      return identityErrorResponse('ClientId or clientSecret is incorrect. Try again', 'invalid_grant', 400);
    }
    if (user.status !== 'active') {
      await rateLimit.recordFailedLogin(loginIdentifier);
      await safeWriteAuditEvent(env, {
        actorUserId: user.id,
        action: 'auth.login.failed.user_inactive',
        category: 'auth',
        level: 'warn',
        targetType: 'user',
        targetId: user.id,
        metadata: {
          grantType,
          deviceIdentifier: deviceInfo.deviceIdentifier,
          ...auditRequestMetadata(request),
        },
      });
      return identityErrorResponse('Account is disabled', 'invalid_grant', 400);
    }

    if (!user.apiKey || !constantTimeEquals(clientSecret, user.apiKey)) {
      await rateLimit.recordFailedLogin(loginIdentifier);
      await safeWriteAuditEvent(env, {
        actorUserId: user.id,
        action: 'auth.login.failed.bad_api_key',
        category: 'auth',
        level: 'warn',
        targetType: 'user',
        targetId: user.id,
        metadata: {
          grantType,
          deviceIdentifier: deviceInfo.deviceIdentifier,
          ...auditRequestMetadata(request),
        },
      });
      return identityErrorResponse('ClientId or clientSecret is incorrect. Try again', 'invalid_grant', 400);
    }

    // Persist device only after successful client credential verification.
    const deviceSession = await resolveDeviceSession(storage, user.id, deviceInfo);
    if (deviceSession) {
      await storage.upsertDevice(
        user.id,
        deviceSession.identifier,
        deviceInfo.deviceName,
        deviceInfo.deviceType,
        deviceSession.sessionStamp
      );
      await persistIdentityDevicePushToken(env, storage, user.id, deviceSession, deviceInfo.deviceType, body);
    }

    // Successful login - clear failed attempts
    await rateLimit.clearLoginAttempts(loginIdentifier);

    const accessToken = await auth.generateAccessToken(user, deviceSession);
    const refreshToken = await auth.generateRefreshToken(user.id, deviceSession);
    const accountKeys = buildAccountKeys(user);
    const userDecryptionOptions = buildUserDecryptionOptions(user);
    await safeWriteAuditEvent(env, {
      actorUserId: user.id,
      action: 'auth.login.success',
      category: 'auth',
      level: 'info',
      targetType: 'user',
      targetId: user.id,
      metadata: {
        grantType,
        webSession: shouldUseWebSession(request),
        deviceIdentifier: deviceSession?.identifier ?? deviceInfo.deviceIdentifier,
        deviceType: deviceInfo.deviceType,
        ...auditRequestMetadata(request),
      },
    });

    const response: TokenResponse = {
      access_token: accessToken,
      expires_in: LIMITS.auth.accessTokenTtlSeconds,
      token_type: 'Bearer',
      ...(shouldUseWebSession(request) ? { web_session: true } : { refresh_token: refreshToken }),
      Key: user.key,
      PrivateKey: user.privateKey,
      AccountKeys: accountKeys,
      accountKeys: accountKeys,
      Kdf: user.kdfType,
      KdfIterations: user.kdfIterations,
      KdfMemory: user.kdfMemory,
      KdfParallelism: user.kdfParallelism,
      ForcePasswordReset: false,
      ResetMasterPassword: false,
      MasterPasswordPolicy: masterPasswordPolicyResponse(),
      ApiUseKeyConnector: false,
      scope: 'api offline_access',
      unofficialServer: true,
      UserDecryptionOptions: userDecryptionOptions,
      userDecryptionOptions: userDecryptionOptions,
    };

    const baseResponse = jsonResponse(response);
    return shouldUseWebSession(request)
      ? withWebRefreshCookie(request, baseResponse, refreshToken)
      : baseResponse;

  } else if (grantType === 'send_access') {
    const sendAccessLimit = await rateLimit.consumeBudget(`${clientIdentifier}:public`, LIMITS.rateLimit.publicRequestsPerMinute);
    if (!sendAccessLimit.allowed) {
      return identityErrorResponse(
        `Rate limit exceeded. Try again in ${sendAccessLimit.retryAfterSeconds} seconds.`,
        'TooManyRequests',
        429
      );
    }

    const sendId = String(body.send_id || body.sendId || '').trim();
    if (!sendId) {
      return jsonResponse(
        {
          error: 'invalid_request',
          error_description: 'send_id is required',
          send_access_error_type: 'invalid_send_id',
          ErrorModel: {
            Message: 'send_id is required',
            Object: 'error',
          },
        },
        400
      );
    }

    const passwordHashB64 = String(
      body.password_hash_b64 || body.passwordHashB64 || body.passwordHash || body.password_hash || ''
    ).trim() || null;
    const password = String(body.password || '').trim() || null;

    const result = await issueSendAccessToken(
      env,
      sendId,
      passwordHashB64,
      password,
      rateLimit,
      `${clientIdentifier}:send-password`
    );
    if ('error' in result) {
      return result.error;
    }

    return jsonResponse({
      access_token: result.token,
      expires_in: LIMITS.auth.sendAccessTokenTtlSeconds,
      token_type: 'Bearer',
      scope: 'api.send',
      unofficialServer: true,
    });
  } else if (grantType === 'refresh_token') {
    const refreshLimit = await rateLimit.consumeBudget(
      `${clientIdentifier}:identity-refresh`,
      LIMITS.rateLimit.refreshTokenRequestsPerMinute
    );
    if (!refreshLimit.allowed) {
      return identityErrorResponse(
        `Rate limit exceeded. Try again in ${refreshLimit.retryAfterSeconds} seconds.`,
        'TooManyRequests',
        429
      );
    }

    // Refresh token
    const refreshToken = String(body.refresh_token || '').trim() || (
      shouldUseWebSession(request)
        ? parseCookieValue(request, WEB_REFRESH_COOKIE)
        : null
    );
    if (!refreshToken) {
      return identityErrorResponse('Refresh token is required', 'invalid_request', 400);
    }

    const result = await auth.refreshAccessTokenDetailed(refreshToken);
    if (!result.ok) {
      await safeWriteAuditEvent(env, {
        actorUserId: result.userId ?? null,
        action: `auth.refresh.failed.${result.reason}`,
        category: 'auth',
        level: 'warn',
        targetType: result.deviceIdentifier ? 'device' : 'refreshToken',
        targetId: result.deviceIdentifier ?? null,
        metadata: {
          grantType,
          reason: result.reason,
          webSession: shouldUseWebSession(request),
          ...auditRequestMetadata(request),
        },
      });
      const invalidResponse = identityErrorResponse('Invalid refresh token', 'invalid_grant', 400);
      return shouldUseWebSession(request)
        ? withWebRefreshCookie(request, invalidResponse, null)
        : invalidResponse;
    }

    // Keep a short overlap window for old refresh token to absorb
    // concurrent refresh requests from multiple client contexts.
    await storage.constrainRefreshTokenExpiry(
      refreshToken,
      Date.now() + LIMITS.auth.refreshTokenOverlapGraceMs
    );

    const { accessToken, user, device } = result;
    if (device?.identifier) {
      await storage.touchDeviceLastSeen(user.id, device.identifier);
    }
    const newRefreshToken = await auth.generateRefreshToken(user.id, device);
    const accountKeys = buildAccountKeys(user);
    const userDecryptionOptions = buildUserDecryptionOptions(user);

    const response: TokenResponse = {
      access_token: accessToken,
      expires_in: LIMITS.auth.accessTokenTtlSeconds,
      token_type: 'Bearer',
      ...(shouldUseWebSession(request) ? { web_session: true } : { refresh_token: newRefreshToken }),
      Key: user.key,
      PrivateKey: user.privateKey,
      AccountKeys: accountKeys,
      accountKeys: accountKeys,
      Kdf: user.kdfType,
      KdfIterations: user.kdfIterations,
      KdfMemory: user.kdfMemory,
      KdfParallelism: user.kdfParallelism,
      ForcePasswordReset: false,
      ResetMasterPassword: false,
      MasterPasswordPolicy: masterPasswordPolicyResponse(),
      ApiUseKeyConnector: false,
      scope: 'api offline_access',
      unofficialServer: true,
      UserDecryptionOptions: userDecryptionOptions,
      userDecryptionOptions: userDecryptionOptions,
    };

    const baseResponse = jsonResponse(response);
    return shouldUseWebSession(request)
      ? withWebRefreshCookie(request, baseResponse, newRefreshToken)
      : baseResponse;
  }

  return identityErrorResponse('Unsupported grant type', 'unsupported_grant_type', 400);
}

// POST /identity/accounts/prelogin
export async function handlePrelogin(request: Request, env: Env): Promise<Response> {
  const storage = new StorageService(env.DB);

  let body: { email?: string };
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON', 400);
  }

  const email = body.email?.toLowerCase();
  if (!email) {
    return errorResponse('Email is required', 400);
  }

  const user = await storage.getUser(email);

  // Return default KDF settings even if user doesn't exist (to prevent user enumeration)
  const kdfType = user?.kdfType ?? 0;
  const kdfIterations = user?.kdfIterations ?? LIMITS.auth.defaultKdfIterations;
  // Use ?? null so non-existent users return null (not undefined/omitted) for these fields,
  // matching the response shape of real PBKDF2 users and reducing enumeration signal.
  const kdfMemory = user?.kdfMemory ?? null;
  const kdfParallelism = user?.kdfParallelism ?? null;

  return jsonResponse(buildPreloginResponse(email, kdfType, kdfIterations, kdfMemory, kdfParallelism));
}

// POST /identity/connect/revocation
// Best-effort OAuth token revocation endpoint.
// RFC 7009 allows returning 200 even if token is unknown.
export async function handleRevocation(request: Request, env: Env): Promise<Response> {
  const storage = new StorageService(env.DB);

  let body: Record<string, string>;
  const contentType = request.headers.get('content-type') || '';
  try {
    if (contentType.includes('application/x-www-form-urlencoded')) {
      const formData = await request.formData();
      body = Object.fromEntries(formData.entries()) as Record<string, string>;
    } else {
      body = await request.json();
    }
  } catch {
    return new Response(null, { status: 200 });
  }

  const token = String(body.token || '').trim() || (
    shouldUseWebSession(request)
      ? (parseCookieValue(request, WEB_REFRESH_COOKIE) || '')
      : ''
  );
  if (token) {
    await storage.deleteRefreshToken(token);
  }

  const baseResponse = new Response(null, { status: 200 });
  return shouldUseWebSession(request)
    ? withWebRefreshCookie(request, baseResponse, null)
    : baseResponse;
}

export function checkClientCredentialsParam(clientId: string, clientSecret: string, scope: string): boolean {
  if (scope !== 'api') {
    return false;
  }
  if (!clientId.startsWith('user.')) {
    return false;
  }
  if (!clientSecret) {
    return false;
  }
  return true;
}
