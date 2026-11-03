import { Injectable, NgZone } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { DeviceGpsFix } from './maps.service';

export interface DriverGpsFix extends DeviceGpsFix {
  capturedAt: string;
}

export interface DriverLocationSnapshot {
  rideId: string | null;
  tracking: boolean;
  fix: DriverGpsFix | null;
  error: string | null;
  offline: boolean;
}

export const DRIVER_GPS_STALE_MS = 30_000;

export function isDriverFixStale(capturedAt: string, now = Date.now()): boolean {
  const then = Date.parse(capturedAt);
  return Number.isNaN(then) || now - then > DRIVER_GPS_STALE_MS;
}

export function isValidDeviceCoordinate(latitude: number, longitude: number): boolean {
  return Number.isFinite(latitude) && latitude >= -90 && latitude <= 90
    && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180;
}

/** Uses the device timestamp. An invalid timestamp is not replaced with the current time. */
export function gpsReadingTimestamp(timestamp: number): string | null {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return null;
  }
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function poorAccuracyNote(meters: number | null): string | null {
  if (meters === null || !Number.isFinite(meters) || meters < 0 || meters <= 100) {
    return null;
  }
  return `GPS accuracy is poor (${Math.round(meters)} m). This is not an exact position.`;
}

const IDLE: DriverLocationSnapshot = {
  rideId: null,
  tracking: false,
  fix: null,
  error: null,
  offline: false,
};

/**
 * Device GPS for one accepted ride. Nothing calls start automatically.
 * watchPosition runs only after an explicit start. Only one watch is kept.
 * changes$ is the single stream a later Supabase sender can observe. This service does not publish to the cloud.
 */
@Injectable({ providedIn: 'root' })
export class DriverGpsService {
  private readonly updates = new BehaviorSubject<DriverLocationSnapshot>({ ...IDLE });
  readonly changes$ = this.updates.asObservable();
  private watchId: number | null = null;
  private removeNetwork: (() => void) | null = null;

  constructor(private zone: NgZone) {}

  get snapshot(): DriverLocationSnapshot {
    return this.updates.value;
  }

  get trackingActive(): boolean {
    return this.snapshot.tracking;
  }

  fixForRide(rideId: string): DriverGpsFix | null {
    const current = this.snapshot;
    if (!current.tracking || current.rideId !== rideId) {
      return null;
    }
    return current.fix;
  }

  isStale(now = Date.now()): boolean {
    const fix = this.snapshot.fix;
    return Boolean(this.snapshot.tracking && fix && isDriverFixStale(fix.capturedAt, now));
  }

  start(rideId: string, assignment?: { actorId: string; driverId: string }): void {
    if (assignment && assignment.actorId !== assignment.driverId) {
      this.stopWatch();
      this.publish({
        ...IDLE,
        error: 'Only the assigned driver can share location for this ride.',
        offline: this.readOffline(),
      });
      return;
    }
    const id = rideId.trim();
    if (!id) {
      this.publish({ ...IDLE, error: 'Choose an accepted ride before sharing location.', offline: this.readOffline() });
      return;
    }
    if (this.watchId !== null && this.snapshot.rideId === id) {
      return;
    }
    this.stopWatch();
    const geolocation = typeof navigator === 'undefined' ? undefined : navigator.geolocation;
    if (!geolocation || typeof geolocation.watchPosition !== 'function') {
      this.publish({
        rideId: id,
        tracking: false,
        fix: null,
        error: 'GPS is not available on this device.',
        offline: this.readOffline(),
      });
      return;
    }
    this.watchId = geolocation.watchPosition(
      (position) => this.zone.run(() => this.record(id, position)),
      (error) => this.zone.run(() => this.failWatch(error)),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 },
    );
    this.bindNetwork();
    this.publish({
      rideId: id,
      tracking: true,
      fix: null,
      error: null,
      offline: this.readOffline(),
    });
  }

  stop(): void {
    this.stopWatch();
    this.publish({ ...IDLE, offline: this.readOffline() });
  }

  private record(rideId: string, position: GeolocationPosition): void {
    if (!this.snapshot.tracking || this.snapshot.rideId !== rideId) {
      return;
    }
    const latitude = position.coords.latitude;
    const longitude = position.coords.longitude;
    const capturedAt = gpsReadingTimestamp(position.timestamp);
    if (!isValidDeviceCoordinate(latitude, longitude) || !capturedAt) {
      this.publish({
        ...this.snapshot,
        error: 'That GPS reading was invalid and was ignored.',
        offline: this.readOffline(),
      });
      return;
    }
    const accuracy = position.coords.accuracy;
    const accuracyMeters = Number.isFinite(accuracy) && accuracy >= 0 ? accuracy : null;
    const stale = isDriverFixStale(capturedAt);
    this.publish({
      ...this.snapshot,
      fix: {
        latitude,
        longitude,
        accuracyMeters,
        source: 'device-gps',
        capturedAt,
      },
      error: stale
        ? 'This GPS reading is stale. It is not a new position.'
        : poorAccuracyNote(accuracyMeters),
      offline: this.readOffline(),
    });
  }

  private failWatch(error: GeolocationPositionError): void {
    const denied = error.code === error.PERMISSION_DENIED;
    const message = denied
      ? 'Location permission was denied. Sharing stopped.'
      : error.code === error.POSITION_UNAVAILABLE
        ? 'GPS is unavailable. No location was invented.'
        : 'The GPS update timed out. No location was invented.';
    if (denied) {
      this.stopWatch();
      this.publish({
        ...this.snapshot,
        tracking: false,
        error: message,
        offline: this.readOffline(),
      });
      return;
    }
    this.publish({ ...this.snapshot, error: message, offline: this.readOffline() });
  }

  private publish(next: DriverLocationSnapshot): void {
    this.updates.next(next);
  }

  private stopWatch(): void {
    if (this.watchId !== null && navigator.geolocation?.clearWatch) {
      navigator.geolocation.clearWatch(this.watchId);
    }
    this.watchId = null;
    this.removeNetwork?.();
    this.removeNetwork = null;
  }

  private bindNetwork(): void {
    this.removeNetwork?.();
    const update = () => this.zone.run(() => {
      this.publish({ ...this.snapshot, offline: this.readOffline() });
    });
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    this.removeNetwork = () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }

  private readOffline(): boolean {
    return typeof navigator !== 'undefined' && navigator.onLine === false;
  }
}
