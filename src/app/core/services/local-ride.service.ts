import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { AuthService } from './auth.service';
import { NotificationService } from './notification.service';
import {
  ACTIVE_RIDE_STATUSES,
  CANCELLABLE_RIDE_STATUSES,
  CreateLocalRideInput,
  DRIVER_QUEUE_STATUSES,
  LocalDriverOption,
  LocalRide,
  LocalRideStatus,
} from '../models/local-ride.model';

const STORAGE_KEY = 'careride.local.rides';

export interface RideProgressStep {
  label: string;
  state: 'done' | 'current' | 'upcoming';
  text: string;
}

export interface RideProgress {
  terminal: 'Cancelled' | 'Declined' | 'Reported' | null;
  steps: RideProgressStep[];
}

@Injectable({ providedIn: 'root' })
export class LocalRideService {
  constructor(
    private auth: AuthService,
    private notifications: NotificationService,
  ) {}

  private readonly ridesSubject = new BehaviorSubject<LocalRide[]>(this.readFromStorage());
  readonly rides$ = this.ridesSubject.asObservable();

  getRides(): LocalRide[] {
    return [...this.ridesSubject.value];
  }

  reloadFromStorage(): LocalRide[] {
    const rides = this.readFromStorage();
    this.ridesSubject.next(rides);
    return [...rides];
  }

  syncCloudRides(cloudRides: LocalRide[]): void {
    const localOnly = this.getRides().filter((ride) => !this.looksLikeUuid(ride.id));
    this.writeRides([...cloudRides, ...localOnly]);
  }

  private looksLikeUuid(id: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
  }

  getScheduledRides(): LocalRide[] {
    return this.getRides()
      .filter((ride) => ACTIVE_RIDE_STATUSES.includes(ride.status))
      .sort((a, b) => this.compareSchedule(a, b));
  }

  getRideById(id: string): LocalRide | null {
    return this.getRides().find((ride) => ride.id === id) ?? null;
  }

  rideTimingLabel(ride: LocalRide): 'Immediate' | 'Scheduled' {
    if (ride.status === 'Scheduled') {
      return 'Scheduled';
    }
    if (ride.status === 'Pending') {
      return 'Immediate';
    }
    const pickupDay = /^(\d{4}-\d{2}-\d{2})/.exec(ride.date)?.[1];
    const createdDay = /^(\d{4}-\d{2}-\d{2})/.exec(ride.createdAt)?.[1];
    if (pickupDay && createdDay && pickupDay > createdDay) {
      return 'Scheduled';
    }
    return 'Immediate';
  }

  assignedDriverLabel(ride: LocalRide): string {
    if (!this.hasAssignedDriver(ride)) {
      return 'Not assigned';
    }
    return ride.driverName?.trim() || 'Not assigned';
  }

  assignedVehicleLabel(ride: LocalRide): string {
    if (!this.hasAssignedDriver(ride)) {
      return 'Not provided';
    }
    return this.driverAccount(ride.driverId)?.vehicleType?.trim() || this.vehiclePart(ride.vehicleLabel, 0);
  }

  assignedPlateLabel(ride: LocalRide): string {
    if (!this.hasAssignedDriver(ride)) {
      return 'Not provided';
    }
    return this.driverAccount(ride.driverId)?.plateNumber?.trim() || this.vehiclePart(ride.vehicleLabel, 1);
  }

  rideProgress(ride: LocalRide): RideProgress {
    const labels = ['Pending', 'Confirmed', 'Ongoing', 'Completed'];
    if (ride.status === 'Cancelled' || ride.status === 'Rejected' || ride.status === 'Reported') {
      return {
        terminal: ride.status === 'Rejected' ? 'Declined' : ride.status === 'Reported' ? 'Reported' : 'Cancelled',
        steps: labels.map((label) => ({ label, state: 'upcoming', text: 'Not completed' })),
      };
    }
    const current = ride.status === 'Completed'
      ? 3
      : ride.status === 'Driver Assigned'
        ? 1
        : ['Driver On The Way', 'Arrived', 'Picked Up', 'In Progress'].includes(ride.status)
          ? 2
          : 0;
    return {
      terminal: null,
      steps: labels.map((label, index) => ({
        label,
        state: index < current ? 'done' : index === current ? 'current' : 'upcoming',
        text: index < current ? 'Done' : index === current ? (index === 2 ? ride.status : 'Current') : 'Not yet',
      })),
    };
  }

  hasSamePickupReservation(driverId: string, ride: LocalRide): boolean {
    const pickup = this.pickupKey(ride);
    if (!pickup) {
      return false;
    }
    const reserving = ['Driver Assigned', 'Driver On The Way', 'Arrived', 'Picked Up', 'In Progress'];
    return this.getRides().some((other) =>
      other.id !== ride.id &&
      other.driverId === driverId &&
      reserving.includes(other.status) &&
      this.pickupKey(other) === pickup,
    );
  }

  private driverAccount(driverId: string | null | undefined) {
    if (!driverId) {
      return null;
    }
    return this.auth.listManagedAccounts().find((account) => account.id === driverId) ?? null;
  }

  private vehiclePart(label: string | null | undefined, index: number): string {
    const parts = (label || '').split('·').map((part) => part.trim()).filter(Boolean);
    if (parts.length > 1) {
      return parts[index] || 'Not provided';
    }
    return index === 0 && parts[0] ? parts[0] : 'Not provided';
  }

  private pickupKey(ride: LocalRide): string | null {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ride.date || '') || !/^\d{2}:\d{2}/.test(ride.time || '')) {
      return null;
    }
    return `${ride.date}T${ride.time.slice(0, 5)}`;
  }

  getUpcomingRide(): LocalRide | null {
    return this.getScheduledRides()[0] ?? null;
  }

  getHistoryRides(): LocalRide[] {
    return this.getRides()
      .filter((ride) => !ACTIVE_RIDE_STATUSES.includes(ride.status))
      .sort((a, b) => this.compareSchedule(b, a));
  }

  getDriverQueueRides(): LocalRide[] {
    return this.getRides()
      .filter((ride) => this.isDriverQueueRide(ride))
      .sort((a, b) => this.compareSchedule(a, b));
  }

  getDriverHistoryRides(): LocalRide[] {
    return this.getRides()
      .filter((ride) => this.hasAssignedDriver(ride) && !this.isDriverQueueRide(ride))
      .sort((a, b) => this.compareSchedule(b, a));
  }

  getDriverClientReviews(driverId?: string): LocalRide[] {
    return this.getRides()
      .filter((ride) => ride.status === 'Completed' && (!driverId || this.rideBelongsToDriver(ride, driverId)))
      .sort((a, b) => this.compareSchedule(b, a));
  }

  rateCompletedRide(
    id: string,
    stars: number,
    comment: string,
    passenger: { id: string; fullName: string },
  ): LocalRide | null {
    this.reloadFromStorage();
    const ride = this.getRideById(id);
    const notes = comment.trim();
    const passengerName = passenger.fullName.trim().toLowerCase();
    if (!ride || !passenger.id.trim() || !passengerName) {
      return null;
    }
    if (ride.status !== 'Completed' || !ride.driverId || ride.clientRating) {
      return null;
    }
    if (ride.passengerName.trim().toLowerCase() !== passengerName) {
      return null;
    }
    if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
      return null;
    }
    return this.updateRide(id, {
      clientRating: stars,
      clientComment: notes || null,
      ratedAt: new Date().toISOString(),
      ratedByPassengerId: passenger.id,
    });
  }

  driverRatingSummary(driverId: string): string {
    const reviews = this.getRides().filter((ride) =>
      ride.driverId === driverId &&
      ride.status === 'Completed' &&
      Number.isInteger(ride.clientRating) &&
      (ride.clientRating ?? 0) >= 1 &&
      (ride.clientRating ?? 0) <= 5,
    );
    if (!reviews.length) {
      return 'Not yet rated';
    }
    const total = reviews.reduce((sum, ride) => sum + (ride.clientRating ?? 0), 0);
    const average = Math.round((total / reviews.length) * 10) / 10;
    const label = reviews.length === 1 ? 'review' : 'reviews';
    return `${average.toFixed(1)} ★ · ${reviews.length} ${label}`;
  }

  getUnratedCompletedRides(): LocalRide[] {
    return this.getHistoryRides().filter(
      (ride) => ride.status === 'Completed' && !ride.clientRating && Boolean(ride.driverId),
    );
  }

  getDriverScheduleRides(driverId?: string): LocalRide[] {
    return this.getRides()
      .filter((ride) => ACTIVE_RIDE_STATUSES.includes(ride.status))
      .filter((ride) => {
        if (!driverId) {
          return Boolean(ride.driverId || ride.preferredDriverId) || this.isDriverQueueRide(ride);
        }
        return this.rideBelongsToDriver(ride, driverId);
      })
      .sort((a, b) => this.compareSchedule(a, b));
  }

  rideBelongsToDriver(ride: LocalRide, driverId: string): boolean {
    return ride.driverId === driverId || ride.preferredDriverId === driverId;
  }

  isDriverQueueRide(ride: LocalRide): boolean {
    if (DRIVER_QUEUE_STATUSES.includes(ride.status)) {
      return true;
    }
    return this.hasAssignedDriver(ride) && ACTIVE_RIDE_STATUSES.includes(ride.status);
  }

  assistanceSummary(ride: LocalRide): string {
    if (!ride.assistance?.length) {
      return 'None selected';
    }
    return ride.assistance.join(', ');
  }

  formatDate(date: string): string {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
    if (!match) {
      return date;
    }
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const parsed = new Date(year, month - 1, day);
    if (Number.isNaN(parsed.getTime())) {
      return date;
    }
    return parsed.toLocaleDateString('en-PH', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  }

  formatTime(time: string): string {
    const match = /^(\d{1,2}):(\d{2})/.exec(time);
    if (!match) {
      return time;
    }
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour > 23 || minute > 59) {
      return time;
    }
    const suffix = hour >= 12 ? 'PM' : 'AM';
    const hour12 = hour % 12 || 12;
    return `${hour12}:${String(minute).padStart(2, '0')} ${suffix}`;
  }

  createRide(input: CreateLocalRideInput): LocalRide {
    const now = new Date().toISOString();
    const ride: LocalRide = {
      ...input,
      pickupLatitude: input.pickupLatitude ?? null,
      pickupLongitude: input.pickupLongitude ?? null,
      destinationLatitude: input.destinationLatitude ?? null,
      destinationLongitude: input.destinationLongitude ?? null,
      id: this.createId(),
      status: input.status ?? 'Pending',
      createdAt: now,
      updatedAt: now,
    };

    this.writeRides([ride, ...this.getRides()]);
    return ride;
  }

  saveRide(ride: LocalRide): LocalRide {
    const rides = this.getRides().filter((item) => item.id !== ride.id);
    this.writeRides([ride, ...rides]);
    return ride;
  }

  updateRide(id: string, changes: Partial<Omit<LocalRide, 'id' | 'createdAt'>>): LocalRide | null {
    const rides = this.getRides();
    const index = rides.findIndex((ride) => ride.id === id);
    if (index < 0) {
      return null;
    }

    const previous = rides[index];
    const updated: LocalRide = {
      ...previous,
      ...changes,
      id: previous.id,
      createdAt: previous.createdAt,
      updatedAt: new Date().toISOString(),
    };
    rides[index] = updated;
    this.writeRides(rides);
    if (
      updated.referralStatus === 'accepted_by_replacement' &&
      previous.referralStatus !== 'accepted_by_replacement'
    ) {
      this.notifications.referralConfirmationNeeded(updated);
    }
    return updated;
  }

  cancelRide(id: string): LocalRide | null {
    this.reloadFromStorage();
    const ride = this.getRideById(id);
    if (!ride || !CANCELLABLE_RIDE_STATUSES.includes(ride.status)) {
      return null;
    }
    const updated = this.updateRide(id, { status: 'Cancelled' });
    if (updated) {
      this.notifications.bookingCancelled(updated);
    }
    return updated;
  }

  canCancel(ride: LocalRide): boolean {
    return CANCELLABLE_RIDE_STATUSES.includes(ride.status);
  }

  rejectRide(id: string): LocalRide | null {
    const ride = this.getRideById(id);
    if (!ride || (ride.status !== 'Pending' && ride.status !== 'Scheduled')) {
      return null;
    }
    return this.updateRide(id, { status: 'Rejected' });
  }

  canAdvance(from: LocalRideStatus, to: LocalRideStatus): boolean {
    const allowed: Partial<Record<LocalRideStatus, LocalRideStatus[]>> = {
      Pending: ['Driver Assigned', 'Cancelled', 'Rejected'],
      Scheduled: ['Driver Assigned', 'Cancelled', 'Rejected'],
      'Driver Assigned': ['Driver On The Way', 'Cancelled'],
      'Driver On The Way': ['Arrived'],
      Arrived: ['Picked Up'],
      'Picked Up': ['In Progress'],
      'In Progress': ['Completed'],
    };
    return allowed[from]?.includes(to) ?? false;
  }

  isOngoingStatus(status: LocalRideStatus): boolean {
    return ['Driver On The Way', 'Arrived', 'Picked Up', 'In Progress'].includes(status);
  }

  hasOngoingRide(driverId: string, exceptRideId?: string): boolean {
    return this.getRides().some((ride) =>
      ride.id !== exceptRideId &&
      ride.driverId === driverId &&
      this.isOngoingStatus(ride.status),
    );
  }

  startRide(id: string, driverId: string): { ride: LocalRide | null; reason: string | null } {
    this.reloadFromStorage();
    const ride = this.getRideById(id);
    if (!ride) {
      return { ride: null, reason: 'This booking is no longer available.' };
    }
    if (ride.driverId !== driverId) {
      return { ride: null, reason: 'Only the assigned driver can start this ride.' };
    }
    if (ride.status !== 'Driver Assigned') {
      return { ride: null, reason: 'Only a confirmed booking can be started.' };
    }
    if (ride.referralStatus === 'pending' || ride.referralStatus === 'accepted_by_replacement') {
      return { ride: null, reason: 'This booking has a driver change that is not finished. It was not started.' };
    }
    if (this.hasOngoingRide(driverId, ride.id)) {
      return { ride: null, reason: 'You already have a ride in progress. Finish that ride before starting another.' };
    }
    const updated = this.updateRide(id, { status: 'In Progress' });
    if (!updated) {
      return { ride: null, reason: 'The ride could not be started.' };
    }
    this.notifications.rideStarted(updated);
    return { ride: updated, reason: null };
  }

  completeRide(id: string, driverId: string): { ride: LocalRide | null; reason: string | null } {
    this.reloadFromStorage();
    const ride = this.getRideById(id);
    if (!ride) {
      return { ride: null, reason: 'This booking is no longer available.' };
    }
    if (ride.driverId !== driverId) {
      return { ride: null, reason: 'Only the assigned driver can complete this ride.' };
    }
    if (ride.status === 'Completed') {
      return { ride: null, reason: 'This ride is already completed.' };
    }
    if (!this.isOngoingStatus(ride.status)) {
      return { ride: null, reason: 'Start the ride before completing it.' };
    }
    const updated = this.updateRide(id, { status: 'Completed' });
    if (!updated) {
      return { ride: null, reason: 'The ride could not be completed.' };
    }
    this.notifications.rideCompleted(updated);
    return { ride: updated, reason: null };
  }

  advanceRide(id: string, nextStatus: LocalRideStatus): LocalRide | null {
    const ride = this.getRideById(id);
    if (!ride || !this.canAdvance(ride.status, nextStatus)) {
      return null;
    }
    return this.updateRide(id, { status: nextStatus });
  }

  formatStatus(status: LocalRideStatus): string {
    return status;
  }

  hasAssignedDriver(ride: LocalRide): boolean {
    return Boolean(ride.driverId || ride.driverName || ride.vehicleLabel) ||
      DRIVER_QUEUE_STATUSES.includes(ride.status);
  }

  driverLocationTitle(ride: LocalRide): string {
    switch (ride.status) {
      case 'Driver On The Way':
        return 'En route to pickup';
      case 'Arrived':
        return 'At pickup location';
      case 'Picked Up':
      case 'In Progress':
        return 'En route to destination';
      case 'Completed':
        return 'Last stop · destination';
      default:
        return 'Assigned · heading to pickup';
    }
  }

  driverLocationDetail(ride: LocalRide): string {
    if (ride.status === 'Picked Up' || ride.status === 'In Progress' || ride.status === 'Completed') {
      return ride.destination;
    }
    return ride.pickupLocation;
  }

  driverCoordinates(ride: LocalRide): { latitude: number; longitude: number } | null {
    const pickupLat = ride.pickupLatitude;
    const pickupLng = ride.pickupLongitude;
    const destLat = ride.destinationLatitude;
    const destLng = ride.destinationLongitude;
    const hasPickup = pickupLat !== null && pickupLat !== undefined && pickupLng !== null && pickupLng !== undefined;
    const hasDest = destLat !== null && destLat !== undefined && destLng !== null && destLng !== undefined;

    if (!hasPickup && !hasDest) {
      return null;
    }

    const pickup = {
      latitude: hasPickup ? pickupLat : destLat as number,
      longitude: hasPickup ? pickupLng : destLng as number,
    };
    const destination = {
      latitude: hasDest ? destLat as number : pickup.latitude,
      longitude: hasDest ? destLng as number : pickup.longitude,
    };
    const approach = {
      latitude: pickup.latitude + 0.016,
      longitude: pickup.longitude + 0.012,
    };

    switch (ride.status) {
      case 'Driver On The Way':
        return this.lerpPoint(approach, pickup, 0.55);
      case 'Arrived':
        return pickup;
      case 'Picked Up':
      case 'In Progress':
        return this.lerpPoint(pickup, destination, 0.45);
      case 'Completed':
        return destination;
      default:
        return approach;
    }
  }

  private lerpPoint(
    from: { latitude: number; longitude: number },
    to: { latitude: number; longitude: number },
    amount: number,
  ): { latitude: number; longitude: number } {
    return {
      latitude: from.latitude + (to.latitude - from.latitude) * amount,
      longitude: from.longitude + (to.longitude - from.longitude) * amount,
    };
  }

  driverMapsUrl(ride: LocalRide): string {
    const coords = this.driverCoordinates(ride);
    if (coords) {
      return `https://www.google.com/maps?q=${coords.latitude},${coords.longitude}`;
    }
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(this.driverLocationDetail(ride))}`;
  }

  driverMapEmbedUrl(ride: LocalRide): string {
    const coords = this.driverCoordinates(ride);
    if (coords) {
      return `https://maps.google.com/maps?q=${coords.latitude},${coords.longitude}&z=15&output=embed`;
    }
    return `https://maps.google.com/maps?q=${encodeURIComponent(this.driverLocationDetail(ride))}&z=14&output=embed`;
  }

  localDemoDriver(): LocalDriverOption {
    return this.getDriverRoster().find((driver) => driver.driverId === 'CR-DEMO-DRIVER') ?? this.getDriverRoster()[0];
  }

  getDriverRoster(date?: string, time?: string): LocalDriverOption[] {
    const slot = this.slotStart(date, time);
    const roster: LocalDriverOption[] = [
      {
        driverId: 'CR-DEMO-DRIVER',
        driverName: 'CareRide Driver',
        driverPhone: '09170000002',
        vehicleId: 'CR-VAN-001',
        vehicleLabel: 'Accessible van · CR-001',
        rating: 4.9,
        ratingCount: 128,
        available: !this.isDriverBusyAt('CR-DEMO-DRIVER', slot),
      },
      {
        driverId: 'CR-DEMO-DRIVER-2',
        driverName: 'Elena Santos',
        driverPhone: '09170000012',
        vehicleId: 'CR-VAN-002',
        vehicleLabel: 'Accessible van · CR-002',
        rating: 4.7,
        ratingCount: 86,
        available: !this.isDriverBusyAt('CR-DEMO-DRIVER-2', slot),
      },
      {
        driverId: 'CR-DEMO-DRIVER-3',
        driverName: 'Marco Reyes',
        driverPhone: '09170000013',
        vehicleId: 'CR-SEDAN-003',
        vehicleLabel: 'Sedan · CR-003',
        rating: 4.5,
        ratingCount: 54,
        available: !this.isDriverBusyAt('CR-DEMO-DRIVER-3', slot),
      },
    ];
    for (const driver of this.auth.listApprovedDrivers()) {
      if (roster.some((item) => item.driverId === driver.id)) {
        continue;
      }
      roster.push({
        driverId: driver.id,
        driverName: driver.fullName,
        driverPhone: driver.phone,
        vehicleId: driver.id,
        vehicleLabel: 'Community vehicle',
        rating: 0,
        ratingCount: 0,
        available: !this.isDriverBusyAt(driver.id, slot),
      });
    }
    return roster.map((driver) => this.withLiveRating(driver));
  }

  private withLiveRating(driver: LocalDriverOption): LocalDriverOption {
    const reviews = this.getDriverClientReviews(driver.driverId).filter(
      (ride) => typeof ride.clientRating === 'number',
    );
    if (!reviews.length) {
      return driver;
    }
    const total = reviews.reduce((sum, ride) => sum + (ride.clientRating ?? 0), 0);
    return {
      ...driver,
      rating: Math.round((total / reviews.length) * 10) / 10,
      ratingCount: reviews.length,
    };
  }

  getAvailableDrivers(date?: string, time?: string): LocalDriverOption[] {
    return this.getDriverRoster(date, time).filter((driver) => driver.available);
  }

  getDriverActiveRide(driverId: string): LocalRide | null {
    return this.getRides()
      .filter((ride) => this.rideBelongsToDriver(ride, driverId) && this.isDriverQueueRide(ride))
      .sort((a, b) => this.compareSchedule(a, b))[0] ?? null;
  }

  findDriver(driverId: string | null | undefined, date?: string, time?: string): LocalDriverOption | null {
    if (!driverId) {
      return null;
    }
    return this.getDriverRoster(date, time).find((driver) => driver.driverId === driverId) ?? null;
  }

  isDriverBusyAt(driverId: string, slotMs: number | null): boolean {
    const windowMs = 90 * 60 * 1000;
    return this.getRides().some((ride) => {
      if (!ACTIVE_RIDE_STATUSES.includes(ride.status)) {
        return false;
      }
      const assignedToDriver = ride.driverId === driverId;
      const preferredByPassenger = ride.preferredDriverId === driverId && !ride.driverId;
      if (!assignedToDriver && !preferredByPassenger) {
        return false;
      }
      const rideStart = this.slotStart(ride.date, ride.time);
      if (rideStart === null || slotMs === null) {
        return DRIVER_QUEUE_STATUSES.includes(ride.status);
      }
      return slotMs < rideStart + windowMs && slotMs + windowMs > rideStart;
    });
  }

  private slotStart(date?: string, time?: string): number | null {
    if (!date || !time) {
      return Date.now();
    }
    const parsed = new Date(`${date}T${time}`);
    return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
  }

  ratingLabel(rating: number, count?: number): string {
    const stars = `${rating.toFixed(1)} ★`;
    if (!count) {
      return stars;
    }
    return `${stars} · ${count} trips`;
  }

  statusTone(status: LocalRideStatus): 'pending' | 'active' | 'completed' | 'cancelled' {
    if (status === 'Cancelled' || status === 'Rejected' || status === 'Reported') {
      return 'cancelled';
    }
    if (status === 'Completed') {
      return 'completed';
    }
    if (status === 'Pending' || status === 'Scheduled') {
      return 'pending';
    }
    return 'active';
  }

  private compareSchedule(a: LocalRide, b: LocalRide): number {
    return `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`);
  }

  private createId(): string {
    return `CR-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`.toUpperCase();
  }

  private readFromStorage(): LocalRide[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return [];
      }
      const parsed = JSON.parse(raw) as LocalRide[];
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed.map((ride) => ({
        ...ride,
        pickupLatitude: ride.pickupLatitude ?? null,
        pickupLongitude: ride.pickupLongitude ?? null,
        destinationLatitude: ride.destinationLatitude ?? null,
        destinationLongitude: ride.destinationLongitude ?? null,
        pickupAccuracyMeters: ride.pickupAccuracyMeters ?? null,
        destinationAccuracyMeters: ride.destinationAccuracyMeters ?? null,
      }));
    } catch {
      return [];
    }
  }

  private writeRides(rides: LocalRide[]): void {
    this.ridesSubject.next(rides);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rides));
    window.dispatchEvent(new CustomEvent('careride-rides-changed'));
  }
}
