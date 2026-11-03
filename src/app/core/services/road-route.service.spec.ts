import { TestBed } from '@angular/core/testing';
import {
  OSRM_DEMO_ROUTE_ENDPOINT,
  RoadRouteService,
  formatRoadDistance,
  formatRoadDuration,
  osrmDrivingUrl,
  parseOsrmRoute,
  roadRouteSummary,
} from './road-route.service';

const pickup = { latitude: 13.4115, longitude: 121.1803 };
const destination = { latitude: 13.42, longitude: 121.19 };

describe('road routes', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    TestBed.resetTestingModule();
  });

  it('reads road distance, travel time, and geometry from an OSRM route', () => {
    const route = parseOsrmRoute({
      code: 'Ok',
      routes: [{
        distance: 4200,
        duration: 540,
        geometry: {
          type: 'LineString',
          coordinates: [[121.1803, 13.4115], [121.185, 13.415], [121.19, 13.42]],
        },
      }],
    });

    expect(route).toEqual({
      distanceMeters: 4200,
      durationSeconds: 540,
      coordinates: [
        { latitude: 13.4115, longitude: 121.1803 },
        { latitude: 13.415, longitude: 121.185 },
        { latitude: 13.42, longitude: 121.19 },
      ],
    });
    expect(formatRoadDistance(4200)).toBe('4.2 km');
    expect(formatRoadDuration(540)).toBe('9 min');
    expect(roadRouteSummary(4200, 540)).toBe('4.2 km · 9 min by road');
    expect(osrmDrivingUrl(pickup, destination)).toContain(OSRM_DEMO_ROUTE_ENDPOINT);
    expect(osrmDrivingUrl(pickup, destination)).toContain('121.1803,13.4115;121.19,13.42');
  });

  it('treats a no-route response as unavailable and does not invent a distance', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ code: 'NoRoute', routes: [] }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const routes = TestBed.inject(RoadRouteService);

    const result = await routes.drivingRoute(pickup, destination);

    expect(result).toEqual({
      status: 'unavailable',
      message: 'No driving route was found between these points.',
    });
    expect(JSON.stringify(result)).not.toContain('km');
  });

  it('reports a network failure without a straight-line substitute', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('offline');
    }));
    const routes = TestBed.inject(RoadRouteService);

    await expect(routes.drivingRoute(pickup, destination)).resolves.toEqual({
      status: 'unavailable',
      message: 'The driving route could not be loaded. Distance and travel time are unavailable.',
    });
    await expect(routes.drivingRoute({ latitude: 999, longitude: 121 }, destination)).resolves.toMatchObject({
      status: 'unavailable',
    });
  });

  it('requests the demo OSRM endpoint once for the same confirmed points', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(String(url)).toContain('https://router.project-osrm.org/route/v1/driving/');
      return {
        ok: true,
        json: async () => ({
          code: 'Ok',
          routes: [{
            distance: 1500,
            duration: 180,
            geometry: { type: 'LineString', coordinates: [[121.18, 13.41], [121.19, 13.42]] },
          }],
        }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);
    const routes = TestBed.inject(RoadRouteService);

    const first = await routes.drivingRoute(pickup, destination);
    const second = await routes.drivingRoute(pickup, destination);

    expect(first.status).toBe('ok');
    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
