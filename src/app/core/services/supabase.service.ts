import { Injectable } from '@angular/core';
import { SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../../../environments/environment';
import { probePublicSupabase, PublicConnectivityResult } from './supabase-connectivity';
import { getSharedSupabaseClient } from './supabase-client';
// Keeps the auth and booking adapters in the application compilation.
import './supabase-auth.adapter';
import './supabase-booking.adapter';

export interface OwnProfileSnapshot {
  id: string;
  role: string;
  fullName: string;
  email: string;
  phone: string;
  address: string;
  accountStatus: string;
}

export interface OwnProfileConnectionResult {
  reachable: boolean;
  signedIn: boolean;
  profile: OwnProfileSnapshot | null;
  message: string;
}

@Injectable({ providedIn: 'root' })
export class SupabaseService {
  /** True only after cloudMigration is explicitly enabled. Workflows use this. */
  readonly configured: boolean;
  /** Null while cloud migration is off, so existing services stay on localStorage. */
  readonly client: SupabaseClient | null;

  constructor() {
    const { url, anonKey, cloudMigration } = environment.supabase;
    this.configured = Boolean(url && anonKey && cloudMigration);
    this.client = this.configured ? getSharedSupabaseClient() : null;
  }

  /**
   * Temporary public probe. Does not enable cloudMigration or create this.client.
   * Does not sign in, create a session, or test database rows and row level security.
   */
  testPublicConnectivity(): Promise<PublicConnectivityResult> {
    const { url, anonKey } = environment.supabase;
    return probePublicSupabase(url, anonKey);
  }

  /**
   * Read-only reachability check. When a Supabase session already exists, also reads
   * that user's own profiles row. Does not sign in, sign up, or write localStorage.
   */
  async testOwnProfileConnection(): Promise<OwnProfileConnectionResult> {
    const { url, anonKey } = environment.supabase;
    if (!url || !anonKey) {
      return {
        reachable: false,
        signedIn: false,
        profile: null,
        message: 'Supabase URL or publishable key is missing.',
      };
    }

    const client = this.client ?? getSharedSupabaseClient();

    const reachable = await this.projectResponds(url, anonKey);
    if (!reachable) {
      return {
        reachable: false,
        signedIn: false,
        profile: null,
        message: 'Supabase could not be reached.',
      };
    }

    const { data, error } = await client.auth.getSession();
    if (error) {
      return {
        reachable: true,
        signedIn: false,
        profile: null,
        message: this.safeMessage(error.message, 'The existing session could not be read.'),
      };
    }
    if (!data.session?.user?.id) {
      return {
        reachable: true,
        signedIn: false,
        profile: null,
        message: 'Supabase responded. No signed-in session is present, and none was created.',
      };
    }

    const userId = data.session.user.id;
    const { data: profile, error: profileError } = await client
      .from('profiles')
      .select('id, role, full_name, email, phone, address, account_status')
      .eq('id', userId)
      .maybeSingle();

    if (profileError) {
      return {
        reachable: true,
        signedIn: true,
        profile: null,
        message: this.safeMessage(profileError.message, 'The profile read did not succeed.'),
      };
    }
    if (!profile) {
      return {
        reachable: true,
        signedIn: true,
        profile: null,
        message: 'Signed in. No profile row was returned for this account.',
      };
    }

    return {
      reachable: true,
      signedIn: true,
      profile: {
        id: String(profile.id ?? ''),
        role: String(profile.role ?? ''),
        fullName: String(profile.full_name ?? ''),
        email: String(profile.email ?? ''),
        phone: String(profile.phone ?? ''),
        address: String(profile.address ?? ''),
        accountStatus: String(profile.account_status ?? ''),
      },
      message: 'Read this account’s own profile.',
    };
  }

  private async projectResponds(url: string, apiKey: string): Promise<boolean> {
    try {
      const response = await fetch(`${url.replace(/\/$/, '')}/auth/v1/settings`, {
        method: 'GET',
        headers: {
          apikey: apiKey,
          Authorization: `Bearer ${apiKey}`,
        },
      });
      return response.ok || response.status === 401 || response.status === 403;
    } catch {
      return false;
    }
  }

  private safeMessage(message: string, fallback: string): string {
    const text = message.trim();
    if (!text || /sb_publishable_|sb_secret_|service_role|eyJ|bearer\s+/i.test(text)) {
      return fallback;
    }
    return text;
  }
}
