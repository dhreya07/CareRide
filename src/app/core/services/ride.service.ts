import { Injectable } from '@angular/core';
import { environment } from '../../../environments/environment';
import { CreateLocalRideInput, LocalRide, LocalRideStatus } from '../models/local-ride.model';
import { isProfileUuid } from '../models/profile-id';
import { bookingTransitionAllowed, CloudAvailableDriver, SupabaseBookingAdapter } from './supabase-booking.adapter';
import { LocalRideService } from './local-ride.service';
import { NotificationService } from './notification.service';
import { SupabaseService } from './supabase.service';

/**
 * Booking workflows. cloudMigration false keeps every action on localStorage.
 * The Supabase booking adapter is used only after that flag is turned on.
 */
@Injectable({ providedIn: 'root' })
export class RideService {
  /** Supabase auth user id while cloud bookings are on. Null while the flag is off. */
  cloudProfileId: string | null = null;

  constructor(
    private supabase: SupabaseService,
    private localRides: LocalRideService,
    private notifications: NotificationService,
    private cloudBookingsApi: SupabaseBookingAdapter,
  ) {}

  /** Older gate used by pages that only need to know the migration client exists. */
  get configured(): boolean {
    return Boolean(this.supabase.client);
  }

  /** True only when cloud booking migration is explicitly enabled. */
  get cloudBookings(): boolean {
    return environment.supabase.cloudMigration === true;
  }

  async submitPassengerRide(input: CreateLocalRideInput): Promise<LocalRide> {
    if (!this.cloudBookings) {
      const ride = this.localRides.createRide(input);
      if (ride.preferredDriverId) {
        this.notifications.bookingRequested(ride.preferredDriverId, ride);
      }
      try {
        await this.notifications.notify('ride_request_submitted', ride.id);
      } catch {
        // Ride is already saved. SMS failure must not mark the request as failed.
      }
      return ride;
    }

    if (input.preferredDriverId && !isProfileUuid(input.preferredDriverId)) {
      throw new Error('The preferred driver must be a Supabase profile id.');
    }
    const ride = await this.cloudBookingsApi.createBooking(input);
    return this.cacheCloudRide(ride);
  }

  async hydrateFromCloud(): Promise<LocalRide[]> {
    if (!this.cloudBookings) {
      return this.localRides.getRides();
    }
    const rides = await this.cloudBookingsApi.listBookings();
    this.localRides.syncCloudRides(rides);
    this.cloudProfileId = await this.cloudBookingsApi.currentUserId();
    try {
      await this.notifications.refreshCloud();
    } catch {
      // Booking rows are already cached. Notifications can load on the next visit.
    }
    return this.localRides.getRides();
  }

  async getLocalRide(id: string): Promise<LocalRide | null> {
    if (!this.cloudBookings || !isProfileUuid(id)) {
      return this.localRides.getRideById(id);
    }
    const ride = await this.cloudBookingsApi.getBooking(id);
    return ride ? this.cacheCloudRide(ride) : this.localRides.getRideById(id);
  }

  async acceptBooking(id: string): Promise<LocalRide> {
    const ride = await this.cloudBookingsApi.acceptBooking(this.requireCloudBooking(id));
    return this.cacheCloudRide(ride);
  }

  async declineBooking(id: string): Promise<LocalRide> {
    const ride = await this.cloudBookingsApi.declineBooking(this.requireCloudBooking(id));
    return this.cacheCloudRide(ride);
  }

  async referBooking(id: string, proposedDriverId: string): Promise<LocalRide> {
    const ride = await this.cloudBookingsApi.referBooking(
      this.requireCloudBooking(id),
      this.requireProfile(proposedDriverId, 'The replacement driver'),
    );
    return this.cacheCloudRide(ride);
  }

  async acceptReferral(id: string): Promise<LocalRide> {
    const ride = await this.cloudBookingsApi.acceptReferral(this.requireCloudBooking(id));
    return this.cacheCloudRide(ride);
  }

  async confirmDriverChange(id: string): Promise<LocalRide> {
    const ride = await this.cloudBookingsApi.confirmDriverChange(this.requireCloudBooking(id));
    return this.cacheCloudRide(ride);
  }

  async listAvailableDrivers(): Promise<CloudAvailableDriver[]> {
    if (!this.cloudBookings) {
      return [];
    }
    return this.cloudBookingsApi.listAvailableDrivers();
  }

  async declineReferral(id: string): Promise<LocalRide> {
    const ride = await this.cloudBookingsApi.declineReferral(this.requireCloudBooking(id));
    return this.cacheCloudRide(ride);
  }

  async declineDriverChange(id: string): Promise<LocalRide> {
    const ride = await this.cloudBookingsApi.declineDriverChange(this.requireCloudBooking(id));
    return this.cacheCloudRide(ride);
  }

  async cancelRide(id: string): Promise<LocalRide | null> {
    if (!this.cloudBookings) {
      return this.localRides.cancelRide(id);
    }
    const ride = await this.cloudBookingsApi.cancelBooking(this.requireCloudBooking(id));
    return this.cacheCloudRide(ride);
  }

  /**
   * Local admin rejection. Cloud bookings have no admin reject function;
   * the assigned driver declines, or an allowed user cancels.
   */
  async rejectRide(id: string): Promise<LocalRide | null> {
    if (!this.cloudBookings) {
      return this.localRides.rejectRide(id);
    }
    this.requireCloudBooking(id);
    throw new Error('An admin cannot reject a cloud booking. The assigned driver declines it, or the booking can be cancelled.');
  }

  async advanceUiStatus(id: string, nextStatus: LocalRideStatus): Promise<LocalRide | null> {
    if (!this.cloudBookings) {
      return this.localRides.advanceRide(id, nextStatus);
    }
    const current = this.localRides.getRideById(id);
    if (current && !bookingTransitionAllowed(current.status, nextStatus)) {
      return null;
    }
    const ride = await this.cloudBookingsApi.advanceBooking(this.requireCloudBooking(id), nextStatus);
    return this.cacheCloudRide(ride);
  }

  async startBooking(id: string): Promise<LocalRide> {
    const ride = await this.cloudBookingsApi.startBooking(this.requireCloudBooking(id));
    return this.cacheCloudRide(ride);
  }

  async completeBooking(id: string): Promise<LocalRide> {
    const ride = await this.cloudBookingsApi.completeBooking(this.requireCloudBooking(id));
    return this.cacheCloudRide(ride);
  }

  async rateBooking(id: string, stars: number, comment: string): Promise<LocalRide> {
    const ride = await this.cloudBookingsApi.rateCompletedBooking(this.requireCloudBooking(id), stars, comment);
    return this.cacheCloudRide(ride);
  }

  async assignBooking(id: string, driverId: string): Promise<LocalRide> {
    const ride = await this.cloudBookingsApi.assignBooking(
      this.requireCloudBooking(id),
      this.requireProfile(driverId, 'The driver'),
    );
    return this.cacheCloudRide(ride);
  }

  async setOwnAvailability(status: 'available' | 'busy' | 'offline'): Promise<void> {
    if (!this.cloudBookings) {
      throw new Error('Cloud driver availability is not enabled.');
    }
    await this.cloudBookingsApi.setOwnAvailability(status);
  }

  async reportIssue(rideId: string, description: string): Promise<void> {
    if (!this.cloudBookings) {
      return;
    }
    await this.cloudBookingsApi.reportSafety(this.requireCloudBooking(rideId), description);
  }

  private requireProfile(id: string, label: string): string {
    if (!isProfileUuid(id)) {
      throw new Error(`${label} must be a Supabase profile id.`);
    }
    return id;
  }

  private requireCloudBooking(id: string): string {
    if (!this.cloudBookings) {
      throw new Error('Cloud booking is not enabled.');
    }
    if (!isProfileUuid(id)) {
      throw new Error('This on-device booking is not a cloud booking.');
    }
    return id;
  }

  private async cacheCloudRide(ride: LocalRide): Promise<LocalRide> {
    this.localRides.saveRide(ride);
    try {
      await this.notifications.refreshCloud();
    } catch {
      // The booking change is saved. Notification refresh can retry.
    }
    return ride;
  }
}
