import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { AlertController } from '@ionic/angular';
import { of } from 'rxjs';
import { AdminService } from '../../core/services/admin.service';
import { AuthService, LocalCareRideUser } from '../../core/services/auth.service';
import { LocalRideService } from '../../core/services/local-ride.service';
import { RideService } from '../../core/services/ride.service';
import { CloudManagedAccount } from '../../core/services/supabase-auth.adapter';
import { AdminPage } from './admin.page';

const PASSENGER_ID = '11111111-1111-4111-8111-111111111111';
const DRIVER_ID = '22222222-2222-4222-8222-222222222222';

const auth = {
  cloudAuthEnabled: false,
  listManagedAccounts: vi.fn<() => LocalCareRideUser[]>(() => [localPassenger()]),
  listCloudAccounts: vi.fn<() => Promise<CloudManagedAccount[]>>(async () => cloudRows()),
  acceptAccount: vi.fn(),
  declineAccount: vi.fn(),
  reviewCloudAccount: vi.fn(async () => undefined),
  signOut: vi.fn(async () => undefined),
  listApprovedDrivers: vi.fn(() => []),
  readAvailability: vi.fn(() => 'offline' as const),
  accountStatusOf: (user: LocalCareRideUser) => AuthService.prototype.accountStatusOf(user),
};

describe('Admin accounts screen', () => {
  beforeEach(() => {
    localStorage.clear();
    auth.cloudAuthEnabled = false;
    auth.listManagedAccounts.mockReset();
    auth.listManagedAccounts.mockReturnValue([localPassenger()]);
    auth.listCloudAccounts.mockReset();
    auth.listCloudAccounts.mockResolvedValue(cloudRows());
    auth.acceptAccount.mockReset();
    auth.declineAccount.mockReset();
    auth.reviewCloudAccount.mockReset();
    auth.reviewCloudAccount.mockResolvedValue(undefined);
    TestBed.resetTestingModule();
  });

  afterEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
  });

  it('keeps the localStorage account list while cloud auth is off', async () => {
    localStorage.setItem('careride_users', JSON.stringify([localPassenger()]));
    const fixture = await createPage();

    fixture.componentInstance.showTab('accounts');
    fixture.detectChanges();

    expect(auth.listCloudAccounts).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('Local Pat');
    expect(fixture.nativeElement.textContent).not.toContain('local-secret');
    expect(fixture.nativeElement.textContent).not.toContain('Registered');
    expect(localStorage.getItem('careride_users')).toContain('Local Pat');
    fixture.destroy();
  });

  it('shows an empty cloud list and then filters pending, approved, and rejected accounts', async () => {
    auth.cloudAuthEnabled = true;
    auth.listCloudAccounts.mockResolvedValue([]);
    const empty = await createPage();
    empty.componentInstance.showTab('accounts');
    await settled(empty.componentInstance);
    empty.detectChanges();

    expect(empty.nativeElement.textContent).toContain('No passenger accounts');
    empty.destroy();
    TestBed.resetTestingModule();

    auth.listCloudAccounts.mockResolvedValue(cloudRows());
    const fixture = await createPage();
    fixture.componentInstance.showTab('accounts');
    await settled(fixture.componentInstance);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Pat Pending');
    expect(fixture.nativeElement.textContent).toContain('pat-pending@example.com');
    expect(fixture.componentInstance.statusCount('pending')).toBe(1);
    expect(fixture.componentInstance.statusCount('approved')).toBe(0);
    expect(fixture.nativeElement.textContent).toContain('Registered');

    fixture.componentInstance.selectAccountFilter('approved');
    expect(fixture.componentInstance.visibleAccounts).toHaveLength(0);
    expect(fixture.componentInstance.accountEmptyTitle).toBe('No approved passenger accounts');

    fixture.componentInstance.selectAccountGroup('driver');
    fixture.componentInstance.selectAccountFilter('approved');
    expect(fixture.componentInstance.visibleAccounts.map((account) => account.fullName)).toEqual(['Approved Driver']);
    expect(fixture.componentInstance.statusCount('approved')).toBe(1);

    fixture.componentInstance.selectAccountGroup('passenger');
    fixture.componentInstance.selectAccountFilter('rejected');
    expect(fixture.componentInstance.visibleAccounts.map((account) => account.fullName)).toEqual(['Rae Rejected']);
    expect(localStorage.getItem('careride_users')).toBeNull();
    fixture.destroy();
  });

  it('shows a cloud load error without changing local accounts', async () => {
    localStorage.setItem('careride_users', '[]');
    auth.cloudAuthEnabled = true;
    auth.listCloudAccounts.mockRejectedValue(new Error('Accounts could not be loaded.'));
    const fixture = await createPage();

    fixture.componentInstance.showTab('accounts');
    await settled(fixture.componentInstance);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Accounts could not be loaded');
    expect(fixture.nativeElement.textContent).not.toContain('Local Pat');
    expect(localStorage.getItem('careride_users')).toBe('[]');
    fixture.destroy();
  });

  it('approves and rejects through the cloud review and not localStorage', async () => {
    auth.cloudAuthEnabled = true;
    const fixture = await createPage();
    fixture.componentInstance.showTab('accounts');
    await settled(fixture.componentInstance);

    await fixture.componentInstance.confirmAccountDecision(
      fixture.componentInstance.visibleAccounts[0],
      'approved',
    );
    await settled(fixture.componentInstance);

    expect(auth.reviewCloudAccount).toHaveBeenCalledWith(PASSENGER_ID, 'approved');
    expect(auth.acceptAccount).not.toHaveBeenCalled();

    fixture.componentInstance.selectAccountGroup('driver');
    fixture.componentInstance.selectAccountFilter('pending');
    await fixture.componentInstance.confirmAccountDecision(
      fixture.componentInstance.visibleAccounts[0],
      'rejected',
    );

    expect(auth.reviewCloudAccount).toHaveBeenCalledWith(DRIVER_ID, 'rejected');
    expect(auth.declineAccount).not.toHaveBeenCalled();
    expect(localStorage.getItem('careride_users')).toBeNull();
    fixture.destroy();
  });
});

async function createPage() {
  await TestBed.configureTestingModule({
    imports: [AdminPage],
    providers: [
      provideRouter([{ path: 'admin/accounts', children: [] }]),
      { provide: AuthService, useValue: auth },
      {
        provide: LocalRideService,
        useValue: {
          rides$: of([]),
          reloadFromStorage: vi.fn(),
          getRides: () => [],
          statusTone: () => 'pending',
          getAvailableDrivers: () => [],
        },
      },
      { provide: RideService, useValue: { hydrateFromCloud: vi.fn(async () => []) } },
      { provide: AdminService, useValue: {} },
      {
        provide: AlertController,
        useValue: {
          create: vi.fn(async () => ({
            present: vi.fn(async () => undefined),
            onDidDismiss: vi.fn(async () => ({ role: 'confirm' })),
          })),
        },
      },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(AdminPage);
  await TestBed.inject(Router).navigateByUrl('/admin/accounts');
  fixture.detectChanges();
  return fixture;
}

async function settled(page: AdminPage): Promise<void> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await Promise.resolve();
    if (!page.accountsLoading) {
      await Promise.resolve();
      return;
    }
  }
}

function localPassenger(): LocalCareRideUser {
  return {
    id: 'CR-PAT',
    accountType: 'passenger',
    fullName: 'Local Pat',
    email: 'pat@local.test',
    phone: '',
    address: '',
    password: 'local-secret',
    accountStatus: 'pending',
    createdAt: '2026-02-01T00:00:00.000Z',
  };
}

function cloudRows(): CloudManagedAccount[] {
  return [
    cloudAccount(PASSENGER_ID, 'passenger', 'pending', 'Pat Pending'),
    cloudAccount(DRIVER_ID, 'driver', 'pending', 'Dee Driver'),
    cloudAccount('44444444-4444-4444-8444-444444444444', 'passenger', 'rejected', 'Rae Rejected'),
    cloudAccount('55555555-5555-4555-8555-555555555555', 'driver', 'approved', 'Approved Driver'),
  ];
}

function cloudAccount(
  id: string,
  role: 'passenger' | 'driver',
  accountStatus: 'pending' | 'approved' | 'rejected',
  fullName: string,
): CloudManagedAccount {
  return {
    id,
    role,
    accountStatus,
    fullName,
    email: `${fullName.toLowerCase().replace(/\s+/g, '-')}@example.com`,
    phone: '',
    address: '',
    createdAt: '2026-03-02T00:00:00.000Z',
  };
}
