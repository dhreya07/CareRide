import { CALAPAN_CITY, CALAPAN_ZOOM, MAP_OVERLAY_POINTER_OPTIONS, mapFocus, mapHostIsReady, mapLayoutIsStale } from './location-map.component';

describe('Request Ride map view', () => {
  it('opens on Calapan City when no points are saved', () => {
    expect(mapFocus(null, null)).toEqual({
      latitude: CALAPAN_CITY.latitude,
      longitude: CALAPAN_CITY.longitude,
      zoom: CALAPAN_ZOOM,
    });
    expect(CALAPAN_CITY).toEqual({ latitude: 13.4115, longitude: 121.1803 });
  });

  it('uses a saved pickup or destination before the default city', () => {
    expect(mapFocus({ latitude: 13.4, longitude: 121.2 }, null)).toEqual({
      latitude: 13.4,
      longitude: 121.2,
      zoom: 16,
    });
    expect(mapFocus(
      { latitude: 13.4, longitude: 121.2 },
      { latitude: 13.42, longitude: 121.18 },
    )).toEqual({
      points: [
        { latitude: 13.4, longitude: 121.2 },
        { latitude: 13.42, longitude: 121.18 },
      ],
    });
  });

  it('lets map taps pass through the GPS dot and accuracy circle', () => {
    expect(MAP_OVERLAY_POINTER_OPTIONS.interactive).toBe(false);
    expect(MAP_OVERLAY_POINTER_OPTIONS.bubblingMouseEvents).toBe(false);
  });

  it('asks for a new layout when a visible map container no longer matches Leaflet', () => {
    expect(mapLayoutIsStale(0, 190, 0, 0)).toBe(false);
    expect(mapLayoutIsStale(360, 190, 360, 190)).toBe(false);
    expect(mapLayoutIsStale(360, 190, 0, 0)).toBe(true);
  });

  it('waits until the map container has a real size', () => {
    expect(mapHostIsReady(0, 280)).toBe(false);
    expect(mapHostIsReady(320, 0)).toBe(false);
    expect(mapHostIsReady(320, 280)).toBe(true);
  });
});
