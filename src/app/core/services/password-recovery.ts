import { createPasswordRecoveryClient, clearPasswordRecoveryStorage } from './supabase-client';

export const PASSWORD_RECOVERY_PATH = '/reset-password';

export type RecoveryLink =
  | { kind: 'expired' }
  | { kind: 'missing' }
  | { kind: 'code'; code: string }
  | { kind: 'tokens'; accessToken: string; refreshToken: string };

export function passwordRecoveryRedirectUrl(origin: string): string {
  return `${origin.replace(/\/$/, '')}${PASSWORD_RECOVERY_PATH}`;
}

export function readRecoveryLink(href: string): RecoveryLink {
  const url = new URL(href, 'http://localhost');
  const hash = new URLSearchParams(url.hash.startsWith('#') ? url.hash.slice(1) : url.hash);
  const errorCode = (hash.get('error_code') || url.searchParams.get('error_code') || '').toLowerCase();
  const error = (hash.get('error') || url.searchParams.get('error') || '').toLowerCase();
  if (errorCode === 'otp_expired' || errorCode === 'otp_disabled' || error === 'access_denied') {
    return { kind: 'expired' };
  }

  const code = url.searchParams.get('code');
  if (code) {
    return { kind: 'code', code };
  }

  const type = (hash.get('type') || url.searchParams.get('type') || '').toLowerCase();
  const accessToken = hash.get('access_token') || '';
  const refreshToken = hash.get('refresh_token') || '';
  if (type === 'recovery' && accessToken && refreshToken) {
    return { kind: 'tokens', accessToken, refreshToken };
  }
  return { kind: 'missing' };
}

/**
 * Supabase may return the recovery hash to the site root or /login.
 * Those routes display the login page, so the hash has to move to /reset-password first.
 * Returns null when this URL is already the reset page or is not a recovery callback.
 */
export function recoveryResetUrl(href: string): string | null {
  if (readRecoveryLink(href).kind === 'missing') {
    return null;
  }
  const url = new URL(href, 'http://localhost');
  const path = url.pathname.replace(/\/$/, '') || '/';
  if (path === PASSWORD_RECOVERY_PATH) {
    return null;
  }
  return `${url.origin}${PASSWORD_RECOVERY_PATH}${url.search}${url.hash}`;
}

export function redirectRecoveryCallback(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  const next = recoveryResetUrl(window.location.href);
  if (!next) {
    return false;
  }
  window.location.replace(next);
  return true;
}

export function clearRecoveryAddress(): void {
  if (typeof window === 'undefined') {
    return;
  }
  const link = readRecoveryLink(window.location.href);
  if (link.kind === 'missing') {
    return;
  }
  window.history.replaceState({}, '', PASSWORD_RECOVERY_PATH);
}

export async function requestPasswordRecovery(email: string, origin: string): Promise<void> {
  const client = createPasswordRecoveryClient();
  const { error } = await client.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
    redirectTo: passwordRecoveryRedirectUrl(origin),
  });
  if (error) {
    throw new Error(recoveryFailureMessage(error, 'Unable to send a password reset message.'));
  }
}

export async function establishPasswordRecovery(link: RecoveryLink): Promise<void> {
  if (link.kind === 'expired' || link.kind === 'missing') {
    throw new Error('This recovery link is invalid or has expired. Request a new link.');
  }
  const client = createPasswordRecoveryClient();
  const { error } = link.kind === 'code'
    ? await client.auth.exchangeCodeForSession(link.code)
    : await client.auth.setSession({
        access_token: link.accessToken,
        refresh_token: link.refreshToken,
      });
  if (error) {
    throw new Error(recoveryFailureMessage(error, 'This recovery link is invalid or has expired. Request a new link.'));
  }
  const { data, error: sessionError } = await client.auth.getSession();
  if (sessionError || !data.session) {
    throw new Error('This recovery link is invalid or has expired. Request a new link.');
  }
}

export async function updatePasswordFromRecovery(password: string): Promise<void> {
  const client = createPasswordRecoveryClient();
  const { data, error: sessionError } = await client.auth.getSession();
  if (sessionError || !data.session) {
    throw new Error('This recovery link is invalid or has expired. Request a new link.');
  }
  const { error } = await client.auth.updateUser({ password });
  if (error) {
    throw new Error(recoveryFailureMessage(error, 'The password could not be updated.'));
  }
  await client.auth.signOut();
  clearPasswordRecoveryStorage();
}

function recoveryFailureMessage(error: unknown, fallback: string): string {
  const code = readCode(error);
  if (code === 'otp_expired' || code === 'otp_disabled' || code === 'access_denied') {
    return 'This recovery link is invalid or has expired. Request a new link.';
  }
  if (code === 'invalid_credentials' || code === 'email_not_confirmed') {
    return fallback;
  }
  const message = readMessage(error);
  if (!message || /eyJ|bearer|sb_secret|sb_publishable|access_token|refresh_token/i.test(message)) {
    return fallback;
  }
  return message;
}

function readCode(error: unknown): string {
  if (!error || typeof error !== 'object' || !('code' in error)) {
    return '';
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : '';
}

function readMessage(error: unknown): string {
  if (!error || typeof error !== 'object' || !('message' in error)) {
    return '';
  }
  const message = (error as { message?: unknown }).message;
  return typeof message === 'string' ? message.trim() : '';
}
