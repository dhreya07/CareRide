import { Injectable } from '@angular/core';
import { environment } from '../../../environments/environment';

export interface MapPoint {
  latitude: number;
  longitude: number;
  label: string;
}

export interface PlaceSuggestion {
  id: string;
  label: string;
  latitude: number;
  longitude: number;
}

/** A reading from the device Geolocation API. This is never the map's default center. */
export interface DeviceGpsFix {
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
  source: 'device-gps';
  /** Device time of this reading, when the browser provides it. */
  capturedAt?: string;
}

function deviceFixFromPosition(position: GeolocationPosition): DeviceGpsFix {
  const accuracy = position.coords.accuracy;
  const fix: DeviceGpsFix = {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracyMeters: Number.isFinite(accuracy) ? accuracy : null,
    source: 'device-gps',
  };
  if (Number.isFinite(position.timestamp)) {
    fix.capturedAt = new Date(position.timestamp).toISOString();
  }
  return fix;
}

export const GPS_GOOD_METERS = 30;
export const GPS_FAIR_METERS = 100;

export function gpsAccuracyLevel(meters: number | null): 'good' | 'fair' | 'poor' | 'unknown' {
  if (meters === null || !Number.isFinite(meters) || meters < 0) {
    return 'unknown';
  }
  if (meters <= GPS_GOOD_METERS) {
    return 'good';
  }
  if (meters <= GPS_FAIR_METERS) {
    return 'fair';
  }
  return 'poor';
}

export interface PlaceDescription {
  title: string;
  detail: string;
}

const COORDINATE_LABEL = /^-?\d+\.\d+,\s*-?\d+\.\d+$/;

export function isCoordinateLabel(label: string | null | undefined): boolean {
  return COORDINATE_LABEL.test((label || '').trim());
}

export function isUsableCoordinate(latitude: number, longitude: number): boolean {
  return Number.isFinite(latitude) && latitude >= -90 && latitude <= 90
    && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180;
}

export function preferredPlaceName(label: string | null | undefined): string | null {
  const text = (label || '').trim();
  if (!text || text === 'Selected map location' || text === 'Finding this place…' || isCoordinateLabel(text)) {
    return null;
  }
  return text;
}

export function placeFromAddress(
  address: Record<string, string> | undefined,
  name: string | undefined,
  coordinatesLabel: string,
  preferred?: string | null,
): PlaceDescription {
  const preferredName = preferredPlaceName(preferred);
  const named = (name || '').trim();
  const road = (address?.['road'] || address?.['pedestrian'] || '').trim();
  const barangay = (
    address?.['suburb']
    || address?.['neighbourhood']
    || address?.['quarter']
    || address?.['village']
    || address?.['hamlet']
    || ''
  ).trim();
  const city = (address?.['city'] || address?.['town'] || address?.['municipality'] || '').trim();
  const province = (address?.['state'] || '').trim();
  const parts = [...new Set([road, barangay, city, province].filter((part) => part.length > 0))];
  const title = preferredName || named || parts[0] || 'Selected map location';
  const detail = parts.filter((part) => part !== title).join(', ');
  return {
    title,
    detail: detail || (title === 'Selected map location' ? coordinatesLabel : ''),
  };
}

export function gpsAccuracyText(meters: number | null): string {
  const rounded = meters === null ? null : Math.round(meters);
  switch (gpsAccuracyLevel(meters)) {
    case 'good':
      return `GPS accuracy: ${rounded} m.`;
    case 'fair':
      return `GPS accuracy: ${rounded} m. Tap the map if you need to adjust the point.`;
    case 'poor':
      return `GPS accuracy is poor (${rounded} m). Move outdoors or tap the map to place the point.`;
    default:
      return 'GPS accuracy was not reported by this device. Tap the map if the point looks wrong.';
  }
}

export interface RideMapData {
  pickup: MapPoint | null;
  destination: MapPoint | null;
  driverLocation: MapPoint | null;
}

type GoogleLatLng = { lat: () => number; lng: () => number };
type GoogleGeocoder = {
  geocode: (
    request: { address: string },
    callback: (results: Array<{ formatted_address?: string; geometry?: { location?: GoogleLatLng } }> | null, status: string) => void,
  ) => void;
};
type GooglePlaces = {
  AutocompleteService: new () => {
    getPlacePredictions: (
      request: { input: string; locationBias?: unknown },
      callback: (results: Array<{ place_id?: string; description?: string }> | null, status: string) => void,
    ) => void;
  };
  PlacesService: new (container: HTMLElement) => {
    getDetails: (
      request: { placeId: string; fields: string[] },
      callback: (place: { formatted_address?: string; name?: string; geometry?: { location?: GoogleLatLng } } | null, status: string) => void,
    ) => void;
  };
};

@Injectable({ providedIn: 'root' })
export class MapsService {
  private loadPromise: Promise<void> | null = null;
  private photonCache = new Map<string, { at: number; places: PlaceSuggestion[] }>();
  private photonPending = new Map<string, Promise<PlaceSuggestion[]>>();

  get configured(): boolean {
    return Boolean(environment.googleMaps.apiKey);
  }

  getUnavailableMessage(): string {
    return this.configured
      ? 'Google Maps is configured. Search an address, then save the coordinates before submitting.'
      : 'Add a Google Maps browser API key in src/environments/environment.ts to enable address lookup. Restrict the key to this app origin and the Maps JavaScript API.';
  }

  getRideMapData(pickup: MapPoint | null, destination: MapPoint | null): RideMapData {
    return { pickup, destination, driverLocation: null };
  }

  coordinateLabel(latitude: number, longitude: number): string {
    return `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
  }

  /**
   * One-time device position. Call only from an explicit user action.
   * This does not watch or store a location history.
   */
  async geolocationPermission(): Promise<'granted' | 'denied' | 'prompt' | 'unknown'> {
    const permissions = navigator.permissions;
    if (!permissions || typeof permissions.query !== 'function') {
      return 'unknown';
    }
    try {
      const status = await permissions.query({ name: 'geolocation' });
      if (status.state === 'granted' || status.state === 'denied' || status.state === 'prompt') {
        return status.state;
      }
    } catch {
      return 'unknown';
    }
    return 'unknown';
  }

  /**
   * Follows the device while the caller keeps the returned stop function.
   * It does not write pickup or destination coordinates.
   */
  watchDeviceGps(
    onFix: (fix: DeviceGpsFix) => void,
    onError: (message: string, denied: boolean) => void,
  ): () => void {
    const geolocation = navigator.geolocation;
    if (!geolocation || typeof geolocation.watchPosition !== 'function') {
      onError('GPS is not available on this device. Choose a point on the map.', false);
      return () => undefined;
    }
    const watchId = geolocation.watchPosition(
      (position) => onFix(deviceFixFromPosition(position)),
      (error) => onError(this.locationError(error), error.code === error.PERMISSION_DENIED),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 },
    );
    return () => {
      geolocation.clearWatch(watchId);
    };
  }

  currentPosition(): Promise<DeviceGpsFix> {
    const geolocation = navigator.geolocation;
    if (!geolocation || typeof geolocation.getCurrentPosition !== 'function') {
      return Promise.reject(new Error('Location is unavailable in this browser. Search for a pickup or adjust the map.'));
    }
    const attempt = (highAccuracy: boolean, timeout: number): Promise<DeviceGpsFix> =>
      new Promise((resolve, reject) => {
        geolocation.getCurrentPosition(
          (position) => resolve(deviceFixFromPosition(position)),
          (error) => reject(error),
          { enableHighAccuracy: highAccuracy, timeout, maximumAge: 0 },
        );
      });
    // Request a fresh network-based fix first for faster desktop response.
    // If unavailable, try high accuracy once. Never substitute map center
    // or cached coordinates for a device GPS reading.
    return attempt(false, 7000).catch(async (error: GeolocationPositionError) => {
      if (error.code === 1) {
        throw new Error(this.locationError(error));
      }
      try {
        return await attempt(true, 9000);
      } catch (fallbackError) {
        throw new Error(this.locationError(fallbackError as GeolocationPositionError));
      }
    });
  }

  /**
   * OpenStreetMap Nominatim lookup. Returns coordinates when the provider
   * has no label, so the app never invents a street address.
   */
  async reverseGeocode(latitude: number, longitude: number): Promise<string> {
    const fallback = this.coordinateLabel(latitude, longitude);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90
      || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      throw new Error('That map point is not a valid location.');
    }
    const key = `${latitude.toFixed(5)},${longitude.toFixed(5)}`;
    const cached = this.reverseCache.get(key);
    if (cached) {
      return cached;
    }
    await this.paceReverseLookup();
    try {
      const url = new URL('https://nominatim.openstreetmap.org/reverse');
      url.searchParams.set('format', 'jsonv2');
      url.searchParams.set('lat', String(latitude));
      url.searchParams.set('lon', String(longitude));
      url.searchParams.set('zoom', '18');
      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) {
        return fallback;
      }
      const body = await response.json() as { display_name?: unknown };
      const label = typeof body.display_name === 'string' ? body.display_name.trim() : '';
      const result = label || fallback;
      this.reverseCache.set(key, result);
      return result;
    } catch {
      return fallback;
    }
  }

  private reverseCache = new Map<string, string>();
  private placeCache = new Map<string, PlaceDescription>();
  private lastReverseAt = 0;

  /**
   * Readable name for a confirmed map point. Coordinates stay with the caller.
   * A named facility or searched place is kept. A failed lookup does not invent a name.
   */
  async describePlace(
    latitude: number,
    longitude: number,
    preferred?: string | null,
  ): Promise<PlaceDescription> {
    const coordinates = this.coordinateLabel(latitude, longitude);
    const named = preferredPlaceName(preferred);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90
      || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      return { title: named || 'Selected map location', detail: coordinates };
    }
    const key = `${latitude.toFixed(5)},${longitude.toFixed(5)}|${named ?? ''}`;
    const cached = this.placeCache.get(key);
    if (cached) {
      return cached;
    }
    await this.paceReverseLookup();
    try {
      const url = new URL('https://nominatim.openstreetmap.org/reverse');
      url.searchParams.set('format', 'jsonv2');
      url.searchParams.set('lat', String(latitude));
      url.searchParams.set('lon', String(longitude));
      url.searchParams.set('zoom', '18');
      url.searchParams.set('addressdetails', '1');
      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) {
        return { title: named || 'Selected map location', detail: coordinates };
      }
      const body = await response.json() as { name?: unknown; address?: Record<string, string> };
      const place = placeFromAddress(
        body.address,
        typeof body.name === 'string' ? body.name : '',
        coordinates,
        named,
      );
      if (place.title !== 'Selected map location' || named) {
        this.placeCache.set(key, place);
      }
      return place;
    } catch {
      return { title: named || 'Selected map location', detail: coordinates };
    }
  }

  async readableBookingLabel(
    stored: string,
    latitude: number | null | undefined,
    longitude: number | null | undefined,
  ): Promise<string> {
    const text = (stored || '').trim();
    if (!isCoordinateLabel(text) || latitude == null || longitude == null) {
      return text;
    }
    const place = await this.describePlace(latitude, longitude, null);
    return place.title;
  }

  private async paceReverseLookup(): Promise<void> {
    const wait = 1100 - (Date.now() - this.lastReverseAt);
    if (wait > 0) {
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
    this.lastReverseAt = Date.now();
  }

  private locationError(error: GeolocationPositionError): string {
    if (error.code === error.PERMISSION_DENIED) {
      return 'Location permission was denied. You can still choose a point on the map.';
    }
    if (error.code === error.POSITION_UNAVAILABLE) {
      return 'Your location is unavailable. Choose a point on the map instead.';
    }
    return 'The location request timed out. Choose a point on the map instead.';
  }

  /**
   * Place suggestions from the configured Google Places API.
   * This does not call the public Nominatim autocomplete endpoint.
   */
  async searchPlaces(
    query: string,
    bias?: { latitude: number; longitude: number },
  ): Promise<PlaceSuggestion[]> {
    const text = query.trim();
    if (text.length < 3) {
      return [];
    }
    if (!this.configured) {
      throw new Error(this.searchUnavailableMessage());
    }
    await this.loadSdk();
    const places = this.googlePlaces();
    if (!places) {
      throw new Error('Google Places did not load. Enable the Places API for this browser key.');
    }
    const autocomplete = new places.AutocompleteService();
    const predictions = await new Promise<Array<{ place_id?: string; description?: string }>>((resolve) => {
      autocomplete.getPlacePredictions({
        input: text,
        locationBias: bias
          ? { center: { lat: bias.latitude, lng: bias.longitude }, radius: 20000 }
          : { center: { lat: 13.4115, lng: 121.1803 }, radius: 30000 },
      }, (results, status) => {
        if (status !== 'OK' || !results) {
          resolve([]);
          return;
        }
        resolve(results.slice(0, 5));
      });
    });
    const details = new places.PlacesService(document.createElement('div'));
    const suggestions: PlaceSuggestion[] = [];
    for (const prediction of predictions) {
      if (!prediction.place_id) {
        continue;
      }
      const place = await new Promise<PlaceSuggestion | null>((resolve) => {
        details.getDetails({
          placeId: prediction.place_id as string,
          fields: ['geometry', 'formatted_address', 'name'],
        }, (result, status) => {
          const location = result?.geometry?.location;
          if (status !== 'OK' || !location) {
            resolve(null);
            return;
          }
          resolve({
            id: prediction.place_id as string,
            label: result?.formatted_address || result?.name || prediction.description || text,
            latitude: location.lat(),
            longitude: location.lng(),
          });
        });
      });
      if (place) {
        suggestions.push(place);
      }
    }
    return suggestions;
  }

  searchUnavailableMessage(): string {
    return 'Address search needs a Google Maps browser key restricted to this site and the Places API. You can still tap or drag the map.';
  }

  /**
   * Place search for the full-screen picker.
   * Uses Google Places when a browser key is configured.
   * Otherwise uses Photon, which is a search service. This does not call Nominatim autocomplete.
   */
  async searchLocations(
    query: string,
    bias?: { latitude: number; longitude: number },
  ): Promise<PlaceSuggestion[]> {
    const text = query.trim();
    if (text.length < 3) {
      return [];
    }
    if (this.configured) {
      return this.searchPlaces(text, bias);
    }
    const latitude = bias?.latitude ?? 13.4115;
    const longitude = bias?.longitude ?? 121.1803;
    const key = `${text.toLowerCase()}|${latitude.toFixed(2)},${longitude.toFixed(2)}`;
    const cached = this.photonCache.get(key);
    if (cached && Date.now() - cached.at < 5 * 60 * 1000) {
      return cached.places;
    }
    const existing = this.photonPending.get(key);
    if (existing) {
      return existing;
    }
    const request = this.searchWithPhoton(text, latitude, longitude, key);
    this.photonPending.set(key, request);
    try {
      return await request;
    } finally {
      this.photonPending.delete(key);
    }
  }

  private async searchWithPhoton(
    text: string,
    latitude: number,
    longitude: number,
    key: string,
  ): Promise<PlaceSuggestion[]> {
    const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(text)}&lat=${latitude}&lon=${longitude}&limit=5&lang=en`;
    let response: Response;
    try {
      response = await fetch(url);
    } catch {
      throw new Error('Place search is unavailable right now. Move the pin on the map instead.');
    }
    if (response.status === 429) {
      throw new Error('Place search is busy. Wait a moment, or move the pin on the map.');
    }
    if (!response.ok) {
      throw new Error('Place search is unavailable right now. Move the pin on the map instead.');
    }
    const payload = await response.json() as {
      features?: Array<{
        geometry?: { coordinates?: number[] };
        properties?: Record<string, string>;
      }>;
    };
    const places: PlaceSuggestion[] = [];
    for (const feature of payload.features ?? []) {
      const coordinates = feature.geometry?.coordinates;
      const longitudeValue = Number(coordinates?.[0]);
      const latitudeValue = Number(coordinates?.[1]);
      if (!isUsableCoordinate(latitudeValue, longitudeValue)) {
        continue;
      }
      const properties = feature.properties ?? {};
      const parts = [properties['name'], properties['housenumber'], properties['street'], properties['city'], properties['state']]
        .map((part) => part?.trim())
        .filter((part): part is string => Boolean(part));
      places.push({
        id: `${properties['osm_id'] || places.length}:${latitudeValue},${longitudeValue}`,
        label: parts.join(', ') || this.coordinateLabel(latitudeValue as number, longitudeValue as number),
        latitude: latitudeValue as number,
        longitude: longitudeValue as number,
      });
    }
    this.photonCache.set(key, { at: Date.now(), places });
    return places;
  }

  async geocode(address: string): Promise<MapPoint> {
    const query = address.trim();
    if (!query) {
      throw new Error('Enter an address before looking it up on the map.');
    }
    if (!this.configured) {
      throw new Error(this.getUnavailableMessage());
    }

    await this.loadSdk();
    const googleMaps = this.googleMaps();
    if (!googleMaps?.maps?.Geocoder) {
      throw new Error('The Google Maps JavaScript API did not load. Check the browser key and enabled APIs.');
    }

    const geocoder = new googleMaps.maps.Geocoder();
    return await new Promise((resolve, reject) => {
      geocoder.geocode({ address: query }, (results, status) => {
        if (status !== 'OK' || !results?.[0]?.geometry?.location) {
          reject(new Error('That address could not be found. Check the spelling or enter a more complete location.'));
          return;
        }
        const location = results[0].geometry.location;
        resolve({
          latitude: location.lat(),
          longitude: location.lng(),
          label: results[0].formatted_address || query,
        });
      });
    });
  }

  private googleMaps(): { maps?: { Geocoder: new () => GoogleGeocoder; places?: GooglePlaces } } | undefined {
    return (window as unknown as {
      google?: { maps?: { Geocoder: new () => GoogleGeocoder; places?: GooglePlaces } };
    }).google;
  }

  private googlePlaces(): GooglePlaces | null {
    return this.googleMaps()?.maps?.places ?? null;
  }

  private loadSdk(): Promise<void> {
    if (this.loadPromise) {
      return this.loadPromise;
    }

    this.loadPromise = new Promise((resolve, reject) => {
      const existing = document.getElementById('careride-google-maps');
      if (existing) {
        resolve();
        return;
      }

      const script = document.createElement('script');
      script.id = 'careride-google-maps';
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(environment.googleMaps.apiKey)}&libraries=places`;
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      script.onerror = () => {
        this.loadPromise = null;
        reject(new Error('Unable to load the Google Maps script. Confirm the API key, billing, and HTTP referrer restrictions.'));
      };
      document.head.appendChild(script);
    });

    return this.loadPromise;
  }
}
