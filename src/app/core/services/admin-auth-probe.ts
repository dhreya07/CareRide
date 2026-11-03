import { environment } from '../../../environments/environment';
import { dashboardAccessAllowed } from './supabase-auth.adapter';
import { createIsolatedAuthClient } from './supabase-client';

export interface AdminAuthProbeReport {
  authorized: boolean;
  role: 'passenger' | 'driver' | 'admin' | null;
  accountStatus: 'pending' | 'approved' | 'rejected' | null;
  signedOut: boolean;
  message: string;
}

const SIGNED_OUT = 'The test session was signed out.';

/**
 * Development-only check for the existing approved admin.
 * The caller supplies the email and password. This function does not store them,
 * print them, open a dashboard, or write a localStorage session.
 */
export async function probeApprovedAdmin(email: string, password: string): Promise<AdminAuthProbeReport> {
  if (environment.production) {
    throw new Error('The admin auth probe is available only in development.');
  }

  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail || !password) {
    return report(false, null, null, true, 'Email and password are required. No sign-in was attempted.');
  }

  let client;
  try {
    client = createIsolatedAuthClient();
  } catch {
    return report(false, null, null, true, `Network or configuration failure. ${SIGNED_OUT}`);
  }

  let result = report(false, null, null, false, `Unexpected authentication error. ${SIGNED_OUT}`);
  try {
    const { data, error } = await client.auth.signInWithPassword({
      email: normalizedEmail,
      password,
    });
    const userId = data.user?.id;
    if (error || !userId) {
      result = report(false, null, null, false, signInFailureMessage(error));
    } else {
      const { data: row, error: profileError } = await client
        .from('profiles')
        .select('role, account_status')
        .eq('id', userId)
        .maybeSingle();
      if (profileError) {
        result = report(false, null, null, false, profileFailureMessage(profileError));
      } else if (!row) {
        result = report(false, null, null, false, `Profile not found. ${SIGNED_OUT}`);
      } else {
        const record = row as { role?: unknown; account_status?: unknown };
        const role = roleFromColumn(record.role);
        const accountStatus = statusFromColumn(record.account_status);
        const authorized = dashboardAccessAllowed(
          role && accountStatus
            ? {
                id: userId,
                role,
                accountStatus,
                fullName: '',
                email: '',
                phone: '',
                address: '',
              }
            : null,
          ['admin'],
        );
        result = report(authorized, role, accountStatus, false, profileDecisionMessage(authorized, accountStatus));
      }
    }
  } catch (caught) {
    result = report(false, null, null, false, thrownFailureMessage(caught));
  } finally {
    let signedOut = false;
    try {
      const { error } = await client.auth.signOut();
      signedOut = !error;
    } catch {
      signedOut = false;
    }
    result = { ...result, signedOut };
  }
  return result;
}

/** Registers the probe for a manual console call. It does not sign in. */
export function installAdminAuthProbe(): void {
  if (environment.production || typeof globalThis === 'undefined') {
    return;
  }
  Object.defineProperty(globalThis, 'careRideProbeApprovedAdmin', {
    configurable: true,
    enumerable: true,
    writable: true,
    value: probeApprovedAdmin,
  });
}

function report(
  authorized: boolean,
  role: AdminAuthProbeReport['role'],
  accountStatus: AdminAuthProbeReport['accountStatus'],
  signedOut: boolean,
  message: string,
): AdminAuthProbeReport {
  return { authorized, role, accountStatus, signedOut, message };
}

/** Maps a Supabase Auth error to a fixed sentence. The original message is not returned. */
export function signInFailureMessage(error: unknown): string {
  const code = readCode(error);
  if (code === 'invalid_credentials' || code === 'user_not_found' || code === 'invalid_grant') {
    return `Invalid login credentials. ${SIGNED_OUT}`;
  }
  if (code === 'email_not_confirmed' || code === 'provider_email_needs_verification') {
    return `Email not confirmed. ${SIGNED_OUT}`;
  }
  if (isNetworkOrConfiguration(error)) {
    return `Network or configuration failure. ${SIGNED_OUT}`;
  }
  return `Unexpected authentication error. ${SIGNED_OUT}`;
}

function profileFailureMessage(error: unknown): string {
  const code = readCode(error);
  const status = readStatus(error);
  if (code === '42501' || code === 'PGRST301' || status === 401 || status === 403) {
    return `Profile access denied. ${SIGNED_OUT}`;
  }
  if (code === 'PGRST116') {
    return `Profile not found. ${SIGNED_OUT}`;
  }
  return `Unexpected authentication error. ${SIGNED_OUT}`;
}

function profileDecisionMessage(
  authorized: boolean,
  accountStatus: AdminAuthProbeReport['accountStatus'],
): string {
  if (authorized) {
    return `Approved admin profile confirmed. ${SIGNED_OUT}`;
  }
  if (accountStatus === 'pending' || accountStatus === 'rejected') {
    return `Account not approved. ${SIGNED_OUT}`;
  }
  return `This account is not authorized for the admin dashboard. ${SIGNED_OUT}`;
}

function thrownFailureMessage(caught: unknown): string {
  if (isNetworkOrConfiguration(caught)) {
    return `Network or configuration failure. ${SIGNED_OUT}`;
  }
  return `Unexpected authentication error. ${SIGNED_OUT}`;
}

function isNetworkOrConfiguration(error: unknown): boolean {
  const code = readCode(error);
  const name = readName(error);
  const status = readStatus(error);
  if (
    name === 'AuthRetryableFetchError'
    || code === 'invalid_api_key'
    || code === 'bad_jwt'
    || status === 0
  ) {
    return true;
  }
  const text = safeErrorText(error);
  return text === 'failed to fetch'
    || text === 'fetch failed'
    || text === 'network request failed'
    || text === 'load failed'
    || text === 'networkerror when attempting to fetch resource.'
    || text === 'invalid api key';
}

function safeErrorText(error: unknown): string {
  const message = readMessage(error).trim().toLowerCase();
  if (!message || /eyJ|bearer|sb_secret|sb_publishable|password|@/.test(message)) {
    return '';
  }
  return message;
}

function readCode(error: unknown): string {
  return readStringField(error, 'code');
}

function readName(error: unknown): string {
  return readStringField(error, 'name');
}

function readMessage(error: unknown): string {
  return readStringField(error, 'message');
}

function readStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object' || !('status' in error)) {
    return null;
  }
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' ? status : null;
}

function readStringField(error: unknown, field: 'code' | 'name' | 'message'): string {
  if (!error || typeof error !== 'object' || !(field in error)) {
    return '';
  }
  const value = (error as Record<string, unknown>)[field];
  return typeof value === 'string' ? value : '';
}

function roleFromColumn(value: unknown): AdminAuthProbeReport['role'] {
  return value === 'passenger' || value === 'driver' || value === 'admin' ? value : null;
}

function statusFromColumn(value: unknown): AdminAuthProbeReport['accountStatus'] {
  return value === 'pending' || value === 'approved' || value === 'rejected' ? value : null;
}

declare global {
  interface Window {
    careRideProbeApprovedAdmin?: typeof probeApprovedAdmin;
  }
}
