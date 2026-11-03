import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../../../environments/environment';

/** One storage key for every CareRide Supabase client. */
export const SUPABASE_AUTH_STORAGE_KEY = 'careride.supabase.auth';

let sharedClient: SupabaseClient | null = null;

/** Separate from the persisted app session. The admin probe uses this key only in memory. */
export const SUPABASE_PROBE_STORAGE_KEY = 'careride.admin-auth-probe';

/** PKCE verifier for password recovery. This is not a CareRide account record. */
export const SUPABASE_RECOVERY_STORAGE_KEY = 'careride.password-recovery';

/**
 * The persisted client used by the app.
 * Auth and, later, cloud migration both receive this same instance and session.
 */
export function getSharedSupabaseClient(): SupabaseClient {
  if (sharedClient) {
    return sharedClient;
  }
  const { url, anonKey } = environment.supabase;
  if (!url || !anonKey) {
    throw new Error('Supabase URL or publishable key is missing.');
  }
  sharedClient = createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storageKey: SUPABASE_AUTH_STORAGE_KEY,
    },
  });
  return sharedClient;
}

export function peekSharedSupabaseClient(): SupabaseClient | null {
  return sharedClient;
}

/** Clears the cached client so unit tests can install a fresh mock. */
export function resetSharedSupabaseClient(): void {
  sharedClient = null;
}

/**
 * Client used only to request and finish a password recovery link.
 * Its storage is separate from the app session and from CareRide account records.
 */
export function createPasswordRecoveryClient(): SupabaseClient {
  const { url, anonKey } = environment.supabase;
  if (!url || !anonKey) {
    throw new Error('Supabase URL or publishable key is missing.');
  }
  return createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      flowType: 'pkce',
      storageKey: SUPABASE_RECOVERY_STORAGE_KEY,
    },
  });
}

export function clearPasswordRecoveryStorage(): void {
  const keys = [
    SUPABASE_RECOVERY_STORAGE_KEY,
    `${SUPABASE_RECOVERY_STORAGE_KEY}-code-verifier`,
  ];
  for (const key of keys) {
    localStorage.removeItem(key);
  }
}

export function createIsolatedAuthClient(): SupabaseClient {
  const bucket = new Map<string, string>();
  const { url, anonKey } = environment.supabase;
  if (!url || !anonKey) {
    throw new Error('Supabase URL or publishable key is missing.');
  }
  return createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: SUPABASE_PROBE_STORAGE_KEY,
      storage: {
        getItem: (key) => bucket.get(key) ?? null,
        setItem: (key, value) => {
          bucket.set(key, value);
        },
        removeItem: (key) => {
          bucket.delete(key);
        },
      },
    },
  });
}
