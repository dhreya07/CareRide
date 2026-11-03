import { createClient } from '@supabase/supabase-js';
import { environment } from '../../../environments/environment';
import * as prodDialog from './password-recovery-test-dialog.prod';
import {
  installPasswordRecoveryTestDialog,
  openCareRidePasswordRecovery,
} from './password-recovery-test-dialog';
import { SUPABASE_AUTH_STORAGE_KEY, SUPABASE_RECOVERY_STORAGE_KEY } from './supabase-client';

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(),
}));

describe('development password recovery request dialog', () => {
  let resetPasswordForEmail: ReturnType<typeof vi.fn>;
  let updateUser: ReturnType<typeof vi.fn>;
  let signUp: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    environment.production = false;
    environment.supabase.cloudAuthEnabled = false;
    environment.supabase.cloudMigration = false;
    document.body.replaceChildren();
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('careride_users', '[]');
    localStorage.setItem(SUPABASE_AUTH_STORAGE_KEY, 'existing-app-session');
    delete window.openCareRidePasswordRecovery;
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    resetPasswordForEmail = vi.fn(async () => ({ data: {}, error: null }));
    updateUser = vi.fn();
    signUp = vi.fn();
    vi.mocked(createClient).mockReset();
    vi.mocked(createClient).mockReturnValue({
      auth: { resetPasswordForEmail, updateUser, signUp },
    } as never);
  });

  afterEach(() => {
    environment.production = false;
    environment.supabase.cloudAuthEnabled = false;
    environment.supabase.cloudMigration = false;
    document.body.replaceChildren();
    delete window.openCareRidePasswordRecovery;
    localStorage.clear();
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('registers the opener without showing the dialog or sending email', () => {
    installPasswordRecoveryTestDialog();

    expect(window.openCareRidePasswordRecovery).toBe(openCareRidePasswordRecovery);
    expect(Reflect.get(globalThis, 'openCareRidePasswordRecovery')).toBe(openCareRidePasswordRecovery);
    expect(document.getElementById('care-ride-password-recovery-test')).toBeNull();
    expect(createClient).not.toHaveBeenCalled();
    expect(resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it('opens an email dialog only when requested', () => {
    openCareRidePasswordRecovery();
    openCareRidePasswordRecovery();

    const email = document.getElementById('care-ride-recovery-test-email');
    expect(document.querySelectorAll('#care-ride-password-recovery-test')).toHaveLength(1);
    expect(email).toBeInstanceOf(HTMLInputElement);
    expect(document.body.textContent).toContain('Send Recovery Email');
    expect(resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it('does not send a recovery email when cancelled', () => {
    openCareRidePasswordRecovery();
    fillEmail('admin@example.com');

    clickButton('Cancel');

    expect(document.getElementById('care-ride-password-recovery-test')).toBeNull();
    expect(document.body.textContent).not.toContain('admin@example.com');
    expect(resetPasswordForEmail).not.toHaveBeenCalled();
    expect(localStorage.getItem('careride_users')).toBe('[]');
  });

  it('requests recovery at the local reset page and leaves no email or token behind', async () => {
    openCareRidePasswordRecovery();
    fillEmail('Admin@Example.com');

    clickButton('Send Recovery Email');
    await vi.waitFor(() => {
      expect(document.getElementById('care-ride-password-recovery-test')).toBeNull();
    });

    expect(resetPasswordForEmail).toHaveBeenCalledTimes(1);
    expect(resetPasswordForEmail).toHaveBeenCalledWith('admin@example.com', {
      redirectTo: 'http://localhost:8100/reset-password',
    });
    expect(createClient).toHaveBeenCalledWith(
      environment.supabase.url,
      environment.supabase.anonKey,
      expect.objectContaining({
        auth: expect.objectContaining({
          storageKey: SUPABASE_RECOVERY_STORAGE_KEY,
          flowType: 'pkce',
        }),
      }),
    );
    expect(updateUser).not.toHaveBeenCalled();
    expect(signUp).not.toHaveBeenCalled();
    expect(environment.supabase.cloudAuthEnabled).toBe(false);
    expect(environment.supabase.cloudMigration).toBe(false);
    const result = document.getElementById('care-ride-password-recovery-test-result');
    expect(result?.textContent).toContain('Recovery email requested.');
    expect(result?.textContent).not.toContain('admin@example.com');
    expect(result?.textContent).not.toContain('access_token');
    expect(localStorage.getItem(SUPABASE_AUTH_STORAGE_KEY)).toBe('existing-app-session');
    expect(localStorage.getItem('careride_users')).toBe('[]');
    for (const method of ['log', 'info', 'debug', 'warn', 'error'] as const) {
      expect(vi.mocked(console[method]).mock.calls.flat().join(' ')).not.toContain('admin@example.com');
    }
  });

  it('does not register or open in production', () => {
    environment.production = true;

    installPasswordRecoveryTestDialog();
    openCareRidePasswordRecovery();
    prodDialog.installPasswordRecoveryTestDialog();
    prodDialog.openCareRidePasswordRecovery();

    expect(window.openCareRidePasswordRecovery).toBeUndefined();
    expect(document.getElementById('care-ride-password-recovery-test')).toBeNull();
    expect(resetPasswordForEmail).not.toHaveBeenCalled();
  });
});

function fillEmail(value: string): void {
  const email = document.getElementById('care-ride-recovery-test-email');
  if (!(email instanceof HTMLInputElement)) {
    throw new Error('The recovery test email field was not created.');
  }
  email.value = value;
}

function clickButton(label: string): void {
  const match = [...document.querySelectorAll('button')].find((button) => button.textContent === label);
  match?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}
