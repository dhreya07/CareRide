import { LocalRide } from '../../core/models/local-ride.model';
import { DriverLocationPublisherService } from '../../core/services/driver-location-publisher.service';
import { ChangeDetectorRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AlertController } from '@ionic/angular';
import { Router } from '@angular/router';
import { EMPTY } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { DriverGpsService } from '../../core/services/driver-gps.service';
import { LocalRideService } from '../../core/services/local-ride.service';
import { NotificationService } from '../../core/services/notification.service';
import { RideService } from '../../core/services/ride.service';
import { DriverPage } from './driver.page';

describe('Driver availability controls', () => {
  let page: DriverPage;
  let auth: {
    cloudAuthEnabled: boolean;
    currentCloudProfile: ReturnType<typeof vi.fn>;
    setCloudDriverAvailability: ReturnType<typeof vi.fn>;
    getLocalAccount: ReturnType<typeof vi.fn>;
    readAvailability: ReturnType<typeof vi.fn>;
    setMyAvailability: ReturnType<typeof vi.fn>;
  };
  let rides: {
    cloudBookings: boolean;
    setOwnAvailability: ReturnType<typeof vi.fn>;
  };
  let localDriver: { availability: 'available' | 'offline' };

  beforeEach(() => {
    localDriver = { availability: 'offline' };
    auth = {
      cloudAuthEnabled: true,
      currentCloudProfile: vi.fn(async () => ({
        id: '22222222-2222-4222-8222-222222222222',
        role: 'driver',
        accountStatus: 'approved',
        availability: 'offline',
      })),
      setCloudDriverAvailability: vi.fn(async () => undefined),
      getLocalAccount: vi.fn(() => localDriver),
      readAvailability: vi.fn((driver: typeof localDriver) => driver.availability),
      setMyAvailability: vi.fn((status: 'available' | 'offline') => {
        localDriver.availability = status;
      }),
    };
    rides = {
      cloudBookings: false,
      setOwnAvailability: vi.fn(async () => undefined),
    };

    TestBed.configureTestingModule({
      providers: [
        DriverPage,
        { provide: DriverLocationPublisherService, useValue: {
          onlineIntent: () => 0, optIn: vi.fn(), disable: vi.fn(), setDashboardVisible: vi.fn(),
        } },
        { provide: AuthService, useValue: auth },
        { provide: RideService, useValue: rides },
        { provide: LocalRideService, useValue: { reloadFromStorage: vi.fn() } },
        { provide: Router, useValue: { url: '/driver', events: EMPTY } },
        { provide: AlertController, useValue: { create: vi.fn() } },
        { provide: NotificationService, useValue: { changes$: EMPTY } },
        { provide: DriverGpsService, useValue: { changes$: EMPTY } },
        { provide: ChangeDetectorRef, useValue: { markForCheck: vi.fn() } },
      ],
    });
    page = TestBed.inject(DriverPage);
  });

  afterEach(() => {
    page.ngOnDestroy();
    TestBed.resetTestingModule();
  });

  it('updates cloud availability through AuthService and refreshes after success', async () => {
    await page.setMyAvailability('available');

    expect(auth.setCloudDriverAvailability).toHaveBeenCalledWith('available');
    expect(rides.setOwnAvailability).not.toHaveBeenCalled();
    expect(page.locationPublisher.optIn).toHaveBeenCalledWith(0);
    expect(page.myAvailability).toBe('available');
  });

  it('reads availability from the signed-in cloud Driver profile', async () => {
    auth.currentCloudProfile.mockResolvedValueOnce({
      id: '22222222-2222-4222-8222-222222222222',
      role: 'driver',
      accountStatus: 'approved',
      availability: 'offline',
    });
    const refresh = (page as unknown as { refreshCloudAvailability: () => Promise<void> })
      .refreshCloudAvailability.bind(page);

    await refresh();

    expect(auth.currentCloudProfile).toHaveBeenCalledOnce();
    expect(page.myAvailability).toBe('offline');
  });

  it('keeps the prior status and shows an error when the cloud update is rejected', async () => {
    auth.setCloudDriverAvailability.mockRejectedValueOnce(new Error('Only approved drivers can update availability.'));
    const cloud = page as unknown as { cloudAvailability: string | null };
    cloud.cloudAvailability = 'offline';

    await page.setMyAvailability('available');

    expect(page.myAvailability).toBe('offline');
    expect(page.availabilityError).toBe('Only approved drivers can update availability.');
    expect(page.dialog?.message).toBe('Only approved drivers can update availability.');
    expect(page.locationPublisher.optIn).not.toHaveBeenCalled();
  });

  it('preserves local-account availability when cloud auth is disabled', async () => {
    auth.cloudAuthEnabled = false;

    await page.setMyAvailability('available');

    expect(auth.setMyAvailability).toHaveBeenCalledWith('available');
    expect(auth.setCloudDriverAvailability).not.toHaveBeenCalled();
    expect(page.myAvailability).toBe('available');
  });
  it('reports booking-day and completed totals without counting cancelled history', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(2026, 10, 16, 9));
      const ride = (id: string, date: string, status: LocalRide['status'], updatedAt: string) =>
        ({ id, date, time: '10:00', status, updatedAt } as LocalRide);
      const today = ride('today', '2026-11-16', 'Driver Assigned', '2026-11-15T10:00:00Z');
      const later = ride('later', '2026-11-17', 'Driver Assigned', '2026-11-14T10:00:00Z');
      const complete = ride('done', '2026-11-13', 'Completed', '2026-11-15T12:00:00Z');
      const cancelled = ride('cancelled', '2026-11-13', 'Cancelled', '2026-11-14T09:00:00Z');
      page.scheduleRides = [later, today];
      page.rides = [today];
      page.historyRides = [complete, cancelled];

      expect(page.todayTripCount).toBe(1);
      expect(page.completedTripCount).toBe(1);
      expect(page.upcomingHomeRides.map(({ id }) => id)).toEqual(['today', 'later']);
      expect(page.recentHomeRides.map(({ id }) => id)).toEqual(['done', 'today', 'later', 'cancelled']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops the publisher immediately when the Driver chooses Offline', async () => {
    const cloud = page as unknown as { cloudAvailability: 'available' };
    cloud.cloudAvailability = 'available';
    await page.setMyAvailability('offline');
    expect(page.locationPublisher.disable).toHaveBeenCalledOnce();
    expect(vi.mocked(page.locationPublisher.disable)).toHaveBeenCalledBefore(auth.setCloudDriverAvailability);
    expect(page.myAvailability).toBe('offline');
  });
});
