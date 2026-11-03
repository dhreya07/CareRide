import { TestBed } from '@angular/core/testing';
import { MapsService, placeFromAddress } from './maps.service';

describe('MapsService location helpers', () => {
  let maps: MapsService;

  beforeEach(() => {
    maps = TestBed.inject(MapsService);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports a denied location permission without watching the device', async () => {
    const getCurrentPosition = vi.fn((
      _success: PositionCallback,
      failure: PositionErrorCallback,
    ) => {
      failure({
        code: 1,
        PERMISSION_DENIED: 1,
        POSITION_UNAVAILABLE: 2,
        TIMEOUT: 3,
        message: 'denied',
      } as GeolocationPositionError);
    });
    vi.stubGlobal('navigator', {
      geolocation: { getCurrentPosition },
    });

    await expect(maps.currentPosition()).rejects.toThrow('Location permission was denied');
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    const options = (getCurrentPosition.mock.calls[0] as unknown as unknown[])[2] as PositionOptions;
    expect(options).toMatchObject({ enableHighAccuracy: true, maximumAge: 0 });
  });

  it('keeps the device GPS accuracy and does not invent a position', async () => {
    vi.stubGlobal('navigator', {
      geolocation: {
        getCurrentPosition: (success: PositionCallback) => {
          success({
            coords: {
              latitude: 13.4118,
              longitude: 121.1809,
              accuracy: 16.4,
            },
          } as GeolocationPosition);
        },
      },
    });

    await expect(maps.currentPosition()).resolves.toEqual({
      latitude: 13.4118,
      longitude: 121.1809,
      accuracyMeters: 16.4,
      source: 'device-gps',
    });
  });

  it('records missing GPS accuracy as unknown instead of a guessed distance', async () => {
    vi.stubGlobal('navigator', {
      geolocation: {
        getCurrentPosition: (success: PositionCallback) => {
          success({
            coords: { latitude: 13.41, longitude: 121.18, accuracy: Number.NaN },
          } as GeolocationPosition);
        },
      },
    });

    await expect(maps.currentPosition()).resolves.toMatchObject({ accuracyMeters: null, source: 'device-gps' });
  });

  it('searches places through Photon and does not call Nominatim autocomplete', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(String(url)).toContain('photon.komoot.io');
      expect(String(url)).not.toContain('nominatim');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          features: [{
            geometry: { coordinates: [121.1803, 13.4115] },
            properties: { name: 'Calapan City Hospital', city: 'Calapan', osm_id: '42' },
          }],
        }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    const places = await maps.searchLocations('Calapan hospital', { latitude: 13.41, longitude: 121.18 });

    expect(places).toEqual([expect.objectContaining({
      label: 'Calapan City Hospital, Calapan',
      latitude: 13.4115,
      longitude: 121.1803,
    })]);
    await maps.searchLocations('Calapan hospital', { latitude: 13.41, longitude: 121.18 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not send address search to Nominatim when Google Places is not configured', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(maps.searchPlaces('Calapan hospital')).rejects.toThrow('Google Maps browser key');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps a named facility and puts the street details underneath', () => {
    const place = placeFromAddress(
      { road: 'J.P. Rizal Street', suburb: 'Balite', city: 'Calapan', state: 'Oriental Mindoro' },
      'Another name',
      '13.41150, 121.18030',
      'Oriental Mindoro Provincial Hospital',
    );

    expect(place.title).toBe('Oriental Mindoro Provincial Hospital');
    expect(place.detail).toBe('J.P. Rizal Street, Balite, Calapan, Oriental Mindoro');
    expect(place.title).not.toContain('13.41150');
  });

  it('uses Selected map location when reverse geocoding fails and does not cache that failure', async () => {
    const fetchMock = vi.fn();
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(maps.describePlace(13.41, 121.18)).resolves.toEqual({
      title: 'Selected map location',
      detail: '13.41000, 121.18000',
    });

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        name: 'Calapan City Health Center',
        address: { suburb: 'Camilmil', city: 'Calapan' },
      }),
    });
    await expect(maps.describePlace(13.41, 121.18)).resolves.toEqual({
      title: 'Calapan City Health Center',
      detail: 'Camilmil, Calapan',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('uses coordinates when reverse geocoding has no street label', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ display_name: '   ' }),
    })));

    await expect(maps.reverseGeocode(14.6, 120.9842)).resolves.toBe('14.60000, 120.98420');
  });

  it('watches the device with high accuracy and can be stopped', () => {
    const clearWatch = vi.fn();
    const watchPosition = vi.fn((
      success: PositionCallback,
      _failure: PositionErrorCallback,
      options: PositionOptions,
    ) => {
      success({
        coords: {
          latitude: 13.4118,
          longitude: 121.1809,
          accuracy: 16,
        },
      } as GeolocationPosition);
      expect(options).toMatchObject({ enableHighAccuracy: true, maximumAge: 0 });
      return 7;
    });
    vi.stubGlobal('navigator', { geolocation: { watchPosition, clearWatch } });
    const onFix = vi.fn();

    const stop = maps.watchDeviceGps(onFix, vi.fn());

    expect(onFix).toHaveBeenCalledWith({
      latitude: 13.4118,
      longitude: 121.1809,
      accuracyMeters: 16,
      source: 'device-gps',
    });
    stop();
    expect(clearWatch).toHaveBeenCalledWith(7);
  });

  it('uses coordinates when reverse geocoding cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('offline');
    }));

    await expect(maps.reverseGeocode(14.61, 120.99)).resolves.toBe('14.61000, 120.99000');
  });
});
