import { describe, expect, it } from 'vitest';
import { isNearbyDriverEligible } from './nearby-driver-eligibility';

describe('nearby Driver eligibility', () => {
  const now = Date.parse('2026-11-16T00:00:00Z');
  const pickup = { latitude: 0, longitude: 0, confirmed: true };
  const fix = { latitude: 0, longitude: 0, accuracyMeters: 100, capturedAt: new Date(now - 30_000).toISOString() };
  const driver = { approved: true, availability: 'available', fix };

  it.each([[4999, true], [5000, true], [5001, false]])('checks distance %s metres', (metres, eligible) => {
    const latitude = metres / 6_371_000 * 180 / Math.PI;
    expect(isNearbyDriverEligible(pickup, { ...driver, fix: { ...fix, latitude } }, now)).toBe(eligible);
  });

  it.each(['offline', 'busy', 'unknown', null, undefined])('rejects availability %s', (availability) => {
    expect(isNearbyDriverEligible(pickup, { ...driver, availability }, now)).toBe(false);
  });

  it('requires approval, confirmation and a GPS fix', () => {
    expect(isNearbyDriverEligible(pickup, { ...driver, approved: false }, now)).toBe(false);
    expect(isNearbyDriverEligible({ ...pickup, confirmed: false }, driver, now)).toBe(false);
    expect(isNearbyDriverEligible(pickup, { ...driver, fix: null }, now)).toBe(false);
  });

  it.each([null, -1, 100.01, NaN, Infinity])('rejects accuracy %s', (accuracyMeters) => {
    expect(isNearbyDriverEligible(pickup, { ...driver, fix: { ...fix, accuracyMeters } }, now)).toBe(false);
  });

  it.each(['invalid', '', new Date(now - 30_001).toISOString(), new Date(now + 1).toISOString()])(
    'rejects timestamp %s', (capturedAt) => {
      expect(isNearbyDriverEligible(pickup, { ...driver, fix: { ...fix, capturedAt } }, now)).toBe(false);
    },
  );

  it.each([NaN, Infinity, 91])('rejects invalid latitude %s at either endpoint', (latitude) => {
    expect(isNearbyDriverEligible({ ...pickup, latitude }, driver, now)).toBe(false);
    expect(isNearbyDriverEligible(pickup, { ...driver, fix: { ...fix, latitude } }, now)).toBe(false);
  });
});
