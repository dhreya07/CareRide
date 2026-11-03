import { TestBed } from '@angular/core/testing';
import { environment } from '../../../environments/environment';
import { AuthService } from './auth.service';
import { SupabaseAuthAdapter } from './supabase-auth.adapter';
import { SupabaseService } from './supabase.service';

const approvedAdmin = {
  id: '33333333-3333-4333-8333-333333333333',
  role: 'admin' as const,
  accountStatus: 'approved' as const,
  fullName: 'CareRide Admin',
  email: 'admin@example.com',
  phone: '09170000001',
  address: '',
};

describe('AuthService cloud auth switch', () => {
  afterEach(() => {
    environment.supabase.cloudAuthEnabled = false;
    localStorage.clear();
    TestBed.resetTestingModule();
  });

  it('keeps localStorage sign-in while cloud auth is off', async () => {
    environment.supabase.cloudAuthEnabled = false;
    const auth = await createAuth();
    const signIn = vi.spyOn(TestBed.inject(SupabaseAuthAdapter), 'signIn');

    const role = await auth.signIn('admin@careride.local', 'CareRideAdmin1');

    expect(role).toBe('admin');
    expect(auth.cloudAuthEnabled).toBe(false);
    expect(auth.configured).toBe(false);
    expect(environment.supabase.cloudMigration).toBe(false);
    expect(signIn).not.toHaveBeenCalled();
    expect(await auth.currentCloudProfile()).toBeNull();
    await expect(auth.reviewCloudAccount(approvedAdmin.id, 'approved')).rejects.toThrow('not enabled');
    await expect(auth.sendPasswordReset('admin@careride.local')).rejects.toThrow(
      'Password recovery is available after Supabase authentication is connected.',
    );
    expect(auth.recoveryRedirectUrl('http://localhost:8100')).toBe('http://localhost:8100/reset-password');
  });

  it('uses the adapter for sign-in, access, registration, and sign-out when cloud auth is enabled', async () => {
    environment.supabase.cloudAuthEnabled = true;
    const auth = await createAuth();
    const adapter = TestBed.inject(SupabaseAuthAdapter);
    const supabase = TestBed.inject(SupabaseService);
    vi.spyOn(adapter, 'signIn').mockResolvedValue(approvedAdmin);
    vi.spyOn(adapter, 'readOwnProfile').mockResolvedValue(approvedAdmin);
    vi.spyOn(adapter, 'registerPassenger').mockResolvedValue({
      accountStatus: 'pending',
      emailConfirmationRequired: true,
    });
    vi.spyOn(adapter, 'registerDriver').mockResolvedValue({
      accountStatus: 'pending',
      emailConfirmationRequired: false,
    });
    vi.spyOn(adapter, 'signOut').mockResolvedValue();
    vi.spyOn(adapter, 'reviewAccount').mockResolvedValue();

    expect(supabase.client).toBeNull();
    expect(supabase.configured).toBe(false);
    expect(localStorage.getItem('careride_users')).toBeNull();

    await expect(auth.signIn('pat@example.com', 'secret-pass')).resolves.toBe('admin');
    expect(localStorage.getItem('careride_users')).toBeNull();
    expect(JSON.stringify(localStorage)).not.toContain('secret-pass');
    expect(await auth.hasAccess(['admin'])).toBe(true);
    expect(await auth.hasAccess(['passenger'])).toBe(false);
    expect(await auth.getCurrentRole()).toBe('admin');
    expect(await auth.isSignedIn()).toBe(true);

    await expect(auth.register('pat@example.com', 'secret-pass', 'Pat Rider', '09171234567', 'family', 'Manila'))
      .resolves.toEqual({ accountStatus: 'pending', emailConfirmationRequired: true });
    expect(adapter.registerPassenger).toHaveBeenCalledWith({
      email: 'pat@example.com',
      password: 'secret-pass',
      fullName: 'Pat Rider',
      phone: '09171234567',
      address: 'Manila',
      bookingIntent: 'family',
    });
    expect(localStorage.getItem('careride_users')).toBeNull();

    await expect(auth.register(
      'dee@example.com',
      'secret-pass',
      'Dee Driver',
      '09170000002',
      'self',
      'Quezon City',
      'driver',
      {
        licenseNumber: 'N01-23-456789',
        vehicleType: 'van',
        plateNumber: 'ABC 123',
        wheelchairAccessible: true,
        seniorAssistance: false,
      },
    )).resolves.toEqual({ accountStatus: 'pending', emailConfirmationRequired: false });
    expect(adapter.registerDriver).toHaveBeenCalledWith(expect.objectContaining({
      licenseNumber: 'N01-23-456789',
      vehicleType: 'van',
      plateNumber: 'ABC 123',
      wheelchairAccessible: true,
      seniorAssistance: false,
    }));

    await auth.reviewCloudAccount('11111111-1111-4111-8111-111111111111', 'approved');
    expect(adapter.reviewAccount).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      'approved',
    );

    await auth.signOut();
    expect(adapter.signOut).toHaveBeenCalled();
    expect(localStorage.getItem('careride_logged_in')).toBeNull();
    expect(JSON.stringify(localStorage)).not.toContain('secret-pass');
  });

  it('refuses pending, rejected, and missing cloud profiles', async () => {
    environment.supabase.cloudAuthEnabled = true;
    const auth = await createAuth();
    const adapter = TestBed.inject(SupabaseAuthAdapter);
    vi.spyOn(adapter, 'signIn').mockRejectedValue(
      new Error('Account Under Review. An admin must approve this account before you can sign in.'),
    );
    vi.spyOn(adapter, 'readOwnProfile').mockResolvedValue({
      ...approvedAdmin,
      role: 'passenger',
      accountStatus: 'pending',
    });

    await expect(auth.signIn('pat@example.com', 'secret-pass')).rejects.toThrow('Account Under Review');
    expect(await auth.hasAccess(['passenger', 'admin'])).toBe(false);
    expect(await auth.isSignedIn()).toBe(false);
    expect(await auth.getCurrentRole()).toBeNull();
    expect((await auth.currentCloudProfile())?.accountStatus).toBe('pending');
    expect(localStorage.getItem('careride_users')).toBeNull();

    vi.mocked(adapter.readOwnProfile).mockResolvedValue({
      ...approvedAdmin,
      role: 'driver',
      accountStatus: 'rejected',
    });
    expect(await auth.hasAccess(['driver'])).toBe(false);
    expect(await auth.getCurrentRole()).toBeNull();

    vi.mocked(adapter.readOwnProfile).mockResolvedValue(null);
    expect(await auth.hasAccess()).toBe(false);
    expect(await auth.getCurrentRole()).toBeNull();
    expect(await auth.currentCloudProfile()).toBeNull();
  });
});

async function createAuth(): Promise<AuthService> {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({});
  return TestBed.inject(AuthService);
}
