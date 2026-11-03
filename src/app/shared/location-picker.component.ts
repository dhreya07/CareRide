import {
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  NgZone,
  OnChanges,
  OnDestroy,
  OnInit,
  Output,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import * as L from 'leaflet';
import { isCoordinateLabel, isUsableCoordinate, MapsService, PlaceSuggestion, preferredPlaceName } from '../core/services/maps.service';
import { RoadRouteService, roadRouteSummary } from '../core/services/road-route.service';
import {
  FacilityFilter,
  HealthcareFacility,
  HealthcareFacilityService,
  distanceMeters,
  facilityKindLabel,
  facilityIdsWithLabels,
  facilityLabel,
  filterFacilities,
  formatDistance,
  sortFacilities,
} from '../core/services/healthcare-facilities';
import { CALAPAN_CITY, CALAPAN_ZOOM, MAP_OVERLAY_POINTER_OPTIONS, MapCoordinate, mapHostIsReady } from './location-map.component';

export interface PickedLocation {
  latitude: number;
  longitude: number;
  label: string;
  detail?: string;
  source: 'manual' | 'search' | 'gps';
}

export function locationPickerPhoneLayout(width: number): boolean {
  return width <= 480;
}

/** Two stops closer than this are the same place, not a trip. */
export const SAME_STOP_METERS = 40;

export function placesAreSameStop(
  left: { latitude: number; longitude: number } | null,
  right: { latitude: number; longitude: number } | null,
): boolean {
  if (!left || !right
    || !isUsableCoordinate(left.latitude, left.longitude)
    || !isUsableCoordinate(right.latitude, right.longitude)) {
    return false;
  }
  return distanceMeters(left, right) < SAME_STOP_METERS;
}

@Component({
  selector: 'app-location-picker',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './location-picker.component.html',
  styleUrl: './location-picker.component.scss',
  host: {
    '[class.phone]': 'phoneLayout',
  },
})
export class LocationPickerComponent implements OnInit, AfterViewInit, OnChanges, OnDestroy {
  @Input() role: 'pickup' | 'destination' = 'pickup';
  @Input() initialLatitude: number | null = null;
  @Input() initialLongitude: number | null = null;
  @Input() initialLabel = '';
  @Input() currentLocation: MapCoordinate | null = null;
  @Input() currentAccuracyMeters: number | null = null;
  @Input() initialQuery = '';
  @Input() otherLatitude: number | null = null;
  @Input() otherLongitude: number | null = null;
  @Output() confirmed = new EventEmitter<PickedLocation>();
  @Output() cancelled = new EventEmitter<void>();
  @Output() locate = new EventEmitter<void>();

  @ViewChild('mapHost', { static: true }) private mapHost?: ElementRef<HTMLElement>;

  readonly filters: Array<{ id: FacilityFilter; label: string }> = [
    { id: 'all', label: 'All Places' },
    { id: 'hospital', label: 'Hospitals' },
    { id: 'health-center', label: 'Health Centers' },
    { id: 'clinic', label: 'Clinics' },
  ];

  phoneLayout = false;
  searchQuery = '';
  searchResults: PlaceSuggestion[] = [];
  searchMessage = '';
  searching = false;
  draftLatitude: number | null = null;
  draftLongitude: number | null = null;
  draftTitle = '';
  draftDetail = '';
  draftSource: 'manual' | 'search' | 'gps' = 'manual';
  facilities: HealthcareFacility[] = [];
  facilityFilter: FacilityFilter = 'all';
  adjustingLocation = false;
  selectionReady = false;
  facilitiesFailed = false;
  selectedSearchId = '';
  roadSummary = '';
  roadUnavailable = '';
  private routeToken = 0;
  facilitiesMessage = '';
  facilitiesLoading = false;
  showSearchArea = false;
  tilesFailed = false;
  selectedFacilityId = '';
  waitingForGps = false;
  gpsMessage = '';
  selectionMessage = '';

  private map: L.Map | null = null;
  private facilityLayer: L.LayerGroup | null = null;
  private currentDot: L.CircleMarker | null = null;
  private currentCircle: L.Circle | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private readyFrame = 0;
  private seenSize = '';
  private tileErrors = 0;
  private labelToken = 0;
  private labelTimer: ReturnType<typeof setTimeout> | null = null;
  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private searchGeneration = 0;
  private lastSearchQuery = '';
  private lastFacilityCenter: MapCoordinate | null = null;
  private pinned: { latitude: number; longitude: number; label: string } | null = null;
  private explicitSelection: { latitude: number; longitude: number; label: string; detail: string } | null = null;
  private selectionVersion = 0;
  private holdSelection = false;
  private userDragged = false;
  private selectionMarker: L.Marker | null = null;
  private acceptNextMove = false;
  private gpsRequest = 0;
  private deviceFix: MapCoordinate | null = null;
  private deviceAccuracy: number | null = null;
  private previousOverflow = '';
  private movedToBody = false;
  /** True after the passenger pans while Adjust on map is active. Zoom alone does not count. */
  private movedWhileAdjusting = false;
  /** Map center used for display only. Never treat this as a confirmed stop by itself. */
  private viewLatitude: number | null = null;
  private viewLongitude: number | null = null;

  constructor(
    private host: ElementRef<HTMLElement>,
    private zone: NgZone,
    private maps: MapsService,
    private healthcare: HealthcareFacilityService,
    private roads: RoadRouteService,
    private changes: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    if (this.role === 'destination') {
      this.facilityFilter = 'hospital';
    }
    this.phoneLayout = locationPickerPhoneLayout(window.innerWidth);
    this.searchQuery = this.initialQuery;
    const start = this.startingPoint();
    // Center the map on pickup / GPS / Calapan when helpful, but do not treat that
    // center as a confirmed destination or pickup until the passenger chooses it.
    this.viewLatitude = start.latitude;
    this.viewLongitude = start.longitude;
    this.draftLatitude = null;
    this.draftLongitude = null;
    this.draftTitle = '';
    this.draftDetail = '';
    this.draftSource = 'manual';
    this.selectionReady = false;
    this.explicitSelection = null;
    this.pinned = null;
    this.movedWhileAdjusting = false;
    const named = preferredPlaceName(this.initialLabel);
    if (named && this.initialLatitude !== null && this.initialLongitude !== null
      && isUsableCoordinate(this.initialLatitude, this.initialLongitude)) {
      this.rememberSelection(this.initialLatitude, this.initialLongitude, named, 'manual');
      this.pinned = {
        latitude: this.initialLatitude,
        longitude: this.initialLongitude,
        label: named,
      };
      this.draftTitle = named;
      this.explicitSelection = {
        latitude: this.initialLatitude,
        longitude: this.initialLongitude,
        label: named,
        detail: this.draftDetail,
      };
      this.selectionReady = true;
      this.viewLatitude = this.initialLatitude;
      this.viewLongitude = this.initialLongitude;
    }
  }

  ngAfterViewInit(): void {
    document.body.appendChild(this.host.nativeElement);
    this.movedToBody = true;
    this.previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const host = this.mapHost?.nativeElement;
    if (host && typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.onHostResize());
      this.resizeObserver.observe(host);
    }
    this.whenContainerReady();
    // Pickup should offer a fresh GPS fix immediately, not a silent default map center.
    // A previously confirmed pickup is preserved and never overwritten.
    if (this.role === 'pickup' && !this.selectionReady) {
      this.useMyLocation();
    }
    setTimeout(() => this.refreshSize(), 60);
    setTimeout(() => this.refreshSize(), 320);
  }

  ngOnChanges(): void {
    this.drawGps();
    // Parent GPS watch updates the blue dot only. Never auto-confirm an older
    // parent reading while our explicit fresh GPS request is still pending.
  }

  ngOnDestroy(): void {
    cancelAnimationFrame(this.readyFrame);
    if (this.labelTimer !== null) {
      clearTimeout(this.labelTimer);
    }
    if (this.searchTimer !== null) {
      clearTimeout(this.searchTimer);
    }
    this.resizeObserver?.disconnect();
    this.map?.remove();
    this.map = null;
    if (this.movedToBody) {
      document.body.style.overflow = this.previousOverflow;
      this.host.nativeElement.remove();
    }
  }

  visibleFacilities(): HealthcareFacility[] {
    const origin = this.role === 'destination' && this.otherLatitude !== null && this.otherLongitude !== null
      && isUsableCoordinate(this.otherLatitude, this.otherLongitude)
      ? { latitude: this.otherLatitude, longitude: this.otherLongitude }
      : this.currentLocation ?? this.draftPoint() ?? CALAPAN_CITY;
    return sortFacilities(filterFacilities(this.facilities, this.facilityFilter), origin);
  }

  facilityTitle(facility: HealthcareFacility): string {
    return facilityLabel(facility);
  }

  selectedFacility(): HealthcareFacility | null {
    return this.facilities.find((facility) => facility.id === this.selectedFacilityId) ?? null;
  }

  selectionHeading(): string {
    if (this.role === 'pickup') {
      return 'Selected Pickup';
    }
    return this.selectedFacility()?.kind === 'hospital' ? 'Selected hospital' : 'Selected Destination';
  }

  cardDetail(): string {
    if (this.draftDetail && !isCoordinateLabel(this.draftDetail)) {
      return this.draftDetail;
    }
    return '';
  }

  selectedFacilityAddress(facility: HealthcareFacility): string {
    if (this.explicitSelection
      && this.explicitSelection.latitude === facility.latitude
      && this.explicitSelection.longitude === facility.longitude
      && this.explicitSelection.detail
      && !/^-?\d+\.\d+,\s*-?\d+\.\d+$/.test(this.explicitSelection.detail)) {
      return this.explicitSelection.detail;
    }
    return 'Address is not listed in OpenStreetMap.';
  }

  facilityMeta(facility: HealthcareFacility): string {
    const origin = this.role === 'destination' && this.otherLatitude !== null && this.otherLongitude !== null
      && isUsableCoordinate(this.otherLatitude, this.otherLongitude)
      ? { latitude: this.otherLatitude, longitude: this.otherLongitude }
      : this.currentLocation ?? this.draftPoint();
    const distance = origin ? formatDistance(distanceMeters(origin, facility)) : '';
    return distance
      ? `${facilityKindLabel(facility.kind)} · ${distance} from ${this.role === 'destination' && this.otherLatitude !== null ? 'pickup' : 'your location'} (straight-line)`
      : facilityKindLabel(facility.kind);
  }

  setFilter(filter: FacilityFilter): void {
    this.facilityFilter = filter;
    this.drawFacilities();
    if (!this.facilities.length && !this.facilitiesLoading) void this.searchThisArea();
  }

  scheduleSearch(): void {
    if (this.searchTimer !== null) {
      clearTimeout(this.searchTimer);
    }
    this.searchTimer = setTimeout(() => {
      this.searchTimer = null;
      void this.runSearch();
    }, 500);
  }

  async runSearch(): Promise<void> {
    const text = this.searchQuery.trim();
    if (text.length < 3 || (text === this.lastSearchQuery && this.searchResults.length > 0)) {
      if (text.length < 3) {
        this.searchResults = [];
        this.searchMessage = text ? 'Type at least 3 characters.' : '';
      }
      return;
    }
    const generation = ++this.searchGeneration;
    this.searching = true;
    this.searchMessage = '';
    this.lastSearchQuery = text;
    try {
      const bias = this.draftPoint() ?? undefined;
      const results = await this.maps.searchLocations(text, bias);
      if (generation !== this.searchGeneration) {
        return;
      }
      const usable = results.filter((place) => isUsableCoordinate(place.latitude, place.longitude));
      const skipped = results.length - usable.length;
      this.searchResults = usable;
      if (!usable.length) {
        this.searchMessage = skipped
          ? 'Those results did not include usable coordinates. Move the pin on the map.'
          : 'No matching places were returned. Move the pin on the map.';
      } else {
        this.searchMessage = skipped
          ? 'Some results had no usable coordinates and were left out.'
          : '';
      }
    } catch (error: unknown) {
      if (generation !== this.searchGeneration) {
        return;
      }
      this.searchResults = [];
      this.searchMessage = error instanceof Error
        ? error.message
        : 'Place search is unavailable right now. Move the pin on the map instead.';
    } finally {
      if (generation === this.searchGeneration) {
        this.searching = false;
        this.changes.markForCheck();
      }
    }
  }

  chooseSearchResult(place: PlaceSuggestion): void {
    this.searchGeneration += 1;
    if (this.searchTimer !== null) {
      clearTimeout(this.searchTimer);
      this.searchTimer = null;
    }
    if (!isUsableCoordinate(place.latitude, place.longitude)) {
      this.searchMessage = 'That result has no usable coordinates. Choose another result or move the pin.';
      this.changes.markForCheck();
      return;
    }
    this.searchResults = this.searchResults.map((item) => item);
    this.selectedSearchId = place.id;
    this.searchMessage = '';
    this.searchQuery = place.label;
    this.lastSearchQuery = place.label;
    this.adjustingLocation = false;
    this.showChosenPlace(place.latitude, place.longitude, place.label);
  }

  chooseFacility(facility: HealthcareFacility): void {
    this.selectedFacilityId = facility.id;
    this.selectedSearchId = '';
    this.adjustingLocation = false;
    this.showChosenPlace(facility.latitude, facility.longitude, facilityLabel(facility));
  }

  beginAdjusting(): void {
    this.adjustingLocation = true;
    this.movedWhileAdjusting = false;
    this.selectionMessage = '';
    const center = this.map?.getCenter();
    if (center && isUsableCoordinate(center.lat, center.lng)) {
      this.viewLatitude = center.lat;
      this.viewLongitude = center.lng;
    } else if (this.viewLatitude === null || this.viewLongitude === null) {
      const start = this.startingPoint();
      this.viewLatitude = start.latitude;
      this.viewLongitude = start.longitude;
    }
    this.drawSelectionMarker();
    this.changes.markForCheck();
  }

  useAdjustedPoint(): void {
    const latitude = this.viewLatitude;
    const longitude = this.viewLongitude;
    if (latitude === null || longitude === null || !isUsableCoordinate(latitude, longitude)) {
      this.selectionMessage = 'Move the map until the pin sits on the location you want.';
      this.changes.markForCheck();
      return;
    }
    if (!this.movedWhileAdjusting) {
      this.selectionMessage = 'Move the map to the place you want, then tap Use This Location.';
      this.changes.markForCheck();
      return;
    }
    this.adjustingLocation = false;
    this.movedWhileAdjusting = false;
    this.commitManualPoint(latitude, longitude);
  }

  placePrimary(place: PlaceSuggestion): string {
    return place.label.split(',')[0]?.trim() || place.label;
  }

  placeSecondary(place: PlaceSuggestion): string {
    return place.label.split(',').slice(1).join(',').trim();
  }

  private showChosenPlace(latitude: number, longitude: number, label: string): void {
    const named = preferredPlaceName(label) || 'Selected map location';
    const address = label.split(',').slice(1).join(',').trim();
    this.selectionVersion += 1;
    this.holdSelection = true;
    this.adjustingLocation = false;
    this.movedWhileAdjusting = false;
    this.rememberSelection(latitude, longitude, named, 'search');
    this.draftDetail = address;
    this.viewLatitude = latitude;
    this.viewLongitude = longitude;
    this.explicitSelection = {
      latitude,
      longitude,
      label: named,
      detail: address,
    };
    this.map?.setView([latitude, longitude], 16, { animate: false });
    this.holdSelection = false;
    this.selectionReady = true;
    this.selectionMessage = '';
    this.drawSelectionMarker();
    if (!address) {
      this.queueLabel(latitude, longitude, this.selectionVersion);
    }
    void this.refreshSelectionRoute();
  }

  private async refreshSelectionRoute(): Promise<void> {
    const here = this.explicitSelection;
    if (!here || this.otherLatitude === null || this.otherLongitude === null
      || !isUsableCoordinate(this.otherLatitude, this.otherLongitude)) {
      this.roadSummary = '';
      this.roadUnavailable = '';
      return;
    }
    if (placesAreSameStop(here, { latitude: this.otherLatitude, longitude: this.otherLongitude })) {
      this.roadSummary = '';
      this.roadUnavailable = 'That point is the same as the other stop. Choose a different place.';
      return;
    }
    const token = ++this.routeToken;
    const pickup = this.role === 'destination'
      ? { latitude: this.otherLatitude, longitude: this.otherLongitude }
      : { latitude: here.latitude, longitude: here.longitude };
    const destination = this.role === 'destination'
      ? { latitude: here.latitude, longitude: here.longitude }
      : { latitude: this.otherLatitude, longitude: this.otherLongitude };
    const result = await this.roads.drivingRoute(pickup, destination);
    if (token !== this.routeToken) {
      return;
    }
    if (result.status === 'ok' && result.distanceMeters < 50) {
      this.roadSummary = '';
      this.roadUnavailable = 'That point is the same as the other stop. Choose a different place.';
    } else if (result.status === 'ok') {
      this.roadSummary = roadRouteSummary(result.distanceMeters, result.durationSeconds);
      this.roadUnavailable = '';
    } else {
      this.roadSummary = '';
      this.roadUnavailable = 'Road distance unavailable';
    }
    this.changes.markForCheck();
  }

  rememberSelection(
    latitude: number,
    longitude: number,
    label: string,
    source: 'manual' | 'search',
  ): void {
    const named = preferredPlaceName(label);
    this.draftLatitude = latitude;
    this.draftLongitude = longitude;
    this.draftTitle = named || 'Selected map location';
    this.draftDetail = this.maps.coordinateLabel(latitude, longitude);
    this.draftSource = source;
    this.pinned = named ? { latitude, longitude, label: named } : null;
    this.selectionReady = true;
    this.changes.markForCheck();
  }

  noteMapMoved(latitude: number, longitude: number, fromUser = true): void {
    if (this.holdSelection) {
      return;
    }
    this.showSearchArea = this.lastFacilityCenter
      ? distanceMeters(this.lastFacilityCenter, { latitude, longitude }) > 700
      : false;
    const intentional = fromUser || this.acceptNextMove;
    this.acceptNextMove = false;
    if (isUsableCoordinate(latitude, longitude)) {
      this.viewLatitude = latitude;
      this.viewLongitude = longitude;
    }
    // Panning while adjusting only moves the preview pin. Confirm needs
    // Use This Location, a search result, a facility, or Current location.
    if (this.adjustingLocation && intentional && isUsableCoordinate(latitude, longitude)) {
      this.movedWhileAdjusting = true;
      this.changes.markForCheck();
      return;
    }
    if (this.explicitSelection) {
      this.restoreExplicitSelection();
    }
    this.changes.markForCheck();
  }

  private commitManualPoint(latitude: number, longitude: number, source: 'manual' | 'gps' = 'manual'): void {
    this.selectionReady = true;
    this.selectionMessage = '';
    this.selectionVersion += 1;
    this.adjustingLocation = false;
    this.movedWhileAdjusting = false;
    this.draftLatitude = latitude;
    this.draftLongitude = longitude;
    this.viewLatitude = latitude;
    this.viewLongitude = longitude;
    this.draftSource = source;
    this.draftTitle = 'Finding this place…';
    this.draftDetail = '';
    this.pinned = null;
    this.selectedFacilityId = '';
    this.selectedSearchId = '';
    this.explicitSelection = { latitude, longitude, label: '', detail: '' };
    this.drawSelectionMarker();
    this.queueLabel(latitude, longitude, this.selectionVersion);
    void this.refreshSelectionRoute();
    this.changes.markForCheck();
  }

  private drawSelectionMarker(): void {
    const map = this.map;
    const selected = this.role === 'destination' && !this.adjustingLocation ? this.explicitSelection : null;
    if (!map || !selected) {
      this.selectionMarker?.remove();
      this.selectionMarker = null;
      return;
    }
    const latLng = L.latLng(selected.latitude, selected.longitude);
    if (this.selectionMarker) {
      this.selectionMarker.setLatLng(latLng);
      return;
    }
    this.selectionMarker = L.marker(latLng, {
      interactive: false,
      keyboard: false,
      icon: L.divIcon({
        className: 'care-selected-destination',
        html: '<span>Destination</span>',
        iconSize: [110, 28],
        iconAnchor: [55, 28],
      }),
    }).addTo(map);
  }

  private restoreExplicitSelection(): void {
    if (!this.explicitSelection) {
      return;
    }
    this.draftLatitude = this.explicitSelection.latitude;
    this.draftLongitude = this.explicitSelection.longitude;
    const named = preferredPlaceName(this.explicitSelection.label);
    if (named) {
      this.draftTitle = named;
      if (this.draftSource !== 'gps') {
        this.draftSource = 'search';
      }
      this.pinned = {
        latitude: this.explicitSelection.latitude,
        longitude: this.explicitSelection.longitude,
        label: named,
      };
    }
    if (this.explicitSelection.detail && !isCoordinateLabel(this.explicitSelection.detail)) {
      this.draftDetail = this.explicitSelection.detail;
    }
    this.changes.markForCheck();
  }

  async searchThisArea(): Promise<void> {
    // Facility discovery must use the visible map area, not a stale confirmed
    // stop. The latter made Search This Area appear to do nothing.
    const center = this.map?.getCenter();
    const point = center && isUsableCoordinate(center.lat, center.lng)
      ? { latitude: center.lat, longitude: center.lng }
      : this.draftPoint() ?? this.startingPoint();
    this.lastFacilityCenter = point;
    this.showSearchArea = false;
    this.facilitiesLoading = true;
    this.facilitiesFailed = false;
    this.facilitiesMessage = '';
    try {
      this.facilities = await this.healthcare.nearby(point.latitude, point.longitude);
      this.facilitiesMessage = this.visibleFacilities().length
        ? ''
        : this.facilityFilter === 'hospital'
          ? 'No hospital records were found in this area. OpenStreetMap coverage may be incomplete.'
          : 'No healthcare records were found in this area. OpenStreetMap coverage may be incomplete.';
    } catch (error: unknown) {
      this.facilities = [];
      this.facilitiesFailed = true;
      this.facilitiesMessage = error instanceof Error
        ? error.message
        : 'Nearby facilities could not be loaded. You can still choose a place or adjust the pin.';
    } finally {
      this.facilitiesLoading = false;
      this.drawFacilities();
      this.changes.markForCheck();
    }
  }

  useMyLocation(): void {
    const request = ++this.gpsRequest;
    this.gpsMessage = 'Requesting a fresh GPS reading…';
    this.waitingForGps = true;
    this.changes.markForCheck();
    // Draw last known fix as a blue marker only; never select stale GPS as pickup.
    const known = this.currentLocation;
    if (known && isUsableCoordinate(known.latitude, known.longitude)) {
      this.deviceFix = known;
      this.deviceAccuracy = this.currentAccuracyMeters;
      this.drawGps();
      this.acceptNextMove = true;
      this.map?.panTo([known.latitude, known.longitude]);
    }
    void this.refreshDeviceFix(request);
  }

  private async refreshDeviceFix(request: number): Promise<void> {
    if (typeof this.maps.currentPosition !== 'function') {
      this.waitingForGps = false;
      const known = this.deviceFix ?? this.currentLocation;
      if (known && isUsableCoordinate(known.latitude, known.longitude)) {
        this.gpsMessage = 'Fresh GPS unavailable. Last known position is shown on the map only. Search or adjust the pickup manually.';
        this.drawGps();
      } else {
        this.gpsMessage = 'Your location is unavailable. Choose a point on the map instead.';
        this.changes.markForCheck();
      }
      return;
    }
    try {
      const fix = await this.maps.currentPosition();
      if (request !== this.gpsRequest || !isUsableCoordinate(fix.latitude, fix.longitude)) {
        return;
      }
      this.gpsMessage = '';
      this.waitingForGps = false;
      this.applyDeviceFix(fix.latitude, fix.longitude, fix.accuracyMeters, true);
    } catch (error: unknown) {
      if (request !== this.gpsRequest) {
        return;
      }
      this.waitingForGps = false;
      const known = this.deviceFix ?? this.currentLocation;
      if (known && isUsableCoordinate(known.latitude, known.longitude)) {
        this.gpsMessage = error instanceof Error
          ? `${error.message} Last known position is shown on the map only.`
          : 'Fresh GPS unavailable. Last known position is shown on the map only.';
        this.drawGps();
      } else {
        this.gpsMessage = error instanceof Error
          ? error.message
          : 'Your location is unavailable. Choose a point on the map instead.';
        this.changes.markForCheck();
      }
    }
  }

  private applyDeviceFix(
    latitude: number,
    longitude: number,
    accuracyMeters: number | null,
    selectIt: boolean,
  ): void {
    this.deviceFix = { latitude, longitude };
    this.deviceAccuracy = accuracyMeters;
    this.drawGps();
    if (selectIt) {
      this.adjustingLocation = false;
      this.commitManualPoint(latitude, longitude, 'gps');
    }
    this.acceptNextMove = true;
    this.map?.panTo([latitude, longitude]);
  }

  confirmSelection(): void {
    if (this.adjustingLocation) {
      this.selectionMessage = 'Tap Use This Location after moving the map, or choose a search result or hospital.';
      this.changes.markForCheck();
      return;
    }
    if (!this.selectionReady || !this.explicitSelection) {
      this.selectionMessage = 'Choose a search result, a hospital, or adjust the pin and use that location.';
      this.changes.markForCheck();
      return;
    }
    const latitude = this.explicitSelection.latitude;
    const longitude = this.explicitSelection.longitude;
    if (!isUsableCoordinate(latitude, longitude)) {
      this.selectionMessage = 'Move the map until the pin sits on the location you want.';
      this.changes.markForCheck();
      return;
    }
    const other = this.otherLatitude !== null && this.otherLongitude !== null
      ? { latitude: this.otherLatitude, longitude: this.otherLongitude }
      : null;
    if (placesAreSameStop({ latitude, longitude }, other)) {
      this.selectionMessage = 'That point is the same as the other stop. Choose a different place.';
      this.changes.markForCheck();
      return;
    }
    this.selectionMessage = '';
    const named = this.pinned?.label
      || preferredPlaceName(this.explicitSelection.label)
      || preferredPlaceName(this.draftTitle);
    this.confirmed.emit({
      latitude,
      longitude,
      label: named || 'Selected map location',
      detail: this.draftDetail || this.explicitSelection.detail || this.maps.coordinateLabel(latitude, longitude),
      source: this.draftSource,
    });
  }

  cancel(): void {
    this.cancelled.emit();
  }

  refreshSize(): void {
    this.map?.invalidateSize();
  }

  private startingPoint(): MapCoordinate {
    if (this.initialLatitude !== null && this.initialLongitude !== null
      && isUsableCoordinate(this.initialLatitude, this.initialLongitude)) {
      return { latitude: this.initialLatitude, longitude: this.initialLongitude };
    }
    if (this.role === 'destination'
      && this.otherLatitude !== null && this.otherLongitude !== null
      && isUsableCoordinate(this.otherLatitude, this.otherLongitude)) {
      return { latitude: this.otherLatitude, longitude: this.otherLongitude };
    }
    if (this.currentLocation && isUsableCoordinate(this.currentLocation.latitude, this.currentLocation.longitude)) {
      return this.currentLocation;
    }
    return CALAPAN_CITY;
  }

  private draftPoint(): MapCoordinate | null {
    if (this.draftLatitude !== null && this.draftLongitude !== null
      && isUsableCoordinate(this.draftLatitude, this.draftLongitude)) {
      return { latitude: this.draftLatitude, longitude: this.draftLongitude };
    }
    if (this.viewLatitude !== null && this.viewLongitude !== null
      && isUsableCoordinate(this.viewLatitude, this.viewLongitude)) {
      return { latitude: this.viewLatitude, longitude: this.viewLongitude };
    }
    return null;
  }

  private queueLabel(latitude: number, longitude: number, version = this.selectionVersion): void {
    const token = ++this.labelToken;
    const lockedName = preferredPlaceName(this.explicitSelection?.label);
    if (this.labelTimer !== null) {
      clearTimeout(this.labelTimer);
    }
    this.labelTimer = setTimeout(() => {
      void this.maps.describePlace(latitude, longitude, lockedName).then((place) => {
        if (token !== this.labelToken || version !== this.selectionVersion) {
          return;
        }
        if (lockedName && this.explicitSelection) {
          this.draftTitle = preferredPlaceName(this.draftTitle) || lockedName;
          const existing = this.explicitSelection.detail;
          const keep = existing && !isCoordinateLabel(existing) ? existing : '';
          const lookedUp = place.detail && !isCoordinateLabel(place.detail) ? place.detail : '';
          const address = keep || lookedUp;
          this.draftDetail = address;
          this.explicitSelection = { ...this.explicitSelection, label: lockedName, detail: address };
          this.changes.markForCheck();
          return;
        }
        this.draftTitle = place.title;
        this.draftDetail = isCoordinateLabel(place.detail) ? '' : place.detail;
        if (this.explicitSelection) {
          this.explicitSelection = {
            ...this.explicitSelection,
            label: place.title,
            detail: this.draftDetail,
          };
        }
        this.changes.markForCheck();
      }).catch(() => {
        if (token !== this.labelToken || version !== this.selectionVersion) {
          return;
        }
        if (lockedName && this.explicitSelection) {
          this.draftTitle = lockedName;
        } else if (!preferredPlaceName(this.draftTitle)) {
          this.draftTitle = 'Selected map location';
          this.draftDetail = '';
        }
        this.changes.markForCheck();
      });
    }, 700);
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

  private onHostResize(): void {
    const host = this.mapHost?.nativeElement;
    if (!host) {
      return;
    }
    const next = `${host.clientWidth}x${host.clientHeight}`;
    if (next === this.seenSize || !mapHostIsReady(host.clientWidth, host.clientHeight)) {
      return;
    }
    this.seenSize = next;
    this.phoneLayout = locationPickerPhoneLayout(host.clientWidth);
    if (!this.map) {
      this.createMap(host);
      return;
    }
    this.map.invalidateSize();
  }

  private createMap(host: HTMLElement): void {
    const start = this.startingPoint();
    this.zone.runOutsideAngular(() => {
      this.map = L.map(host, {
        zoomControl: true,
        attributionControl: true,
      });
      const tiles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        subdomains: 'abc',
        maxZoom: 19,
        tileSize: 256,
        detectRetina: false,
        updateWhenIdle: false,
        keepBuffer: 2,
        attribution: '&copy; OpenStreetMap',
      });
      tiles.on('tileerror', () => {
        this.tileErrors += 1;
        if (this.tileErrors < 6) {
          return;
        }
        this.zone.run(() => {
          this.tilesFailed = true;
          this.changes.markForCheck();
        });
      });
      tiles.addTo(this.map);
      this.map.on('dragstart', () => {
        this.userDragged = true;
      });
      this.map.on('zoomend', () => {
        this.zone.run(() => this.drawFacilities());
      });
      this.map.on('moveend', () => {
        const center = this.map?.getCenter();
        if (!center) {
          return;
        }
        const fromUser = this.userDragged;
        this.userDragged = false;
        this.zone.run(() => this.noteMapMoved(center.lat, center.lng, fromUser));
      });
      this.seenSize = `${host.clientWidth}x${host.clientHeight}`;
      this.map.setView([start.latitude, start.longitude], this.initialLatitude === null ? CALAPAN_ZOOM : 16);
      this.map.invalidateSize();
      this.drawGps();
    });
    void this.searchThisArea();
  }

  private drawGps(): void {
    const map = this.map;
    if (!map) {
      return;
    }
    const point = this.deviceFix ?? this.currentLocation;
    if (!point || !isUsableCoordinate(point.latitude, point.longitude)) {
      this.currentDot?.remove();
      this.currentCircle?.remove();
      this.currentDot = null;
      this.currentCircle = null;
      return;
    }
    const center = L.latLng(point.latitude, point.longitude);
    const meters = this.deviceAccuracy ?? this.currentAccuracyMeters;
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

  private drawFacilities(): void {
    const map = this.map;
    if (!map) {
      return;
    }
    this.facilityLayer?.remove();
    this.facilityLayer = L.layerGroup();
    const zoom = map.getZoom();
    const gap = zoom >= 16 ? 56 : zoom >= 14 ? 84 : 120;
    const visible = this.visibleFacilities();
    const labeled = new Set(facilityIdsWithLabels(visible.map((facility) => {
      const pixel = map.latLngToContainerPoint([facility.latitude, facility.longitude]);
      return { id: facility.id, x: pixel.x, y: pixel.y, kind: facility.kind };
    }), gap));
    for (const facility of visible) {
      const showName = facility.kind === 'hospital' || labeled.has(facility.id);
      const name = facilityLabel(facility);
      const safeName = name.replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
      const marker = L.marker([facility.latitude, facility.longitude], {
        keyboard: false,
        title: name,
        zIndexOffset: facility.kind === 'hospital' ? 400 : 0,
        icon: L.divIcon({
          className: `care-facility-pin ${facility.kind}${showName ? ' named' : ''}`,
          html: showName
            ? `<span class="dot"></span><span class="name">${safeName}</span>`
            : `<span class="dot"></span>`,
          iconSize: showName ? [168, 28] : [22, 22],
          iconAnchor: [11, 14],
        }),
      });
      marker.on('click', () => {
        this.zone.run(() => this.chooseFacility(facility));
      });
      marker.addTo(this.facilityLayer);
    }
    this.facilityLayer.addTo(map);
  }
}
