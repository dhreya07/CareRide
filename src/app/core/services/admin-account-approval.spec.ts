import { TestBed } from '@angular/core/testing';
import { createClient } from '@supabase/supabase-js';
import { environment } from '../../../environments/environment';
import { AuthService } from './auth.service';
import { SupabaseAuthAdapter, filterCloudAccounts } from './supabase-auth.adapter';
import { resetSharedSupabaseClient } from './supabase-client';

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(),
}));

const PASSENGER_ID = '11111111-1111-4111-8111-111111111111';
const DRIVER_ID = '22222222-2222-4222-8222-222222222222';
const ADMIN_ID = '33333333-3333-4333-8333-333333333333';

const state = {
  listRows: [] as Record<string, unknown>[],
  driverRows: [] as Record<string, unknown>[],
  listError: null as { message: string } | null,
  ownProfile: null as Record<string, unknown> | null,
  rpcs: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  selects: [] as string[],
};

describe('cloud admin account approval', () => {
  beforeEach(() => {
    resetSharedSupabaseClient();
    environment.supabase.cloudAuthEnabled = false;
    environment.supabase.cloudMigration = false;
    localStorage.clear();
    state.listRows = [];
    state.driverRows = [];
    state.listError = null;
    state.ownProfile = accountRow(ADMIN_ID, 'admin', 'approved', 'CareRide Admin', '2026-01-01T00:00:00.000Z');
    state.rpcs = [];
    state.selects = [];
    vi.stubGlobal('fetch', vi.fn(() => {
      throw new Error('Live network is not allowed in this test.');
    }));
    vi.mocked(createClient).mockReset();
    vi.mocked(createClient).mockReturnValue({
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: { id: String(state.ownProfile?.['id'] ?? '') } },
          error: null,
        })),
      },
      from: vi.fn((table: string) => query(table)),
      rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
        state.rpcs.push({ fn, args });
        return { data: null, error: null };
      }),
    } as never);
    TestBed.resetTestingModule();
  });

  afterEach(() => {
    environment.supabase.cloudAuthEnabled = false;
    environment.supabase.cloudMigration = false;
    localStorage.clear();
    vi.unstubAllGlobals();
    TestBed.resetTestingModule();
  });

  it('loads passenger and driver accounts and filters each status', async () => {
    state.listRows = [
      accountRow(PASSENGER_ID, 'passenger', 'pending', 'Pat Pending', '2026-03-01T00:00:00.000Z'),
      accountRow(DRIVER_ID, 'driver', 'approved', 'Dee Driver', '2026-03-02T00:00:00.000Z'),
      accountRow('44444444-4444-4444-8444-444444444444', 'passenger', 'rejected', 'Rae Rejected', '2026-03-03T00:00:00.000Z'),
      accountRow(ADMIN_ID, 'admin', 'approved', 'CareRide Admin', '2026-01-01T00:00:00.000Z'),
    ];
    state.driverRows = [{
      user_id: DRIVER_ID,
      license_number: 'N01',
      vehicle_type: 'van',
      plate_number: 'ABC 123',
      wheelchair_accessible: true,
      senior_assistance: false,
    }];
    const adapter = TestBed.inject(SupabaseAuthAdapter);

    const accounts = await adapter.listManagedAccounts();

    expect(accounts.map((account) => account.fullName)).toEqual([
      'Pat Pending',
      'Dee Driver',
      'Rae Rejected',
    ]);
    expect(accounts[1]).toEqual(expect.objectContaining({
      role: 'driver',
      accountStatus: 'approved',
      createdAt: '2026-03-02T00:00:00.000Z',
      licenseNumber: 'N01',
      plateNumber: 'ABC 123',
    }));
    expect(filterCloudAccounts(accounts, 'passenger', 'pending').map((account) => account.fullName)).toEqual(['Pat Pending']);
    expect(filterCloudAccounts(accounts, 'driver', 'approved')).toHaveLength(1);
    expect(filterCloudAccounts(accounts, 'passenger', 'rejected')).toHaveLength(1);
    expect(filterCloudAccounts(accounts, 'driver', 'pending')).toHaveLength(0);
    expect(accounts.some((account) => account.id === ADMIN_ID)).toBe(false);
  });

  it('returns an empty account list without treating it as an error', async () => {
    const accounts = await TestBed.inject(SupabaseAuthAdapter).listManagedAccounts();

    expect(accounts).toEqual([]);
  });

  it('does not let a passenger list or approve accounts', async () => {
    state.ownProfile = accountRow(PASSENGER_ID, 'passenger', 'approved', 'Pat', '2026-03-01T00:00:00.000Z');
    const adapter = TestBed.inject(SupabaseAuthAdapter);

    await expect(adapter.listManagedAccounts()).rejects.toThrow('Only an approved admin');
    await expect(adapter.reviewAccount(DRIVER_ID, 'approved')).rejects.toThrow('Only an approved admin');
    expect(state.selects.some((columns) => columns.includes('created_at'))).toBe(false);
    expect(state.rpcs).toHaveLength(0);
  });

  it('approves and rejects through review_account and refuses the admin account', async () => {
    const adapter = TestBed.inject(SupabaseAuthAdapter);

    await adapter.reviewAccount(PASSENGER_ID, 'approved');
    await adapter.reviewAccount(DRIVER_ID, 'rejected');

    expect(state.rpcs).toEqual([
      { fn: 'review_account', args: { p_user_id: PASSENGER_ID, p_decision: 'approved' } },
      { fn: 'review_account', args: { p_user_id: DRIVER_ID, p_decision: 'rejected' } },
    ]);
    await expect(adapter.reviewAccount(ADMIN_ID, 'rejected')).rejects.toThrow('cannot review their own account');
    expect(state.rpcs).toHaveLength(2);
  });

  it('hides a Supabase error instead of returning its raw text', async () => {
    state.listError = { message: 'permission denied eyJsecret' };

    await expect(TestBed.inject(SupabaseAuthAdapter).listManagedAccounts()).rejects.toThrow(
      'Accounts could not be loaded.',
    );
  });

  it('keeps localStorage accounts while cloud auth is off', async () => {
    localStorage.setItem('careride_logged_in', 'true');
    localStorage.setItem('careride_user_type', 'admin');
    localStorage.setItem('careride_users', JSON.stringify([
      localUser('CR-PAT', 'passenger', 'pending', 'Local Pat'),
      localUser('CR-ADMIN', 'admin', 'approved', 'Local Admin'),
    ]));
    const auth = TestBed.inject(AuthService);
    const listCloud = vi.spyOn(TestBed.inject(SupabaseAuthAdapter), 'listManagedAccounts');

    expect(auth.cloudAuthEnabled).toBe(false);
    expect(await auth.listCloudAccounts()).toEqual([]);
    expect(listCloud).not.toHaveBeenCalled();
    expect(createClient).not.toHaveBeenCalled();
    const stored = auth.listManagedAccounts();
    expect(stored.some((user) => user.fullName === 'Local Pat' && user.accountStatus === 'pending')).toBe(true);
    expect(stored.some((user) => user.accountType === 'admin')).toBe(false);

    auth.acceptAccount('CR-PAT');

    expect(auth.listManagedAccounts().find((user) => user.id === 'CR-PAT')?.accountStatus).toBe('approved');
    await expect(auth.reviewCloudAccount(PASSENGER_ID, 'approved')).rejects.toThrow('not enabled');
    expect(state.rpcs).toHaveLength(0);
    expect(localStorage.getItem('careride_users')).toContain('Local Pat');
    expect(localStorage.getItem('careride_users')).not.toContain('eyJsecret');
  });
});

function query(table: string) {
  let columns = '';
  const api = {
    select(next: string) {
      columns = next;
      state.selects.push(next);
      return api;
    },
    eq() {
      return api;
    },
    in() {
      return api;
    },
    order() {
      return api;
    },
    maybeSingle: async () => ({ data: table === 'profiles' ? state.ownProfile : null, error: null }),
    then(
      onFulfilled: (value: { data: unknown; error: { message: string } | null }) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) {
      const payload = columns.includes('created_at')
        ? { data: state.listError ? null : state.listRows, error: state.listError }
        : { data: state.driverRows, error: null };
      return Promise.resolve(payload).then(onFulfilled, onRejected);
    },
  };
  return api;
}

function accountRow(
  id: string,
  role: string,
  accountStatus: string,
  fullName: string,
  createdAt: string,
): Record<string, unknown> {
  return {
    id,
    role,
    account_status: accountStatus,
    full_name: fullName,
    email: `${fullName.toLowerCase().replace(/\s+/g, '-')}@example.com`,
    phone: '',
    address: '',
    created_at: createdAt,
  };
}

function localUser(id: string, accountType: string, accountStatus: string, fullName: string) {
  return {
    id,
    accountType,
    fullName,
    email: `${id.toLowerCase()}@local.test`,
    phone: '',
    address: '',
    password: 'local-secret',
    accountStatus,
    createdAt: '2026-02-01T00:00:00.000Z',
  };
}
