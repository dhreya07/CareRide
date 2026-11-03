export type SupabaseConnectivityStatus =
  | 'reached'
  | 'authentication_required'
  | 'network_or_configuration_error';

export interface PublicConnectivityResult {
  status: SupabaseConnectivityStatus;
  httpStatus: number | null;
  message: string;
}

/**
 * Temporary read-only probe. It does not create a Supabase client, sign in,
 * or write storage. A successful response does not test tables or row level security.
 */
export async function probePublicSupabase(url: string, apiKey: string): Promise<PublicConnectivityResult> {
  const projectUrl = url.trim().replace(/\/$/, '');
  if (!projectUrl || !apiKey.trim()) {
    return {
      status: 'network_or_configuration_error',
      httpStatus: null,
      message: 'Supabase URL or publishable key is missing.',
    };
  }

  try {
    const response = await fetch(`${projectUrl}/auth/v1/settings`, {
      method: 'GET',
      headers: {
        apikey: apiKey,
        Authorization: `Bearer ${apiKey}`,
      },
    });

    if (response.ok) {
      return {
        status: 'reached',
        httpStatus: response.status,
        message: 'Supabase auth endpoint responded. No user session was sent. Database tables and row level security were not tested.',
      };
    }

    if (response.status === 401 || response.status === 403) {
      return {
        status: 'authentication_required',
        httpStatus: response.status,
        message: 'Supabase responded and did not accept the request without authentication. No user session was sent. Database tables and row level security were not tested.',
      };
    }

    return {
      status: 'network_or_configuration_error',
      httpStatus: response.status,
      message: `Supabase returned HTTP ${response.status}.`,
    };
  } catch (error) {
    return {
      status: 'network_or_configuration_error',
      httpStatus: null,
      message: networkMessage(error),
    };
  }
}

function networkMessage(error: unknown): string {
  const cause = error && typeof error === 'object' && 'cause' in error
    ? (error as { cause?: { code?: string; message?: string } }).cause
    : undefined;
  const code = cause?.code ?? '';
  const detail = `${code} ${cause?.message ?? ''} ${error instanceof Error ? error.message : ''}`;
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo|Could not resolve|NXDOMAIN|name does not exist/i.test(detail)) {
    return 'The Supabase host could not be resolved. Check the project URL.';
  }
  return 'Supabase could not be reached.';
}
