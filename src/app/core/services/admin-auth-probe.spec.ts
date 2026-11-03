import { createClient } from '@supabase/supabase-js';
import { environment } from '../../../environments/environment';
import { installAdminAuthProbe, probeApprovedAdmin } from './admin-auth-probe';
import {
  peekSharedSupabaseClient,
  resetSharedSupabaseClient,
  SUPABASE_AUTH_STORAGE_KEY,
  SUPABASE_PROBE_STORAGE_KEY,
} from './supabase-client';

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(),
}));

const ADMIN_ID = '33333333-3333-4333-8333-333333333333';

describe('approved admin auth probe (mocked)', () => {
  let signIn: ReturnType<typeof vi.fn>;
  let signOut: ReturnType<typeof vi.fn>;
  let maybeSingle: ReturnType<typeof vi.fn>;
  let rpc: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    environment.production = false;
    resetSharedSupabaseClient();
    localStorage.clear();
    localStorage.setItem('careride_logged_in', 'true');
    localStorage.setItem('careride_user_type', 'passenger');
    localStorage.setItem(SUPABASE_AUTH_STORAGE_KEY, 'existing-app-session');
    delete window.careRideProbeApprovedAdmin;

    signIn = vi.fn(async () => ({
      data: { user: { id: ADMIN_ID }, session: { access_token: 'mock-token', refresh_token: 'mock-refresh' } },
      error: null,
    }));
    signOut = vi.fn(async () => ({ error: null }));
    maybeSingle = vi.fn(async () => ({ data: { role: 'admin', account_status: 'approved' }, error: null }));
    rpc = vi.fn();

    vi.mocked(createClient).mockReset();
    vi.mocked(createClient).mockReturnValue({
      auth: { signInWithPassword: signIn, signOut },
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({ maybeSingle })),
        })),
      })),
      rpc,
    } as never);
  });

  afterEach(() => {
    environment.production = false;
    delete window.careRideProbeApprovedAdmin;
    localStorage.clear();
  });

  it('registers the console hook without signing in', () => {
    installAdminAuthProbe();

    expect(window.careRideProbeApprovedAdmin).toBe(probeApprovedAdmin);
    expect(createClient).not.toHaveBeenCalled();
    expect(peekSharedSupabaseClient()).toBeNull();
  });

  it('confirms an approved admin, then signs out without touching app storage', async () => {
    const result = await probeApprovedAdmin(' Admin@Example.com ', 'secret-pass');

    expect(result).toEqual({
      authorized: true,
      role: 'admin',
      accountStatus: 'approved',
      signedOut: true,
      message: 'Approved admin profile confirmed. The test session was signed out.',
    });
    expect(signIn).toHaveBeenCalledWith({ email: 'admin@example.com', password: 'secret-pass' });
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(rpc).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('secret-pass');
    expect(JSON.stringify(result)).not.toContain('mock-token');
    expect(JSON.stringify(result)).not.toContain('mock-refresh');
    expect(localStorage.getItem('careride_logged_in')).toBe('true');
    expect(localStorage.getItem('careride_user_type')).toBe('passenger');
    expect(localStorage.getItem(SUPABASE_AUTH_STORAGE_KEY)).toBe('existing-app-session');
    expect(peekSharedSupabaseClient()).toBeNull();

    const options = vi.mocked(createClient).mock.calls[0]?.[2] as {
      auth: {
        persistSession: boolean;
        storageKey: string;
        storage: { setItem: (key: string, value: string) => void };
      };
    };
    expect(options.auth.persistSession).toBe(false);
    expect(options.auth.storageKey).toBe(SUPABASE_PROBE_STORAGE_KEY);
    options.auth.storage.setItem('session', 'secret-pass');
    expect(localStorage.getItem(SUPABASE_PROBE_STORAGE_KEY)).toBeNull();
    expect(JSON.stringify(localStorage)).not.toContain('secret-pass');
  });

  it('rejects pending, rejected, passenger, and unknown profiles', async () => {
    maybeSingle.mockResolvedValueOnce({ data: { role: 'admin', account_status: 'pending' }, error: null });
    await expect(probeApprovedAdmin('admin@example.com', 'secret-pass')).resolves.toMatchObject({
      authorized: false,
      role: 'admin',
      accountStatus: 'pending',
      signedOut: true,
      message: 'Account not approved. The test session was signed out.',
    });

    maybeSingle.mockResolvedValueOnce({ data: { role: 'admin', account_status: 'rejected' }, error: null });
    await expect(probeApprovedAdmin('admin@example.com', 'secret-pass')).resolves.toMatchObject({
      authorized: false,
      accountStatus: 'rejected',
      signedOut: true,
    });

    maybeSingle.mockResolvedValueOnce({ data: { role: 'passenger', account_status: 'approved' }, error: null });
    await expect(probeApprovedAdmin('admin@example.com', 'secret-pass')).resolves.toMatchObject({
      authorized: false,
      role: 'passenger',
      signedOut: true,
    });

    maybeSingle.mockResolvedValueOnce({ data: { role: 'owner', account_status: 'approved' }, error: null });
    await expect(probeApprovedAdmin('admin@example.com', 'secret-pass')).resolves.toMatchObject({
      authorized: false,
      role: null,
      accountStatus: 'approved',
      signedOut: true,
    });
    expect(signOut).toHaveBeenCalledTimes(4);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('reports safe categories for sign-in and profile failures', async () => {
    signIn.mockResolvedValueOnce({
      data: { user: null, session: null },
      error: { code: 'email_not_confirmed', message: 'Email not confirmed for secret-pass' },
    });
    await expect(probeApprovedAdmin('admin@example.com', 'secret-pass')).resolves.toMatchObject({
      message: 'Email not confirmed. The test session was signed out.',
      signedOut: true,
    });

    signIn.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const network = await probeApprovedAdmin('admin@example.com', 'secret-pass');
    expect(network.message).toBe('Network or configuration failure. The test session was signed out.');
    expect(network.message).not.toContain('secret-pass');

    signIn.mockResolvedValueOnce({
      data: { user: null, session: null },
      error: {
        name: 'AuthApiError',
        code: 'unexpected_failure',
        message: 'Bearer eyJsecret-pass',
        status: 500,
      },
    });
    const unexpected = await probeApprovedAdmin('admin@example.com', 'secret-pass');
    expect(unexpected.message).toBe('Unexpected authentication error. The test session was signed out.');
    expect(unexpected.message).not.toContain('eyJ');
    expect(unexpected.message).not.toContain('secret-pass');

    signIn.mockResolvedValue({
      data: { user: { id: ADMIN_ID }, session: { access_token: 'mock-token' } },
      error: null,
    });
    maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    await expect(probeApprovedAdmin('admin@example.com', 'secret-pass')).resolves.toMatchObject({
      role: null,
      accountStatus: null,
      message: 'Profile not found. The test session was signed out.',
    });

    maybeSingle.mockResolvedValueOnce({
      data: null,
      error: { code: '42501', status: 403, message: 'permission denied for secret-pass' },
    });
    const denied = await probeApprovedAdmin('admin@example.com', 'secret-pass');
    expect(denied.message).toBe('Profile access denied. The test session was signed out.');
    expect(denied.message).not.toContain('secret-pass');
    expect(signOut.mock.calls.length).toBeGreaterThan(0);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('signs out after a failed sign-in and does not run without credentials', async () => {
    signIn.mockResolvedValueOnce({
      data: { user: null, session: null },
      error: { code: 'invalid_credentials', message: 'Invalid login credentials' },
    });

    const failed = await probeApprovedAdmin('admin@example.com', 'secret-pass');

    expect(failed).toMatchObject({
      authorized: false,
      role: null,
      accountStatus: null,
      signedOut: true,
      message: 'Invalid login credentials. The test session was signed out.',
    });
    expect(failed.message).not.toContain('secret-pass');
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(maybeSingle).not.toHaveBeenCalled();

    vi.mocked(createClient).mockClear();
    const missing = await probeApprovedAdmin('  ', '');
    expect(missing).toMatchObject({ authorized: false, signedOut: true });
    expect(createClient).not.toHaveBeenCalled();
  });

  it('does not run in a production build', async () => {
    environment.production = true;

    await expect(probeApprovedAdmin('admin@example.com', 'secret-pass')).rejects.toThrow('development');
    expect(createClient).not.toHaveBeenCalled();
    installAdminAuthProbe();
    expect(window.careRideProbeApprovedAdmin).toBeUndefined();
  });
});
