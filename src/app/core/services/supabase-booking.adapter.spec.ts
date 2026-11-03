import { TestBed } from '@angular/core/testing';
import { createClient } from '@supabase/supabase-js';
import { environment } from '../../../environments/environment';
import { CreateLocalRideInput, LocalRide } from '../models/local-ride.model';
import { LocalRideService } from './local-ride.service';
import { bookingTransitionAllowed, SupabaseBookingAdapter } from './supabase-booking.adapter';
import { resetSharedSupabaseClient } from './supabase-client';

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(),
}));

const BOOKING_ID = '11111111-1111-4111-8111-111111111111';
const DRIVER_ID = '22222222-2222-4222-8222-222222222222';

describe('Supabase booking foundation', () => {
  let rpc: ReturnType<typeof vi.fn>;
  let from: ReturnType<typeof vi.fn>;
  let getUser: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetSharedSupabaseClient();
    environment.supabase.cloudMigration = false;
    environment.supabase.cloudAuthEnabled = false;
    localStorage.clear();
    rpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
      if (fn === 'assign_booking') {
        return { data: null, error: { message: 'Only an approved admin can assign a booking eyJsecret' } };
      }
      return { data: storedRide(fn, args), error: null };
    });
    from = vi.fn(() => ({
      select: () => ({
        order: async () => ({ data: [storedRide('list', {})], error: null }),
      }),
    }));
    getUser = vi.fn(async () => ({ data: { user: { id: DRIVER_ID } }, error: null }));
    vi.mocked(createClient).mockReset();
    vi.mocked(createClient).mockReturnValue({ rpc, from, auth: { getUser } } as never);
    vi.stubGlobal('fetch', vi.fn(() => {
      throw new Error('Live network is not allowed in this test.');
    }));
    TestBed.resetTestingModule();
  });

  afterEach(() => {
    environment.supabase.cloudMigration = false;
    environment.supabase.cloudAuthEnabled = false;
    localStorage.clear();
    vi.unstubAllGlobals();
    TestBed.resetTestingModule();
  });

  it('keeps a new localStorage ride when cloud booking is off', () => {
    const rides = TestBed.inject(LocalRideService);
    const ride = rides.createRide(sampleInput('Pending'));

    expect(ride.id.startsWith('CR-')).toBe(true);
    expect(ride.status).toBe('Pending');
    expect(localStorage.getItem('careride.local.rides')).toContain(ride.passengerName);
    expect(createClient).not.toHaveBeenCalled();
  });

  it('refuses a local preferred-driver id before calling Supabase', async () => {
    environment.supabase.cloudMigration = true;
    const adapter = TestBed.inject(SupabaseBookingAdapter);

    await expect(adapter.createBooking({
      ...sampleInput('Pending'),
      preferredDriverId: 'CR-DEMO-DRIVER',
    })).rejects.toThrow('The preferred driver must be a Supabase profile id.');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('does not send a booking request without a Supabase session', async () => {
    environment.supabase.cloudMigration = true;
    getUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    const adapter = TestBed.inject(SupabaseBookingAdapter);

    await expect(adapter.createBooking(sampleInput('Pending'))).rejects.toThrow('Sign in before continuing.');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('does not call Supabase while cloud booking is off', async () => {
    const adapter = TestBed.inject(SupabaseBookingAdapter);

    await expect(adapter.createBooking(sampleInput('Pending'))).rejects.toThrow('Cloud booking is not enabled.');
    await expect(adapter.listBookings()).rejects.toThrow('Cloud booking is not enabled.');
    expect(createClient).not.toHaveBeenCalled();
    expect(localStorage.getItem('careride.local.rides')).toBeNull();
  });

  it('creates an immediate ride and a scheduled ride through create_booking', async () => {
    environment.supabase.cloudMigration = true;
    const adapter = TestBed.inject(SupabaseBookingAdapter);

    const immediate = await adapter.createBooking(sampleInput('Pending'));
    const scheduled = await adapter.createBooking(sampleInput('Scheduled'));

    expect(immediate.status).toBe('Pending');
    expect(scheduled.status).toBe('Scheduled');
    expect(rpc).toHaveBeenNthCalledWith(1, 'create_booking', {
      p_booking: expect.objectContaining({
        status: 'Pending',
        pickup_location: 'Home',
        preferred_driver_id: DRIVER_ID,
      }),
    });
    expect(rpc).toHaveBeenNthCalledWith(2, 'create_booking', {
      p_booking: expect.objectContaining({ status: 'Scheduled', ride_date: '2026-03-04' }),
    });
  });

  it('accepts, declines, refers, cancels, and advances only through the booking functions', async () => {
    environment.supabase.cloudMigration = true;
    const adapter = TestBed.inject(SupabaseBookingAdapter);

    expect((await adapter.acceptBooking(BOOKING_ID)).status).toBe('Driver Assigned');
    expect((await adapter.declineBooking(BOOKING_ID)).status).toBe('Rejected');
    expect((await adapter.referBooking(BOOKING_ID, DRIVER_ID)).referralStatus).toBe('pending');
    expect((await adapter.acceptReferral(BOOKING_ID)).referralStatus).toBe('accepted_by_replacement');
    expect((await adapter.cancelBooking(BOOKING_ID)).status).toBe('Cancelled');
    expect((await adapter.advanceBooking(BOOKING_ID, 'Driver On The Way')).status).toBe('Driver On The Way');
    expect((await adapter.startBooking(BOOKING_ID)).status).toBe('In Progress');
    expect((await adapter.completeBooking(BOOKING_ID)).status).toBe('Completed');
    expect((await adapter.rateCompletedBooking(BOOKING_ID, 5, 'Careful ride')).clientRating).toBe(5);

    expect(rpc.mock.calls.map((call) => call[0])).toEqual([
      'accept_booking',
      'decline_booking',
      'refer_booking',
      'accept_referral',
      'cancel_booking',
      'advance_booking',
      'start_booking',
      'complete_booking',
      'rate_completed_booking',
    ]);
  });

  it('allows the local status transitions and rejects an invalid one', () => {
    expect(bookingTransitionAllowed('Pending', 'Driver Assigned')).toBe(true);
    expect(bookingTransitionAllowed('Scheduled', 'Rejected')).toBe(true);
    expect(bookingTransitionAllowed('Driver Assigned', 'Cancelled')).toBe(true);
    expect(bookingTransitionAllowed('Driver On The Way', 'Arrived')).toBe(true);
    expect(bookingTransitionAllowed('Arrived', 'Picked Up')).toBe(true);
    expect(bookingTransitionAllowed('Picked Up', 'In Progress')).toBe(true);
    expect(bookingTransitionAllowed('In Progress', 'Completed')).toBe(true);
    expect(bookingTransitionAllowed('Pending', 'Completed')).toBe(false);
    expect(bookingTransitionAllowed('Completed', 'Cancelled')).toBe(false);
    expect(bookingTransitionAllowed('Cancelled', 'Driver Assigned')).toBe(false);
  });

  it('lets an admin read monitored bookings and hides an unauthorized assignment error', async () => {
    environment.supabase.cloudMigration = true;
    const adapter = TestBed.inject(SupabaseBookingAdapter);

    const rows = await adapter.listBookings();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(BOOKING_ID);
    expect(from).toHaveBeenCalledWith('bookings');

    await expect(adapter.assignBooking(BOOKING_ID, DRIVER_ID)).rejects.toThrow(
      'The booking could not be updated.',
    );
    expect(localStorage.getItem('careride.local.rides')).toBeNull();
  });

  it('reports a Supabase failure without returning its raw text', async () => {
    environment.supabase.cloudMigration = true;
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'connection failed eyJsecret' } });
    const adapter = TestBed.inject(SupabaseBookingAdapter);

    await expect(adapter.listBookings()).resolves.toHaveLength(1);
    await expect(adapter.cancelBooking(BOOKING_ID)).rejects.toThrow('The booking could not be updated.');
  });
});

function sampleInput(status: 'Pending' | 'Scheduled'): CreateLocalRideInput {
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
    preferredDriverId: DRIVER_ID,
    preferredDriverName: 'Dee Driver',
    status,
  };
}

function storedRide(fn: string, args: Record<string, unknown>): Record<string, unknown> {
  const payload = args['p_booking'] as Record<string, unknown> | undefined;
  const status = fn === 'accept_booking' || fn === 'advance_booking' && args['p_next_status']
    ? (fn === 'accept_booking' ? 'Driver Assigned' : args['p_next_status'])
    : fn === 'decline_booking'
      ? 'Rejected'
      : fn === 'cancel_booking'
        ? 'Cancelled'
        : fn === 'start_booking'
          ? 'In Progress'
          : fn === 'complete_booking' || fn === 'rate_completed_booking'
            ? 'Completed'
            : payload?.['status'] ?? 'Pending';
  return {
    id: BOOKING_ID,
    passenger_type: 'self',
    passenger_name: 'Pat Passenger',
    pickup_location: 'Home',
    destination: 'Clinic',
    purpose: 'Checkup',
    ride_date: payload?.['ride_date'] ?? '2026-03-04',
    ride_time: '09:30:00',
    assistance: ['Wheelchair'],
    other_assistance_notes: '',
    notes: '',
    emergency_contact_name: 'Kim',
    emergency_contact_number: '09170000000',
    preferred_driver_id: DRIVER_ID,
    status,
    referral_status: fn === 'refer_booking'
      ? 'pending'
      : fn === 'accept_referral'
        ? 'accepted_by_replacement'
        : null,
    referral_proposed_driver_id: fn === 'refer_booking' ? DRIVER_ID : null,
    client_rating: fn === 'rate_completed_booking' ? args['p_stars'] : null,
    created_at: '2026-03-04T01:00:00.000Z',
    updated_at: '2026-03-04T01:00:00.000Z',
  };
}
