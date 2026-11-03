import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import {
  clearRecoveryAddress,
  establishPasswordRecovery,
  readRecoveryLink,
  recoveryResetUrl,
  requestPasswordRecovery,
  updatePasswordFromRecovery,
} from './password-recovery';

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(),
}));

describe('password recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    window.history.replaceState({}, '', '/reset-password');
  });

  it('treats an expired email link as expired and drops the token', () => {
    const link = readRecoveryLink(
      'http://localhost:8100/reset-password#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired&access_token=secret-token',
    );

    expect(link).toEqual({ kind: 'expired' });
    expect(JSON.stringify(link)).not.toContain('secret-token');
  });

  it('moves a recovery hash that landed on login to the reset page', () => {
    const href = 'http://localhost:8100/login#access_token=token-a&expires_in=3600&refresh_token=token-b&token_type=bearer&type=recovery';

    expect(readRecoveryLink(href)).toEqual({
      kind: 'tokens',
      accessToken: 'token-a',
      refreshToken: 'token-b',
    });
    expect(recoveryResetUrl(href)).toBe(
      'http://localhost:8100/reset-password#access_token=token-a&expires_in=3600&refresh_token=token-b&token_type=bearer&type=recovery',
    );
    expect(recoveryResetUrl(
      'http://localhost:8100/reset-password#access_token=token-a&refresh_token=token-b&type=recovery',
    )).toBeNull();
    expect(recoveryResetUrl(
      'http://localhost:8100/login?code=recovery-code',
    )).toBe('http://localhost:8100/reset-password?code=recovery-code');
    expect(recoveryResetUrl(
      'http://localhost:8100/#error=access_denied&error_code=otp_expired',
    )).toBe('http://localhost:8100/reset-password#error=access_denied&error_code=otp_expired');
    expect(recoveryResetUrl(
      'http://localhost:8100/login#access_token=token-a&refresh_token=token-b&type=signup',
    )).toBeNull();
  });

  it('reads a recovery code without treating a missing link as ready', () => {
    expect(readRecoveryLink('http://localhost:8100/reset-password?code=recovery-code')).toEqual({
      kind: 'code',
      code: 'recovery-code',
    });
    expect(readRecoveryLink('http://localhost:8100/reset-password')).toEqual({ kind: 'missing' });
  });

  it('removes recovery details from the address bar', () => {
    window.history.replaceState({}, '', '/reset-password?code=recovery-code');

    clearRecoveryAddress();

    expect(window.location.pathname).toBe('/reset-password');
    expect(window.location.search).toBe('');
  });

  it('requests a new link at the local reset route', async () => {
    const resetPasswordForEmail = vi.fn().mockResolvedValue({ error: null });
    vi.mocked(createClient).mockReturnValue({
      auth: { resetPasswordForEmail },
    } as never);

    await requestPasswordRecovery('Admin@Example.com', 'http://localhost:8100');

    expect(resetPasswordForEmail).toHaveBeenCalledWith('admin@example.com', {
      redirectTo: 'http://localhost:8100/reset-password',
    });
  });

  it('does not update a password when no recovery session exists', async () => {
    const updateUser = vi.fn();
    vi.mocked(createClient).mockReturnValue({
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
        updateUser,
        signOut: vi.fn(),
      },
    } as never);

    await expect(updatePasswordFromRecovery('next-password')).rejects.toThrow(
      'This recovery link is invalid or has expired. Request a new link.',
    );
    expect(updateUser).not.toHaveBeenCalled();
  });

  it('updates the password after a recovery session and then signs out', async () => {
    const updateUser = vi.fn().mockResolvedValue({ error: null });
    const signOut = vi.fn().mockResolvedValue({ error: null });
    vi.mocked(createClient).mockReturnValue({
      auth: {
        getSession: vi.fn().mockResolvedValue({
          data: { session: { access_token: 'mock-session' } },
          error: null,
        }),
        updateUser,
        signOut,
      },
    } as never);
    localStorage.setItem('careride_users', '[]');

    await updatePasswordFromRecovery('next-password');

    expect(updateUser).toHaveBeenCalledWith({ password: 'next-password' });
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('careride_users')).toBe('[]');
    expect(localStorage.getItem('careride.password-recovery')).toBeNull();
  });

  it('does not repeat a token from a failed recovery exchange', async () => {
    vi.mocked(createClient).mockReturnValue({
      auth: {
        exchangeCodeForSession: vi.fn().mockResolvedValue({
          error: { code: 'otp_expired', message: 'access_token=eyJsecret' },
        }),
      },
    } as never);

    await expect(establishPasswordRecovery({ kind: 'code', code: 'recovery-code' })).rejects.toThrow(
      'This recovery link is invalid or has expired. Request a new link.',
    );
  });
});
