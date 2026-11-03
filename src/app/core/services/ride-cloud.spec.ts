import { TestBed } from '@angular/core/testing';
import { environment } from '../../../environments/environment';
import { CreateLocalRideInput, LocalRide } from '../models/local-ride.model';
import { AdminService } from './admin.service';
import { LocalRideService } from './local-ride.service';
import { NotificationService } from './notification.service';
import { RideService } from './ride.service';
import { SupabaseBookingAdapter } from './supabase-booking.adapter';

const BOOKING = '11111111-1111-4111-8111-111111111111';
const DRIVER = '22222222-2222-4222-8222-222222222222';
const REPLACEMENT = '33333333-3333-4333-8333-333333333333';

describe('Cloud booking wiring', () => {
  let cloud: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    localStorage.clear();
    environment.supabase.cloudMigration = false;
    environment.supabase.cloudAuthEnabled = false;
    cloud = {
      createBooking: vi.fn(async (input: CreateLocalRideInput) => ride({ status: input.status ?? 'Pending' })),
      listBookings: vi.fn(async () => [ride({ status: 'Pending' })]),
      getBooking: vi.fn(async () => ride({ status: 'Pending' })),
      acceptBooking: vi.fn(async () => ride({ status: 'Driver Assigned', driverId: DRIVER })),
      declineBooking: vi.fn(async () => ride({ status: 'Rejected', driverId: DRIVER })),
      referBooking: vi.fn(async () => ride({ referralStatus: 'pending', referralProposedDriverId: REPLACEMENT })),
      acceptReferral: vi.fn(async () => ride({ referralStatus: 'accepted_by_replacement' })),
      confirmDriverChange: vi.fn(async () => ride({
        referralStatus: 'passenger_confirmed',
        driverId: REPLACEMENT,
      })),
      declineDriverChange: vi.fn(async () => ride({ referralStatus: 'passenger_declined' })),
      cancelBooking: vi.fn(async () => ride({ status: 'Cancelled' })),
      advanceBooking: vi.fn(async (_id: string, status: LocalRide['status']) => ride({ status })),
      startBooking: vi.fn(async () => ride({ status: 'In Progress', driverId: DRIVER })),
      completeBooking: vi.fn(async () => ride({ status: 'Completed', driverId: DRIVER })),
      rateCompletedBooking: vi.fn(async () => ride({ status: 'Completed', clientRating: 5 })),
      assignBooking: vi.fn(async () => ride({ status: 'Driver Assigned', driverId: DRIVER })),
      listNotifications: vi.fn(async () => [{
        id: 'note-1',
        recipientId: DRIVER,
        type: 'booking_request',
        title: 'New booking request',
        message: 'Pat requested a ride.',
        rideId: BOOKING,
        createdAt: '2026-03-04T01:00:00.000Z',
        read: false,
      }]),
      currentUserId: vi.fn(async () => DRIVER),
      setOwnAvailability: vi.fn(async () => undefined),
      listAvailableDrivers: vi.fn(async () => [cloudDriver()]),
      declineReferral: vi.fn(async () => ride({ referralStatus: undefined })),
      markNotificationRead: vi.fn(async () => undefined),
      markAllNotificationsRead: vi.fn(async () => undefined),
      reportSafety: vi.fn(async () => undefined),
    };
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: SupabaseBookingAdapter, useValue: cloud }],
    });
  });

  afterEach(() => {
    environment.supabase.cloudMigration = false;
    environment.supabase.cloudAuthEnabled = false;
    localStorage.clear();
    TestBed.resetTestingModule();
  });

  it('keeps passenger creation, history, cancellation, and local ids on localStorage', async () => {
    const rides = TestBed.inject(RideService);
    const local = TestBed.inject(LocalRideService);
    const created = await rides.submitPassengerRide(sample('Pending'));

    expect(created.id.startsWith('CR-')).toBe(true);
    expect(created.status).toBe('Pending');
    expect(local.getRides()).toHaveLength(1);
    expect(await rides.hydrateFromCloud()).toEqual(local.getRides());
    expect(await rides.cancelRide(created.id)).toMatchObject({ status: 'Cancelled' });
    expect(cloud['createBooking']).not.toHaveBeenCalled();
    expect(cloud['listBookings']).not.toHaveBeenCalled();
    expect(cloud['cancelBooking']).not.toHaveBeenCalled();
    expect(localStorage.getItem('careride.local.rides')).toContain(created.id);
  });

  it('does not send a local driver id when cloud booking is enabled', async () => {
    environment.supabase.cloudMigration = true;
    const rides = TestBed.inject(RideService);

    await expect(rides.submitPassengerRide(sample('Scheduled'))).rejects.toThrow(
      'The preferred driver must be a Supabase profile id.',
    );
    expect(cloud['createBooking']).not.toHaveBeenCalled();
    expect(localStorage.getItem('careride.local.rides')).toBeNull();
  });

  it('creates immediate and scheduled cloud bookings without removing local rides', async () => {
    const local = TestBed.inject(LocalRideService);
    const kept = local.createRide({ ...sample('Pending'), preferredDriverId: 'CR-DEMO-DRIVER' });
    environment.supabase.cloudMigration = true;
    const rides = TestBed.inject(RideService);

    const immediate = await rides.submitPassengerRide({ ...sample('Pending'), preferredDriverId: DRIVER });
    const scheduled = await rides.submitPassengerRide({ ...sample('Scheduled'), preferredDriverId: DRIVER });

    expect(immediate.status).toBe('Pending');
    expect(scheduled.status).toBe('Scheduled');
    expect(cloud['createBooking']).toHaveBeenCalledTimes(2);
    expect(local.getRideById(kept.id)?.passengerName).toBe('Pat Passenger');
  });

  it('runs driver accept, decline, referral, replacement acceptance, and ride progress', async () => {
    environment.supabase.cloudMigration = true;
    const rides = TestBed.inject(RideService);

    expect((await rides.acceptBooking(BOOKING)).status).toBe('Driver Assigned');
    expect((await rides.advanceUiStatus(BOOKING, 'Driver On The Way'))?.status).toBe('Driver On The Way');
    expect((await rides.startBooking(BOOKING)).status).toBe('In Progress');
    expect((await rides.completeBooking(BOOKING)).status).toBe('Completed');
    expect((await rides.declineBooking(BOOKING)).status).toBe('Rejected');
    expect((await rides.referBooking(BOOKING, REPLACEMENT)).referralStatus).toBe('pending');
    expect((await rides.acceptReferral(BOOKING)).referralStatus).toBe('accepted_by_replacement');
    expect((await rides.declineReferral(BOOKING)).referralStatus).toBeUndefined();
    await rides.setOwnAvailability('available');

    expect(cloud['acceptBooking']).toHaveBeenCalledWith(BOOKING);
    expect(cloud['referBooking']).toHaveBeenCalledWith(BOOKING, REPLACEMENT);
    expect(cloud['acceptReferral']).toHaveBeenCalledWith(BOOKING);
    expect(cloud['declineReferral']).toHaveBeenCalledWith(BOOKING);
    expect(cloud['setOwnAvailability']).toHaveBeenCalledWith('available');
  });

  it('lets the passenger confirm or decline a replacement and rate a completed ride', async () => {
    environment.supabase.cloudMigration = true;
    const rides = TestBed.inject(RideService);

    expect((await rides.confirmDriverChange(BOOKING)).driverId).toBe(REPLACEMENT);
    expect((await rides.declineDriverChange(BOOKING)).referralStatus).toBe('passenger_declined');
    expect((await rides.rateBooking(BOOKING, 5, 'Careful ride')).clientRating).toBe(5);
    expect(cloud['rateCompletedBooking']).toHaveBeenCalledWith(BOOKING, 5, 'Careful ride');
  });

  it('blocks an invalid transition and a local booking id before calling Supabase', async () => {
    environment.supabase.cloudMigration = true;
    const rides = TestBed.inject(RideService);
    const local = TestBed.inject(LocalRideService);
    local.saveRide(ride({ status: 'Pending' }));

    expect(await rides.advanceUiStatus(BOOKING, 'Completed')).toBeNull();
    await expect(rides.acceptBooking('CR-LOCAL-RIDE')).rejects.toThrow(
      'This on-device booking is not a cloud booking.',
    );
    await expect(rides.referBooking(BOOKING, 'CR-DEMO-DRIVER')).rejects.toThrow(
      'The replacement driver must be a Supabase profile id.',
    );

    expect(cloud['advanceBooking']).not.toHaveBeenCalled();
    expect(cloud['acceptBooking']).not.toHaveBeenCalled();
    expect(cloud['referBooking']).not.toHaveBeenCalled();
    expect(local.getRideById(BOOKING)?.status).toBe('Pending');
  });

  it('keeps the local ride when a cloud decision is unauthorized or Supabase fails', async () => {
    environment.supabase.cloudMigration = true;
    const rides = TestBed.inject(RideService);
    const local = TestBed.inject(LocalRideService);
    local.saveRide(ride({ status: 'Pending' }));
    cloud['declineBooking'].mockRejectedValueOnce(new Error('This booking is not waiting for you'));
    cloud['cancelBooking'].mockRejectedValueOnce(new Error('The booking could not be updated.'));

    await expect(rides.declineBooking(BOOKING)).rejects.toThrow('This booking is not waiting for you');
    await expect(rides.cancelRide(BOOKING)).rejects.toThrow('The booking could not be updated.');
    expect(local.getRideById(BOOKING)?.status).toBe('Pending');
  });

  it('lets an approved admin monitor and assign, but not reject through the driver action', async () => {
    environment.supabase.cloudMigration = true;
    const rides = TestBed.inject(RideService);
    const admin = TestBed.inject(AdminService);
    cloud['listBookings'].mockResolvedValueOnce([
      ride({ status: 'Scheduled' }),
      ride({ id: '44444444-4444-4444-8444-444444444444', status: 'Completed' }),
    ]);

    const queue = await admin.getAssignmentQueue();
    const assigned = await rides.assignBooking(BOOKING, DRIVER);

    expect(queue.rides.map((item) => item.id)).toEqual([BOOKING]);
    expect(queue.drivers.map((driver) => driver.id)).toEqual([DRIVER]);
    expect(assigned.status).toBe('Driver Assigned');
    expect(cloud['assignBooking']).toHaveBeenCalledWith(BOOKING, DRIVER);
    await expect(rides.rejectRide(BOOKING)).rejects.toThrow('An admin cannot reject a cloud booking.');
    await expect(rides.assignBooking(BOOKING, 'CR-DEMO-DRIVER')).rejects.toThrow(
      'The driver must be a Supabase profile id.',
    );
  });

  it('loads cloud notifications for the signed-in profile and leaves local notifications untouched', async () => {
    const notifications = TestBed.inject(NotificationService);
    notifications.bookingRequested('CR-DEMO-DRIVER', ride({ id: 'CR-RIDE' }));
    expect(notifications.listFor('CR-DEMO-DRIVER')).toHaveLength(1);

    environment.supabase.cloudMigration = true;
    await notifications.refreshCloud();

    expect(notifications.listFor('CR-DEMO-DRIVER').map((item) => item.id)).toEqual(['note-1']);
    expect(cloud['listNotifications']).toHaveBeenCalledTimes(1);
    await notifications.markRead('note-1', DRIVER);
    expect(cloud['markNotificationRead']).toHaveBeenCalledWith('note-1');
    expect(notifications.listFor(DRIVER)[0].read).toBe(true);
    expect(localStorage.getItem('careride.local.notifications')).toContain('CR-DEMO-DRIVER');
    expect(localStorage.getItem('careride.local.notifications')).not.toContain('note-1');
  });

  it('does not read cloud notifications or change availability while cloud booking is off', async () => {
    const rides = TestBed.inject(RideService);
    const notifications = TestBed.inject(NotificationService);
    const admin = TestBed.inject(AdminService);

    await notifications.refreshCloud();
    await expect(rides.setOwnAvailability('offline')).rejects.toThrow('Cloud driver availability is not enabled.');
    await expect(admin.getAssignmentQueue()).rejects.toThrow('Admin data is unavailable until Supabase is configured.');
    expect(cloud['listNotifications']).not.toHaveBeenCalled();
    expect(cloud['setOwnAvailability']).not.toHaveBeenCalled();
    expect(cloud['listBookings']).not.toHaveBeenCalled();
    expect(environment.supabase.cloudAuthEnabled).toBe(false);
    expect(await rides.listAvailableDrivers()).toEqual([]);
    await rides.reportIssue('CR-LOCAL', 'A local concern');
    expect(cloud['listAvailableDrivers']).not.toHaveBeenCalled();
    expect(cloud['reportSafety']).not.toHaveBeenCalled();
  });

  it('uses profile ids for driver choice, referral decline, read state, and safety reports', async () => {
    environment.supabase.cloudMigration = true;
    const rides = TestBed.inject(RideService);
    const notifications = TestBed.inject(NotificationService);

    const drivers = await rides.listAvailableDrivers();
    expect(drivers.map((driver) => driver.id)).toEqual([DRIVER]);
    expect(drivers[0].vehicleLabel).toBe('Van · ABC 123');
    expect(drivers[0].availability).toBe('available');
    await rides.reportIssue(BOOKING, 'The pickup was unsafe.');
    await expect(rides.reportIssue('CR-LOCAL', 'Blocked.')).rejects.toThrow(
      'This on-device booking is not a cloud booking.',
    );
    await notifications.refreshCloud();
    await notifications.markAllRead(DRIVER);

    expect(cloud['listAvailableDrivers']).toHaveBeenCalledTimes(1);
    expect(cloud['reportSafety']).toHaveBeenCalledWith(BOOKING, 'The pickup was unsafe.');
    expect(cloud['markAllNotificationsRead']).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('careride.local.rides') ?? '').not.toContain('CR-LOCAL');
  });
});

function cloudDriver() {
  return {
    id: DRIVER,
    name: 'Dee Driver',
    phone: '09170000000',
    vehicleType: 'Van',
    plateNumber: 'ABC 123',
    vehicleLabel: 'Van · ABC 123',
    availability: 'available',
    wheelchairAccessible: true,
    seniorAssistance: false,
    rating: 4.8,
    ratingCount: 3,
  };
}

function sample(status: 'Pending' | 'Scheduled'): CreateLocalRideInput {
  return {
    passengerType: 'self',
    passengerName: 'Pat Passenger',
    pickupLocation: 'Home',
    destination: 'Clinic',
    purpose: 'Checkup',
    date: '2026-03-04',
    time: '09:30',
    assistance: ['Wheelchair'],
    otherAssistanceNotes: '',
    notes: '',
    emergencyContactName: 'Kim',
    emergencyContactNumber: '09170000000',
    preferredDriverId: 'CR-DEMO-DRIVER',
    preferredDriverName: 'Dee Driver',
    status,
  };
}

function ride(changes: Partial<LocalRide>): LocalRide {
  return {
    id: BOOKING,
    passengerType: 'self',
    passengerName: 'Pat Passenger',
    pickupLocation: 'Home',
    destination: 'Clinic',
    purpose: 'Checkup',
    date: '2026-03-04',
    time: '09:30',
    assistance: ['Wheelchair'],
    otherAssistanceNotes: '',
    notes: '',
    emergencyContactName: 'Kim',
    emergencyContactNumber: '09170000000',
    pickupLatitude: null,
    pickupLongitude: null,
    destinationLatitude: null,
    destinationLongitude: null,
    status: 'Pending',
    createdAt: '2026-03-04T01:00:00.000Z',
    updatedAt: '2026-03-04T01:00:00.000Z',
    ...changes,
  };
}
