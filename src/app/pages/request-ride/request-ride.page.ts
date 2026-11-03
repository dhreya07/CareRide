import { ChangeDetectorRef, Component, OnDestroy, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AlertController, IonIcon } from '@ionic/angular';
import { LocalPassengerType } from '../../core/models/local-ride.model';
import { AppNavigationComponent } from '../../shared/app-navigation.component';
import { AuthService, LocalCareRideUser } from '../../core/services/auth.service';
import { LocalRideService } from '../../core/services/local-ride.service';
import { DeviceGpsFix, gpsAccuracyText, isCoordinateLabel, isUsableCoordinate, MapsService, PlaceSuggestion, preferredPlaceName } from '../../core/services/maps.service';
import { isDriverFixStale } from '../../core/services/driver-gps.service';
import { ProfileService } from '../../core/services/profile.service';
import { RideService } from '../../core/services/ride.service';
import { SupabaseService } from '../../core/services/supabase.service';
import { LocationMapComponent, MapCoordinate } from '../../shared/location-map.component';
import { LocationPickerComponent, PickedLocation, placesAreSameStop } from '../../shared/location-picker.component';
import { RoadRouteService, roadRouteSummary } from '../../core/services/road-route.service';

@Component({
  selector: 'app-request-ride',
  standalone: true,
  templateUrl: './request-ride.page.html',
  styleUrls: ['./request-ride.page.scss'],
  imports: [CommonModule, FormsModule, IonIcon, AppNavigationComponent, LocationMapComponent, LocationPickerComponent],
})
export class RequestRidePage implements OnDestroy {
  step: 'form' | 'review' = 'form';
  submitting = false;
  formError = '';

  pickupLocation = '';
  destination = '';
  purpose = '';
  rideType: 'now' | 'schedule' = 'now';
  rideDate = '';
  rideTime = '';
  passengerType: LocalPassengerType = 'self';
  passengerName = '';

  wheelchair = false;
  walker = false;
  companion = false;
  visualAssistance = false;
  hearingAssistance = false;
  otherAssistance = false;
  otherAssistanceNotes = '';

  notes = '';
  emergencyContactName = '';
  emergencyContactNumber = '';

  pickupLatitude: number | null = null;
  pickupLongitude: number | null = null;
  destinationLatitude: number | null = null;
  destinationLongitude: number | null = null;
  pickupAccuracyMeters: number | null = null;
  destinationAccuracyMeters: number | null = null;
  pickupSource: 'gps' | 'search' | 'manual' | null = null;
  destinationSource: 'gps' | 'search' | 'manual' | null = null;
  pickupConfirmed = false;
  destinationConfirmed = false;
  pickupDetail = '';
  destinationDetail = '';
  placeQuery = '';
  placeSuggestions: PlaceSuggestion[] = [];
  placeSearchMessage = '';
  liveLatitude: number | null = null;
  liveLongitude: number | null = null;
  liveAccuracyMeters: number | null = null;
  liveCapturedAt = '';
  liveGpsError = '';
  liveGpsStale = false;
  private stopLiveGps: (() => void) | null = null;
  private recenterOnNextFix = false;
  private staleTimer: ReturnType<typeof setInterval> | null = null;
  private labelToken = { pickup: 0, destination: 0 };
  mapsMessage = '';
  lookupBusy: 'pickup' | 'destination' | null = null;
  selectedDriverId = '';
  drivers: BookingDriverOption[] = [];
  mapMode: 'pickup' | 'destination' = 'pickup';
  locating = false;
  locationNotice = '';
  pickerRole: 'pickup' | 'destination' | null = null;
  pickerQuery = '';
  roadRoute: MapCoordinate[] | null = null;
  roadSummary = '';
  routeUnavailable = '';
  private routeRequest = 0;
  private revealFrame = 0;

  @ViewChild(LocationMapComponent) private locationMap?: LocationMapComponent;

  constructor(
    private alertController: AlertController,
    private router: Router,
    private rides: RideService,
    private localRides: LocalRideService,
    private profiles: ProfileService,
    private auth: AuthService,
    private maps: MapsService,
    private roads: RoadRouteService,
    private supabase: SupabaseService,
    private changes: ChangeDetectorRef,
  ) {
    this.applyRideNowSchedule();
    this.mapsMessage = this.maps.getUnavailableMessage();
  }

  ionViewDidEnter(): void {
    this.revealMap();
    void this.resumeLiveGpsIfAllowed();
  }

  ionViewDidLeave(): void {
    this.endLiveGps();
  }

  ngOnDestroy(): void {
    cancelAnimationFrame(this.revealFrame);
    this.endLiveGps();
  }

  private revealMap(frames = 20): void {
    cancelAnimationFrame(this.revealFrame);
    if (!this.locationMap || this.step !== 'form') {
      return;
    }
    const ready = this.locationMap.refreshSize();
    if (!ready && frames > 0) {
      this.revealFrame = requestAnimationFrame(() => this.revealMap(frames - 1));
    }
  }

  get liveGpsPoint(): MapCoordinate | null {
    if (this.liveLatitude === null || this.liveLongitude === null) {
      return null;
    }
    return { latitude: this.liveLatitude, longitude: this.liveLongitude };
  }

  openLocationPicker(role: 'pickup' | 'destination'): void {
    this.pickerRole = role;
    this.mapMode = role;
    this.pickerQuery = role === 'pickup' ? this.pickupLocation : this.destination;
    this.changes.markForCheck();
  }

  cancelLocationPicker(): void {
    this.pickerRole = null;
    this.changes.detectChanges();
    this.revealMap();
  }

  async confirmLocationPicker(selection: PickedLocation): Promise<void> {
    const role = this.pickerRole;
    if (!role) {
      return;
    }
    if (!isUsableCoordinate(selection.latitude, selection.longitude)) {
      this.locationNotice = 'That place has no usable coordinates. Choose another result or move the pin.';
      this.changes.markForCheck();
      return;
    }
    const other = role === 'destination'
      ? this.point(this.pickupLatitude, this.pickupLongitude)
      : this.point(this.destinationLatitude, this.destinationLongitude);
    if (placesAreSameStop({ latitude: selection.latitude, longitude: selection.longitude }, other)) {
      this.locationNotice = 'That point is the same as the other stop. Choose a different place.';
      this.changes.markForCheck();
      return;
    }
    const rawTitle = selection.label.trim();
    const title = preferredPlaceName(rawTitle) || 'Selected map location';
    const rawDetail = selection.detail?.trim() ?? '';
    const detail = rawDetail && !isCoordinateLabel(rawDetail) ? rawDetail : '';
    this.applySelectedPoint(role, selection.latitude, selection.longitude, title, null, selection.source);
    if (role === 'pickup') {
      this.pickupDetail = detail;
      this.pickupConfirmed = true;
    } else {
      this.destinationDetail = detail;
      this.destinationConfirmed = true;
    }
    this.pickerRole = null;
    this.changes.detectChanges();
    const labelUpdate = preferredPlaceName(title)
      ? Promise.resolve()
      : this.fillVerifiedPlaceLabel(role, selection.latitude, selection.longitude);
    this.revealMap();
    await Promise.all([this.updateRoadRoute(), labelUpdate]);
  }

  private async fillVerifiedPlaceLabel(
    role: 'pickup' | 'destination',
    latitude: number,
    longitude: number,
  ): Promise<void> {
    const token = ++this.labelToken[role];
    const described = await this.maps.describePlace(latitude, longitude, null);
    if (token !== this.labelToken[role]) {
      return;
    }
    const currentLatitude = role === 'pickup' ? this.pickupLatitude : this.destinationLatitude;
    const currentLongitude = role === 'pickup' ? this.pickupLongitude : this.destinationLongitude;
    if (currentLatitude !== latitude || currentLongitude !== longitude) {
      return;
    }
    const named = preferredPlaceName(described.title);
    const address = described.detail && !isCoordinateLabel(described.detail) ? described.detail : '';
    if (role === 'pickup') {
      if (named) {
        this.pickupLocation = named;
      }
      this.pickupDetail = address;
    } else {
      if (named) {
        this.destination = named;
      }
      this.destinationDetail = address;
    }
    this.changes.markForCheck();
  }

  async updateRoadRoute(): Promise<void> {
    const token = ++this.routeRequest;
    const pickup = this.mapPickup;
    const destination = this.mapDestination;
    if (!pickup || !destination || !this.pickupConfirmed || !this.destinationConfirmed) {
      this.roadRoute = null;
      this.roadSummary = '';
      this.routeUnavailable = '';
      return;
    }
    const result = await this.roads.drivingRoute(pickup, destination);
    if (token !== this.routeRequest) {
      return;
    }
    if (result.status === 'ok' && result.distanceMeters < 50) {
      this.roadRoute = null;
      this.roadSummary = '';
      this.routeUnavailable = 'Pickup and destination are the same point. Choose a different destination.';
    } else if (result.status === 'ok') {
      this.roadRoute = result.coordinates;
      this.roadSummary = roadRouteSummary(result.distanceMeters, result.durationSeconds);
      this.routeUnavailable = '';
    } else {
      this.roadRoute = null;
      this.roadSummary = '';
      this.routeUnavailable = result.message;
    }
    this.changes.markForCheck();
  }

  onPreviewMapPressed(): void {
    this.openLocationPicker(this.previewSelectionRole());
  }

  previewSelectionRole(): 'pickup' | 'destination' {
    if (this.pickupLatitude === null || !this.pickupConfirmed) {
      return 'pickup';
    }
    return 'destination';
  }

  placeTitle(role: 'pickup' | 'destination'): string {
    const label = role === 'pickup' ? this.pickupLocation : this.destination;
    if (!label.trim()) {
      return role === 'pickup' ? 'Add pickup' : 'Add destination';
    }
    if (isCoordinateLabel(label)) {
      return 'Selected map location';
    }
    return label.trim();
  }

  placeDetail(role: 'pickup' | 'destination'): string {
    const detail = role === 'pickup' ? this.pickupDetail : this.destinationDetail;
    if (detail.trim() && !isCoordinateLabel(detail)) {
      return detail;
    }
    const label = role === 'pickup' ? this.pickupLocation : this.destination;
    if (label.trim()) {
      return '';
    }
    return role === 'pickup' ? 'Choose where the ride starts' : 'Choose a hospital, clinic, or other destination';
  }

  recenterOnMe(): void {
    const point = this.liveGpsPoint;
    if (!point) {
      this.liveGpsError = 'Current GPS location is not available yet.';
      return;
    }
    this.locationMap?.recenter(point);
  }

  ionViewWillEnter(): void {
    this.refreshDrivers();
    const profile = this.profiles.loadLocal();
    if (profile) {
      if (this.passengerType === 'self' && !this.passengerName.trim()) {
        this.passengerName = profile.name || this.auth.getLocalDisplayName();
      }
      if (!this.emergencyContactName) this.emergencyContactName = profile.emergencyName || '';
      if (!this.emergencyContactNumber) this.emergencyContactNumber = profile.emergencyPhone || '';
      this.applyAssistance(profile.assistance || []);
    } else if (!this.passengerName.trim()) {
      this.passengerName = this.auth.getLocalDisplayName();
    }
  }

  get mapsConfigured(): boolean {
    return this.maps.configured;
  }

  get backendConfigured(): boolean {
    return this.supabase.configured;
  }

  backToDashboard(): void {
    if (this.step === 'review') {
      this.step = 'form';
      return;
    }
    void this.router.navigate(['/dashboard']);
  }

  selectRideType(type: 'now' | 'schedule'): void {
    const switchingToNow = type === 'now' && this.rideType !== 'now';
    this.rideType = type;
    if (switchingToNow || (type === 'now' && !this.rideDate && !this.rideTime)) {
      this.applyRideNowSchedule();
    }
    this.refreshDrivers();
  }

  refreshDrivers(): void {
    if (this.rides.cloudBookings) {
      void this.loadCloudDrivers();
      return;
    }
    const previous = this.selectedDriverId;
    this.drivers = this.eligibleBookingDrivers();
    if (!previous || this.drivers.some((driver) => driver.id === previous)) {
      return;
    }
    this.selectedDriverId = '';
    this.formError = 'That driver is no longer available. Please choose another driver.';
    this.step = 'form';
  }

  blockLockedSchedule(event: Event): void {
    if (this.rideType !== 'now') {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const target = event.target as HTMLInputElement | null;
    target?.blur();
  }

  selectPassengerType(type: LocalPassengerType): void {
    this.passengerType = type;
    if (type === 'self' && !this.passengerName.trim()) {
      this.passengerName = this.auth.getLocalDisplayName();
    }
  }

  async lookupPickup(): Promise<void> {
    this.mapMode = 'pickup';
    this.placeQuery = this.pickupLocation;
    await this.searchPlaces();
  }

  async lookupDestination(): Promise<void> {
    this.mapMode = 'destination';
    this.placeQuery = this.destination;
    await this.searchPlaces();
  }

  async goToReview(): Promise<void> {
    const error = this.validateForm();
    if (error) {
      this.formError = error;
      await this.showAlert('Please complete the form', error);
      return;
    }
    this.formError = '';
    this.step = 'review';
  }

  editRequest(): void {
    this.step = 'form';
    this.changes.detectChanges();
    this.revealMap();
  }

  async submitRideRequest(): Promise<void> {
    if (this.submitting) {
      return;
    }

    const error = this.validateForm();
    if (error) {
      this.formError = error;
      this.step = 'form';
      await this.showAlert('Please complete the form', error);
      return;
    }
    this.formError = '';
    const driver = this.selectedDriver();
    if (!driver) {
      this.formError = 'Please choose an available driver.';
      this.step = 'form';
      await this.showAlert('Choose a driver', this.formError);
      return;
    }

    this.submitting = true;
    try {
      await this.rides.submitPassengerRide({
        passengerType: this.passengerType,
        passengerName: this.resolvedPassengerName(),
        pickupLocation: this.pickupLocation.trim(),
        destination: this.destination.trim(),
        purpose: this.purpose.trim(),
        date: this.rideDate,
        time: this.rideTime,
        assistance: this.getAssistanceLabels(),
        otherAssistanceNotes: this.otherAssistance ? this.otherAssistanceNotes.trim() : '',
        notes: this.notes.trim(),
        emergencyContactName: this.emergencyContactName.trim(),
        emergencyContactNumber: this.emergencyContactNumber.trim(),
        pickupLatitude: this.pickupLatitude,
        pickupLongitude: this.pickupLongitude,
        destinationLatitude: this.destinationLatitude,
        destinationLongitude: this.destinationLongitude,
        pickupAccuracyMeters: this.pickupAccuracyMeters,
        destinationAccuracyMeters: this.destinationAccuracyMeters,
        preferredDriverId: driver.id,
        preferredDriverName: driver.name,
        preferredDriverPhone: driver.phone,
        preferredVehicleLabel: driver.vehicleLabel,
        preferredDriverRating: driver.rating,
        status: this.rideType === 'schedule' ? 'Scheduled' : 'Pending',
      });
      await this.router.navigate(['/scheduled-rides'], { replaceUrl: true });
    } catch (submitError) {
      this.formError = submitError instanceof Error
        ? submitError.message
        : 'The ride could not be saved. No confirmation was recorded.';
      await this.showAlert(
        'Request was not saved',
        this.formError,
      );
    } finally {
      this.submitting = false;
    }
  }

  getAssistanceLabels(): string[] {
    const labels: string[] = [];
    if (this.wheelchair) labels.push('Wheelchair assistance');
    if (this.walker) labels.push('Walking assistance');
    if (this.visualAssistance) labels.push('Visual assistance');
    if (this.hearingAssistance) labels.push('Hearing assistance');
    if (this.companion) labels.push('Companion assistance');
    if (this.otherAssistance) labels.push('Other special assistance');
    return labels;
  }

  assistanceSummary(): string {
    const labels = this.getAssistanceLabels();
    return labels.length ? labels.join(', ') : 'None selected';
  }

  passengerLabel(): string {
    if (this.passengerType === 'family') {
      return `${this.resolvedPassengerName()} (family member)`;
    }
    return `${this.resolvedPassengerName()} (myself)`;
  }

  scheduleLabel(): string {
    return `${this.rideDate} at ${this.rideTime}`;
  }

  get mapPickup(): MapCoordinate | null {
    return this.point(this.pickupLatitude, this.pickupLongitude);
  }

  get mapDestination(): MapCoordinate | null {
    return this.point(this.destinationLatitude, this.destinationLongitude);
  }

  selectMapMode(mode: 'pickup' | 'destination'): void {
    this.mapMode = mode;
    this.locationNotice = mode === 'pickup'
      ? 'Tap the map to set the pickup.'
      : 'Tap the map to set the destination.';
  }

  async onMapPicked(point: MapCoordinate): Promise<void> {
    await this.placeManualPoint(this.mapMode, point.latitude, point.longitude);
  }

  async onMarkerMoved(move: { role: 'pickup' | 'destination'; point: MapCoordinate }): Promise<void> {
    await this.placeManualPoint(move.role, move.point.latitude, move.point.longitude);
  }

  async placeManualPoint(role: 'pickup' | 'destination', latitude: number, longitude: number): Promise<void> {
    const token = ++this.labelToken[role];
    this.applySelectedPoint(role, latitude, longitude, this.maps.coordinateLabel(latitude, longitude), null, 'manual');
    this.changes.markForCheck();
    const label = await this.labelForPoint(latitude, longitude);
    if (token !== this.labelToken[role] || !this.samePoint(role, latitude, longitude)) {
      return;
    }
    this.setPointLabel(role, label);
    this.changes.markForCheck();
  }

  confirmMapPoint(): void {
    if (this.mapMode === 'pickup') {
      if (this.pickupLatitude === null || this.pickupLongitude === null) {
        this.locationNotice = 'Choose a pickup on the map before confirming it.';
        return;
      }
      this.pickupConfirmed = true;
      this.locationNotice = `Pickup confirmed. ${this.sourceText(this.pickupSource)}`;
      this.changes.markForCheck();
      return;
    }
    if (this.destinationLatitude === null || this.destinationLongitude === null) {
      this.locationNotice = 'Choose a destination on the map before confirming it.';
      return;
    }
    this.destinationConfirmed = true;
    this.locationNotice = `Destination confirmed. ${this.sourceText(this.destinationSource)}`;
    this.changes.markForCheck();
  }

  async searchPlaces(): Promise<void> {
    this.placeSuggestions = [];
    this.placeSearchMessage = '';
    this.lookupBusy = this.mapMode;
    if (!this.maps.configured) {
      this.placeSearchMessage = this.maps.searchUnavailableMessage();
      return;
    }
    try {
      const bias = this.pickupLatitude !== null && this.pickupLongitude !== null
        ? { latitude: this.pickupLatitude, longitude: this.pickupLongitude }
        : undefined;
      this.placeSuggestions = await this.maps.searchPlaces(this.placeQuery, bias);
      this.placeSearchMessage = this.placeSuggestions.length
        ? ''
        : 'No matching places were returned. Tap or drag the map instead.';
    } catch (error: unknown) {
      this.placeSearchMessage = error instanceof Error ? error.message : this.maps.searchUnavailableMessage();
    } finally {
      this.lookupBusy = null;
    }
  }

  choosePlace(place: PlaceSuggestion): void {
    this.applySelectedPoint(
      this.mapMode,
      place.latitude,
      place.longitude,
      place.label,
      null,
      'search',
    );
    this.placeSuggestions = [];
    this.placeQuery = place.label;
  }

  sourceText(source: 'gps' | 'search' | 'manual' | null): string {
    if (source === 'gps') {
      return 'GPS location';
    }
    if (source === 'search') {
      return 'Searched location';
    }
    if (source === 'manual') {
      return 'Manually selected on the map';
    }
    return 'Typed address';
  }

  applySelectedPoint(
    role: 'pickup' | 'destination',
    latitude: number,
    longitude: number,
    label: string,
    accuracyMeters: number | null = null,
    source: 'gps' | 'search' | 'manual' = 'manual',
  ): void {
    if (role === 'pickup') {
      this.pickupLatitude = latitude;
      this.pickupLongitude = longitude;
      this.pickupLocation = label;
      this.pickupAccuracyMeters = source === 'gps' ? accuracyMeters : null;
      this.pickupSource = source;
      this.pickupConfirmed = false;
    } else {
      this.destinationLatitude = latitude;
      this.destinationLongitude = longitude;
      this.destination = label;
      this.destinationAccuracyMeters = source === 'gps' ? accuracyMeters : null;
      this.destinationSource = source;
      this.destinationConfirmed = false;
    }
    const accuracy = source === 'gps' && accuracyMeters !== null ? ` ${gpsAccuracyText(accuracyMeters)}` : '';
    this.locationNotice = role === 'pickup'
      ? `Pickup set from ${this.sourceText(source).toLowerCase()}: ${label}.${accuracy}`
      : `Destination set from ${this.sourceText(source).toLowerCase()}: ${label}.${accuracy}`;
    if (this.formError === 'Please enter both pickup location and destination.') {
      this.formError = '';
    }
  }

  async useCurrentLocation(): Promise<void> {
    if (this.locating) {
      return;
    }
    this.locating = true;
    this.liveGpsError = '';
    this.beginLiveGps();
    if (typeof this.maps.currentPosition === 'function') {
      try {
        const fix = await this.maps.currentPosition();
        this.recordLiveFix(fix);
        this.liveGpsStale = Boolean(this.liveCapturedAt && isDriverFixStale(this.liveCapturedAt));
        this.locationMap?.recenter({ latitude: fix.latitude, longitude: fix.longitude });
      } catch (error: unknown) {
        const current = this.liveGpsPoint;
        if (current) {
          this.locationMap?.recenter(current);
          this.liveGpsStale = Boolean(this.liveCapturedAt && isDriverFixStale(this.liveCapturedAt));
          this.liveGpsError = error instanceof Error
            ? `${error.message} Showing the last GPS reading${this.liveGpsStale ? ' (stale)' : ''}.`
            : 'Showing the last GPS reading. A fresh reading was not available.';
        } else {
          this.liveGpsError = error instanceof Error
            ? error.message
            : 'Your location is unavailable. Choose a point on the map.';
          this.recenterOnNextFix = true;
        }
      }
    } else if (this.liveGpsPoint) {
      this.liveGpsStale = Boolean(this.liveCapturedAt && isDriverFixStale(this.liveCapturedAt));
      this.locationMap?.recenter(this.liveGpsPoint);
    } else {
      this.recenterOnNextFix = true;
    }
    this.locating = false;
    this.changes.detectChanges();
  }

  selectedDriver(): BookingDriverOption | null {
    return this.drivers.find((driver) => driver.id === this.selectedDriverId) ?? null;
  }

  selectDriver(driver: BookingDriverOption): void {
    if (this.rides.cloudBookings) {
      if (!this.drivers.some((item) => item.id === driver.id)) {
        this.selectedDriverId = '';
        void this.loadCloudDrivers();
        this.formError = 'That driver is no longer available. Please choose another driver.';
        return;
      }
      this.selectedDriverId = driver.id;
      if (this.formError === 'That driver is no longer available. Please choose another driver.') {
        this.formError = '';
      }
      return;
    }
    const account = this.auth.listApprovedDrivers().find((item) => item.id === driver.id);
    if (!account || !this.isEligibleAccount(account)) {
      this.selectedDriverId = '';
      this.drivers = this.eligibleBookingDrivers();
      this.formError = 'That driver is no longer available. Please choose another driver.';
      return;
    }
    this.selectedDriverId = account.id;
    if (this.formError === 'That driver is no longer available. Please choose another driver.') {
      this.formError = '';
    }
  }

  private recordLiveFix(fix: DeviceGpsFix): void {
    this.liveLatitude = fix.latitude;
    this.liveLongitude = fix.longitude;
    this.liveAccuracyMeters = fix.accuracyMeters;
    this.liveCapturedAt = fix.capturedAt ?? new Date().toISOString();
    this.liveGpsError = '';
    this.liveGpsStale = isDriverFixStale(this.liveCapturedAt);
  }

  private point(latitude: number | null, longitude: number | null): MapCoordinate | null {
    if (latitude === null || longitude === null) {
      return null;
    }
    return { latitude, longitude };
  }

  private async labelForPoint(latitude: number, longitude: number): Promise<string> {
    try {
      return await this.maps.reverseGeocode(latitude, longitude);
    } catch {
      return this.maps.coordinateLabel(latitude, longitude);
    }
  }

  private async resumeLiveGpsIfAllowed(): Promise<void> {
    if ((await this.maps.geolocationPermission()) !== 'granted') {
      return;
    }
    this.beginLiveGps();
  }

  private beginLiveGps(): void {
    if (this.stopLiveGps) {
      return;
    }
    this.stopLiveGps = this.maps.watchDeviceGps(
      (fix) => {
        this.recordLiveFix(fix);
        if (this.recenterOnNextFix) {
          this.recenterOnNextFix = false;
          this.locationMap?.recenter({ latitude: fix.latitude, longitude: fix.longitude });
        }
        this.changes.detectChanges();
      },
      (message, denied) => {
        this.liveGpsError = message;
        if (denied) {
          this.endLiveGps();
        }
        this.changes.detectChanges();
      },
    );
    this.staleTimer = setInterval(() => {
      this.liveGpsStale = Boolean(this.liveCapturedAt && isDriverFixStale(this.liveCapturedAt));
      this.changes.markForCheck();
    }, 5000);
  }

  private endLiveGps(): void {
    this.stopLiveGps?.();
    this.stopLiveGps = null;
    this.recenterOnNextFix = false;
    if (this.staleTimer !== null) {
      clearInterval(this.staleTimer);
      this.staleTimer = null;
    }
  }

  private samePoint(role: 'pickup' | 'destination', latitude: number, longitude: number): boolean {
    const currentLatitude = role === 'pickup' ? this.pickupLatitude : this.destinationLatitude;
    const currentLongitude = role === 'pickup' ? this.pickupLongitude : this.destinationLongitude;
    return currentLatitude === latitude && currentLongitude === longitude;
  }

  private setPointLabel(role: 'pickup' | 'destination', label: string): void {
    if (role === 'pickup') {
      this.pickupLocation = label;
      return;
    }
    this.destination = label;
  }

  private applyAssistance(values: string[]): void {
    this.wheelchair = values.includes('Wheelchair assistance');
    this.walker = values.includes('Walking assistance');
    this.visualAssistance = values.includes('Visual assistance');
    this.hearingAssistance = values.includes('Hearing assistance');
    this.companion = values.includes('Companion assistance');
  }

  private resolvedPassengerName(): string {
    if (this.passengerType === 'family') {
      return this.passengerName.trim();
    }
    return this.passengerName.trim() || this.auth.getLocalDisplayName();
  }

  private validateForm(): string | null {
    if (!this.pickupLocation.trim() || !this.destination.trim()) {
      return 'Please enter both pickup location and destination.';
    }
    const pickupPoint = this.point(this.pickupLatitude, this.pickupLongitude);
    const destinationPoint = this.point(this.destinationLatitude, this.destinationLongitude);
    if (placesAreSameStop(pickupPoint, destinationPoint)) {
      return 'Pickup and destination are the same point. Choose a different destination.';
    }
    // Same barangay/place name is allowed when the mapped coordinates clearly differ.
    if (this.pickupLocation.trim().toLowerCase() === this.destination.trim().toLowerCase()
      && (!pickupPoint || !destinationPoint)) {
      return 'Pickup and destination must be different locations.';
    }
    if (!this.purpose.trim()) {
      return 'Please enter the purpose of this trip.';
    }
    if (this.passengerType === 'family' && !this.passengerName.trim()) {
      return 'Please enter the passenger name for this family booking.';
    }
    if (this.rides.cloudBookings) {
      if (!this.selectedDriverId || !this.drivers.some((driver) => driver.id === this.selectedDriverId)) {
        return 'Please choose an available driver for this trip.';
      }
    } else {
    const account = this.auth.listApprovedDrivers().find((item) => item.id === this.selectedDriverId);
    if (!this.selectedDriverId || !account) {
      return 'Please choose an available driver for this trip.';
    }
    if (!this.isEligibleAccount(account)) {
      this.selectedDriverId = '';
      this.drivers = this.eligibleBookingDrivers();
      return 'That driver is no longer available. Please choose another driver.';
    }
    }
    if (!this.rideDate || !this.rideTime) {
      return 'Please choose a date and time.';
    }
    const scheduledAt = new Date(`${this.rideDate}T${this.rideTime}`);
    if (Number.isNaN(scheduledAt.getTime())) {
      return 'Please enter a valid date and time.';
    }
    if (this.rideType === 'schedule' && scheduledAt.getTime() <= Date.now()) {
      return 'Scheduled rides need to be set for a future date and time.';
    }
    if (!this.emergencyContactName.trim() || !this.emergencyContactNumber.trim()) {
      return 'Please enter an emergency contact name and number.';
    }
    if (this.pickupLatitude !== null && !this.pickupConfirmed) {
      return 'Confirm the pickup on the map before submitting.';
    }
    if (this.destinationLatitude !== null && !this.destinationConfirmed) {
      return 'Confirm the destination on the map before submitting.';
    }
    return null;
  }

  private applyRideNowSchedule(): void {
    const now = new Date();
    const minutes = now.getMinutes();
    const rounded = new Date(now.getTime());
    rounded.setSeconds(0, 0);
    rounded.setMinutes(minutes + (5 - (minutes % 5 || 5)));

    const year = rounded.getFullYear();
    const month = String(rounded.getMonth() + 1).padStart(2, '0');
    const day = String(rounded.getDate()).padStart(2, '0');
    const hour = String(rounded.getHours()).padStart(2, '0');
    const minute = String(rounded.getMinutes()).padStart(2, '0');
    this.rideDate = `${year}-${month}-${day}`;
    this.rideTime = `${hour}:${minute}`;
  }

  private async loadCloudDrivers(): Promise<void> {
    const previous = this.selectedDriverId;
    try {
      const drivers = await this.rides.listAvailableDrivers();
      this.drivers = drivers.map((driver) => ({
        id: driver.id,
        name: driver.name,
        phone: driver.phone,
        vehicleType: driver.vehicleType,
        plateNumber: driver.plateNumber,
        vehicleLabel: driver.vehicleLabel,
        ratingText: driver.ratingCount
          ? `${driver.rating?.toFixed(1) ?? '0.0'} ★ · ${driver.ratingCount} reviews`
          : 'Not yet rated',
        rating: driver.rating,
        wheelchair: driver.wheelchairAccessible,
        seniorAssistance: driver.seniorAssistance,
      }));
    } catch (error: unknown) {
      this.drivers = [];
      this.formError = error instanceof Error ? error.message : 'Available drivers could not be loaded.';
    }
    if (previous && this.drivers.some((driver) => driver.id === previous)) {
      return;
    }
    if (previous) {
      this.selectedDriverId = '';
      this.formError = 'That driver is no longer available. Please choose another driver.';
      this.step = 'form';
    }
  }

  private eligibleBookingDrivers(): BookingDriverOption[] {
    return this.auth.listApprovedDrivers()
      .filter((driver) => this.isEligibleAccount(driver))
      .map((driver) => this.toBookingDriver(driver));
  }

  private isEligibleAccount(driver: LocalCareRideUser): boolean {
    if (this.auth.accountStatusOf(driver) !== 'approved') {
      return false;
    }
    const availability = this.auth.readAvailability(driver);
    if (availability === 'offline' || availability === 'unknown') {
      return false;
    }
    if (this.rideType === 'now') {
      return availability === 'available' && !this.localRides.hasOngoingRide(driver.id);
    }
    if (availability !== 'available' && availability !== 'busy') {
      return false;
    }
    const slotMs = this.scheduledSlotMs();
    return slotMs === null || !this.localRides.isDriverBusyAt(driver.id, slotMs);
  }

  private scheduledSlotMs(): number | null {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(this.rideDate) || !/^\d{2}:\d{2}/.test(this.rideTime)) {
      return null;
    }
    const parsed = new Date(`${this.rideDate}T${this.rideTime.slice(0, 5)}`);
    return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
  }

  private toBookingDriver(driver: LocalCareRideUser): BookingDriverOption {
    const vehicleType = driver.vehicleType?.trim() || '';
    const plateNumber = driver.plateNumber?.trim() || '';
    const vehicleLabel = [vehicleType, plateNumber].filter(Boolean).join(' · ');
    return {
      id: driver.id,
      name: driver.fullName,
      phone: driver.phone,
      vehicleType: vehicleType || 'Not provided',
      plateNumber: plateNumber || 'Not provided',
      vehicleLabel: vehicleLabel || 'Not provided',
      ratingText: this.ratingText(driver.id),
      rating: this.averageRating(driver.id),
      wheelchair: Boolean(driver.wheelchairAccessible),
      seniorAssistance: Boolean(driver.seniorAssistance),
    };
  }

  private ratingText(driverId: string): string {
    return this.localRides.driverRatingSummary(driverId);
  }

  private averageRating(driverId: string): number | null {
    const reviews = this.ratedReviews(driverId);
    if (!reviews.length) {
      return null;
    }
    const total = reviews.reduce((sum, ride) => sum + (ride.clientRating ?? 0), 0);
    return Math.round((total / reviews.length) * 10) / 10;
  }

  private ratedReviews(driverId: string) {
    return this.localRides.getDriverClientReviews(driverId).filter(
      (ride) =>
        ride.driverId === driverId &&
        Number.isInteger(ride.clientRating) &&
        (ride.clientRating ?? 0) >= 1 &&
        (ride.clientRating ?? 0) <= 5,
    );
  }

  private async showAlert(header: string, message: string): Promise<void> {
    const alert = await this.alertController.create({
      header,
      message,
      buttons: ['OK'],
    });
    await alert.present();
  }
}

interface BookingDriverOption {
  id: string;
  name: string;
  phone: string;
  vehicleType: string;
  plateNumber: string;
  vehicleLabel: string;
  ratingText: string;
  rating: number | null;
  wheelchair: boolean;
  seniorAssistance: boolean;
}
