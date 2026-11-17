import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { vi } from 'vitest';

import { LocalRide } from '../../core/models/local-ride.model';
import { AuthService } from '../../core/services/auth.service';
import { DropoffProofService } from '../../core/services/dropoff-proof.service';
import { LocalRideService } from '../../core/services/local-ride.service';
import { RideService } from '../../core/services/ride.service';
import { RideHistoryPage } from './ride-history.page';

const CLOUD_RIDE: LocalRide = {
  id: '11111111-1111-4111-8111-111111111111',
  passengerType: 'self',
  passengerName: 'Staging Passenger',
  pickupLocation: 'Pickup',
  destination: 'Destination',
  purpose: '',
  date: '2026-11-18',
  time: '09:00',
  assistance: [],
  otherAssistanceNotes: '',
  notes: '',
  emergencyContactName: '',
  emergencyContactNumber: '',
  pickupLatitude: null,
  pickupLongitude: null,
  destinationLatitude: null,
  destinationLongitude: null,
  pickupAccuracyMeters: null,
  destinationAccuracyMeters: null,
  driverId: '22222222-2222-4222-8222-222222222222',
  driverName: 'Approved Driver',
  driverPhone: null,
  vehicleLabel: null,
  driverRating: null,
  preferredDriverId: null,
  preferredDriverName: null,
  preferredDriverPhone: null,
  preferredVehicleLabel: null,
  preferredDriverRating: null,
  clientRating: null,
  clientComment: null,
  ratedAt: null,
  ratedByPassengerId: null,
  status: 'Completed',
  createdAt: '2026-11-18T01:00:00.000Z',
  updatedAt: '2026-11-18T02:00:00.000Z',
};

describe('RideHistoryPage cloud history', () => {
  let fixture: ComponentFixture<RideHistoryPage>;
  let ridesSubject: BehaviorSubject<LocalRide[]>;
  let cloudRides: LocalRide[];
  let hydrateFromCloud: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    cloudRides = [CLOUD_RIDE];
    ridesSubject = new BehaviorSubject<LocalRide[]>(cloudRides);
    hydrateFromCloud = vi.fn(async () => cloudRides);

    await TestBed.configureTestingModule({
      imports: [RideHistoryPage],
      providers: [
        provideRouter([]),
        {
          provide: LocalRideService,
          useValue: {
            rides$: ridesSubject.asObservable(),
            getRides: vi.fn(() => cloudRides),
            reloadFromStorage: vi.fn(),
            formatDate: vi.fn((value: string) => value),
            formatTime: vi.fn((value: string) => value),
            statusTone: vi.fn(() => 'completed'),
            rideProgress: vi.fn(() => ({ terminal: null, steps: [] })),
            rideTimingLabel: vi.fn(() => 'Immediate'),
            assignedDriverLabel: vi.fn(() => 'Approved Driver'),
            assignedVehicleLabel: vi.fn(() => 'Not provided'),
            assignedPlateLabel: vi.fn(() => 'Not provided'),
          },
        },
        {
          provide: RideService,
          useValue: {
            cloudBookings: true,
            hydrateFromCloud,
          },
        },
        // A cloud sign-in intentionally has no matching local careride_users row.
        { provide: AuthService, useValue: { getLocalAccount: vi.fn(() => null) } },
        {
          provide: DropoffProofService,
          useValue: {
            listForCurrentPassenger: vi.fn(async () => []),
            createViewUrl: vi.fn(async () => null),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(RideHistoryPage);
  });

  afterEach(() => fixture.destroy());

  it('shows a completed cloud booking without requiring a local account record', () => {
    const page = fixture.componentInstance;

    (page as unknown as { loadRides: () => void }).loadRides();

    expect(page.rides).toEqual([CLOUD_RIDE]);
    expect(page.completedCount).toBe(1);
    expect(page.needsRating(CLOUD_RIDE)).toBe(true);
  });

  it('shows a safe error instead of a misleading empty history when cloud refresh fails', async () => {
    hydrateFromCloud.mockRejectedValueOnce(new Error('network failure'));
    const page = fixture.componentInstance;

    page.refresh();
    await Promise.resolve();
    await Promise.resolve();

    expect(page.historyLoadError).toContain('Ride history could not be refreshed');
  });
});
