import { TestBed } from '@angular/core/testing';
import { createClient } from '@supabase/supabase-js';
import { environment } from '../../../environments/environment';
import { AuthService } from './auth.service';
import { SUPABASE_RECOVERY_STORAGE_KEY } from './supabase-client';

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(),
}));

describe('password recovery while cloud auth is off', () => {
  beforeEach(() => {
    environment.supabase.cloudAuthEnabled = false;
    environment.supabase.cloudMigration = false;
    localStorage.clear();
    vi.mocked(createClient).mockReset();
    TestBed.resetTestingModule();
  });

  afterEach(() => {
    environment.supabase.cloudAuthEnabled = false;
    environment.supabase.cloudMigration = false;
    localStorage.clear();
    TestBed.resetTestingModule();
  });

  it('does not contact Supabase for an expired recovery link', async () => {
    const exchangeCodeForSession = vi.fn();
    const updateUser = vi.fn();
    vi.mocked(createClient).mockReturnValue({
      auth: { exchangeCodeForSession, updateUser },
    } as never);
    const auth = await createAuth();
    const accounts = localStorage.getItem('careride_users');

    const arrival = await auth.openPasswordRecovery(
      'http://localhost:8100/reset-password#error=access_denied&error_code=otp_expired&access_token=secret-token',
    );

    expect(arrival).toBe('expired');
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
    expect(updateUser).not.toHaveBeenCalled();
    expect(localStorage.getItem('careride_users')).toBe(accounts);
  });

  it('establishes a valid recovery session without enabling cloud auth', async () => {
    const exchangeCodeForSession = vi.fn(async () => ({ error: null }));
    const getSession = vi.fn(async () => ({
      data: { session: { access_token: 'mock-session' } },
      error: null,
    }));
    vi.mocked(createClient).mockReturnValue({
      auth: { exchangeCodeForSession, getSession },
    } as never);
    const auth = await createAuth();

    const arrival = await auth.openPasswordRecovery(
      'http://localhost:8100/reset-password?code=recovery-code',
    );

    expect(arrival).toBe('ready');
    expect(environment.supabase.cloudAuthEnabled).toBe(false);
    expect(exchangeCodeForSession).toHaveBeenCalledWith('recovery-code');
    expect(getSession).toHaveBeenCalled();
  });

  it('updates the password only after that session and then clears it', async () => {
    const updateUser = vi.fn(async () => ({ error: null }));
    const signOut = vi.fn(async () => ({ error: null }));
    const getSession = vi.fn(async () => ({
      data: { session: { access_token: 'mock-session' } },
      error: null,
    }));
    vi.mocked(createClient).mockReturnValue({
      auth: { updateUser, signOut, getSession },
    } as never);
    const auth = await createAuth();
    const accounts = localStorage.getItem('careride_users');
    localStorage.setItem(SUPABASE_RECOVERY_STORAGE_KEY, 'recovery-session');
    localStorage.setItem(`${SUPABASE_RECOVERY_STORAGE_KEY}-code-verifier`, 'verifier');

    await auth.updateRecoveredPassword('next-password');

    expect(updateUser).toHaveBeenCalledWith({ password: 'next-password' });
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(SUPABASE_RECOVERY_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(`${SUPABASE_RECOVERY_STORAGE_KEY}-code-verifier`)).toBeNull();
    expect(localStorage.getItem('careride_users')).toBe(accounts);
    expect(environment.supabase.cloudAuthEnabled).toBe(false);
    expect(environment.supabase.cloudMigration).toBe(false);
  });

  it('does not update a password when the recovery session is missing', async () => {
    const updateUser = vi.fn();
    const signOut = vi.fn();
    vi.mocked(createClient).mockReturnValue({
      auth: {
        updateUser,
        signOut,
        getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
      },
    } as never);
    const auth = await createAuth();

    await expect(auth.updateRecoveredPassword('next-password')).rejects.toThrow(
      'This recovery link is invalid or has expired. Request a new link.',
    );
    expect(updateUser).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
  });

  it('keeps the ordinary reset request switched off', async () => {
    const resetPasswordForEmail = vi.fn();
    vi.mocked(createClient).mockReturnValue({
      auth: { resetPasswordForEmail },
    } as never);
    const auth = await createAuth();

    await expect(auth.sendPasswordReset('admin@example.com')).rejects.toThrow(
      'Password recovery is available after Supabase authentication is connected.',
    );
    expect(resetPasswordForEmail).not.toHaveBeenCalled();
  });
});

async function createAuth(): Promise<AuthService> {
  await TestBed.configureTestingModule({}).compileComponents();
  return TestBed.inject(AuthService);
}
