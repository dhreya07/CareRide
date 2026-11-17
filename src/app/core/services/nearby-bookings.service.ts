import { Injectable } from '@angular/core';
import { LocalRide } from '../models/local-ride.model';
import { isUsableCoordinate } from './maps.service';

export interface NearbyDriverPoint {
  latitude: number;
  longitude: number;
}
export interface NearbyBooking {
  ride: LocalRide;
  distanceKm: number;
  pickup: NearbyDriverPoint;
}
export const NEARBY_BOOKING_RADIUS_KM = 5;

@Injectable({ providedIn: 'root' })
export class NearbyBookingsService {
  /** Caller supplies only bookings the signed-in driver may view. Read-only. */
  findNearby(driver: NearbyDriverPoint | null, rides: readonly LocalRide[], radiusKm = NEARBY_BOOKING_RADIUS_KM): NearbyBooking[] {
    if (!driver || !isUsableCoordinate(driver.latitude, driver.longitude) || !Number.isFinite(radiusKm) || radiusKm <= 0) return [];
    return rides.flatMap((ride): NearbyBooking[] => {
      if (ride.status !== 'Pending' && ride.status !== 'Scheduled') return [];
      const latitude = ride.pickupLatitude;
      const longitude = ride.pickupLongitude;
      if (latitude == null || longitude == null || !isUsableCoordinate(latitude, longitude)) return [];
      const pickup = { latitude, longitude };
      const distanceKm = this.distanceKm(driver, pickup);
      return distanceKm <= radiusKm ? [{ ride, distanceKm, pickup }] : [];
    }).sort((a, b) => a.distanceKm - b.distanceKm || a.ride.id.localeCompare(b.ride.id));
  }

  /** Straight-line distance, not road travel distance. */
  distanceKm(from: NearbyDriverPoint, to: NearbyDriverPoint): number {
    const rad = Math.PI / 180;
    const dLat = (to.latitude - from.latitude) * rad;
    const dLon = (to.longitude - from.longitude) * rad;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(from.latitude * rad) * Math.cos(to.latitude * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * 6371.0088 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, a))));
  }
}
