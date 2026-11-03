import { createClient } from '@supabase/supabase-js';
import { environment } from '../../../environments/environment';
import * as prodDialog from './admin-auth-test-dialog.prod';
import { installAdminAuthTestDialog, openCareRideAdminTest } from './admin-auth-test-dialog';
import { resetSharedSupabaseClient, SUPABASE_AUTH_STORAGE_KEY } from './supabase-client';

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(),
}));

describe('development admin authentication test dialog', () => {
  let signIn: ReturnType<typeof vi.fn>;
  let signOut: ReturnType<typeof vi.fn>;
  let rpc: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    environment.production = false;
    resetSharedSupabaseClient();
    document.body.replaceChildren();
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('careride_logged_in', 'true');
    localStorage.setItem(SUPABASE_AUTH_STORAGE_KEY, 'existing-app-session');
    delete window.openCareRideAdminTest;
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    signIn = vi.fn(async () => ({
      data: {
        user: { id: '33333333-3333-4333-8333-333333333333' },
        session: { access_token: 'mock-token', refresh_token: 'mock-refresh' },
      },
      error: null,
    }));
    signOut = vi.fn(async () => ({ error: null }));
    rpc = vi.fn();
    vi.mocked(createClient).mockReset();
    vi.mocked(createClient).mockReturnValue({
      auth: { signInWithPassword: signIn, signOut },
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () => ({
              data: { role: 'admin', account_status: 'approved' },
              error: null,
            })),
          })),
        })),
      })),
      rpc,
    } as never);
  });

  afterEach(() => {
    environment.production = false;
    document.body.replaceChildren();
    delete window.openCareRideAdminTest;
    localStorage.clear();
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('registers the opener without showing the dialog or signing in', () => {
    installAdminAuthTestDialog();

    expect(window.openCareRideAdminTest).toBe(openCareRideAdminTest);
    expect(document.getElementById('care-ride-admin-auth-test')).toBeNull();
    expect(createClient).not.toHaveBeenCalled();
  });

  it('opens a masked password dialog only when requested', () => {
    openCareRideAdminTest();
    openCareRideAdminTest();

    const password = document.getElementById('care-ride-admin-test-password');
    expect(document.querySelectorAll('#care-ride-admin-auth-test')).toHaveLength(1);
    expect(password).toBeInstanceOf(HTMLInputElement);
    expect((password as HTMLInputElement).type).toBe('password');
    expect(createClient).not.toHaveBeenCalled();
  });

  it('clears credentials and removes the dialog on cancel', () => {
    openCareRideAdminTest();
    fillDialog();

    clickButton('Cancel');

    expect(document.getElementById('care-ride-admin-auth-test')).toBeNull();
    expect(document.body.textContent).not.toContain('secret-pass');
    expect(storedText()).not.toContain('secret-pass');
    expect(createClient).not.toHaveBeenCalled();
  });

  it('shows only the safe probe result and leaves no credentials behind', async () => {
    openCareRideAdminTest();
    fillDialog();

    clickButton('Test Connection');
    await vi.waitFor(() => {
      expect(document.getElementById('care-ride-admin-auth-test')).toBeNull();
    });

    expect(signIn).toHaveBeenCalledWith({ email: 'admin@example.com', password: 'secret-pass' });
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(rpc).not.toHaveBeenCalled();
    const result = document.getElementById('care-ride-admin-auth-test-result');
    expect(result?.textContent).toContain('authorized: true');
    expect(result?.textContent).toContain('role: admin');
    expect(result?.textContent).toContain('accountStatus: approved');
    expect(result?.textContent).toContain('signedOut: true');
    expect(result?.textContent).toContain('Approved admin profile confirmed.');
    expect(result?.textContent).not.toContain('mock-token');
    expect(result?.textContent).not.toContain('mock-refresh');
    expect(document.body.textContent).not.toContain('secret-pass');
    expect(storedText()).toContain('existing-app-session');
    expect(storedText()).not.toContain('secret-pass');
    expect(storedText()).not.toContain('admin@example.com');
    for (const method of ['log', 'info', 'debug', 'warn', 'error'] as const) {
      expect(vi.mocked(console[method]).mock.calls.flat().join(' ')).not.toContain('secret-pass');
    }
  });

  it('does not register or open in production', () => {
    environment.production = true;

    installAdminAuthTestDialog();
    openCareRideAdminTest();
    prodDialog.installAdminAuthTestDialog();
    prodDialog.openCareRideAdminTest();

    expect(window.openCareRideAdminTest).toBeUndefined();
    expect(document.getElementById('care-ride-admin-auth-test')).toBeNull();
    expect(createClient).not.toHaveBeenCalled();
  });
});

function fillDialog(): void {
  const email = document.getElementById('care-ride-admin-test-email');
  const password = document.getElementById('care-ride-admin-test-password');
  if (!(email instanceof HTMLInputElement) || !(password instanceof HTMLInputElement)) {
    throw new Error('The admin test dialog fields were not created.');
  }
  email.value = 'admin@example.com';
  password.value = 'secret-pass';
}

function clickButton(label: string): void {
  const match = [...document.querySelectorAll('button')].find((button) => button.textContent === label);
  match?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

function storedText(): string {
  return [...storageEntries(localStorage), ...storageEntries(sessionStorage)].join(' ');
}

function storageEntries(storage: Storage): string[] {
  const values: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index) ?? '';
    values.push(key, storage.getItem(key) ?? '');
  }
  return values;
}
