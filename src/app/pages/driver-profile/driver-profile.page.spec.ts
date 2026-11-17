import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { AuthService, LocalCareRideUser } from '../../core/services/auth.service';
import { CloudAccountProfile } from '../../core/services/supabase-auth.adapter';
import { authGuard } from '../../core/guards/auth.guard';
import { routes } from '../../app.routes';
import { DriverNavigationComponent } from '../../shared/driver-navigation.component';
import { DriverProfilePage } from './driver-profile.page';

const driverAccount: LocalCareRideUser = {
  id: 'driver-1',
  accountType: 'driver',
  fullName: 'Riley Driver',
  email: 'riley@example.test',
  phone: '09170000000',
  address: 'Makati',
  password: 'not-rendered',
  createdAt: '2026-01-01T00:00:00.000Z',
  licenseNumber: 'DL-123',
  licenseExpirationDate: '2030-01-01',
  emergencyContactName: 'Sam Driver',
  emergencyContactPhone: '09171111111',
  vehicleType: 'Van',
  vehicleBodyType: 'Van',
  vehicleBrand: 'Example Motors',
  vehicleModel: 'Care Van',
  vehicleVariant: 'Standard',
  vehicleModelYear: 2024,
  vehicleColor: 'Blue',
  plateNumber: 'ABC1234',
  passengerSeatingCapacity: 4,
  verifiedPassengerSeatingCapacity: 3,
  capacityVerificationStatus: 'verified',
  driverDeclaredAccessibility: ['wheelchair_ramp'],
  adminVerifiedAccessibility: ['wheelchair_securement'],
  accessibilityVerificationStatus: 'in_review',
};

describe('DriverProfilePage', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('renders all six profile sections from the signed-in AuthService account', async () => {
    const auth = localAuth(() => driverAccount);
    const fixture = await createPage(auth);
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(auth.getLocalAccount).toHaveBeenCalled();
    expect(text).toContain('Riley Driver');
    expect(text).toContain('riley@example.test');
    expect(text).toContain('Personal Information');
    expect(text).toContain('License Details');
    expect(text).toContain('Emergency Contact');
    expect(text).toContain('Vehicle Information');
    expect(text).toContain('Passenger Capacity');
    expect(text).toContain('Accessibility and Assistance');
    expect(text).not.toContain('not-rendered');
    fixture.destroy();
  });

  it('shows missing profile data as Not provided', async () => {
    const incomplete = { ...driverAccount };
    incomplete.address = undefined as unknown as string;
    delete incomplete.licenseNumber;
    delete incomplete.licenseExpirationDate;
    delete incomplete.emergencyContactName;
    delete incomplete.emergencyContactPhone;
    delete incomplete.vehicleBrand;
    delete incomplete.passengerSeatingCapacity;
    delete incomplete.verifiedPassengerSeatingCapacity;
    delete incomplete.driverDeclaredAccessibility;
    delete incomplete.adminVerifiedAccessibility;
    const fixture = await createPage(localAuth(() => incomplete));
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Not provided');
    expect(fixture.nativeElement.textContent).not.toContain('None declared');
    fixture.destroy();
  });

  it('shows None declared when the stored declaration is explicitly empty', async () => {
    const fixture = await createPage(localAuth(() => ({ ...driverAccount, driverDeclaredAccessibility: [] })));
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('None declared');
    fixture.destroy();
  });

  it('keeps driver-declared capabilities separate from Admin-verified capabilities', async () => {
    const fixture = await createPage(localAuth(() => driverAccount));
    fixture.detectChanges();

    const cards = fixture.nativeElement.querySelectorAll('.profile-card') as NodeListOf<HTMLElement>;
    const capacityCard = [...cards].find((card) => card.textContent?.includes('Passenger Capacity'))!;
    const accessibilityCard = [...cards].find((card) => card.textContent?.includes('Accessibility and Assistance'))!;
    expect(capacityCard.querySelector('.declared')?.textContent).toContain('Declared');
    expect(capacityCard.querySelector('.verified-block')?.textContent).toContain('3 passenger seats');
    expect(capacityCard.querySelector('.verified-block')?.textContent).not.toContain('4 passenger seats');
    expect(accessibilityCard.querySelector('.declared')?.textContent).toContain('Declared');
    expect(accessibilityCard.querySelector('.verified-block')?.textContent).toContain('wheelchair securement');
    expect(accessibilityCard.querySelector('.verified-block')?.textContent).not.toContain('wheelchair ramp');
    fixture.destroy();
  });

  it('shows no driver details when AuthService does not return a driver account', async () => {
    const passenger = { ...driverAccount, accountType: 'passenger' };
    const fixture = await createPage(localAuth(() => passenger));
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Driver account information is unavailable.');
    expect(fixture.nativeElement.textContent).not.toContain('Riley Driver');
    fixture.destroy();
  });

  it('loads the signed-in cloud driver through AuthService without using localStorage account data', async () => {
    const profile = cloudDriverProfile();
    const auth = {
      cloudAuthEnabled: true,
      getLocalAccount: vi.fn(() => null),
      currentCloudProfile: vi.fn(async () => profile),
    };
    const fixture = await createPage(auth);
    await fixture.whenStable();
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(auth.currentCloudProfile).toHaveBeenCalled();
    expect(auth.getLocalAccount).not.toHaveBeenCalled();
    expect(text).toContain('Cloud Driver');
    expect(text).toContain('DL-CLOUD');
    expect(text).toContain('Cloud Van');
    expect(text).toContain('CLOUD123');
    expect(text).toContain('Not provided');
    expect(text).toContain('Verification: Not provided');
    fixture.destroy();
  });

  it('shows a safe error when the cloud profile read fails', async () => {
    const auth = {
      cloudAuthEnabled: true,
      getLocalAccount: vi.fn(() => null),
      currentCloudProfile: vi.fn(async () => { throw new Error('database detail should not be rendered'); }),
    };
    const fixture = await createPage(auth);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Driver profile information could not be loaded. Please try again.');
    expect(fixture.nativeElement.textContent).not.toContain('database detail should not be rendered');
    fixture.destroy();
  });

  it('clears an earlier cloud account when the next read has no driver profile', async () => {
    const auth = {
      cloudAuthEnabled: true,
      getLocalAccount: vi.fn(() => null),
      currentCloudProfile: vi.fn<() => Promise<CloudAccountProfile | null>>()
        .mockResolvedValueOnce(cloudDriverProfile())
        .mockResolvedValueOnce(null),
    };
    const fixture = await createPage(auth);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Cloud Driver');

    fixture.componentInstance.ionViewWillEnter();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Driver account information is unavailable.');
    expect(fixture.nativeElement.textContent).not.toContain('Cloud Driver');
    fixture.destroy();
  });

  it('ignores an earlier profile request after leaving the page', async () => {
    let resolveProfile!: (value: CloudAccountProfile) => void;
    const pending = new Promise<CloudAccountProfile>((resolve) => { resolveProfile = resolve; });
    const auth = {
      cloudAuthEnabled: true,
      getLocalAccount: vi.fn(() => null),
      currentCloudProfile: vi.fn(() => pending),
    };
    const fixture = await createPage(auth);
    fixture.componentInstance.ionViewDidLeave();
    resolveProfile(cloudDriverProfile());
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).not.toContain('Cloud Driver');
    expect(fixture.nativeElement.textContent).toContain('Driver account information is unavailable.');
    fixture.destroy();
  });

  it('uses the driver-only guard for /driver/profile', () => {
    const route = routes.find((item) => item.path === 'driver/profile');
    expect(route?.canActivate).toContain(authGuard);
    expect(route?.data?.['roles']).toEqual(['driver']);
  });

  it('links the shared Driver Profile navigation item to /driver/profile', async () => {
    await TestBed.configureTestingModule({
      imports: [DriverNavigationComponent],
      providers: [provideRouter([])],
    }).compileComponents();
    const fixture = TestBed.createComponent(DriverNavigationComponent);
    fixture.detectChanges();

    const link = [...fixture.nativeElement.querySelectorAll('a')]
      .find((anchor: HTMLAnchorElement) => anchor.getAttribute('aria-label') === 'Profile') as HTMLAnchorElement | undefined;
    expect(link).toBeTruthy();
    expect(link?.getAttribute('href')).toBe('/driver/profile');
    expect(link?.textContent).toContain('Profile');
    fixture.destroy();
  });
});

function localAuth(getLocalAccount: () => LocalCareRideUser | null) {
  return {
    cloudAuthEnabled: false,
    getLocalAccount: vi.fn(getLocalAccount),
    currentCloudProfile: vi.fn(async () => null),
  };
}

function cloudDriverProfile(): CloudAccountProfile {
  return {
    id: 'cloud-driver-1',
    role: 'driver',
    accountStatus: 'approved',
    fullName: 'Cloud Driver',
    email: 'cloud@example.test',
    phone: '09172222222',
    address: 'Quezon City',
    licenseNumber: 'DL-CLOUD',
    vehicleType: 'Cloud Van',
    plateNumber: 'CLOUD123',
    wheelchairAccessible: false,
    seniorAssistance: true,
    availability: 'offline',
  };
}

async function createPage(auth: {
  cloudAuthEnabled: boolean;
  getLocalAccount: ReturnType<typeof vi.fn>;
  currentCloudProfile: ReturnType<typeof vi.fn>;
}) {
  await TestBed.configureTestingModule({
    imports: [DriverProfilePage],
    providers: [provideRouter([]), { provide: AuthService, useValue: auth }],
  }).compileComponents();
  const fixture = TestBed.createComponent(DriverProfilePage);
  fixture.detectChanges();
  return fixture;
}
