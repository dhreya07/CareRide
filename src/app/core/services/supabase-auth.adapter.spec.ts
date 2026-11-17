import { createClient } from '@supabase/supabase-js';
import { Capacitor } from '@capacitor/core';
import { SupabaseAuthAdapter, dashboardAccessAllowed, stagingNativeSignupRedirect } from './supabase-auth.adapter';
import { SUPABASE_AUTH_STORAGE_KEY, peekSharedSupabaseClient, resetSharedSupabaseClient } from './supabase-client';

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(),
}));

const PASSENGER_ID = '11111111-1111-4111-8111-111111111111';
const DRIVER_ID = '22222222-2222-4222-8222-222222222222';
const ADMIN_ID = '33333333-3333-4333-8333-333333333333';

interface QueryCall {
  table: string;
  columns: string;
  column: string;
  value: unknown;
}

describe('SupabaseAuthAdapter (mocked, no live Supabase)', () => {
  let adapter: SupabaseAuthAdapter;
  let session: { id: string; email: string; user_metadata: Record<string, unknown> } | null;
  let signOutCount: number;
  let signUps: Array<{ email: string; password: string; data: Record<string, unknown>; emailRedirectTo?: string }>;
  let rpcs: Array<{ fn: string; args: Record<string, unknown> }>;
  let queries: QueryCall[];
  let returnSessionOnSignUp: boolean;
  let availabilityRpcError: { message: string } | null;
  let profiles: Record<string, unknown>[];
  let passengerDetails: Record<string, unknown>[];
  let driverDetails: Record<string, unknown>[];

  beforeEach(() => {
    resetSharedSupabaseClient();
    session = null;
    signOutCount = 0;
    signUps = [];
    rpcs = [];
    queries = [];
    returnSessionOnSignUp = false;
    availabilityRpcError = null;
    profiles = [];
    passengerDetails = [];
    driverDetails = [];
    localStorage.clear();

    vi.stubGlobal('fetch', vi.fn(() => {
      throw new Error('Live network is not allowed in this test.');
    }));

    vi.mocked(createClient).mockReset();
    vi.mocked(createClient).mockReturnValue({
      auth: {
        signInWithPassword: vi.fn(async ({ email, password }: { email: string; password: string }) => {
          const known = email === 'pat@example.com' || email === 'dee@example.com' || email === 'admin@example.com';
          if (!known || password !== 'secret-pass') {
            return { data: { user: null, session: null }, error: { message: 'Invalid login credentials' } };
          }
          const id = email.startsWith('pat') ? PASSENGER_ID : email.startsWith('dee') ? DRIVER_ID : ADMIN_ID;
          session = {
            id,
            email,
            user_metadata: { role: 'admin', account_status: 'approved' },
          };
          return { data: { user: session, session: { access_token: 'mock-only' } }, error: null };
        }),
        signUp: vi.fn(async ({
          email,
          password,
          options,
        }: {
          email: string;
          password: string;
          options?: { data?: Record<string, unknown>; emailRedirectTo?: string };
        }) => {
          signUps.push({ email, password, data: options?.data ?? {}, emailRedirectTo: options?.emailRedirectTo });
          if (returnSessionOnSignUp) {
            session = { id: PASSENGER_ID, email, user_metadata: options?.data ?? {} };
            return { data: { user: session, session: { access_token: 'mock-only' } }, error: null };
          }
          return { data: { user: { id: PASSENGER_ID, email }, session: null }, error: null };
        }),
        signOut: vi.fn(async () => {
          signOutCount += 1;
          session = null;
          return { error: null };
        }),
        getUser: vi.fn(async () => {
          if (!session) {
            return { data: { user: null }, error: { message: 'Auth session missing' } };
          }
          return { data: { user: session }, error: null };
        }),
      },
      from: vi.fn((table: string) => {
        let columns = '';
        const api = {
          select(next: string) {
            columns = next;
            return api;
          },
          eq(column: string, value: unknown) {
            queries.push({ table, columns, column, value });
            return api;
          },
          maybeSingle() {
            const source = table === 'profiles'
              ? profiles
              : table === 'passenger_details'
                ? passengerDetails
                : driverDetails;
            const match = [...queries].reverse().find((query) => query.table === table);
            const row = source.find((item) => match && item[match.column] === match.value) ?? null;
            return Promise.resolve({ data: row, error: null });
          },
        };
        return api;
      }),
      rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
        rpcs.push({ fn, args });
        return { data: null, error: fn === 'set_driver_availability' ? availabilityRpcError : null };
      }),
    } as never);

    adapter = new SupabaseAuthAdapter();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    const calls = vi.mocked(fetch).mock.calls;
    expect(calls.some((call) => String(call[0]).includes('supabase.co'))).toBe(false);
    vi.unstubAllGlobals();
  });

  it('denies dashboard access unless the profile row is approved', () => {
    expect(dashboardAccessAllowed(null)).toBe(false);
    expect(dashboardAccessAllowed(profile(PASSENGER_ID, 'passenger', 'pending'))).toBe(false);
    expect(dashboardAccessAllowed(profile(PASSENGER_ID, 'passenger', 'rejected'))).toBe(false);
    expect(dashboardAccessAllowed(profile(PASSENGER_ID, 'passenger', 'approved'), ['admin'])).toBe(false);
    expect(dashboardAccessAllowed(profile(ADMIN_ID, 'admin', 'approved'), ['admin'])).toBe(true);
  });

  it('updates only the authenticated user availability through the existing RPC', async () => {
    session = { id: DRIVER_ID, email: 'dee@example.com', user_metadata: {} };

    await adapter.setOwnDriverAvailability('available');

    expect(rpcs).toEqual([{
      fn: 'set_driver_availability',
      args: { p_user_id: DRIVER_ID, p_availability: 'available' },
    }]);
  });

  it('surfaces a rejected availability update without retrying', async () => {
    session = { id: DRIVER_ID, email: 'dee@example.com', user_metadata: {} };
    availabilityRpcError = { message: 'Only an approved driver can change availability' };

    await expect(adapter.setOwnDriverAvailability('offline'))
      .rejects.toThrow('Only an approved driver can change availability');
    expect(rpcs).toHaveLength(1);
  });

  it('does not call availability RPC without an authenticated identity', async () => {
    await expect(adapter.setOwnDriverAvailability('available'))
      .rejects.toThrow('Sign in again before changing your availability.');
    expect(rpcs).toHaveLength(0);
  });

  it('registers a passenger as pending and sends the signup trigger field names', async () => {
    const result = await adapter.registerPassenger({
      email: ' Pat@Example.com ',
      password: 'secret-pass',
      fullName: ' Pat Rider ',
      phone: ' 09171234567 ',
      address: ' Manila ',
      bookingIntent: 'family',
      passengerType: 'elderly',
      assistance: ['wheelchair'],
      otherNeeds: ' none ',
      emergencyName: ' Kim ',
      emergencyPhone: ' 09170000000 ',
    });

    expect(result).toEqual({ accountStatus: 'pending', emailConfirmationRequired: true });
    expect(signUps).toEqual([{
      email: 'pat@example.com',
      password: 'secret-pass',
      data: {
        role: 'passenger',
        full_name: 'Pat Rider',
        phone: '09171234567',
        address: 'Manila',
        booking_intent: 'family',
        passenger_type: 'elderly',
        assistance: ['wheelchair'],
        other_needs: 'none',
        emergency_name: 'Kim',
        emergency_phone: '09170000000',
      },
      emailRedirectTo: undefined,
    }]);
    expect(signUps[0].data['password']).toBeUndefined();
    expect(localStorage.getItem('careride_users')).toBeNull();
    expect(JSON.stringify(localStorage)).not.toContain('secret-pass');
  });

  it('uses the staging callback only for a native staging signup', async () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    expect(stagingNativeSignupRedirect()).toBe('careride-staging://auth/callback');

    await adapter.registerPassenger({
      email: 'pat@example.com', password: 'secret-pass', fullName: 'Pat', phone: '09171234567',
    });

    expect(signUps[0].emailRedirectTo).toBe('careride-staging://auth/callback');
  });

  it('registers a driver with the trigger field names and refuses an incomplete driver', async () => {
    await expect(adapter.registerDriver({
      email: 'dee@example.com',
      password: 'secret-pass',
      fullName: 'Dee',
      phone: '09170000002',
      licenseNumber: ' ',
      vehicleType: 'van',
      plateNumber: 'ABC 123',
    })).rejects.toThrow('Driver license, vehicle type, and plate number are required.');
    expect(signUps).toHaveLength(0);

    const result = await adapter.registerDriver({
      email: ' Dee@Example.com ',
      password: 'secret-pass',
      fullName: ' Dee Driver ',
      phone: ' 09170000002 ',
      address: ' Quezon City ',
      licenseNumber: ' N01-23-456789 ',
      vehicleType: ' van ',
      plateNumber: ' abc 123 ',
      wheelchairAccessible: true,
      seniorAssistance: false,
      licenseExpirationDate: '2030-12-31',
      emergencyContactName: ' Kim Driver ',
      emergencyContactPhone: ' 09170000003 ',
      vehicleBodyType: 'Passenger van',
      vehicleBrand: 'Toyota',
      vehicleModel: 'HiAce',
      vehicleVariant: 'Commuter',
      vehicleModelYear: 2024,
      vehicleColor: 'White',
      passengerSeatingCapacity: 10,
      driverDeclaredAccessibility: ['wheelchair_ramp', 'transfer_assistance'],
    });

    expect(result.accountStatus).toBe('pending');
    expect(signUps[0].data).toEqual({
      role: 'driver',
      full_name: 'Dee Driver',
      phone: '09170000002',
      address: 'Quezon City',
      license_number: 'N01-23-456789',
      vehicle_type: 'van',
      plate_number: 'abc 123',
      wheelchair_accessible: 'true',
      senior_assistance: 'false',
      license_expiration_date: '2030-12-31',
      emergency_contact_name: 'Kim Driver',
      emergency_contact_phone: '09170000003',
      vehicle_body_type: 'Passenger van',
      vehicle_brand: 'Toyota',
      vehicle_model: 'HiAce',
      vehicle_variant: 'Commuter',
      vehicle_model_year: '2024',
      vehicle_color: 'White',
      passenger_seating_capacity: '10',
      driver_declared_accessibility: ['wheelchair_ramp', 'transfer_assistance'],
    });
    expect(signUps[0].data['role']).not.toBe('admin');
    expect(signUps[0].data).not.toHaveProperty('capacity_verification_status');
    expect(signUps[0].data).not.toHaveProperty('verified_passenger_seating_capacity');
    expect(signUps[0].data).not.toHaveProperty('capacity_verified_by');
    expect(signUps[0].data).not.toHaveProperty('capacity_verified_at');
    expect(signUps[0].data).not.toHaveProperty('admin_verified_accessibility');
    expect(signUps[0].data).not.toHaveProperty('accessibility_verification_status');
    expect(signUps[0].data).not.toHaveProperty('accessibility_verified_by');
    expect(signUps[0].data).not.toHaveProperty('accessibility_verified_at');
  });

  it('omits optional driver metadata when its values are not provided', async () => {
    await adapter.registerDriver({
      email: 'dee@example.com',
      password: 'secret-pass',
      fullName: 'Dee',
      phone: '09170000002',
      licenseNumber: 'N01',
      vehicleType: 'van',
      plateNumber: 'ABC 123',
    });

    expect(signUps[0].data).toMatchObject({
      license_number: 'N01',
      vehicle_type: 'van',
      plate_number: 'ABC 123',
      wheelchair_accessible: 'false',
      senior_assistance: 'false',
      driver_declared_accessibility: [],
    });
    expect(signUps[0].data).not.toHaveProperty('license_expiration_date');
    expect(signUps[0].data).not.toHaveProperty('vehicle_model_year');
    expect(signUps[0].data).not.toHaveProperty('passenger_seating_capacity');
  });

  it('rejects unsupported accessibility identifiers before creating signup metadata', async () => {
    await expect(adapter.registerDriver({
      email: 'dee@example.com',
      password: 'secret-pass',
      fullName: 'Dee',
      phone: '09170000002',
      licenseNumber: 'N01',
      vehicleType: 'van',
      plateNumber: 'ABC 123',
      driverDeclaredAccessibility: ['admin_verified_accessibility'] as never,
    })).rejects.toThrow('Unsupported driver accessibility capability');

    expect(signUps).toHaveLength(0);
  });

  it('isolates a registration session without waiting for sign-out or creating the shared client', async () => {
    returnSessionOnSignUp = true;
    localStorage.setItem(SUPABASE_AUTH_STORAGE_KEY, 'existing-app-session');

    const result = await adapter.registerPassenger({
      email: 'pat@example.com',
      password: 'secret-pass',
      fullName: 'Pat',
      phone: '09171234567',
    });

    expect(result).toEqual({ accountStatus: 'pending', emailConfirmationRequired: false });
    expect(signOutCount).toBe(0);
    expect(peekSharedSupabaseClient()).toBeNull();
    expect(localStorage.getItem(SUPABASE_AUTH_STORAGE_KEY)).toBe('existing-app-session');
    expect(vi.mocked(createClient).mock.calls[0]?.[2]).toMatchObject({
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
        storageKey: 'careride.registration',
      },
    });
  });

  it('bounds a stalled signup without retrying or signing out', async () => {
    vi.useFakeTimers();
    const client = vi.mocked(createClient).getMockImplementation()!('', '')!;
    vi.mocked(client.auth.signUp).mockImplementation(() => new Promise(() => {}));
    const registration = adapter.registerDriver({
      email: 'dee@example.com', password: 'secret-pass', fullName: 'Dee',
      phone: '09170000002', licenseNumber: 'N01', vehicleType: 'van', plateNumber: 'ABC 123',
    });
    const rejected = expect(registration).rejects.toThrow('The account may have been created');
    await vi.advanceTimersByTimeAsync(20000);
    await rejected;
    expect(client.auth.signUp).toHaveBeenCalledTimes(1);
    expect(client.auth.signOut).not.toHaveBeenCalled();
    expect(peekSharedSupabaseClient()).toBeNull();
  });

  it('surfaces a signup database failure without reporting pending success', async () => {
    const client = vi.mocked(createClient).getMockImplementation()!('', '')!;
    vi.mocked(client.auth.signUp).mockResolvedValue({
      data: { user: null, session: null },
      error: { message: 'Database error saving new user' },
    } as never);
    await expect(adapter.registerPassenger({
      email: 'pat@example.com', password: 'secret-pass', fullName: 'Pat', phone: '09171234567',
    })).rejects.toThrow('Database error saving new user');
    expect(client.auth.signUp).toHaveBeenCalledTimes(1);
  });

  it('refuses pending and rejected accounts even when Supabase created a session', async () => {
    profiles.push(profileRow(PASSENGER_ID, 'passenger', 'pending'));
    session = {
      id: PASSENGER_ID,
      email: 'pat@example.com',
      user_metadata: { role: 'admin', account_status: 'approved' },
    };

    expect(await adapter.canAccessDashboard(['passenger', 'admin'])).toBe(false);
    expect(signOutCount).toBe(0);
    await expect(adapter.signIn('pat@example.com', 'secret-pass')).rejects.toThrow('Account Under Review');
    expect(signOutCount).toBe(1);
    expect(session).toBeNull();

    profiles.splice(0, profiles.length, profileRow(PASSENGER_ID, 'passenger', 'rejected'));
    session = {
      id: PASSENGER_ID,
      email: 'pat@example.com',
      user_metadata: { role: 'admin', account_status: 'approved' },
    };
    expect(await adapter.canAccessDashboard(['passenger', 'admin'])).toBe(false);
    await expect(adapter.signIn('pat@example.com', 'secret-pass')).rejects.toThrow('Account Registration Rejected');
    expect(session).toBeNull();
  });

  it('turns Supabase invalid-credential, unconfirmed-email, and network failures into clear login errors', async () => {
    const client = vi.mocked(createClient).getMockImplementation()!('', '')!;
    vi.mocked(client.auth.signInWithPassword)
      .mockResolvedValueOnce({
        data: { user: null, session: null },
        error: { message: 'Invalid login credentials', code: 'invalid_credentials' },
      } as never)
      .mockResolvedValueOnce({
        data: { user: null, session: null },
        error: { message: 'Email not confirmed', code: 'email_not_confirmed' },
      } as never)
      .mockRejectedValueOnce(new TypeError('Failed to fetch'));

    await expect(adapter.signIn('pat@example.com', 'wrong-pass'))
      .rejects.toThrow('Incorrect email or password');
    await expect(adapter.signIn('pat@example.com', 'secret-pass'))
      .rejects.toThrow('confirm your email address');
    await expect(adapter.signIn('pat@example.com', 'secret-pass'))
      .rejects.toThrow('Unable to reach CareRide');
  });

  it('logs in an approved account using profiles.role, not user metadata', async () => {
    profiles.push(profileRow(DRIVER_ID, 'driver', 'approved', 'Dee Driver'));
    driverDetails.push({
      user_id: DRIVER_ID,
      license_number: 'N01',
      vehicle_type: 'van',
      plate_number: 'ABC 123',
      wheelchair_accessible: true,
      senior_assistance: false,
      availability: 'offline',
    });

    const signedIn = await adapter.signIn('dee@example.com', 'secret-pass');

    expect(signedIn.role).toBe('driver');
    expect(signedIn.accountStatus).toBe('approved');
    expect(signedIn.licenseNumber).toBe('N01');
    expect(vi.mocked(createClient).mock.results[0].value.auth.getUser).not.toHaveBeenCalled();
    expect(session?.user_metadata['role']).toBe('admin');
    expect(signOutCount).toBe(0);
    expect(await adapter.canAccessDashboard(['driver'])).toBe(true);
    expect(await adapter.canAccessDashboard(['admin'])).toBe(false);
    expect(queries.some((query) =>
      query.table === 'profiles'
      && query.columns === 'id, role, account_status, full_name, email, phone, address'
      && query.column === 'id')).toBe(true);
    expect(queries.some((query) =>
      query.table === 'driver_details'
      && query.columns === 'license_number, vehicle_type, plate_number, wheelchair_accessible, senior_assistance, availability'
      && query.column === 'user_id')).toBe(true);
  });

  it('lets an approved admin review another account through review_account', async () => {
    profiles.push(profileRow(ADMIN_ID, 'admin', 'approved', 'CareRide Admin'));
    session = {
      id: ADMIN_ID,
      email: 'admin@example.com',
      user_metadata: { role: 'passenger', account_status: 'pending' },
    };

    expect(await adapter.canAccessDashboard(['admin'])).toBe(true);
    await adapter.reviewAccount(PASSENGER_ID, 'approved');
    await adapter.reviewAccount(DRIVER_ID, 'rejected');

    expect(rpcs).toEqual([
      { fn: 'review_account', args: { p_user_id: PASSENGER_ID, p_decision: 'approved' } },
      { fn: 'review_account', args: { p_user_id: DRIVER_ID, p_decision: 'rejected' } },
    ]);

    await expect(adapter.reviewAccount(ADMIN_ID, 'approved')).rejects.toThrow('cannot review their own account');
    expect(rpcs).toHaveLength(2);
  });

  it('does not let a passenger call review_account', async () => {
    profiles.push(profileRow(PASSENGER_ID, 'passenger', 'approved'));
    session = {
      id: PASSENGER_ID,
      email: 'pat@example.com',
      user_metadata: { role: 'admin', account_status: 'approved' },
    };

    await expect(adapter.reviewAccount(DRIVER_ID, 'approved')).rejects.toThrow('Only an approved admin');
    expect(rpcs).toHaveLength(0);
  });

  it('clears the adapter session on logout', async () => {
    profiles.push(profileRow(PASSENGER_ID, 'passenger', 'approved', 'Pat'));
    passengerDetails.push({
      user_id: PASSENGER_ID,
      booking_intent: 'self',
      passenger_type: 'other',
      assistance: [],
      other_needs: '',
      emergency_name: '',
      emergency_phone: '',
    });
    await adapter.signIn('pat@example.com', 'secret-pass');
    expect(session).not.toBeNull();

    await adapter.signOut();

    expect(signOutCount).toBe(1);
    expect(session).toBeNull();
    expect(await adapter.readOwnProfile()).toBeNull();
    expect(await adapter.canAccessDashboard()).toBe(false);
    expect(localStorage.getItem('careride_logged_in')).toBeNull();
  });

  it('creates one Supabase client and reuses its session storage key', async () => {
    profiles.push(profileRow(PASSENGER_ID, 'passenger', 'approved', 'Pat'));
    await adapter.signIn('pat@example.com', 'secret-pass');
    await adapter.readOwnProfile();
    await adapter.signOut();

    expect(vi.mocked(createClient)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(createClient).mock.calls[0]?.[2]).toMatchObject({
      auth: { storageKey: SUPABASE_AUTH_STORAGE_KEY },
    });
  });
});

function profile(
  id: string,
  role: 'passenger' | 'driver' | 'admin',
  accountStatus: 'pending' | 'approved' | 'rejected',
) {
  return {
    id,
    role,
    accountStatus,
    fullName: 'CareRide User',
    email: 'user@example.com',
    phone: '',
    address: '',
  };
}

function profileRow(
  id: string,
  role: 'passenger' | 'driver' | 'admin',
  accountStatus: 'pending' | 'approved' | 'rejected',
  fullName = 'CareRide User',
) {
  return {
    id,
    role,
    account_status: accountStatus,
    full_name: fullName,
    email: 'user@example.com',
    phone: '09170000000',
    address: 'Manila',
  };
}
