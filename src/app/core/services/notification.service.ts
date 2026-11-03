import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { environment } from '../../../environments/environment';
import { LocalRide } from '../models/local-ride.model';
import { AuthService } from './auth.service';
import { SupabaseBookingAdapter } from './supabase-booking.adapter';
import { SupabaseService } from './supabase.service';

const STORAGE_KEY = 'careride.local.notifications';

export type RideNotificationEvent = 'ride_request_submitted'|'ride_confirmed'|'driver_assigned'|'driver_on_the_way'|'driver_arrived'|'ride_completed'|'ride_cancelled'|'safety_alert';

export type InAppNotificationType =
  | 'booking_request'
  | 'booking_accepted'
  | 'booking_declined'
  | 'referral_received'
  | 'referral_confirmation_needed'
  | 'driver_change_confirmed'
  | 'driver_change_declined'
  | 'ride_started'
  | 'ride_completed'
  | 'booking_cancelled';

export interface InAppNotification {
  id: string;
  recipientId: string;
  type: InAppNotificationType;
  title: string;
  message: string;
  rideId: string | null;
  createdAt: string;
  read: boolean;
}

@Injectable({providedIn:'root'})
export class NotificationService {
  private readonly changed = new BehaviorSubject<void>(undefined);
  readonly changes$ = this.changed.asObservable();
  private cloudItems: InAppNotification[] | null = null;
  private readonly cloudReadIds = new Set<string>();

  constructor(
    private supabase: SupabaseService,
    private auth: AuthService,
    private cloudBookings: SupabaseBookingAdapter,
  ) {}

  listFor(recipientId: string): InAppNotification[] {
    if (environment.supabase.cloudMigration === true) {
      return (this.cloudItems ?? []).map((item) => ({
        ...item,
        read: item.read || this.cloudReadIds.has(item.id),
      }));
    }
    return this.read().filter((item) => item.recipientId === recipientId);
  }

  async refreshCloud(): Promise<void> {
    if (environment.supabase.cloudMigration !== true) {
      return;
    }
    const rows = await this.cloudBookings.listNotifications();
    const known: InAppNotificationType[] = [
      'booking_request', 'booking_accepted', 'booking_declined', 'referral_received',
      'referral_confirmation_needed', 'driver_change_confirmed', 'driver_change_declined',
      'ride_started', 'ride_completed', 'booking_cancelled',
    ];
    this.cloudItems = rows
      .filter((row): row is typeof row & { type: InAppNotificationType } =>
        known.includes(row.type as InAppNotificationType),
      )
      .map((row) => ({
        id: row.id,
        recipientId: row.recipientId,
        type: row.type,
        title: row.title,
        message: row.message,
        rideId: row.rideId,
        createdAt: row.createdAt,
        read: row.read,
      }));
    this.changed.next();
  }

  unreadCount(recipientId: string): number {
    return this.listFor(recipientId).filter((item) => !item.read).length;
  }

  async markRead(id: string, recipientId: string): Promise<void> {
    if (environment.supabase.cloudMigration === true) {
      await this.cloudBookings.markNotificationRead(id);
      this.cloudReadIds.add(id);
      this.changed.next();
      return;
    }
    const items = this.read();
    const index = items.findIndex((item) => item.id === id && item.recipientId === recipientId);
    if (index < 0 || items[index].read) {
      return;
    }
    items[index] = { ...items[index], read: true };
    this.write(items);
  }

  async markAllRead(recipientId: string): Promise<void> {
    if (environment.supabase.cloudMigration === true) {
      await this.cloudBookings.markAllNotificationsRead();
      for (const item of this.cloudItems ?? []) {
        this.cloudReadIds.add(item.id);
      }
      this.changed.next();
      return;
    }
    let changed = false;
    const items = this.read().map((item) => {
      if (item.recipientId !== recipientId || item.read) {
        return item;
      }
      changed = true;
      return { ...item, read: true };
    });
    if (changed) {
      this.write(items);
    }
  }

  bookingRequested(driverId: string, ride: LocalRide): void {
    this.record(driverId, 'booking_request', 'New booking request', `${ride.passengerName} requested a ride from ${ride.pickupLocation} to ${ride.destination}.`, ride.id);
  }

  bookingAccepted(ride: LocalRide): void {
    const passengerId = this.passengerIdFor(ride.passengerName);
    const driver = ride.driverName?.trim() || 'Your driver';
    this.record(passengerId, 'booking_accepted', 'Driver accepted', `${driver} accepted booking ${ride.id}.`, ride.id);
  }

  bookingDeclined(ride: LocalRide): void {
    const passengerId = this.passengerIdFor(ride.passengerName);
    const driver = ride.driverName?.trim() || ride.preferredDriverName?.trim() || 'The driver';
    this.record(passengerId, 'booking_declined', 'Driver declined', `${driver} declined booking ${ride.id}.`, ride.id);
  }

  referralReceived(driverId: string, ride: LocalRide): void {
    this.record(driverId, 'referral_received', 'Referral request', `A driver referred booking ${ride.id} to you.`, ride.id);
  }

  referralConfirmationNeeded(ride: LocalRide): void {
    const passengerId = this.passengerIdFor(ride.passengerName);
    const name = ride.referralProposedDriverName?.trim() || 'A replacement driver';
    this.record(passengerId, 'referral_confirmation_needed', 'Confirm driver change', `${name} accepted a referral for booking ${ride.id}. Review it on Home.`, ride.id);
  }

  driverChangeConfirmed(ride: LocalRide): void {
    const passengerId = this.passengerIdFor(ride.passengerName);
    const replacement = ride.referralProposedDriverName?.trim() || ride.driverName?.trim() || 'The replacement driver';
    this.record(passengerId, 'driver_change_confirmed', 'Driver change confirmed', `${replacement} is now the driver for booking ${ride.id}.`, ride.id);
    const originalId = ride.referralOriginalDriverId || '';
    const replacementId = ride.referralProposedDriverId || ride.driverId || '';
    if (originalId && originalId !== replacementId) {
      this.record(originalId, 'driver_change_confirmed', 'Driver change confirmed', `The passenger confirmed a new driver for booking ${ride.id}.`, ride.id);
    }
    if (replacementId) {
      this.record(replacementId, 'driver_change_confirmed', 'Driver change confirmed', `The passenger confirmed you for booking ${ride.id}.`, ride.id);
    }
  }

  driverChangeDeclined(ride: LocalRide): void {
    const originalId = ride.referralOriginalDriverId || ride.driverId || ride.preferredDriverId || '';
    const replacementId = ride.referralProposedDriverId || '';
    if (originalId) {
      this.record(originalId, 'driver_change_declined', 'Driver change declined', `The passenger declined the driver change for booking ${ride.id}.`, ride.id);
    }
    if (replacementId && replacementId !== originalId) {
      this.record(replacementId, 'driver_change_declined', 'Driver change declined', `The passenger declined the referral for booking ${ride.id}.`, ride.id);
    }
  }

  rideStarted(ride: LocalRide): void {
    this.record(this.passengerIdFor(ride.passengerName), 'ride_started', 'Ride started', `Booking ${ride.id} is now in progress.`, ride.id);
  }

  rideCompleted(ride: LocalRide): void {
    this.record(this.passengerIdFor(ride.passengerName), 'ride_completed', 'Ride completed', `Booking ${ride.id} is completed.`, ride.id);
  }

  bookingCancelled(ride: LocalRide): void {
    this.record(this.passengerIdFor(ride.passengerName), 'booking_cancelled', 'Booking cancelled', `Booking ${ride.id} was cancelled.`, ride.id);
    const driverId = ride.driverId || ride.preferredDriverId || '';
    if (driverId) {
      this.record(driverId, 'booking_cancelled', 'Booking cancelled', `Booking ${ride.id} was cancelled.`, ride.id);
    }
  }

  private record(
    recipientId: string | null,
    type: InAppNotificationType,
    title: string,
    message: string,
    rideId: string | null,
  ): void {
    if (!recipientId) {
      return;
    }
    const items = this.read();
    if (items.some((item) => item.recipientId === recipientId && item.type === type && item.rideId === rideId)) {
      return;
    }
    const created: InAppNotification = {
      id: `NT-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`.toUpperCase(),
      recipientId,
      type,
      title,
      message,
      rideId,
      createdAt: new Date().toISOString(),
      read: false,
    };
    this.write([created, ...items]);
  }

  private passengerIdFor(name: string): string | null {
    const target = name.trim().toLowerCase();
    if (!target) {
      return null;
    }
    return this.auth.listManagedAccounts().find(
      (account) => account.accountType === 'passenger' && account.fullName.trim().toLowerCase() === target,
    )?.id ?? null;
  }

  private read(): InAppNotification[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) as InAppNotification[] : [];
      return Array.isArray(parsed) ? parsed.filter((item) => item && item.id && item.recipientId) : [];
    } catch {
      return [];
    }
  }

  private write(items: InAppNotification[]): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    this.changed.next();
  }

  async notify(event: RideNotificationEvent, rideId: string): Promise<void> {
    if (!this.supabase.client) {
      return;
    }
    const { data, error } = await this.supabase.client.functions.invoke('send-ride-notification', {
      body: { event, rideId },
    });
    if (error) {
      throw new Error('The server notification function did not accept this request. No SMS delivery is confirmed.');
    }
    if (data && typeof data === 'object' && 'delivered' in data && data.delivered !== true) {
      throw new Error(
        typeof data === 'object' && data && 'error' in data && typeof data.error === 'string'
          ? data.error
          : 'SMS was not delivered.',
      );
    }
  }
}
