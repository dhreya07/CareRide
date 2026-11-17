import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DRIVER_LOCATION_CLIENT, DriverLocationPublisherService } from './driver-location-publisher.service';
import { DeviceGpsFix, MapsService } from './maps.service';

const rpc = vi.fn();

describe('foreground Driver location publisher', () => {
  const id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  let visibility: DocumentVisibilityState;
  let fix: (reading: DeviceGpsFix) => void;
  let watchError: (message: string, denied: boolean) => void;
  const stop = vi.fn();
  const reading = (): DeviceGpsFix => ({
    latitude: 0, longitude: 0, accuracyMeters: 10,
    capturedAt: new Date().toISOString(), source: 'device-gps',
  });

  function setup(permission: PermissionState = 'granted', queryPending = false, firstFix = reading(), startupFix?: () => Promise<DeviceGpsFix>) {
    const permissionStatus = Object.assign(new EventTarget(), { state: permission });
    visibility = 'visible';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
    const query = vi.fn(() => queryPending ? new Promise<PermissionStatus>(() => {}) : Promise.resolve(permissionStatus));
    vi.stubGlobal('navigator', { permissions: { query } });
    rpc.mockImplementation((name) => name === 'clear_driver_location'
      ? { abortSignal: async () => ({ error: null }) }
      : Promise.resolve({ data: id, error: null }));
    const maps = {
      geolocationPermission: async () => permissionStatus.state,
      currentPosition: startupFix ?? (async () => {
        if (permission === 'granted') throw new Error();
        permissionStatus.state = 'granted';
        return firstFix;
      }),
      watchDeviceGps: (callback: typeof fix, onError: typeof watchError) => { fix = callback; watchError = onError; return stop; },
    };
    TestBed.configureTestingModule({ providers: [{ provide: MapsService, useValue: maps }, { provide: DRIVER_LOCATION_CLIENT, useValue: () => ({ rpc }) }] });
    const publisher = TestBed.inject(DriverLocationPublisherService);
    publisher.setDashboardVisible(true);
    return { publisher, permissionStatus, query };
  }

  afterEach(() => {
    fix = undefined as unknown as typeof fix;
    TestBed.resetTestingModule();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('requires opt-in, rejects bad fixes, and ignores duplicate callbacks', async () => {
    const { publisher } = setup();
    expect(rpc).not.toHaveBeenCalled();
    await publisher.optIn(publisher.onlineIntent());
    await vi.waitFor(() => expect(fix).toBeDefined());
    fix({ ...reading(), accuracyMeters: 101 });
    fix({ ...reading(), capturedAt: new Date(Date.now() - 31_000).toISOString() });
    expect(rpc).toHaveBeenCalledTimes(1);
    const valid = reading();
    fix(valid);
    fix(valid);
    await vi.waitFor(() => expect(publisher.message()).toBe('Location sharing active.'));
    fix(valid);
    expect(rpc).toHaveBeenCalledTimes(2);
    await publisher.disable();
    expect(stop).toHaveBeenCalled();
  });

  it('publishes the valid permission-grant fix before the watch emits', async () => {
    const { publisher } = setup('prompt');
    await publisher.optIn(publisher.onlineIntent());
    await vi.waitFor(() => expect(publisher.message()).toBe('Location sharing active.'));
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      'begin_driver_location_session', 'publish_driver_location',
    ]);
    fix({ ...reading(), accuracyMeters: 101 });
    expect(publisher.message()).toBe('Location sharing active.');
    await publisher.disable();
  });

  it('does not open a session when permission is denied', async () => {
    const { publisher } = setup('denied');
    await publisher.optIn(publisher.onlineIntent());
    expect(rpc).not.toHaveBeenCalled();
    expect(publisher.message()).toContain('inactive');
  });

  it('clears on permission revocation and suppresses callbacks', async () => {
    const { publisher, permissionStatus } = setup();
    await publisher.optIn(publisher.onlineIntent());
    await vi.waitFor(() => expect(publisher.message()).toContain('Waiting'));
    permissionStatus.state = 'denied';
    permissionStatus.dispatchEvent(new Event('change'));
    fix(reading());
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      'begin_driver_location_session', 'clear_driver_location',
    ]);
  });

  it('clears a late begin response after stop', async () => {
    const { publisher } = setup();
    let resolve!: (value: { data: string; error: null }) => void;
    rpc.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    await publisher.optIn(publisher.onlineIntent());
    await vi.waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    await publisher.disable();
    resolve({ data: id, error: null });
    await vi.waitFor(() => expect(rpc).toHaveBeenCalledWith('clear_driver_location', { p_session_id: id }));
    expect(publisher.message()).toContain('inactive');
  });
  it('opens a new session after foreground resume and ignores old callbacks', async () => {
    const { publisher } = setup();
    await publisher.optIn(publisher.onlineIntent());
    await vi.waitFor(() => expect(publisher.message()).toContain('Waiting'));
    const previous = fix;
    visibility = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
    expect(publisher.diagnostic()).toBe('Run cancelled: browser document hidden.');
    previous(reading());
    visibility = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.waitFor(() => expect(fix).not.toBe(previous));
    previous(reading());
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      'begin_driver_location_session', 'clear_driver_location', 'begin_driver_location_session',
    ]);
    await publisher.disable();
  });

  it('stops even when a publish is in flight and cleanup fails', async () => {
    const { publisher } = setup();
    await publisher.optIn(publisher.onlineIntent());
    await vi.waitFor(() => expect(publisher.message()).toContain('Waiting'));
    let finish!: (value: { error: null }) => void;
    rpc.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    fix(reading());
    rpc.mockReturnValueOnce({ abortSignal: async () => { throw new Error(); } });
    await publisher.disable();
    finish({ error: null });
    await Promise.resolve();
    fix(reading());
    expect(publisher.message()).toContain('inactive');
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      'begin_driver_location_session', 'publish_driver_location', 'clear_driver_location',
    ]);
  });
  it('distinguishes a watch error that clears the session before any publish', async () => {
    const { publisher } = setup();
    await publisher.optIn(publisher.onlineIntent());
    await vi.waitFor(() => expect(publisher.message()).toContain('Waiting'));
    watchError('browser details must not be displayed', false);
    expect(publisher.diagnostic()).toBe('Browser GPS watch reported an error before the next fix.');
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      'begin_driver_location_session', 'clear_driver_location',
    ]);
  });
  it('uses a browser fix when the permission query never resolves', async () => {
    const { publisher, query } = setup('prompt', true);
    await publisher.optIn(publisher.onlineIntent());
    await vi.waitFor(() => expect(publisher.message()).toBe('Location sharing active.'), { timeout: 2500 });
    expect(query).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      'begin_driver_location_session', 'publish_driver_location',
    ]);
    await publisher.disable();
  });

  it('does not start after going offline during a pending permission query', async () => {
    const { publisher, query } = setup('prompt', true);
    vi.useFakeTimers();
    try {
      await publisher.optIn(publisher.onlineIntent());
      expect(query).toHaveBeenCalledTimes(1);
      await publisher.disable();
      await vi.advanceTimersByTimeAsync(1000);
      expect(rpc).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
  it('identifies rejected fixes without an RPC and publishes a valid 10 m fix', async () => {
    const { publisher } = setup();
    await publisher.optIn(publisher.onlineIntent());
    await vi.waitFor(() => expect(publisher.message()).toContain('Waiting'));
    const rejected: [Partial<DeviceGpsFix>, string][] = [
      [{ latitude: Infinity }, 'INVALID_COORDINATES'],
      [{ longitude: 181 }, 'INVALID_COORDINATES'],
      [{ accuracyMeters: 101 }, 'WATCH_ACCURACY_OVER_LIMIT'],
      [{ accuracyMeters: NaN }, 'WATCH_ACCURACY_NONFINITE'],
      [{ capturedAt: undefined }, 'MISSING_TIMESTAMP'],
      [{ capturedAt: 'invalid' }, 'MISSING_TIMESTAMP'],
      [{ capturedAt: new Date(Date.now() - 31_000).toISOString() }, 'STALE_TIMESTAMP'],
      [{ capturedAt: new Date(Date.now() + 1000).toISOString() }, 'FUTURE_TIMESTAMP'],
    ];
    for (const [patch, reason] of rejected) {
      fix({ ...reading(), ...patch });
      expect(publisher.diagnostic()).toBe(reason);
    }
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(['begin_driver_location_session']);
    fix({ ...reading(), latitude: 14.5995, longitude: 120.9842 });
    await vi.waitFor(() => expect(publisher.message()).toBe('Location sharing active.'));
    await publisher.disable();
  });
  it.each(['prompt', 'granted'] as const)(
    'publishes 10 m through real MapsService when permission starts as %s',
    async (state) => {
      const permission = Object.assign(new EventTarget(), { state });
      const position = (accuracy: number, timestamp = Date.now()): GeolocationPosition => ({
        coords: {
          latitude: 14.5995, longitude: 120.9842, accuracy,
          altitude: null, altitudeAccuracy: null, heading: null, speed: null,
        },
        timestamp,
      } as GeolocationPosition);
      let watchFix!: PositionCallback;
      let firstTimestamp = 0;
      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
      vi.stubGlobal('navigator', {
        permissions: { query: async () => permission },
        geolocation: {
          getCurrentPosition: (success: PositionCallback) => {
            Object.assign(permission, { state: 'granted' });
            firstTimestamp = Date.now();
            success(position(10, firstTimestamp));
          },
          watchPosition: (success: PositionCallback) => {
            watchFix = success;
            return 1;
          },
          clearWatch: vi.fn(),
        },
      });
      rpc.mockImplementation((name) => name === 'clear_driver_location'
        ? { abortSignal: async () => ({ error: null }) }
        : Promise.resolve({ data: id, error: null }));
      TestBed.configureTestingModule({
        providers: [{ provide: DRIVER_LOCATION_CLIENT, useValue: () => ({ rpc }) }],
      });
      const publisher = TestBed.inject(DriverLocationPublisherService);
      publisher.setDashboardVisible(true);
      try {
        await publisher.optIn(publisher.onlineIntent());
        await vi.waitFor(() => expect(watchFix).toBeDefined());
        await vi.waitFor(() => expect(publisher.message()).toBe('Location sharing active.'));
        expect(rpc).toHaveBeenCalledWith('publish_driver_location', {
          p_session_id: id,
          p_latitude: 14.5995,
          p_longitude: 120.9842,
          p_accuracy_m: 10,
          p_captured_at: new Date(firstTimestamp).toISOString(),
        });
        watchFix(position(101));
        expect(publisher.diagnostic()).toBe('WATCH_ACCURACY_OVER_LIMIT');
        watchFix(position(NaN));
        expect(publisher.diagnostic()).toBe('WATCH_ACCURACY_NONFINITE');
        expect(publisher.message()).toBe('Location sharing active.');
        expect(rpc.mock.calls.filter(([name]) => name === 'publish_driver_location')).toHaveLength(1);
      } finally {
        await publisher.disable();
      }
    },
  );
  it.each([
    [{ accuracyMeters: null }, 'MISSING'],
    [{ accuracyMeters: null, accuracyNonfinite: true }, 'NONFINITE'],
    [{ accuracyMeters: -1 }, 'NEGATIVE'],
    [{ accuracyMeters: 101 }, 'OVER_LIMIT'],
  ] as const)('reports the accuracy category for both callback sources (%s)', async (patch, reason) => {
    const rejected = { ...reading(), ...patch };
    const { publisher } = setup('prompt', false, rejected);
    await publisher.optIn(publisher.onlineIntent());
    await vi.waitFor(() => expect(publisher.diagnostic()).toBe('FIRST_FIX_ACCURACY_' + reason));
    fix(rejected);
    expect(publisher.diagnostic()).toBe('WATCH_ACCURACY_' + reason);
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(['begin_driver_location_session']);
    await publisher.disable();
  });
  it.each(['offline', 'older'] as const)('ignores a late startup fix (%s)', async (reason) => {
    let resolve!: (fix: DeviceGpsFix) => void;
    const pending = new Promise<DeviceGpsFix>((done) => { resolve = done; });
    const startup = vi.fn(() => pending);
    const { publisher } = setup('granted', false, reading(), startup);
    await publisher.optIn(publisher.onlineIntent());
    await vi.waitFor(() => expect(startup).toHaveBeenCalledOnce());

    const older = { ...reading(), capturedAt: new Date(Date.now() - 1000).toISOString() };
    if (reason === 'offline') {
      await publisher.disable();
    } else {
      fix(reading());
      await vi.waitFor(() => expect(publisher.message()).toBe('Location sharing active.'));
    }

    resolve(older);
    await pending;
    expect(rpc.mock.calls.filter(([name]) => name === 'publish_driver_location'))
      .toHaveLength(reason === 'offline' ? 0 : 1);
    await publisher.disable();
  });

  it('keeps the watch publishing after the granted-permission startup request fails', async () => {
    const startup = vi.fn(async () => { throw new Error(); });
    const { publisher } = setup('granted', false, reading(), startup);
    await publisher.optIn(publisher.onlineIntent());
    await vi.waitFor(() => expect(startup).toHaveBeenCalledOnce());
    fix(reading());
    await vi.waitFor(() => expect(publisher.message()).toBe('Location sharing active.'));
    expect(stop).not.toHaveBeenCalled();
    await publisher.disable();
  });
});
