import { Injectable } from '@angular/core';

export type HealthcareKind = 'hospital' | 'clinic' | 'health-center';
export type FacilityFilter = 'all' | HealthcareKind;

export interface HealthcareFacility {
  id: string;
  name: string;
  unnamed: boolean;
  kind: HealthcareKind;
  latitude: number;
  longitude: number;
}

export const FACILITY_CACHE_MS = 10 * 60 * 1000;
/** Primary Overpass endpoint, then a public mirror if the first request fails. */
export const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
] as const;

export function facilityCacheKey(latitude: number, longitude: number): string {
  return `${latitude.toFixed(2)},${longitude.toFixed(2)}`;
}

export function overpassHealthcareQuery(latitude: number, longitude: number, radiusMeters = 8000): string {
  const radius = Math.min(Math.max(Math.round(radiusMeters), 500), 15000);
  const around = (filter: string) =>
    `node${filter}(around:${radius},${latitude},${longitude});way${filter}(around:${radius},${latitude},${longitude});`;
  return `[out:json][timeout:20];(${
    around('["amenity"="hospital"]')
    + around('["amenity"="clinic"]')
    + around('["healthcare"="hospital"]')
    + around('["healthcare"="clinic"]')
    + around('["healthcare"="centre"]')
  });out center;`;
}

export function facilityKind(tags: Record<string, string> | undefined): HealthcareKind | null {
  if (!tags) {
    return null;
  }
  if (tags['amenity'] === 'hospital' || tags['healthcare'] === 'hospital') {
    return 'hospital';
  }
  if (tags['healthcare'] === 'centre' || tags['healthcare'] === 'center') {
    return 'health-center';
  }
  if (tags['amenity'] === 'clinic' || tags['healthcare'] === 'clinic') {
    return 'clinic';
  }
  return null;
}

export function facilityKindLabel(kind: HealthcareKind): string {
  if (kind === 'hospital') {
    return 'Hospital';
  }
  if (kind === 'health-center') {
    return 'Health center';
  }
  return 'Clinic';
}

export function facilityLabel(facility: HealthcareFacility): string {
  if (facility.unnamed || !facility.name.trim()) {
    return `Unnamed ${facilityKindLabel(facility.kind).toLowerCase()}`;
  }
  return facility.name.trim();
}

export function distanceMeters(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number },
): number {
  const earth = 6371000;
  const p1 = from.latitude * Math.PI / 180;
  const p2 = to.latitude * Math.PI / 180;
  const dLat = (to.latitude - from.latitude) * Math.PI / 180;
  const dLon = (to.longitude - from.longitude) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dLon / 2) ** 2;
  return 2 * earth * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters < 0) {
    return '';
  }
  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }
  return `${(meters / 1000).toFixed(1)} km`;
}

export function filterFacilities(facilities: HealthcareFacility[], filter: FacilityFilter): HealthcareFacility[] {
  if (filter === 'all') {
    return facilities;
  }
  return facilities.filter((facility) => facility.kind === filter);
}

/** A pin must be this close to a facility's own coordinates before that facility name is used. */
export const VERIFIED_FACILITY_MATCH_METERS = 75;

export function facilityIdsWithLabels(
  points: Array<{ id: string; x: number; y: number; kind: HealthcareKind }>,
  gapPixels: number,
): string[] {
  const rank = (kind: HealthcareKind) => kind === 'hospital' ? 0 : kind === 'health-center' ? 1 : 2;
  const ordered = [...points].sort((left, right) => rank(left.kind) - rank(right.kind));
  const kept: Array<{ id: string; x: number; y: number }> = [];
  for (const point of ordered) {
    const crowded = kept.some((item) => Math.hypot(item.x - point.x, item.y - point.y) < gapPixels);
    if (crowded) {
      continue;
    }
    kept.push(point);
  }
  return kept.map((point) => point.id);
}

export function nearestVerifiedFacility(
  facilities: HealthcareFacility[],
  point: { latitude: number; longitude: number },
  maxMeters = VERIFIED_FACILITY_MATCH_METERS,
): HealthcareFacility | null {
  let best: HealthcareFacility | null = null;
  let bestDistance = maxMeters;
  for (const facility of facilities) {
    if (facility.unnamed || !facility.name.trim()) {
      continue;
    }
    const distance = distanceMeters(point, facility);
    if (distance <= bestDistance) {
      best = facility;
      bestDistance = distance;
    }
  }
  return best;
}

export function sortFacilities(
  facilities: HealthcareFacility[],
  origin: { latitude: number; longitude: number },
): HealthcareFacility[] {
  return [...facilities].sort((left, right) =>
    distanceMeters(origin, left) - distanceMeters(origin, right));
}

export function parseOverpassHealthcare(payload: unknown): HealthcareFacility[] {
  const elements = payload && typeof payload === 'object' && Array.isArray((payload as { elements?: unknown }).elements)
    ? (payload as { elements: unknown[] }).elements
    : [];
  const seen = new Set<string>();
  const facilities: HealthcareFacility[] = [];
  for (const element of elements) {
    if (!element || typeof element !== 'object') {
      continue;
    }
    const row = element as {
      type?: string;
      id?: number;
      lat?: number;
      lon?: number;
      center?: { lat?: number; lon?: number };
      tags?: Record<string, string>;
    };
    const kind = facilityKind(row.tags);
    const latitude = Number.isFinite(row.lat) ? row.lat as number : row.center?.lat;
    const longitude = Number.isFinite(row.lon) ? row.lon as number : row.center?.lon;
    if (!kind || latitude === undefined || longitude === undefined
      || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      continue;
    }
    const name = (row.tags?.['name'] || row.tags?.['name:en'] || '').trim();
    const id = `${row.type || 'osm'}/${row.id ?? `${latitude},${longitude}`}`;
    const placeKey = `${kind}|${name.toLowerCase()}|${latitude.toFixed(4)}|${longitude.toFixed(4)}`;
    if (seen.has(id) || seen.has(placeKey)) {
      continue;
    }
    seen.add(id);
    seen.add(placeKey);
    facilities.push({
      id,
      name,
      unnamed: name.length === 0,
      kind,
      latitude,
      longitude,
    });
  }
  return facilities;
}

export function facilityFailureMessage(status?: number): string {
  if (status === 429) {
    return 'The map data service is busy. Wait a moment, then use Search this area.';
  }
  return 'Nearby facilities could not be loaded. You can still search for a place or adjust the pin.';
}

@Injectable({ providedIn: 'root' })
export class HealthcareFacilityService {
  private cache = new Map<string, { at: number; facilities: HealthcareFacility[] }>();
  private pending = new Map<string, Promise<HealthcareFacility[]>>();

  async nearby(latitude: number, longitude: number): Promise<HealthcareFacility[]> {
    const key = facilityCacheKey(latitude, longitude);
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.at < FACILITY_CACHE_MS) {
      return cached.facilities;
    }
    const existing = this.pending.get(key);
    if (existing) {
      return existing;
    }
    const request = this.load(latitude, longitude, key);
    this.pending.set(key, request);
    try {
      return await request;
    } finally {
      this.pending.delete(key);
    }
  }

  private async load(latitude: number, longitude: number, key: string): Promise<HealthcareFacility[]> {
    // A smaller discovery radius reduces public-server load; users can pan and
    // choose "Search this area" to discover facilities in another area.
    const query = overpassHealthcareQuery(latitude, longitude, 4500);
    const body = `data=${encodeURIComponent(query)}`;
    let lastStatus: number | undefined;

    // Each endpoint is attempted once under normal circumstances. A 502, 503,
    // 504 or timeout is a server failure, not a reason to send the same heavy
    // query again as GET. This avoids the repeated 12-second requests observed
    // in the browser Network panel.
    for (const endpoint of OVERPASS_ENDPOINTS) {
      let useGet = false;
      for (let attempt = 0; attempt < 2; attempt++) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 6500);
        try {
          const response = await fetch(
            useGet ? `${endpoint}?${body}` : endpoint,
            useGet
              ? { method: 'GET', signal: controller.signal }
              : {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
                  body,
                  signal: controller.signal,
                },
          );

          if (!response.ok) {
            lastStatus = response.status;
            // Only retry as GET if the server explicitly rejects POST.
            if (!useGet && [405, 415, 501].includes(response.status)) {
              useGet = true;
              continue;
            }
            console.warn('[CareRide facilities] Overpass HTTP failure', {
              endpoint, status: response.status,
            });
            break;
          }

          const payload: unknown = await response.json();
          if (!payload || typeof payload !== 'object'
              || !Array.isArray((payload as { elements?: unknown }).elements)) {
            console.warn('[CareRide facilities] Invalid Overpass response', { endpoint });
            break;
          }
          const facilities = parseOverpassHealthcare(payload);
          this.cache.set(key, { at: Date.now(), facilities });
          return facilities;
        } catch (error) {
          console.warn('[CareRide facilities] Overpass request failed', {
            endpoint,
            reason: error instanceof Error ? error.name : 'unknown',
            detail: error instanceof Error ? error.message : String(error),
          });
          break;
        } finally {
          clearTimeout(timeout);
        }
      }
    }

    console.warn('[CareRide facilities] All public Overpass endpoints failed', {
      attemptedEndpoints: OVERPASS_ENDPOINTS.length,
      lastHttpStatus: lastStatus ?? null,
    });

    // Photon is a separate OSM-derived place index. It is a best-effort fallback
    // when public Overpass servers are down, never a fabricated facility list.
    try {
      const fallback = await this.loadPhotonFacilities(latitude, longitude);
      if (fallback.length) {
        this.cache.set(key, { at: Date.now(), facilities: fallback });
        return fallback;
      }
    } catch (error) {
      console.warn('[CareRide facilities] Photon fallback unavailable', error);
    }

    // If the service is temporarily unavailable, reuse a previously verified
    // response for this area rather than replacing it with invented facilities.
    const stale = this.cache.get(key);
    if (stale) {
      return stale.facilities;
    }
    throw new Error(facilityFailureMessage(lastStatus));
  }
  private async loadPhotonFacilities(latitude: number, longitude: number): Promise<HealthcareFacility[]> {
    const searches: Array<{ query: string; kind: HealthcareKind }> = [
      { query: 'hospital', kind: 'hospital' },
      { query: 'medical center', kind: 'hospital' },
      { query: 'health center', kind: 'health-center' },
      { query: 'clinic', kind: 'clinic' },
    ];
    const results = await Promise.allSettled(searches.map(async ({ query, kind }) => {
      const url = new URL('https://photon.komoot.io/api/');
      url.searchParams.set('q', query);
      url.searchParams.set('lat', String(latitude));
      url.searchParams.set('lon', String(longitude));
      url.searchParams.set('limit', '30');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6500);
      try {
        const response = await fetch(url.toString(), { signal: controller.signal });
        if (!response.ok) throw new Error(`Photon HTTP ${response.status}`);
        const payload = await response.json() as {
          features?: Array<{
            geometry?: { coordinates?: number[] };
            properties?: Record<string, unknown>;
          }>;
        };
        return (payload.features ?? []).flatMap((feature): HealthcareFacility[] => {
          const props = feature.properties ?? {};
          const coords = feature.geometry?.coordinates;
          const lon = Number(coords?.[0]);
          const lat = Number(coords?.[1]);
          const name = typeof props['name'] === 'string' ? props['name'].trim() : '';
          if (!name || !Number.isFinite(lat) || !Number.isFinite(lon)
            || distanceMeters({ latitude, longitude }, { latitude: lat, longitude: lon }) > 8000) return [];
          const osmValue = String(props['osm_value'] ?? '').toLowerCase();
          const osmKey = String(props['osm_key'] ?? '').toLowerCase();
          // Require OSM healthcare classification; a text match alone is insufficient.
          const recognized = (osmKey === 'amenity' && ['hospital', 'clinic', 'doctors'].includes(osmValue))
            || (osmKey === 'healthcare' && ['hospital', 'clinic', 'centre', 'center'].includes(osmValue));
          if (!recognized) return [];
          const actualKind: HealthcareKind = osmValue === 'hospital' ? 'hospital'
            : ['centre', 'center'].includes(osmValue) ? 'health-center'
            : osmValue === 'clinic' || osmValue === 'doctors' ? 'clinic' : kind;
          return [{
            id: `photon/${String(props['osm_type'] ?? 'osm')}/${String(props['osm_id'] ?? `${lat},${lon}`)}`,
            name, unnamed: false, kind: actualKind, latitude: lat, longitude: lon,
          }];
        });
      } finally {
        clearTimeout(timer);
      }
    }));
    const unique = new Map<string, HealthcareFacility>();
    for (const result of results) {
      if (result.status !== 'fulfilled') continue;
      for (const facility of result.value) {
        unique.set(`${facility.name.toLowerCase()}|${facility.latitude.toFixed(4)}|${facility.longitude.toFixed(4)}`, facility);
      }
    }
    return [...unique.values()].sort((a, b) => distanceMeters({ latitude, longitude }, a) - distanceMeters({ latitude, longitude }, b));
  }

}
