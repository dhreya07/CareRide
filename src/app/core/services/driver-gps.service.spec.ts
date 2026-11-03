import { TestBed } from '@angular/core/testing';
import { DriverGpsService, isDriverFixStale } from './driver-gps.service';

describe('Driver GPS sharing lifecycle', () => {
  let watchPosition: ReturnType<typeof vi.fn>;
  let clearWatch: ReturnType<typeof vi.fn>;
  let success: PositionCallback;
  let failure: PositionErrorCallback;

  beforeEach(() => {
    watchPosition = vi.fn((
      onSuccess: PositionCallback,
      onError: PositionErrorCallback,
    ) => {
      success = onSuccess;
      failure = onError;
      return 7;
    });
    clearWatch = vi.fn();
    vi.stubGlobal('navigator', {
      onLine: true,
      geolocation: { watchPosition, clearWatch },
    });
    TestBed.resetTestingModule();
  });

  afterEach(() => {
    TestBed.inject(DriverGpsService).stop();
    vi.unstubAllGlobals();
    TestBed.resetTestingModule();
  });

  it('does not watch GPS until sharing starts for a ride', () => {
    const gps = TestBed.inject(DriverGpsService);

    expect(gps.trackingActive).toBe(false);
    expect(watchPosition).not.toHaveBeenCalled();
    expect(gps.fixForRide('CR-RIDE')).toBeNull();
  });

  it('stores a real watch fix and stops watching when sharing stops', () => {
    const gps = TestBed.inject(DriverGpsService);
    gps.start('CR-RIDE');
    success({
      coords: { latitude: 13.41, longitude: 121.18, accuracy: 12 },
      timestamp: Date.now(),
    } as GeolocationPosition);

    expect(gps.trackingActive).toBe(true);
    expect(gps.fixForRide('CR-RIDE')).toMatchObject({
      latitude: 13.41,
      longitude: 121.18,
      accuracyMeters: 12,
      source: 'device-gps',
    });
    expect(gps.fixForRide('CR-OTHER')).toBeNull();

    gps.start('CR-RIDE');
    expect(watchPosition).toHaveBeenCalledTimes(1);

    gps.stop();

    expect(clearWatch).toHaveBeenCalledWith(7);
    expect(gps.trackingActive).toBe(false);
    expect(gps.fixForRide('CR-RIDE')).toBeNull();
  });

  it('stops sharing when permission is denied and does not invent a fix', () => {
    const gps = TestBed.inject(DriverGpsService);
    gps.start('CR-RIDE');
    failure({
      code: 1,
      PERMISSION_DENIED: 1,
      POSITION_UNAVAILABLE: 2,
      TIMEOUT: 3,
      message: 'denied',
    } as GeolocationPositionError);

    expect(gps.trackingActive).toBe(false);
    expect(gps.snapshot.fix).toBeNull();
    expect(gps.snapshot.error).toContain('permission was denied');
    expect(clearWatch).toHaveBeenCalledWith(7);
  });

  it('keeps the last real fix when a later update times out', () => {
    const gps = TestBed.inject(DriverGpsService);
    gps.start('CR-RIDE');
    success({
      coords: { latitude: 13.41, longitude: 121.18, accuracy: 20 },
      timestamp: Date.now(),
    } as GeolocationPosition);
    failure({
      code: 3,
      PERMISSION_DENIED: 1,
      POSITION_UNAVAILABLE: 2,
      TIMEOUT: 3,
      message: 'timeout',
    } as GeolocationPositionError);

    expect(gps.snapshot.fix).toMatchObject({ latitude: 13.41, longitude: 121.18 });
    expect(gps.snapshot.error).toContain('timed out');
    expect(gps.trackingActive).toBe(true);
  });

  it('rejects another driver and an invalid reading without inventing a position', () => {
    const gps = TestBed.inject(DriverGpsService);
    gps.start('CR-RIDE', { actorId: 'driver-a', driverId: 'driver-b' });

    expect(watchPosition).not.toHaveBeenCalled();
    expect(gps.snapshot.error).toContain('assigned driver');

    gps.start('CR-RIDE', { actorId: 'driver-a', driverId: 'driver-a' });
    success({
      coords: { latitude: 99, longitude: 400, accuracy: 10 },
      timestamp: Date.now(),
    } as GeolocationPosition);

    expect(gps.snapshot.fix).toBeNull();
    expect(gps.snapshot.error).toContain('invalid');
    expect(watchPosition).toHaveBeenCalledTimes(1);
  });

  it('keeps a stale device timestamp instead of treating it as a new position', () => {
    const gps = TestBed.inject(DriverGpsService);
    const timestamp = Date.parse('2026-03-04T01:00:00.000Z');
    gps.start('CR-RIDE');
    success({
      coords: { latitude: 13.41, longitude: 121.18, accuracy: 240 },
      timestamp,
    } as GeolocationPosition);

    expect(gps.snapshot.fix?.capturedAt).toBe('2026-03-04T01:00:00.000Z');
    expect(gps.snapshot.error).toContain('stale');
    expect(isDriverFixStale(gps.snapshot.fix!.capturedAt, Date.parse('2026-03-04T01:00:31.000Z'))).toBe(true);
    expect(gps.snapshot.fix?.accuracyMeters).toBe(240);
  });

  it('switches to one watcher when sharing moves to another accepted ride', () => {
    const gps = TestBed.inject(DriverGpsService);
    gps.start('CR-ONE');
    gps.start('CR-TWO');

    expect(watchPosition).toHaveBeenCalledTimes(2);
    expect(clearWatch).toHaveBeenCalledWith(7);
    expect(gps.snapshot.rideId).toBe('CR-TWO');
    expect(gps.fixForRide('CR-ONE')).toBeNull();
  });

  it('marks a fix stale after 30 seconds and missing when there is no fix', () => {
    expect(isDriverFixStale('2026-03-04T01:00:00.000Z', Date.parse('2026-03-04T01:00:31.000Z'))).toBe(true);
    expect(isDriverFixStale('2026-03-04T01:00:00.000Z', Date.parse('2026-03-04T01:00:10.000Z'))).toBe(false);
    expect(TestBed.inject(DriverGpsService).fixForRide('CR-RIDE')).toBeNull();
  });
});
