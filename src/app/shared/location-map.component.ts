import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  NgZone,
  OnChanges,
  OnDestroy,
  Output,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import * as L from 'leaflet';

export interface MapCoordinate {
  latitude: number;
  longitude: number;
}

/** CareRide service area: Calapan City, Oriental Mindoro. */
export const CALAPAN_CITY: MapCoordinate = { latitude: 13.4115, longitude: 121.1803 };
export const CALAPAN_ZOOM = 14;

export function mapHostIsReady(width: number, height: number): boolean {
  return width >= 32 && height >= 32;
}

/** True when the visible container no longer matches the Leaflet map size. */
export function mapLayoutIsStale(
  containerWidth: number,
  containerHeight: number,
  mapWidth: number,
  mapHeight: number,
): boolean {
  if (!mapHostIsReady(containerWidth, containerHeight)) {
    return false;
  }
  return containerWidth !== mapWidth || containerHeight !== mapHeight;
}

/** Accuracy rings and the blue GPS dot must not receive taps. */
export const MAP_OVERLAY_POINTER_OPTIONS = {
  interactive: false,
  bubblingMouseEvents: false,
  className: 'care-location-overlay',
} as const;

export function mapFocus(
  pickup: MapCoordinate | null,
  destination: MapCoordinate | null,
  driver: MapCoordinate | null = null,
): { latitude: number; longitude: number; zoom: number } | { points: MapCoordinate[] } {
  const points = [pickup, destination, driver].filter((point): point is MapCoordinate =>
    Boolean(point) && Number.isFinite(point!.latitude) && Number.isFinite(point!.longitude),
  );
  if (points.length >= 2) {
    return { points };
  }
  if (points.length === 1) {
    return { latitude: points[0].latitude, longitude: points[0].longitude, zoom: 16 };
  }
  return { latitude: CALAPAN_CITY.latitude, longitude: CALAPAN_CITY.longitude, zoom: CALAPAN_ZOOM };
}

@Component({
  selector: 'app-location-map',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './location-map.component.html',
  styleUrl: './location-map.component.scss',
})
export class LocationMapComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() pickup: MapCoordinate | null = null;
  @Input() destination: MapCoordinate | null = null;
  /** Device GPS accuracy for the pickup, in meters. Not used for the default map center. */
  @Input() pickupAccuracyMeters: number | null = null;
  @Input() driver: MapCoordinate | null = null;
  @Input() driverAccuracyMeters: number | null = null;
  @Input() currentLocation: MapCoordinate | null = null;
  @Input() currentAccuracyMeters: number | null = null;
  /** Preview maps show markers but do not move a confirmed point. */
  @Input() selectionEnabled = true;
  @Input() compact = false;
  /** Road geometry between confirmed pickup and destination. Not a GPS trail. */
  @Input() route: MapCoordinate[] | null = null;
  @Output() placeSelected = new EventEmitter<MapCoordinate>();
  @Output() previewPressed = new EventEmitter<void>();
  @Output() markerMoved = new EventEmitter<{ role: 'pickup' | 'destination'; point: MapCoordinate }>();

  tilesFailed = false;

  @ViewChild('mapHost', { static: true }) private mapHost?: ElementRef<HTMLElement>;

  private map: L.Map | null = null;
  private tiles: L.TileLayer | null = null;
  private pickupMarker: L.Marker | null = null;
  private destinationMarker: L.Marker | null = null;
  private driverMarker: L.Marker | null = null;
  private accuracyCircle: L.Circle | null = null;
  private currentDot: L.CircleMarker | null = null;
  private currentCircle: L.Circle | null = null;
  private routeLine: L.Polyline | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private readyFrame = 0;
  private seenSize = '';
  private focusKey = '';
  private tileErrors = 0;

  constructor(private zone: NgZone) {}

  ngAfterViewInit(): void {
    const host = this.mapHost?.nativeElement;
    if (host && typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.onHostResize());
      this.resizeObserver.observe(host);
    }
    this.whenContainerReady();
  }

  ngOnChanges(): void {
    this.drawRoute();
    this.drawMarkers();
    this.showFocus(false);
  }

  ngOnDestroy(): void {
    cancelAnimationFrame(this.readyFrame);
    this.resizeObserver?.disconnect();
    this.map?.remove();
    this.map = null;
    this.tiles = null;
    this.routeLine = null;
    this.pickupMarker = null;
    this.destinationMarker = null;
    this.driverMarker = null;
    this.currentDot = null;
    this.currentCircle = null;
    this.accuracyCircle = null;
  }

  /** Returns true once the container has a real size and the map matches it. */
  refreshSize(): boolean {
    const host = this.mapHost?.nativeElement;
    if (!host || !mapHostIsReady(host.clientWidth, host.clientHeight)) {
      if (!this.map) {
        this.whenContainerReady();
      }
      return false;
    }
    if (!this.map) {
      this.createMap(host);
      return true;
    }
    const size = this.map.getSize();
    if (mapLayoutIsStale(host.clientWidth, host.clientHeight, size.x, size.y)) {
      this.seenSize = `${host.clientWidth}x${host.clientHeight}`;
      this.map.invalidateSize();
      this.drawRoute();
      this.drawMarkers();
      this.showFocus(true);
    }
    return true;
  }

  private whenContainerReady(attempt = 0): void {
    const host = this.mapHost?.nativeElement;
    if (!host || this.map) {
      return;
    }
    if (!mapHostIsReady(host.clientWidth, host.clientHeight)) {
      if (attempt < 30) {
        this.readyFrame = requestAnimationFrame(() => this.whenContainerReady(attempt + 1));
      }
      return;
    }
    this.createMap(host);
  }

  private createMap(host: HTMLElement): void {
    if (this.map || !mapHostIsReady(host.clientWidth, host.clientHeight)) {
      return;
    }
    this.zone.runOutsideAngular(() => {
      this.map = L.map(host, {
        zoomControl: true,
        attributionControl: true,
      });
      this.tiles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        subdomains: 'abc',
        maxZoom: 19,
        tileSize: 256,
        detectRetina: false,
        updateWhenIdle: false,
        keepBuffer: 2,
        attribution: '&copy; OpenStreetMap',
      });
      this.tiles.on('tileerror', () => {
        this.tileErrors += 1;
        if (this.tileErrors < 6) {
          return;
        }
        this.zone.run(() => {
          this.tilesFailed = true;
        });
      });
      this.tiles.addTo(this.map);
      this.map.on('click', (event: L.LeafletMouseEvent) => {
        this.zone.run(() => {
          if (!this.selectionEnabled) {
            this.previewPressed.emit();
            return;
          }
          this.placeSelected.emit({
            latitude: event.latlng.lat,
            longitude: event.latlng.lng,
          });
        });
      });
      // A view is required before markers are added. Drawing the GPS dot
      // before setView makes bringToFront throw and aborts the rest of setup,
      // which leaves zoom controls over a gray map with no tiles or markers.
      const focus = mapFocus(this.pickup, this.destination, this.driver);
      const center = 'points' in focus ? focus.points[0] : focus;
      const zoom = 'points' in focus ? CALAPAN_ZOOM : focus.zoom;
      this.map.setView([center.latitude, center.longitude], zoom);
      this.seenSize = `${host.clientWidth}x${host.clientHeight}`;
      this.drawRoute();
      this.drawMarkers();
      this.showFocus(true);
      this.map.invalidateSize();
    });
  }

  private onHostResize(): void {
    const host = this.mapHost?.nativeElement;
    if (!host) {
      return;
    }
    if (!mapHostIsReady(host.clientWidth, host.clientHeight)) {
      return;
    }
    const next = `${host.clientWidth}x${host.clientHeight}`;
    const size = this.map?.getSize();
    const stale = !size || mapLayoutIsStale(host.clientWidth, host.clientHeight, size.x, size.y);
    if (!stale && next === this.seenSize) {
      return;
    }
    this.seenSize = next;
    if (!this.map) {
      this.createMap(host);
      return;
    }
    this.map.invalidateSize();
    this.drawRoute();
    this.drawMarkers();
    this.showFocus(true);
  }

  private drawRoute(): void {
    const map = this.map;
    if (!map) {
      return;
    }
    const points = (this.route ?? []).filter((point) =>
      Number.isFinite(point.latitude) && Number.isFinite(point.longitude));
    if (points.length < 2) {
      this.routeLine?.remove();
      this.routeLine = null;
      return;
    }
    const latLngs = points.map((point) => L.latLng(point.latitude, point.longitude));
    if (this.routeLine && map.hasLayer(this.routeLine)) {
      this.routeLine.setLatLngs(latLngs);
      return;
    }
    this.routeLine?.remove();
    this.routeLine = null;
    this.routeLine = L.polyline(latLngs, {
      color: '#0f766e',
      weight: 5,
      opacity: 0.9,
      interactive: false,
    }).addTo(map);
  }

  private drawMarkers(): void {
    if (!this.map) {
      return;
    }
    this.pickupMarker = this.placeMarker(this.pickupMarker, this.pickup, 'pickup', 'Pickup');
    this.drawAccuracy();
    this.destinationMarker = this.placeMarker(
      this.destinationMarker,
      this.destination,
      'destination',
      'Destination',
    );
    this.driverMarker = this.placeMarker(this.driverMarker, this.driver, 'driver', 'Driver');
    this.drawCurrentLocation();
  }

  recenter(point: MapCoordinate): void {
    this.map?.panTo([point.latitude, point.longitude]);
  }

  private drawCurrentLocation(): void {
    const map = this.map;
    if (!map) {
      return;
    }
    if (!this.currentLocation) {
      this.currentDot?.remove();
      this.currentCircle?.remove();
      this.currentDot = null;
      this.currentCircle = null;
      return;
    }
    const center = L.latLng(this.currentLocation.latitude, this.currentLocation.longitude);
    const meters = this.currentAccuracyMeters;
    if (meters === null || !Number.isFinite(meters) || meters < 0) {
      this.currentCircle?.remove();
      this.currentCircle = null;
    } else if (this.currentCircle) {
      this.currentCircle.setLatLng(center);
      this.currentCircle.setRadius(meters);
    } else {
      this.currentCircle = L.circle(center, {
        ...MAP_OVERLAY_POINTER_OPTIONS,
        radius: meters,
        color: '#1a73e8',
        weight: 1,
        fillColor: '#1a73e8',
        fillOpacity: 0.15,
      }).addTo(map);
    }
    if (this.currentDot) {
      this.currentDot.setLatLng(center);
    } else {
      this.currentDot = L.circleMarker(center, {
        ...MAP_OVERLAY_POINTER_OPTIONS,
        radius: 8,
        color: '#ffffff',
        weight: 3,
        fillColor: '#1a73e8',
        fillOpacity: 1,
      }).addTo(map);
    }
    const dotElement = this.currentDot.getElement();
    if (dotElement?.parentNode) {
      this.currentDot.bringToFront();
    }
  }

  private drawAccuracy(): void {
    const map = this.map;
    if (!map) {
      return;
    }
    const gpsPoint = this.driver && this.driverAccuracyMeters !== null
      ? { point: this.driver, meters: this.driverAccuracyMeters }
      : this.pickup && this.pickupAccuracyMeters !== null
        ? { point: this.pickup, meters: this.pickupAccuracyMeters }
        : null;
    const meters = gpsPoint?.meters ?? null;
    if (!gpsPoint || meters === null || !Number.isFinite(meters) || meters < 0) {
      this.accuracyCircle?.remove();
      this.accuracyCircle = null;
      return;
    }
    const center = L.latLng(gpsPoint.point.latitude, gpsPoint.point.longitude);
    if (this.accuracyCircle) {
      this.accuracyCircle.setLatLng(center);
      this.accuracyCircle.setRadius(meters);
      return;
    }
    this.accuracyCircle = L.circle(center, {
      ...MAP_OVERLAY_POINTER_OPTIONS,
      radius: meters,
      color: '#11212D',
      weight: 1,
      fillColor: '#4C6B73',
      fillOpacity: 0.15,
    }).addTo(map);
  }

  private showFocus(force: boolean): void {
    const map = this.map;
    if (!map) {
      return;
    }
    const route = (this.route ?? []).filter((point) =>
      Number.isFinite(point.latitude) && Number.isFinite(point.longitude));
    const routeKey = route.length >= 2
      ? `${route.length}:${route[0].latitude},${route[0].longitude}:${route[route.length - 1].latitude},${route[route.length - 1].longitude}`
      : '';
    const key = `${this.pickup?.latitude ?? ''},${this.pickup?.longitude ?? ''}|${this.destination?.latitude ?? ''},${this.destination?.longitude ?? ''}|${this.driver?.latitude ?? ''},${this.driver?.longitude ?? ''}|${routeKey}`;
    if (!force && key === this.focusKey) {
      return;
    }
    this.focusKey = key;
    if (route.length >= 2) {
      const points = [this.pickup, this.destination, ...route].filter((point): point is MapCoordinate =>
        Boolean(point) && Number.isFinite(point!.latitude) && Number.isFinite(point!.longitude));
      map.fitBounds(L.latLngBounds(points.map((point) => [point.latitude, point.longitude])), {
        padding: [28, 28],
      });
      return;
    }
    const focus = mapFocus(this.pickup, this.destination, this.driver);
    if ('points' in focus) {
      map.fitBounds(L.latLngBounds(focus.points.map((point) => [point.latitude, point.longitude])), {
        padding: [28, 28],
      });
      return;
    }
    map.setView([focus.latitude, focus.longitude], focus.zoom);
  }

  private placeMarker(
    current: L.Marker | null,
    point: MapCoordinate | null,
    kind: 'pickup' | 'destination' | 'driver',
    label: string,
  ): L.Marker | null {
    const map = this.map;
    if (!map) {
      return current;
    }
    if (!point) {
      current?.remove();
      return null;
    }
    const latLng = L.latLng(point.latitude, point.longitude);
    if (current && map.hasLayer(current)) {
      current.setLatLng(latLng);
      return current;
    }
    current?.remove();
    const marker = L.marker(latLng, {
      draggable: this.selectionEnabled && kind !== 'driver',
      autoPan: true,
      icon: L.divIcon({
        className: `care-map-pin ${kind}`,
        html: `<span>${label}</span>`,
        iconSize: [92, 32],
        iconAnchor: [46, 32],
      }),
      keyboard: false,
      title: label,
    }).addTo(map);
    if (kind !== 'driver') {
      marker.on('dragend', () => {
        const next = marker.getLatLng();
        this.zone.run(() => {
          this.markerMoved.emit({
            role: kind,
            point: { latitude: next.lat, longitude: next.lng },
          });
        });
      });
    }
    return marker;
  }
}
