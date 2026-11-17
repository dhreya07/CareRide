import { createClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isBrowserSignupCallback,
  isStagingSignupCallback,
  SignupConfirmationCallbackService,
  STAGING_SIGNUP_CALLBACK,
} from './signup-confirmation-callback';

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }));

describe('signup confirmation callback', () => {
  let service: SignupConfirmationCallbackService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new SignupConfirmationCallbackService();
  });

  it('accepts only the exact native staging scheme, host, and path', () => {
    expect(isStagingSignupCallback(STAGING_SIGNUP_CALLBACK)).toBe(true);
    expect(isStagingSignupCallback('careride-staging://other/callback')).toBe(false);
    expect(isStagingSignupCallback('careride-staging://auth/other')).toBe(false);
    expect(isStagingSignupCallback('careride://auth/callback')).toBe(false);
  });

  it('recognizes explicit browser signup callbacks only', () => {
    expect(isBrowserSignupCallback('https://example.test/login#access_token=token&type=signup')).toBe(true);
    expect(isBrowserSignupCallback('https://example.test/reset-password?code=recovery')).toBe(false);
  });

  it('verifies a callback token with Supabase before confirming and does not persist a session', async () => {
    const getUser = vi.fn().mockResolvedValue({
      data: { user: { id: 'user-id', email_confirmed_at: '2026-11-16T00:00:00Z' } },
      error: null,
    });
    vi.mocked(createClient).mockReturnValue({ auth: { getUser } } as never);

    await expect(service.handle(`${STAGING_SIGNUP_CALLBACK}#access_token=secret&type=signup`, true))
      .resolves.toBe('confirmed');

    expect(getUser).toHaveBeenCalledWith('secret');
    expect(vi.mocked(createClient).mock.calls[0]?.[2]).toMatchObject({
      auth: { persistSession: false, autoRefreshToken: false },
    });
  });

  it('exchanges a supplied confirmation hash before accepting it', async () => {
    const verifyOtp = vi.fn().mockResolvedValue({
      data: { user: { id: 'user-id', email_confirmed_at: '2026-11-16T00:00:00Z' } },
      error: null,
    });
    vi.mocked(createClient).mockReturnValue({ auth: { verifyOtp } } as never);

    await expect(service.handle(`${STAGING_SIGNUP_CALLBACK}?token_hash=one-time&type=email`, true))
      .resolves.toBe('confirmed');
    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: 'one-time', type: 'email' });
  });

  it('rejects expired, invalid, and unconfirmed callbacks', async () => {
    const getUser = vi.fn().mockResolvedValue({ data: { user: null }, error: { code: 'invalid_jwt' } });
    vi.mocked(createClient).mockReturnValue({ auth: { getUser } } as never);
    await expect(service.handle(`${STAGING_SIGNUP_CALLBACK}#error_code=otp_expired&type=signup`, true))
      .resolves.toBe('failed');
    await expect(service.handle(`${STAGING_SIGNUP_CALLBACK}#access_token=bad&type=signup`, true))
      .resolves.toBe('failed');
    expect(getUser).toHaveBeenCalledTimes(1);
  });

  it('prevents processing a duplicate callback twice', async () => {
    const getUser = vi.fn().mockResolvedValue({
      data: { user: { id: 'user-id', email_confirmed_at: '2026-11-16T00:00:00Z' } },
      error: null,
    });
    vi.mocked(createClient).mockReturnValue({ auth: { getUser } } as never);
    const callback = `${STAGING_SIGNUP_CALLBACK}#access_token=secret&type=signup`;

    await expect(service.handle(callback, true)).resolves.toBe('confirmed');
    await expect(service.handle(callback, true)).resolves.toBe('duplicate');
    expect(getUser).toHaveBeenCalledTimes(1);
  });
});
