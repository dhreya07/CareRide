import { Injectable } from '@angular/core';
import { SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../../../environments/environment';
import { CreateLocalRideInput, LocalRide, LocalRideStatus } from '../models/local-ride.model';
import { isProfileUuid } from '../models/profile-id';
import { getSharedSupabaseClient } from './supabase-client';

export interface CloudAvailableDriver {
  id: string;
  name: string;
  phone: string;
  vehicleType: string;
  plateNumber: string;
  vehicleLabel: string;
  availability: string;
  wheelchairAccessible: boolean;
  seniorAssistance: boolean;
  rating: number | null;
  ratingCount: number;
}

export interface CloudBookingNotification {
  id: string;
  recipientId: string;
  type: string;
  title: string;
  message: string;
  rideId: string | null;
  createdAt: string;
  read: boolean;
}

const TRANSITIONS: Partial<Record<LocalRideStatus, readonly LocalRideStatus[]>> = {
  Pending: ['Driver Assigned', 'Cancelled', 'Rejected'],
  Scheduled: ['Driver Assigned', 'Cancelled', 'Rejected'],
  'Driver Assigned': ['Driver On The Way', 'Cancelled'],
  'Driver On The Way': ['Arrived'],
  Arrived: ['Picked Up'],
  'Picked Up': ['In Progress'],
  'In Progress': ['Completed'],
};

/** Same pairs as LocalRideService.canAdvance. The database enforces them again. */
export function bookingTransitionAllowed(from: LocalRideStatus, to: LocalRideStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Cloud booking operations. Nothing calls this while cloudMigration is false,
 * so localStorage rides remain the working booking store.
 */
@Injectable({ providedIn: 'root' })
export class SupabaseBookingAdapter {
  async createBooking(input: CreateLocalRideInput): Promise<LocalRide> {
    return this.rpc('create_booking', { p_booking: this.createPayload(input) });
  }

  async getBooking(bookingId: string): Promise<LocalRide | null> {
    const client = this.enabledClient();
    await this.requireSession(client);
    const { data, error } = await client
      .from('bookings')
      .select('*')
      .eq('id', this.profileId(bookingId, 'Cloud booking ids'))
      .maybeSingle();
    if (error) {
      throw new Error(this.safeMessage(error.message, 'Bookings could not be loaded.'));
    }
    return data ? this.toLocalRide(data) : null;
  }

  async listBookings(): Promise<LocalRide[]> {
    const client = this.enabledClient();
    await this.requireSession(client);
    const { data, error } = await client
      .from('bookings')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) {
      throw new Error(this.safeMessage(error.message, 'Bookings could not be loaded.'));
    }
    return (Array.isArray(data) ? data : []).map((row) => this.toLocalRide(row));
  }

  async acceptBooking(bookingId: string): Promise<LocalRide> {
    return this.rpc('accept_booking', { p_booking_id: this.profileId(bookingId, 'Cloud booking ids') });
  }

  async declineBooking(bookingId: string): Promise<LocalRide> {
    return this.rpc('decline_booking', { p_booking_id: this.profileId(bookingId, 'Cloud booking ids') });
  }

  async referBooking(bookingId: string, proposedDriverId: string): Promise<LocalRide> {
    return this.rpc('refer_booking', {
      p_booking_id: this.profileId(bookingId, 'Cloud booking ids'),
      p_proposed_driver_id: this.profileId(proposedDriverId, 'The replacement driver'),
    });
  }

  async acceptReferral(bookingId: string): Promise<LocalRide> {
    return this.rpc('accept_referral', { p_booking_id: this.profileId(bookingId, 'Cloud booking ids') });
  }

  async confirmDriverChange(bookingId: string): Promise<LocalRide> {
    return this.rpc('confirm_driver_change', { p_booking_id: this.profileId(bookingId, 'Cloud booking ids') });
  }

  async declineDriverChange(bookingId: string): Promise<LocalRide> {
    return this.rpc('decline_driver_change', { p_booking_id: this.profileId(bookingId, 'Cloud booking ids') });
  }

  async cancelBooking(bookingId: string): Promise<LocalRide> {
    return this.rpc('cancel_booking', { p_booking_id: this.profileId(bookingId, 'Cloud booking ids') });
  }

  async advanceBooking(bookingId: string, nextStatus: LocalRideStatus): Promise<LocalRide> {
    return this.rpc('advance_booking', {
      p_booking_id: this.profileId(bookingId, 'Cloud booking ids'),
      p_next_status: nextStatus,
    });
  }

  async startBooking(bookingId: string): Promise<LocalRide> {
    return this.rpc('start_booking', { p_booking_id: this.profileId(bookingId, 'Cloud booking ids') });
  }

  async completeBooking(bookingId: string): Promise<LocalRide> {
    return this.rpc('complete_booking', { p_booking_id: this.profileId(bookingId, 'Cloud booking ids') });
  }

  async rateCompletedBooking(bookingId: string, stars: number, comment: string): Promise<LocalRide> {
    return this.rpc('rate_completed_booking', {
      p_booking_id: this.profileId(bookingId, 'Cloud booking ids'),
      p_stars: stars,
      p_comment: comment,
    });
  }

  async assignBooking(bookingId: string, driverId: string): Promise<LocalRide> {
    return this.rpc('assign_booking', {
      p_booking_id: this.profileId(bookingId, 'Cloud booking ids'),
      p_driver_id: this.profileId(driverId, 'The driver'),
    });
  }

  async listAvailableDrivers(): Promise<CloudAvailableDriver[]> {
    const client = this.enabledClient();
    await this.requireSession(client);
    const { data, error } = await client.rpc('list_available_drivers');
    if (error) {
      throw new Error(this.safeMessage(error.message, 'Available drivers could not be loaded.'));
    }
    return (Array.isArray(data) ? data : []).map((row) => this.toDriver(row));
  }

  async declineReferral(bookingId: string): Promise<LocalRide> {
    return this.rpc('decline_referral', {
      p_booking_id: this.profileId(bookingId, 'Cloud booking ids'),
    });
  }

  async markNotificationRead(notificationId: string): Promise<void> {
    await this.call('mark_booking_notification_read', {
      p_notification_id: this.profileId(notificationId, 'Notification ids'),
    });
  }

  async markAllNotificationsRead(): Promise<void> {
    await this.call('mark_all_booking_notifications_read', {});
  }

  async reportSafety(bookingId: string, description: string): Promise<void> {
    const text = description.trim();
    if (!text || text.length > 2000) {
      throw new Error('Describe the safety concern in 2000 characters or less.');
    }
    await this.call('report_booking_safety', {
      p_booking_id: this.profileId(bookingId, 'Cloud booking ids'),
      p_description: text,
    });
  }

  async listNotifications(): Promise<CloudBookingNotification[]> {
    const client = this.enabledClient();
    await this.requireSession(client);
    const { data, error } = await client
      .from('booking_notifications')
      .select('id, recipient_id, booking_id, event, title, message, read, created_at')
      .order('created_at', { ascending: false });
    if (error) {
      throw new Error(this.safeMessage(error.message, 'Notifications could not be loaded.'));
    }
    return (Array.isArray(data) ? data : []).map((row) => this.toNotification(row));
  }

  async currentUserId(): Promise<string | null> {
    const client = this.enabledClient();
    const { data, error } = await client.auth.getUser();
    if (error || !data.user || !isProfileUuid(data.user.id)) {
      return null;
    }
    return data.user.id;
  }

  async setOwnAvailability(status: 'available' | 'busy' | 'offline'): Promise<void> {
    const client = this.enabledClient();
    if (status !== 'available' && status !== 'busy' && status !== 'offline') {
      throw new Error('Choose Available, Busy, or Offline.');
    }
    const userId = await this.requireSession(client);
    if (!userId) {
      throw new Error('Sign in before changing availability.');
    }
    const { error } = await client.rpc('set_driver_availability', {
      p_user_id: userId,
      p_availability: status,
    });
    if (error) {
      throw new Error(this.safeMessage(error.message, 'Availability could not be updated.'));
    }
  }

  private async rpc(fn: string, args: Record<string, unknown>): Promise<LocalRide> {
    const client = this.enabledClient();
    await this.requireSession(client);
    const { data, error } = await client.rpc(fn, args);
    if (error) {
      throw new Error(this.safeMessage(error.message, 'The booking could not be updated.'));
    }
    return this.toLocalRide(data);
  }

  private enabledClient(): SupabaseClient {
    if (environment.supabase.cloudMigration !== true) {
      throw new Error('Cloud booking is not enabled.');
    }
    return getSharedSupabaseClient();
  }

  private createPayload(input: CreateLocalRideInput): Record<string, unknown> {
    return {
      passenger_type: input.passengerType,
      passenger_name: input.passengerName,
      pickup_location: input.pickupLocation,
      destination: input.destination,
      purpose: input.purpose,
      ride_date: input.date,
      ride_time: input.time,
      assistance: input.assistance,
      other_assistance_notes: input.otherAssistanceNotes,
      notes: input.notes,
      emergency_contact_name: input.emergencyContactName,
      emergency_contact_number: input.emergencyContactNumber,
      pickup_latitude: input.pickupLatitude ?? null,
      pickup_longitude: input.pickupLongitude ?? null,
      destination_latitude: input.destinationLatitude ?? null,
      destination_longitude: input.destinationLongitude ?? null,
      preferred_driver_id: this.optionalProfileId(input.preferredDriverId, 'The preferred driver'),
      preferred_driver_name: input.preferredDriverName ?? null,
      preferred_driver_phone: input.preferredDriverPhone ?? null,
      preferred_vehicle_label: input.preferredVehicleLabel ?? null,
      preferred_driver_rating: input.preferredDriverRating ?? null,
      status: input.status ?? 'Pending',
    };
  }

  private toLocalRide(value: unknown): LocalRide {
    const row = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    const status = this.status(row['status']);
    return {
      id: this.text(row['id']),
      passengerType: row['passenger_type'] === 'family' ? 'family' : 'self',
      passengerName: this.text(row['passenger_name']),
      pickupLocation: this.text(row['pickup_location']),
      destination: this.text(row['destination']),
      purpose: this.text(row['purpose']),
      date: this.text(row['ride_date']),
      time: this.time(row['ride_time']),
      assistance: Array.isArray(row['assistance'])
        ? row['assistance'].filter((item): item is string => typeof item === 'string')
        : [],
      otherAssistanceNotes: this.text(row['other_assistance_notes']),
      notes: this.text(row['notes']),
      emergencyContactName: this.text(row['emergency_contact_name']),
      emergencyContactNumber: this.text(row['emergency_contact_number']),
      pickupLatitude: this.number(row['pickup_latitude']),
      pickupLongitude: this.number(row['pickup_longitude']),
      destinationLatitude: this.number(row['destination_latitude']),
      destinationLongitude: this.number(row['destination_longitude']),
      driverId: this.optional(row['driver_id']),
      driverName: this.optional(row['driver_name']),
      driverPhone: this.optional(row['driver_phone']),
      vehicleLabel: this.optional(row['vehicle_label']),
      driverRating: this.number(row['driver_rating']),
      preferredDriverId: this.optional(row['preferred_driver_id']),
      preferredDriverName: this.optional(row['preferred_driver_name']),
      preferredDriverPhone: this.optional(row['preferred_driver_phone']),
      preferredVehicleLabel: this.optional(row['preferred_vehicle_label']),
      preferredDriverRating: this.number(row['preferred_driver_rating']),
      clientRating: this.integer(row['client_rating']),
      clientComment: this.optional(row['client_comment']),
      ratedAt: this.optional(row['rated_at']),
      ratedByPassengerId: this.optional(row['rated_by']),
      referralStatus: this.referral(row['referral_status']),
      referralOriginalDriverId: this.optional(row['referral_original_driver_id']),
      referralProposedDriverId: this.optional(row['referral_proposed_driver_id']),
      referralProposedDriverName: this.optional(row['referral_proposed_driver_name']),
      status,
      createdAt: this.text(row['created_at']),
      updatedAt: this.text(row['updated_at']),
    };
  }

  private status(value: unknown): LocalRideStatus {
    const known: LocalRideStatus[] = [
      'Pending', 'Scheduled', 'Driver Assigned', 'Driver On The Way', 'Arrived',
      'Picked Up', 'In Progress', 'Completed', 'Cancelled', 'Rejected', 'Reported',
    ];
    return known.find((status) => status === value) ?? 'Pending';
  }

  private referral(value: unknown): LocalRide['referralStatus'] {
    if (
      value === 'pending' ||
      value === 'accepted_by_replacement' ||
      value === 'passenger_confirmed' ||
      value === 'passenger_declined'
    ) {
      return value;
    }
    return undefined;
  }

  private text(value: unknown): string {
    return typeof value === 'string' ? value : '';
  }

  private optional(value: unknown): string | null {
    return typeof value === 'string' && value ? value : null;
  }

  private number(value: unknown): number | null {
    return typeof value === 'number' ? value : null;
  }

  private integer(value: unknown): number | null {
    return typeof value === 'number' && Number.isInteger(value) ? value : null;
  }

  private time(value: unknown): string {
    const text = this.text(value);
    return text.length >= 5 ? text.slice(0, 5) : text;
  }

  private async call(fn: string, args: Record<string, unknown>): Promise<void> {
    const client = this.enabledClient();
    await this.requireSession(client);
    const { error } = await client.rpc(fn, args);
    if (error) {
      throw new Error(this.safeMessage(error.message, 'The booking could not be updated.'));
    }
  }

  private async requireSession(client: SupabaseClient): Promise<string> {
    const { data, error } = await client.auth.getUser();
    if (error || !data.user || !isProfileUuid(data.user.id)) {
      throw new Error('Sign in before continuing.');
    }
    return data.user.id;
  }

  private profileId(value: string, label: string): string {
    this.enabledClient();
    if (!isProfileUuid(value)) {
      throw new Error(`${label} must be a Supabase profile id.`);
    }
    return value;
  }

  private optionalProfileId(value: string | null | undefined, label: string): string | null {
    if (!value) {
      return null;
    }
    return this.profileId(value, label);
  }

  private toDriver(value: unknown): CloudAvailableDriver {
    const row = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    const rating = this.number(row['rating']);
    return {
      id: this.text(row['driver_id']),
      name: this.text(row['full_name']),
      phone: this.text(row['phone']),
      vehicleType: this.text(row['vehicle_type']) || 'Not provided',
      plateNumber: this.text(row['plate_number']) || 'Not provided',
      vehicleLabel: this.text(row['vehicle_label']) || 'Not provided',
      availability: this.text(row['availability']) || 'available',
      wheelchairAccessible: row['wheelchair_accessible'] === true,
      seniorAssistance: row['senior_assistance'] === true,
      rating,
      ratingCount: this.integer(row['rating_count']) ?? 0,
    };
  }

  private toNotification(value: unknown): CloudBookingNotification {
    const row = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    return {
      id: this.text(row['id']),
      recipientId: this.text(row['recipient_id']),
      type: this.text(row['event']),
      title: this.text(row['title']),
      message: this.text(row['message']),
      rideId: this.optional(row['booking_id']),
      createdAt: this.text(row['created_at']),
      read: row['read'] === true,
    };
  }

  private safeMessage(message: string, fallback: string): string {
    const text = message.trim();
    if (!text || /eyJ|bearer|sb_secret|sb_publishable|access_token|refresh_token/i.test(text)) {
      return fallback;
    }
    return text;
  }
}
