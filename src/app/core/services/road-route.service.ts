import { Injectable } from '@angular/core';

export interface RoadCoordinate {
  latitude: number;
  longitude: number;
}

export interface RoadRoute {
  distanceMeters: number;
  durationSeconds: number;
  coordinates: RoadCoordinate[];
}

export type RoadRouteResult =
  | { status: 'ok'; distanceMeters: number; durationSeconds: number; coordinates: RoadCoordinate[] }
  | { status: 'unavailable'; message: string };

/**
 * Development routing uses the public OSRM demo server.
 * https://router.project-osrm.org is a shared demo, not a production service:
 * it has no availability guarantee, and heavy or automated traffic can be blocked.
 * CareRide requests one driving route only when the confirmed pickup and
 * destination change. Production needs a dedicated OSRM or Valhalla instance.
 */
export const OSRM_DEMO_ROUTE_ENDPOINT = 'https://router.project-osrm.org/route/v1/driving';
const ROUTE_CACHE_MS = 5 * 60 * 1000;
const ROUTE_TIMEOUT_MS = 12000;

export const ROAD_ROUTE_UNAVAILABLE = 'No driving route was found between these points.';
export const ROAD_ROUTE_FAILED = 'The driving route could not be loaded. Distance and travel time are unavailable.';

export function osrmDrivingUrl(pickup: RoadCoordinate, destination: RoadCoordinate): string {
  const path = `${pickup.longitude},${pickup.latitude};${destination.longitude},${destination.latitude}`;
  return `${OSRM_DEMO_ROUTE_ENDPOINT}/${path}?overview=full&geometries=geojson&alternatives=false`;
}

export function formatRoadDistance(meters: number): string {
  const kilometers = meters / 1000;
  if (kilometers < 10) {
    return `${kilometers.toFixed(1)} km`;
  }
  return `${Math.round(kilometers)} km`;
}

export function formatRoadDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  return minutes === 1 ? '1 min' : `${minutes} min`;
}

export function roadRouteSummary(distanceMeters: number, durationSeconds: number): string {
  return `${formatRoadDistance(distanceMeters)} · ${formatRoadDuration(durationSeconds)} by road`;
}

export function parseOsrmRoute(payload: unknown): RoadRoute | 'no-route' | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const body = payload as { code?: string; routes?: unknown[] };
  if (body.code === 'NoRoute') {
    return 'no-route';
  }
  if (body.code !== 'Ok' || !Array.isArray(body.routes) || !body.routes[0]) {
    return null;
  }
  const route = body.routes[0] as {
    distance?: number;
    duration?: number;
    geometry?: { type?: string; coordinates?: unknown[] };
  };
  const positions = route.geometry?.coordinates;
  if (!Number.isFinite(route.distance) || !Number.isFinite(route.duration)
    || route.geometry?.type !== 'LineString' || !Array.isArray(positions) || positions.length < 2) {
    return null;
  }
  const coordinates: RoadCoordinate[] = [];
  for (const position of positions) {
    if (!Array.isArray(position) || position.length < 2) {
      return null;
    }
    const longitude = Number(position[0]);
    const latitude = Number(position[1]);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return null;
    }
    coordinates.push({ latitude, longitude });
  }
  return {
    distanceMeters: route.distance as number,
    durationSeconds: route.duration as number,
    coordinates,
  };
}

function validPoint(point: RoadCoordinate | null | undefined): point is RoadCoordinate {
  return Boolean(point)
    && Number.isFinite(point!.latitude) && point!.latitude >= -90 && point!.latitude <= 90
    && Number.isFinite(point!.longitude) && point!.longitude >= -180 && point!.longitude <= 180;
}

@Injectable({ providedIn: 'root' })
export class RoadRouteService {
  private cache = new Map<string, { at: number; result: RoadRouteResult }>();

  async drivingRoute(pickup: RoadCoordinate, destination: RoadCoordinate): Promise<RoadRouteResult> {
    if (!validPoint(pickup) || !validPoint(destination)) {
      return { status: 'unavailable', message: 'A driving route needs a valid pickup and destination.' };
    }
    const key = `${pickup.latitude.toFixed(5)},${pickup.longitude.toFixed(5)}|${destination.latitude.toFixed(5)},${destination.longitude.toFixed(5)}`;
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.at < ROUTE_CACHE_MS) {
      return cached.result;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ROUTE_TIMEOUT_MS);
    try {
      const response = await fetch(osrmDrivingUrl(pickup, destination), { signal: controller.signal });
      if (!response.ok) {
        return { status: 'unavailable', message: ROAD_ROUTE_FAILED };
      }
      const parsed = parseOsrmRoute(await response.json());
      const result: RoadRouteResult = parsed === 'no-route' || !parsed
        ? { status: 'unavailable', message: parsed === 'no-route' ? ROAD_ROUTE_UNAVAILABLE : 'The routing service did not return a road route.' }
        : { status: 'ok', distanceMeters: parsed.distanceMeters, durationSeconds: parsed.durationSeconds, coordinates: parsed.coordinates };
      if (result.status === 'ok') {
        this.cache.set(key, { at: Date.now(), result });
      }
      return result;
    } catch {
      return { status: 'unavailable', message: ROAD_ROUTE_FAILED };
    } finally {
      clearTimeout(timer);
    }
  }
}
