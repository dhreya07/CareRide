import { DriverGpsFix, isDriverFixStale } from './driver-gps.service';
import { distanceMeters } from './healthcare-facilities';
import { isUsableCoordinate } from './maps.service';

export function isNearbyDriverEligible(
  pickup: { latitude: number | null; longitude: number | null; confirmed: boolean },
  driver: {
    approved: boolean;
    availability: string | null | undefined;
    fix?: Pick<DriverGpsFix, 'latitude' | 'longitude' | 'accuracyMeters' | 'capturedAt'> | null;
  },
  now = Date.now(),
): boolean {
  const { latitude, longitude, confirmed } = pickup;
  const { fix } = driver;
  if (!confirmed || latitude === null || longitude === null || !isUsableCoordinate(latitude, longitude)
    || driver.approved !== true || driver.availability !== 'available' || !fix) {
    return false;
  }

  const accuracy = fix.accuracyMeters;
  if (!isUsableCoordinate(fix.latitude, fix.longitude)
    || typeof accuracy !== 'number' || !Number.isFinite(accuracy) || accuracy < 0 || accuracy > 100
    || !Number.isFinite(now) || Date.parse(fix.capturedAt) > now || isDriverFixStale(fix.capturedAt, now)) {
    return false;
  }

  return distanceMeters({ latitude, longitude }, fix) <= 5_000;
}
