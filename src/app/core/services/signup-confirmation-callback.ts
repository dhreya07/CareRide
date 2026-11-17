import { Injectable } from '@angular/core';
import { createRegistrationClient } from './supabase-client';

export const STAGING_SIGNUP_CALLBACK = 'careride-staging://auth/callback';

type CallbackPayload =
  | { kind: 'error' }
  | { kind: 'token'; accessToken: string }
  | { kind: 'otp'; tokenHash: string; type: 'email' | 'signup' }
  | { kind: 'invalid' }
  | null;

export type SignupCallbackResult = 'confirmed' | 'failed' | 'duplicate' | 'not-callback';

/** Only the registered staging URI is accepted for native confirmation links. */
export function isStagingSignupCallback(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'careride-staging:'
      && parsed.hostname === 'auth'
      && parsed.pathname === '/callback'
      && !parsed.username
      && !parsed.password
      && !parsed.port;
  } catch {
    return false;
  }
}

/** Browser confirmation uses the existing Site URL and only handles an explicit signup callback. */
export function isBrowserSignupCallback(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    if (parsed.username || parsed.password) return false;
    return callbackParams(parsed).get('type')?.toLowerCase() === 'signup';
  } catch {
    return false;
  }
}

@Injectable({ providedIn: 'root' })
export class SignupConfirmationCallbackService {
  private readonly seen = new Set<string>();

  async handle(url: string, native = false): Promise<SignupCallbackResult> {
    if (native ? !isStagingSignupCallback(url) : !isBrowserSignupCallback(url)) {
      return 'not-callback';
    }

    const fingerprint = fingerprintCallback(url);
    if (this.seen.has(fingerprint)) return 'duplicate';
    this.seen.add(fingerprint);
    if (this.seen.size > 32) this.seen.delete(this.seen.values().next().value!);

    const payload = readCallbackPayload(url);
    if (!payload || payload.kind === 'invalid' || payload.kind === 'error') return 'failed';

    try {
      // This client has memory-only storage. Verification can complete without
      // persisting the callback session into CareRide's signed-in app session.
      const auth = createRegistrationClient().auth;
      if (payload.kind === 'otp') {
        const { data, error } = await auth.verifyOtp({
          token_hash: payload.tokenHash,
          type: payload.type,
        });
        return error || !data.user?.email_confirmed_at ? 'failed' : 'confirmed';
      }

      // Supabase has already verified the email before issuing this token.
      // Ask Auth to validate it, and require the returned user to be confirmed.
      const { data, error } = await auth.getUser(payload.accessToken);
      return error || !data.user?.email_confirmed_at ? 'failed' : 'confirmed';
    } catch {
      return 'failed';
    }
  }
}

function readCallbackPayload(rawUrl: string): CallbackPayload {
  try {
    const url = new URL(rawUrl);
    const params = callbackParams(url);
    const type = (params.get('type') || '').toLowerCase();
    if (params.has('error') || params.has('error_code')) return { kind: 'error' };

    const tokenHash = params.get('token_hash') || '';
    if (tokenHash && (type === 'email' || type === 'signup')) {
      return { kind: 'otp', tokenHash, type };
    }

    const accessToken = params.get('access_token') || '';
    if (type === 'signup' && accessToken) return { kind: 'token', accessToken };
    return { kind: 'invalid' };
  } catch {
    return null;
  }
}

function callbackParams(url: URL): URLSearchParams {
  const hash = new URLSearchParams(url.hash.startsWith('#') ? url.hash.slice(1) : url.hash);
  const query = url.searchParams;
  // Supabase's default confirmation redirect returns auth fields in the hash;
  // custom templates may provide token_hash and type in the query.
  return new URLSearchParams([...query, ...hash]);
}

function fingerprintCallback(value: string): string {
  // Keep only a short in-memory deduplication fingerprint, never the callback tokens.
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return `${first >>> 0}:${second >>> 0}:${value.length}`;
}
