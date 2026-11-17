import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
import { DriverLocationPublisherService } from '../../core/services/driver-location-publisher.service';
import { ChangeDetectorRef, Component, DestroyRef, NgZone, OnDestroy, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { filter } from 'rxjs/operators';
import { AlertController, IonIcon, IonSpinner } from '@ionic/angular';

import { LocalDriverOption, LocalRide, LocalRideStatus } from '../../core/models/local-ride.model';
import { isProfileUuid } from '../../core/models/profile-id';
import { LocalRideService } from '../../core/services/local-ride.service';
import { AuthService, LocalCareRideUser } from '../../core/services/auth.service';
import { NotificationService } from '../../core/services/notification.service';
import { DriverAvatarColor, DriverProfilePhotoService } from '../../core/services/driver-profile-photo.service';
import { RideService } from '../../core/services/ride.service';
import { DriverGpsFix, DriverGpsService, isDriverFixStale, poorAccuracyNote } from '../../core/services/driver-gps.service';
import { DriverNavigationComponent } from '../../shared/driver-navigation.component';
import { LocationMapComponent, MapCoordinate, NearbyMapMarker } from '../../shared/location-map.component';
import { MapsService } from '../../core/services/maps.service';
import { NearbyBookingsService, NearbyBooking, NEARBY_BOOKING_RADIUS_KM } from '../../core/services/nearby-bookings.service';
import { DropoffProofService } from '../../core/services/dropoff-proof.service';

interface DriverDialog {
  kind: 'advance' | 'cancel' | 'report' | 'notice' | 'refer';
  title: string;
  confirmLabel?: string;
  message?: string;
  ride?: LocalRide;
  nextStatus?: LocalRideStatus;
  reportText?: string;
  busy?: boolean;
  referralDrivers?: ReferralDriverOption[];
  selectedReferralId?: string;
}

interface ReferralDriverOption {
  id: string;
  name: string;
  vehicleType: string;
  plateNumber: string;
  availability: string;
  ratingText: string;
}

@Component({
  selector: 'app-driver',
  standalone: true,
  host: { class: 'ion-page' },
  imports: [
    CommonModule,
    FormsModule,
    IonIcon,
    IonSpinner,
    DriverNavigationComponent,
    LocationMapComponent,
    RouterLink,
  ],
  templateUrl: './driver.page.html',
  styleUrls: ['./driver.page.scss'],
})
export class DriverPage implements OnInit, OnDestroy {
readonly nearbyRadiusKm = NEARBY_BOOKING_RADIUS_KM;

nearbyLocationEnabled = false;
nearbyLocationStarting = false;
nearbyLocationError = '';

nearbyDriverPoint: MapCoordinate | null = null;
nearbyAccuracyMeters: number | null = null;

private stopNearbyWatch: (() => void) | null = null;
private nearbyStartToken = 0;

get nearbyBookings(): NearbyBooking[] {
  return this.nearbyLocationEnabled
    ? this.nearbyService.findNearby(
        this.nearbyDriverPoint,
        this.requestRides,
      )
    : [];
}

get nearbyMapMarkers(): NearbyMapMarker[] {
  return this.nearbyBookings.map(({ ride, pickup }) => ({
    ...pickup,
    id: ride.id,
    label: `Pickup: ${ride.pickupLocation || 'Passenger'}`,
  }));
}

async enableNearbyLocation(): Promise<void> {
  if (
    this.nearbyLocationEnabled ||
    this.nearbyLocationStarting
  ) {
    return;
  }

  const token = ++this.nearbyStartToken;

  this.nearbyLocationStarting = true;
  this.nearbyLocationError = '';

  try {
    // Verify cloud drivers through their cloud profile.
    // Do not depend on local careride_users for cloud login.
    if (this.auth.cloudAuthEnabled) {
      const profile = await this.auth.currentCloudProfile();

      if (token !== this.nearbyStartToken) {
        return;
      }

      if (
        !profile ||
        profile.role !== 'driver' ||
        profile.accountStatus !== 'approved' ||
        profile.availability !== 'available'
      ) {
        this.nearbyLocationError =
          'Go Online with an approved Driver account before viewing nearby requests.';
        return;
      }
    } else {
      // Preserve existing local driver verification.
      if (!this.sessionDriverId()) {
        this.nearbyLocationError =
          'An approved signed-in driver is required.';
        return;
      }
    }

    if (token !== this.nearbyStartToken) {
      return;
    }

    if (
      typeof navigator === 'undefined' ||
      !navigator.geolocation
    ) {
      this.nearbyLocationError =
        'Device location is unavailable.';
      return;
    }

    if (Capacitor.isNativePlatform()) {
      try {
        let permission = await Geolocation.checkPermissions();

        if (
          permission.location !== 'granted' &&
          permission.coarseLocation !== 'granted'
        ) {
          permission = await Geolocation.requestPermissions();
        }

        if (
          permission.location !== 'granted' &&
          permission.coarseLocation !== 'granted'
        ) {
          this.nearbyLocationError =
            'Location permission was denied. Allow location access in Android Settings.';
          return;
        }
      } catch {
        this.nearbyLocationError =
          'Unable to request location permission. Check Android app settings.';
        return;
      }
    }

    if (token !== this.nearbyStartToken) {
      return;
    }

    this.nearbyLocationEnabled = true;

    this.stopNearbyWatch = this.maps.watchDeviceGps(
      (fix) => {
        this.zone.run(() => {
          if (
            !this.nearbyLocationEnabled ||
            token !== this.nearbyStartToken
          ) {
            return;
          }

          if (
            !Number.isFinite(fix.latitude) ||
            !Number.isFinite(fix.longitude) ||
            fix.latitude < -90 ||
            fix.latitude > 90 ||
            fix.longitude < -180 ||
            fix.longitude > 180
          ) {
            return;
          }

          this.nearbyDriverPoint = {
            latitude: fix.latitude,
            longitude: fix.longitude,
          };

          this.nearbyAccuracyMeters = fix.accuracyMeters;
          this.nearbyLocationError = '';

          this.changes.markForCheck();
        });
      },

      (message, denied) => {
        this.zone.run(() => {
          if (token !== this.nearbyStartToken) {
            return;
          }

          this.nearbyLocationError = message;

          if (denied) {
            this.disableNearbyLocation(false);
          }

          this.changes.markForCheck();
        });
      },
    );
  } catch (error: unknown) {
    if (token === this.nearbyStartToken) {
      this.nearbyLocationError =
        error instanceof Error
          ? error.message
          : 'Unable to verify your driver account or start location.';

      this.disableNearbyLocation(false);
    }
  } finally {
    if (token === this.nearbyStartToken) {
      this.nearbyLocationStarting = false;
      this.changes.markForCheck();
    }
  }
}

disableNearbyLocation(clearError = true): void {
  ++this.nearbyStartToken;

  this.nearbyLocationStarting = false;
  this.nearbyLocationEnabled = false;

  this.stopNearbyWatch?.();
  this.stopNearbyWatch = null;

  this.nearbyDriverPoint = null;
  this.nearbyAccuracyMeters = null;

  if (clearError) {
    this.nearbyLocationError = '';
  }
}

  rides: LocalRide[] = [];
  requestRides: LocalRide[] = [];
  private cloudAvailableRides: LocalRide[] = [];
  scheduleRides: LocalRide[] = [];
  historyRides: LocalRide[] = [];
  clientReviews: LocalRide[] = [];
  listTab: 'home' | 'schedule' | 'active' | 'history' | 'clients' = 'home';
  me: LocalDriverOption | null = null;
  fetching = false;
  clockWeekday = '';
  clockDate = '';
  clockTime = '';
  clockFullDate = '';
  timeGreeting = 'Good Day';
  readonly dashboardQuote = 'Drive safely, every journey matters.';
  dialog: DriverDialog | null = null;
  availabilityUpdating = false;
  get cloudLocationEnabled(): boolean { return this.auth.cloudAuthEnabled === true; }
  readonly locationPublisher = inject(DriverLocationPublisherService);
  locationShareBusy = false;
  dropoffProofRide: LocalRide | null = null;
  dropoffProofUploading = false;
  readonly uploadedProofIds = new Set<string>();

  get locationShareActive(): boolean {
    return this.locationPublisher.message() === 'Location sharing active.';
  }

  async shareLiveLocation(): Promise<void> {
    if (this.locationShareBusy || this.availabilityUpdating) return;

    if (!this.auth.cloudAuthEnabled || this.myAvailability !== 'available') {
      this.showNotice('Go Online with an approved cloud Driver account before sharing GPS.', 'Location sharing');
      return;
    }

    const alert = await this.alerts.create({
      header: 'Share your exact live location?',
      message: 'Approved passengers nearby may see your exact GPS location before booking. Sharing stops when you leave the Driver Dashboard, go offline, or tap Stop Sharing. Do you agree?',
      backdropDismiss: false,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        { text: 'Agree & Share', role: 'confirm' },
      ],
    });
    await alert.present();
    const { role } = await alert.onDidDismiss();
    if (role !== 'confirm' || this.myAvailability !== 'available') return;

    this.locationShareBusy = true;
    try {
      const profile = await this.auth.currentCloudProfile();
      if (!profile || profile.role !== 'driver' || profile.accountStatus !== 'approved' || profile.availability !== 'available') {
        this.showNotice('An approved, available Driver account is required.', 'Location sharing');
        return;
      }
      await this.locationPublisher.optIn(this.locationPublisher.onlineIntent());
    } catch (error: unknown) {
      this.showNotice(error instanceof Error ? error.message : 'Unable to start location sharing.', 'Location sharing');
    } finally {
      this.locationShareBusy = false;
      this.changes.markForCheck();
    }
  }

  async stopLiveLocation(): Promise<void> {
    if (this.locationShareBusy) return;
    this.locationShareBusy = true;
    try {
      await this.locationPublisher.disable();
    } finally {
      this.locationShareBusy = false;
      this.changes.markForCheck();
    }
  }
  availabilityError = '';
  notificationCount = 0;
  calendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  selectedDay = this.toDayKey(new Date());
  readonly weekdayLabels = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private clockTimer: ReturnType<typeof setInterval> | null = null;
  private readonly destroyRef = inject(DestroyRef);
  private readonly onStorage = (event: StorageEvent) => {
    if (event.key && event.key !== 'careride.local.rides') {
      return;
    }
    this.localRides.reloadFromStorage();
  };

  private readonly onRidesChanged = () => {
    this.localRides.reloadFromStorage();
  };

  private readonly onVisibility = () => {
    if (document.visibilityState === 'visible') {
      this.tickClock(true);
      void this.fetchRides();
    }
  };

  constructor(
    private localRides: LocalRideService,
    private ridesApi: RideService,
    private auth: AuthService,
    private router: Router,
    private alerts: AlertController,
    private notifications: NotificationService,
    private driverGps: DriverGpsService,
    private profilePhotos: DriverProfilePhotoService,
    private changes: ChangeDetectorRef,
    private maps: MapsService,
    private nearbyService: NearbyBookingsService,
    private zone: NgZone,
    private dropoffProofs: DropoffProofService,
  ) {}

  ngOnInit(): void {
    this.profilePhotos.photoChanged$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((changedDriverId) => {
        if (changedDriverId && changedDriverId === this.profileDriverId) {
          this.refreshDriverAvatar(changedDriverId);
        }
      });
    if (!this.auth.cloudAuthEnabled) {
      const local = this.auth.getLocalAccount();
      this.refreshDriverAvatar(local?.accountType === 'driver' ? local.id : null);
    }
    this.localRides.rides$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.applyRides());
    this.notifications.changes$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.refreshNotificationCount());
    this.driverGps.changes$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.changes.markForCheck());
    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => this.syncViewFromUrl());
    window.addEventListener('storage', this.onStorage);
    window.addEventListener('careride-rides-changed', this.onRidesChanged);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.syncViewFromUrl();
    void this.fetchRides();
    this.startAutoFetch();
    this.startClock();
  }

  ionViewWillEnter(): void {
    if (this.auth.cloudAuthEnabled) {
      this.refreshDriverAvatar(null);
    } else {
      const local = this.auth.getLocalAccount();
      this.refreshDriverAvatar(local?.accountType === 'driver' ? local.id : null);
    }
    this.locationPublisher.setDashboardVisible(true);
    this.refreshNotificationCount();
    this.syncViewFromUrl();
    if (this.auth.cloudAuthEnabled) {
      void this.refreshCloudAvailability();
    }
    void this.fetchRides();
    this.startAutoFetch();
    this.startClock();
  }

  ionViewWillLeave(): void {
    this.disableNearbyLocation();
    void this.locationPublisher.disable();
    this.locationPublisher.setDashboardVisible(false);
  }

  ionViewDidLeave(): void {
    if (!this.router.url.startsWith('/driver')) {
      this.stopAutoFetch();
      this.stopClock();
    }
  }

  ngOnDestroy(): void {
    this.disableNearbyLocation();
    void this.locationPublisher.disable();
    this.locationPublisher.setDashboardVisible(false);
    this.stopAutoFetch();
    this.stopClock();
    window.removeEventListener('storage', this.onStorage);
    window.removeEventListener('careride-rides-changed', this.onRidesChanged);
    document.removeEventListener('visibilitychange', this.onVisibility);
  }

  get visibleRides(): LocalRide[] {
    if (this.listTab === 'schedule') {
      return this.scheduleRides;
    }
    if (this.listTab === 'clients') {
      return this.clientReviews;
    }
    if (this.listTab === 'active') {
      return [...this.requestRides, ...this.rides];
    }
    return this.historyRides;
  }

  get isHome(): boolean {
    return this.listTab === 'home';
  }

  homeLoaded = false;
  homeLoadError = '';
  private cloudDriverName = '';
  private profileDriverId: string | null = null;
  driverProfilePhoto: string | null = null;
  driverAvatarColor: DriverAvatarColor = 'teal';

  get driverAvatarBackground(): string {
    const backgrounds: Record<DriverAvatarColor, string> = {
      teal: '#dcfbef', blue: '#deefff', purple: '#ebe0fa', peach: '#ffebdf',
    };
    return backgrounds[this.driverAvatarColor];
  }

  get driverAvatarForeground(): string {
    const foregrounds: Record<DriverAvatarColor, string> = {
      teal: '#078b70', blue: '#397dbb', purple: '#8054b5', peach: '#b86b46',
    };
    return foregrounds[this.driverAvatarColor];
  }

  private refreshDriverAvatar(driverId: string | null): void {
    this.profileDriverId = driverId;
    this.driverProfilePhoto = driverId ? this.profilePhotos.getPhoto(driverId) : null;
    this.driverAvatarColor = driverId ? this.profilePhotos.getAvatarColor(driverId) : 'teal';
    this.changes.markForCheck();
  }

  get driverWelcomeName(): string {
    return this.cloudDriverName || this.auth.getLocalAccount()?.fullName?.trim() || 'Driver';
  }

  get driverFirstName(): string {
    const fullName = this.driverWelcomeName.trim();
    return fullName.split(/\s+/)[0] || 'Driver';
  }

  get personalizedGreeting(): string {
    return `${this.timeGreeting}, ${this.driverFirstName}!`;
  }

  get todayTripCount(): number {
    const today = this.toDayKey(new Date());
    return this.scheduleRides.filter((ride) => this.rideDayKey(ride) === today).length;
  }

  get completedTripCount(): number {
    return this.historyRides.filter((ride) => ride.status === 'Completed').length;
  }

  get upcomingHomeRides(): LocalRide[] {
    const now = Date.now();
    return this.scheduleRides
      .filter((ride) => (this.pickupStart(ride) ?? 0) >= now)
      .sort((a, b) => (this.pickupStart(a) ?? 0) - (this.pickupStart(b) ?? 0))
      .slice(0, 3);
  }

  get recentHomeRides(): LocalRide[] {
    const unique = new Map([...this.requestRides, ...this.scheduleRides, ...this.rides, ...this.historyRides]
      .map((ride) => [ride.id, ride]));
    return [...unique.values()]
      .filter((ride) => Number.isFinite(Date.parse(ride.updatedAt)))
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      .slice(0, 4);
  }

  get pageTitle(): string {
    switch (this.listTab) {
      case 'schedule':
        return 'My schedule';
      case 'active':
        return 'Active trips';
      case 'clients':
        return 'Past clients';
      case 'history':
        return 'Trip history';
      default:
        return 'Overview';
    }
  }

  get myRating(): string {
    const driverId = this.sessionDriverId();
    if (!driverId) {
      return '';
    }
    return this.localRides.driverRatingSummary(driverId);
  }

  get overviewBars(): Array<{ label: string; value: number; pct: number }> {
    const items = [
      { label: 'Schedule', value: this.scheduleRides.length },
      { label: 'Assigned', value: this.assignedCount },
      { label: 'Ongoing', value: this.ongoingCount },
      { label: 'Done', value: this.historyRides.length },
    ];
    const max = Math.max(...items.map((item) => item.value), 1);
    return items.map((item) => ({ ...item, pct: Math.round((item.value / max) * 100) }));
  }

  get ratingBars(): Array<{ label: string; value: number; pct: number }> {
    const counts = [1, 2, 3, 4, 5].map((star) => ({
      label: `${star}â˜…`,
      value: this.clientReviews.filter((ride) => ride.clientRating === star).length,
    }));
    const max = Math.max(...counts.map((item) => item.value), 1);
    return counts.map((item) => ({ ...item, pct: Math.round((item.value / max) * 100) }));
  }

  get ratedCount(): number {
    return this.clientReviews.filter((ride) => ride.clientRating).length;
  }

  stars(rating: number | null | undefined): string {
    const value = Math.round(rating ?? 0);
    if (value < 1) {
      return 'Not rated yet';
    }
    return `${'â˜…'.repeat(value)}${'â˜†'.repeat(5 - value)} ${value}.0`;
  }

  get calendarTitle(): string {
    return this.calendarMonth.toLocaleDateString(undefined, {
      month: 'long',
      year: 'numeric',
    });
  }

  get calendarDays(): Array<{
    key: string;
    day: number;
    inMonth: boolean;
    count: number;
    today: boolean;
    selected: boolean;
  }> {
    const year = this.calendarMonth.getFullYear();
    const month = this.calendarMonth.getMonth();
    const startPad = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const prevMonthDays = new Date(year, month, 0).getDate();
    const todayKey = this.toDayKey(new Date());
    const cells = [];

    for (let index = 0; index < 42; index += 1) {
      const dayNum = index - startPad + 1;
      let inMonth = true;
      let date: Date;
      if (dayNum < 1) {
        inMonth = false;
        date = new Date(year, month - 1, prevMonthDays + dayNum);
      } else if (dayNum > daysInMonth) {
        inMonth = false;
        date = new Date(year, month, dayNum);
      } else {
        date = new Date(year, month, dayNum);
      }
      const key = this.toDayKey(date);
      cells.push({
        key,
        day: date.getDate(),
        inMonth,
        count: this.scheduleRides.filter((ride) => this.rideDayKey(ride) === key).length,
        today: key === todayKey,
        selected: key === this.selectedDay,
      });
    }
    return cells;
  }

  get selectedDayLabel(): string {
    const [year, month, day] = this.selectedDay.split('-').map(Number);
    if (!year || !month || !day) {
      return 'Select a day';
    }
    return new Date(year, month - 1, day).toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });
  }

  get selectedDayRides(): LocalRide[] {
    return this.scheduleRides.filter((ride) => this.rideDayKey(ride) === this.selectedDay);
  }

  shiftCalendar(amount: number): void {
    this.calendarMonth = new Date(
      this.calendarMonth.getFullYear(),
      this.calendarMonth.getMonth() + amount,
      1,
    );
  }

  selectCalendarDay(key: string): void {
    this.selectedDay = key;
  }

  private toDayKey(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private rideDayKey(ride: LocalRide): string {
    return (ride.date || '').slice(0, 10);
  }

  get assignedCount(): number {
    return this.rides.filter((ride) => ride.status === 'Driver Assigned').length;
  }

  get ongoingCount(): number {
    return this.rides.filter((ride) => ride.status !== 'Driver Assigned').length;
  }

  showTab(tab: 'home' | 'schedule' | 'active' | 'history' | 'clients'): void {
    if (tab !== 'active') this.disableNearbyLocation();
    this.listTab = tab;
  }

  private syncViewFromUrl(): void {
    const path = this.router.url.split('?')[0];
    if (!path.endsWith('/active')) this.disableNearbyLocation();
    if (path.endsWith('/schedule')) {
      this.listTab = 'schedule';
      return;
    }
    if (path.endsWith('/active')) {
      this.listTab = 'active';
      return;
    }
    if (path.endsWith('/clients')) {
      this.listTab = 'clients';
      return;
    }
    if (path.endsWith('/history')) {
      this.listTab = 'history';
      return;
    }
    this.listTab = 'home';
  }

  getNextStatus(status: LocalRideStatus): { status: LocalRideStatus; label: string } | null {
    switch (status) {
      case 'Driver Assigned':
        return { status: 'Driver On The Way', label: 'Start trip to pickup' };
      case 'Driver On The Way':
        return { status: 'Arrived', label: 'Mark arrived' };
      case 'Arrived':
        return { status: 'Picked Up', label: 'Passenger picked up' };
      case 'Picked Up':
        return { status: 'In Progress', label: 'Start ride' };
      case 'In Progress':
        return { status: 'Completed', label: 'Complete ride' };
      default:
        return null;
    }
  }

  canStartRide(ride: LocalRide): boolean {
    const driverId = this.sessionDriverId();
    return Boolean(driverId && ride.driverId === driverId && ride.status === 'Driver Assigned');
  }

  canCompleteRide(ride: LocalRide): boolean {
    const driverId = this.sessionDriverId();
    return Boolean(driverId && ride.driverId === driverId && this.localRides.isOngoingStatus(ride.status));
  }

  startRide(ride: LocalRide): void {
    void this.confirmRideAction(ride, 'start');
  }

  completeRide(ride: LocalRide): void {
    void this.confirmRideAction(ride, 'complete');
  }

  canUploadDropoffProof(ride: LocalRide): boolean {
    return this.ridesApi.cloudBookings
      && ride.status === 'Completed'
      && ride.driverId === this.sessionDriverId()
      && !this.uploadedProofIds.has(ride.id);
  }

  chooseDropoffProof(ride: LocalRide, input: HTMLInputElement): void {
    if (!this.canUploadDropoffProof(ride) || this.dropoffProofUploading) {
      return;
    }
    this.dropoffProofRide = ride;
    input.value = '';
    input.click();
  }

  async uploadDropoffProof(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement | null;
    const file = input?.files?.item(0);
    const ride = this.dropoffProofRide;
    this.dropoffProofRide = null;
    if (!file || !ride || !this.canUploadDropoffProof(ride) || this.dropoffProofUploading) {
      return;
    }

    this.dropoffProofUploading = true;
    try {
      await this.dropoffProofs.upload(ride.id, file, {
        destinationLabel: ride.destination,
        destinationLatitude: ride.destinationLatitude,
        destinationLongitude: ride.destinationLongitude,
      });
      this.uploadedProofIds.add(ride.id);
      this.showNotice('The safe-arrival photo is now available to the passenger in Ride History.', 'Photo sent');
    } catch (error: unknown) {
      this.showNotice(error instanceof Error ? error.message : 'The arrival photo could not be uploaded.', 'Photo not sent');
    } finally {
      this.dropoffProofUploading = false;
      if (input) input.value = '';
      this.changes.markForCheck();
    }
  }

  rideActionId: string | null = null;

  private async confirmRideAction(ride: LocalRide, action: 'start' | 'complete'): Promise<void> {
    if (this.rideActionId) {
      return;
    }
    this.rideActionId = ride.id;
    try {
      const alert = await this.alerts.create({
        header: action === 'start' ? 'Start ride' : 'Complete ride',
        message: action === 'start'
          ? 'Start this ride now? It will show as in progress. While you remain Go Online and allow GPS, fresh location updates can be shared with this passenger.'
          : 'Complete this ride? It will move to your completed trips.',
        backdropDismiss: false,
        buttons: [
          { text: 'Cancel', role: 'cancel' },
          { text: action === 'start' ? 'Start Ride' : 'Complete Ride', role: 'confirm' },
        ],
      });
      await alert.present();
      const { role } = await alert.onDidDismiss();
      if (role !== 'confirm') {
        return;
      }
      if (this.ridesApi.cloudBookings) {
        const saved = action === 'start'
          ? await this.ridesApi.startBooking(ride.id)
          : await this.ridesApi.completeBooking(ride.id);
        this.localRides.saveRide(saved);
        this.applyRides();
        if (action === 'start' && this.auth.cloudAuthEnabled && this.myAvailability === 'available') {
          // Starting a ride is explicit Driver consent. Existing publisher checks
          // permission, availability, session validity, accuracy, and freshness.
          await this.locationPublisher.optIn(this.locationPublisher.onlineIntent());
        }
        if (action === 'complete') {
          this.driverGps.stop();
        }
        this.showNotice(
          action === 'start'
            ? 'Ride started. Location sharing will begin when Go Online and GPS permission are active.'
            : 'Ride completed. It is in your trip history.',
          action === 'start' ? 'Ride started' : 'Ride completed',
        );
        return;
      }
      const driverId = this.sessionDriverId();
      if (!driverId) {
        this.showNotice('Sign in as the assigned driver to update this ride.');
        return;
      }
      const result = action === 'start'
        ? this.localRides.startRide(ride.id, driverId)
        : this.localRides.completeRide(ride.id, driverId);
      this.applyRides();
      if (!result.ride) {
        this.showNotice(result.reason || 'The ride was not updated.');
        return;
      }
      if (action === 'complete' && result.ride) {
        this.driverGps.stop();
      }
      this.showNotice(
        action === 'start'
          ? 'Ride started. It is now in progress.'
          : 'Ride completed. It is in your trip history.',
        action === 'start' ? 'Ride started' : 'Ride completed',
      );
    } catch (error: unknown) {
      this.showNotice(error instanceof Error ? error.message : 'The ride was not updated.');
    } finally {
      this.rideActionId = null;
    }
  }

  advanceRide(ride: LocalRide): void {
    const action = this.getNextStatus(ride.status);
    if (!action) {
      this.showNotice('No driver action is available for this ride.');
      return;
    }
    this.dialog = {
      kind: 'advance',
      title: action.label,
      confirmLabel: action.label,
      ride,
      nextStatus: action.status,
    };
  }

  cancelRide(ride: LocalRide): void {
    if (ride.status !== 'Driver Assigned') {
      this.showNotice('This ride can no longer be cancelled by the driver.');
      return;
    }
    this.dialog = {
      kind: 'cancel',
      title: 'Cancel this assignment?',
      confirmLabel: 'Cancel assignment',
      ride,
    };
  }

  reportIssue(ride: LocalRide): void {
    this.dialog = {
      kind: 'report',
      title: 'Report a ride issue',
      confirmLabel: 'Submit report',
      ride,
      reportText: '',
    };
  }

  closeDialog(): void {
    if (this.dialog?.busy) {
      return;
    }
    this.dialog = null;
  }

  confirmDialog(): void {
    if (!this.dialog || this.dialog.busy) {
      return;
    }
    if (this.dialog.kind === 'notice') {
      this.dialog = null;
      return;
    }
    if (this.dialog.kind === 'advance' && this.dialog.ride && this.dialog.nextStatus) {
      void this.completeAdvance(this.dialog.ride, this.dialog.nextStatus);
      return;
    }
    if (this.dialog.kind === 'cancel' && this.dialog.ride) {
      void this.completeCancel(this.dialog.ride);
      return;
    }
    if (this.dialog.kind === 'report' && this.dialog.ride) {
      void this.completeReport(this.dialog.ride, this.dialog.reportText ?? '');
      return;
    }
    if (this.dialog.kind === 'refer' && this.dialog.ride) {
      this.confirmReferral(this.dialog.ride);
    }
  }

  canRespond(ride: LocalRide): boolean {
    const driverId = this.sessionDriverId();
    if (!driverId) {
      return false;
    }
    if (this.ridesApi.cloudBookings && !isProfileUuid(ride.id)) {
      return false;
    }
    if (ride.status !== 'Pending' && ride.status !== 'Scheduled') {
      return false;
    }
    if (this.ridesApi.cloudBookings && this.cloudAvailableRides.some((item) => item.id === ride.id)) {
      return !ride.preferredDriverId || ride.preferredDriverId === driverId;
    }
    return ride.preferredDriverId === driverId || ride.driverId === driverId;
  }

  acceptRequest(ride: LocalRide): void {
    if (this.ridesApi.cloudBookings) {
      void this.acceptCloudRequest(ride);
      return;
    }
    const driver = this.actingDriver();
    const current = this.localRides.getRideById(ride.id);
    if (!driver || !current || !this.canRespond(current)) {
      this.showNotice('This booking can no longer be accepted.');
      return;
    }
    let booking = current;
    if (current.status === 'Scheduled') {
      this.localRides.reloadFromStorage();
      const latest = this.localRides.getRideById(current.id);
      if (!latest || !this.canRespond(latest)) {
        this.showNotice('This booking can no longer be accepted.');
        return;
      }
      booking = latest;
      if (this.samePickupConflict(booking, driver.driverId)) {
        void this.alerts.create({
          header: 'Schedule Conflict',
          message: 'You already have an accepted ride during this time.',
          buttons: ['OK'],
        }).then((alert) => alert.present());
        return;
      }
    }
    const overlap = booking.status === 'Scheduled'
      ? { blocked: null, unchecked: this.pickupStart(booking) === null }
      : this.confirmedOverlap(booking, driver.driverId);
    if (overlap.blocked) {
      this.showNotice(
        `This overlaps a confirmed trip on ${this.formatDate(overlap.blocked.date)} at ${this.formatTime(overlap.blocked.time)}. It was not accepted.`,
      );
      return;
    }
    if (booking.status === 'Pending' && this.localRides.hasOngoingRide(driver.driverId)) {
      this.showNotice('You already have a ride in progress. This immediate request was not accepted.');
      return;
    }
    const accepted = this.localRides.advanceRide(booking.id, 'Driver Assigned');
    if (!accepted) {
      this.showNotice('This booking can no longer be accepted.');
      return;
    }
    const assigned = this.localRides.updateRide(booking.id, {
      driverId: driver.driverId,
      driverName: booking.preferredDriverName || driver.driverName,
      driverPhone: booking.preferredDriverPhone || driver.driverPhone,
      vehicleLabel: booking.preferredVehicleLabel || driver.vehicleLabel,
      driverRating: booking.preferredDriverRating ?? driver.rating,
    });
    if (assigned) {
      this.notifications.bookingAccepted(assigned);
    }
    this.applyRides();
    const scheduled = booking.status === 'Scheduled';
    if (overlap.unchecked) {
      this.showNotice(
        scheduled
          ? 'Scheduled booking confirmed and added to My Schedule. The pickup date or time could not be read, so an overlap check was not completed.'
          : 'Booking confirmed on your active trips. The pickup date or time could not be read, so an overlap check was not completed.',
        'Accepted',
      );
      return;
    }
    this.showNotice(
      scheduled
        ? 'Scheduled booking confirmed. It is on My Schedule.'
        : 'Booking confirmed. It is now on your active trips.',
      'Accepted',
    );
  }

  declineRequest(ride: LocalRide): void {
    if (this.ridesApi.cloudBookings) {
      void this.declineCloudRequest(ride);
      return;
    }
    const driver = this.actingDriver();
    const current = this.localRides.getRideById(ride.id);
    if (!driver || !current || !this.canRespond(current)) {
      this.showNotice('This booking can no longer be declined.');
      return;
    }
    const declined = this.localRides.rejectRide(current.id);
    if (!declined) {
      this.showNotice('This booking can no longer be declined.');
      return;
    }
    const stamped = this.localRides.updateRide(current.id, {
      driverId: driver.driverId,
      driverName: current.preferredDriverName || driver.driverName,
      driverPhone: current.preferredDriverPhone || driver.driverPhone,
      vehicleLabel: current.preferredVehicleLabel || driver.vehicleLabel,
    });
    this.notifications.bookingDeclined(stamped || declined);
    this.applyRides();
    this.showNotice('Request declined. It stays in trip history.', 'Declined');
  }

  referRequest(ride: LocalRide): void {
    if (this.ridesApi.cloudBookings) {
      void this.openCloudReferral(ride);
      return;
    }
    this.localRides.reloadFromStorage();
    const current = this.localRides.getRideById(ride.id);
    const driverId = this.sessionDriverId();
    if (!current || !driverId || !this.canRefer(current, driverId)) {
      this.showNotice('This request is not waiting for you.');
      return;
    }
    if (current.referralStatus === 'pending') {
      this.showNotice('This ride already has a pending referral.');
      return;
    }
    const referralDrivers = this.eligibleReplacementDrivers(current, driverId);
    if (!referralDrivers.length) {
      this.showNotice('No available drivers can take this ride right now.');
      return;
    }
    this.dialog = {
      kind: 'refer',
      title: 'Refer to another driver',
      confirmLabel: 'Continue',
      ride: current,
      referralDrivers,
      selectedReferralId: '',
    };
  }

  selectReferralDriver(driverId: string): void {
    if (!this.dialog || this.dialog.kind !== 'refer') {
      return;
    }
    this.dialog.selectedReferralId = driverId;
  }

  hasPendingReferral(ride: LocalRide): boolean {
    return ride.referralStatus === 'pending' && Boolean(ride.referralProposedDriverId);
  }

  showRefer(ride: LocalRide): boolean {
    const driverId = this.sessionDriverId();
    return Boolean(driverId && this.canRefer(ride, driverId) && !this.hasPendingReferral(ride));
  }

  viewRide(ride: LocalRide): void {
    void this.router.navigate(['/ride-details', ride.id], { state: { ride } });
  }

  openNotifications(): void {
    void this.router.navigate(['/notifications']);
  }

  private refreshNotificationCount(): void {
    const account = this.auth.getLocalAccount();
    this.notificationCount = account ? this.notifications.unreadCount(account.id) : 0;
  }

  signOut(): void {
    void this.locationPublisher.disable();
    this.disableNearbyLocation();
    this.driverGps.stop();
    void this.auth.signOut().then(() => this.router.navigate(['/login']));
  }

  canShareLocation(ride: LocalRide): boolean {
    const driverId = this.sessionDriverId();
    if (!driverId || ride.driverId !== driverId) {
      return false;
    }
    return [
      'Driver Assigned',
      'Driver On The Way',
      'Arrived',
      'Picked Up',
      'In Progress',
    ].includes(ride.status);
  }

  sharingLocation(ride: LocalRide): boolean {
    return this.driverGps.trackingActive && this.driverGps.snapshot.rideId === ride.id;
  }

  driverFix(ride: LocalRide): DriverGpsFix | null {
    return this.driverGps.fixForRide(ride.id);
  }

  driverFixIsStale(fix: DriverGpsFix): boolean {
    return isDriverFixStale(fix.capturedAt);
  }

  driverAccuracyNote(fix: DriverGpsFix): string | null {
    return poorAccuracyNote(fix.accuracyMeters);
  }

  get driverShareOffline(): boolean {
    return this.driverGps.snapshot.offline;
  }

  ridePoint(latitude: number | null | undefined, longitude: number | null | undefined): { latitude: number; longitude: number } | null {
    if (latitude == null || longitude == null) {
      return null;
    }
    return { latitude, longitude };
  }

  toggleLocationShare(ride: LocalRide): void {
    if (!this.canShareLocation(ride)) {
      this.showNotice('Share location only for a ride assigned to you.');
      return;
    }
    if (this.sharingLocation(ride)) {
      this.driverGps.stop();
      this.showNotice('Location sharing stopped.', 'Location');
      return;
    }
    const driverId = this.sessionDriverId();
    this.driverGps.start(ride.id, {
      actorId: driverId || '',
      driverId: ride.driverId || '',
    });
    const error = this.driverGps.snapshot.error;
    this.showNotice(
      error || 'Location sharing requested. Allow GPS for this accepted ride.',
      error ? 'Location' : 'Sharing location',
    );
  }

  formatDate(date: string): string {
    return this.localRides.formatDate(date);
  }

  formatTime(time: string): string {
    return this.localRides.formatTime(time);
  }

  assistanceSummary(ride: LocalRide): string {
    return this.localRides.assistanceSummary(ride);
  }

  statusTone(ride: LocalRide): string {
    return this.localRides.statusTone(ride.status);
  }

  statusLabel(ride: LocalRide): string {
    if (ride.status === 'Rejected') {
      return 'Declined';
    }
    if (ride.status === 'Driver Assigned') {
      return 'New client';
    }
    return ride.status;
  }

  isScheduledRequest(ride: LocalRide): boolean {
    return ride.status === 'Scheduled';
  }

  canAcceptReferral(ride: LocalRide): boolean {
    if (!this.ridesApi.cloudBookings || !this.ridesApi.cloudProfileId) {
      return false;
    }
    return ride.referralStatus === 'pending'
      && ride.referralProposedDriverId === this.ridesApi.cloudProfileId
      && (ride.status === 'Pending' || ride.status === 'Scheduled');
  }

  declineReferral(ride: LocalRide): void {
    if (!this.canAcceptReferral(ride)) {
      this.showNotice('This referral is not waiting for you.');
      return;
    }
    void this.ridesApi.declineReferral(ride.id).then((saved) => {
      this.localRides.saveRide(saved);
      this.applyRides();
      this.showNotice('You declined the referral. The original driver still has this booking.', 'Referral declined');
    }).catch((error: unknown) => {
      this.showNotice(error instanceof Error ? error.message : 'This referral is not waiting for you.');
    });
  }

  acceptReferral(ride: LocalRide): void {
    if (!this.canAcceptReferral(ride)) {
      this.showNotice('This referral is not waiting for you.');
      return;
    }
    void this.ridesApi.acceptReferral(ride.id).then((saved) => {
      this.localRides.saveRide(saved);
      this.applyRides();
      this.showNotice('You accepted the referral. The passenger confirms the driver change.', 'Referral accepted');
    }).catch((error: unknown) => {
      this.showNotice(error instanceof Error ? error.message : 'This referral is not waiting for you.');
    });
  }

  private cloudAvailability: 'available' | 'busy' | 'offline' | null = null;

  get myAvailability(): 'available' | 'busy' | 'offline' | 'unknown' {
    if (this.auth.cloudAuthEnabled) {
      return this.cloudAvailability ?? 'unknown';
    }
    if (this.ridesApi.cloudBookings && this.cloudAvailability) {
      return this.cloudAvailability;
    }
    const account = this.auth.getLocalAccount();
    return account ? this.auth.readAvailability(account) : 'unknown';
  }

  get myAvailabilityLabel(): string {
    if (this.myAvailability === 'available') {
      return 'Available';
    }
    if (this.myAvailability === 'busy') {
      return 'Busy';
    }
    if (this.myAvailability === 'offline') {
      return 'Offline';
    }
    return 'Not set';
  }

  async setMyAvailability(status: 'available' | 'offline'): Promise<void> {
    if (status === 'offline') void this.locationPublisher.disable();
    if (this.availabilityUpdating) {
      return;
    }
    if (this.auth.cloudAuthEnabled || this.ridesApi.cloudBookings) {
      await this.setCloudAvailability(status);
      return;
    }
    if (this.myAvailability === status) {
      this.showNotice(`You are already ${this.availabilityName(status)}.`, 'Availability');
      return;
    }
    try {
      this.auth.setMyAvailability(status);
      this.showNotice(`You are now ${this.availabilityName(status)}.`, 'Availability updated');
    } catch (error: unknown) {
      this.showNotice(error instanceof Error ? error.message : 'Unable to update availability.');
    }
  }

  private availabilityName(status: 'available' | 'busy' | 'offline'): string {
    if (status === 'busy') {
      return 'Busy';
    }
    if (status === 'offline') {
      return 'Offline';
    }
    return 'Available';
  }

  private async refreshCloudAvailability(): Promise<void> {
    this.availabilityError = '';
    try {
      const profile = await this.auth.currentCloudProfile();
      if (!profile || profile.role !== 'driver' || profile.accountStatus !== 'approved') {
        throw new Error('Could not verify your approved Driver account. Sign in again or contact an admin.');
      }
      if (profile.availability !== 'available' && profile.availability !== 'busy' && profile.availability !== 'offline') {
        throw new Error('Your availability could not be read. Please try again.');
      }
      this.cloudDriverName = profile.fullName?.trim() || '';
      this.refreshDriverAvatar(profile.id);
      this.cloudAvailability = profile.availability;
      if (profile.availability !== 'available') void this.locationPublisher.disable();
    } catch (error: unknown) {
      this.cloudDriverName = '';
      this.refreshDriverAvatar(null);
      this.cloudAvailability = null;
      this.availabilityError = error instanceof Error
        ? error.message
        : 'Your availability could not be read. Please try again.';
    }
    this.changes.markForCheck();
  }

  trackRide(_index: number, ride: LocalRide): string {
    return ride.id;
  }

  private showNotice(message: string, title = 'CareRide'): void {
    this.dialog = { kind: 'notice', title, message, confirmLabel: 'OK' };
  }

  private async completeAdvance(ride: LocalRide, nextStatus: LocalRideStatus): Promise<void> {
    if (this.dialog) {
      this.dialog.busy = true;
    }
    try {
      const updatedRide = await this.ridesApi.advanceUiStatus(ride.id, nextStatus);
      if (!updatedRide) {
        this.showNotice('Unable to update the ride.');
        return;
      }
      await this.fetchRides();
      this.showNotice(`Ride status updated to â€œ${nextStatus}â€.`, 'Updated');
    } catch (error: unknown) {
      this.showNotice(error instanceof Error ? error.message : 'Unable to update the ride.');
    }
  }

  private async completeCancel(ride: LocalRide): Promise<void> {
    if (this.dialog) {
      this.dialog.busy = true;
    }
    try {
      const cancelled = await this.ridesApi.cancelRide(ride.id);
      if (!cancelled) {
        this.showNotice('Unable to cancel this ride.');
        return;
      }
      if (this.driverGps.snapshot.rideId === ride.id) {
        this.driverGps.stop();
      }
      await this.fetchRides();
      this.showNotice('Ride assignment cancelled.', 'Cancelled');
    } catch (error: unknown) {
      this.showNotice(error instanceof Error ? error.message : 'Unable to cancel this ride.');
    }
  }

  private async completeReport(ride: LocalRide, issue: string): Promise<void> {
    const cleanIssue = issue.trim();
    if (!cleanIssue) {
      this.showNotice('Please describe the issue before submitting.');
      return;
    }
    if (this.dialog) {
      this.dialog.busy = true;
    }
    try {
      await this.ridesApi.reportIssue(ride.id, cleanIssue);
      await this.fetchRides();
      this.showNotice('Issue recorded for this trip.', 'Reported');
    } catch (error: unknown) {
      this.showNotice(
        error instanceof Error
          ? error.message
          : 'Issue recorded for local testing. Connect Supabase to store incidents.',
      );
    }
  }

  private startClock(): void {
    if (this.clockTimer !== null) {
      this.tickClock();
      return;
    }
    this.tickClock();
    this.clockTimer = setInterval(() => this.tickClock(), 1000);
  }

  private stopClock(): void {
    if (this.clockTimer !== null) {
      clearInterval(this.clockTimer);
      this.clockTimer = null;
    }
  }

  private tickClock(_force = false): void {
    const now = new Date();
    const dateOptions: Intl.DateTimeFormatOptions = {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    };
    this.clockWeekday = now.toLocaleDateString('en-US', { weekday: 'long' });
    this.clockDate = now.toLocaleDateString('en-US', {
      month: 'long', day: 'numeric', year: 'numeric',
    });
    this.clockFullDate = now.toLocaleDateString('en-US', dateOptions);
    this.clockTime = now.toLocaleTimeString('en-US', {
      hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true,
    });

    const hour = now.getHours();
    if (hour >= 5 && hour < 12) {
      this.timeGreeting = 'Good Morning';
    } else if (hour >= 12 && hour < 17) {
      this.timeGreeting = 'Good Afternoon';
    } else if (hour >= 17 && hour < 21) {
      this.timeGreeting = 'Good Evening';
    } else {
      this.timeGreeting = 'Good Night';
    }
    this.changes.markForCheck();
  }

  private startAutoFetch(): void {
    this.stopAutoFetch();
    this.pollTimer = setInterval(() => {
      void this.fetchRides();
    }, 4000);
  }

  private stopAutoFetch(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async fetchRides(): Promise<void> {
    this.fetching = true;
    this.homeLoadError = '';
    try {
      this.localRides.reloadFromStorage();
      await this.ridesApi.hydrateFromCloud();
      // The booking RLS policy returns only trips visible to this Driver,
      // including a Passenger's selected pending request. Keep that cache as
      // the source of driver requests until broad booking dispatch exists.
      this.cloudAvailableRides = this.ridesApi.cloudBookings
        ? this.localRides.getRides().filter((ride) => isProfileUuid(ride.id) && this.canRespond(ride))
        : [];
      this.applyRides();
      this.homeLoaded = true;
    } catch {
      this.cloudAvailableRides = [];
      this.homeLoadError = 'Trip activity could not be refreshed. Try again shortly.';
      try {
        this.localRides.reloadFromStorage();
        this.applyRides();
        this.homeLoaded = true;
      } catch {
        this.homeLoaded = false;
      }
    } finally {
      this.fetching = false;
      this.changes.markForCheck();
    }
  }

  private actingDriver() {
    const driverId = this.sessionDriverId();
    if (!driverId) {
      return null;
    }
    return this.localRides.findDriver(driverId);
  }

  private canRefer(ride: LocalRide, driverId: string): boolean {
    if (!this.canRespond(ride)) {
      return false;
    }
    const ownerId = ride.driverId || ride.preferredDriverId;
    return ownerId === driverId;
  }

  private confirmReferral(ride: LocalRide): void {
    const selectedId = this.dialog?.selectedReferralId || '';
    const selected = this.dialog?.referralDrivers?.find((driver) => driver.id === selectedId);
    if (!selected) {
      this.showNotice('Choose one replacement driver.');
      return;
    }
    void this.alerts.create({
      header: 'Confirm referral',
      message: `Send a pending referral to ${selected.name}? This booking stays with you.`,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        { text: 'Refer', role: 'confirm' },
      ],
    }).then(async (alert) => {
      await alert.present();
      const { role } = await alert.onDidDismiss();
      if (role !== 'confirm') {
        return;
      }
      this.savePendingReferral(ride.id, selected.id);
    });
  }

  private async openCloudReferral(ride: LocalRide): Promise<void> {
    const driverId = this.ridesApi.cloudProfileId;
    const ownerId = ride.driverId || ride.preferredDriverId;
    if (!driverId || ownerId !== driverId || (ride.status !== 'Pending' && ride.status !== 'Scheduled')) {
      this.showNotice('This request is not waiting for you.');
      return;
    }
    if (ride.referralStatus === 'pending' || ride.referralStatus === 'accepted_by_replacement') {
      this.showNotice('This ride already has a pending referral.');
      return;
    }
    try {
      const drivers = (await this.ridesApi.listAvailableDrivers())
        .filter((driver) => driver.id !== driverId)
        .map((driver) => ({
          id: driver.id,
          name: driver.name,
          vehicleType: driver.vehicleType,
          plateNumber: driver.plateNumber,
          availability: 'Available',
          ratingText: driver.ratingCount
            ? `${driver.rating?.toFixed(1) ?? '0.0'} â˜… Â· ${driver.ratingCount} reviews`
            : 'Not yet rated',
        }));
      if (!drivers.length) {
        this.showNotice('No available drivers can take this ride right now.');
        return;
      }
      this.dialog = {
        kind: 'refer',
        title: 'Refer to another driver',
        confirmLabel: 'Continue',
        ride,
        referralDrivers: drivers,
        selectedReferralId: '',
      };
    } catch (error: unknown) {
      this.showNotice(error instanceof Error ? error.message : 'Available drivers could not be loaded.');
    }
  }

  private async acceptCloudRequest(ride: LocalRide): Promise<void> {
    try {
      const saved = await this.ridesApi.acceptBooking(ride.id);
      this.localRides.saveRide(saved);
      this.applyRides();
      this.showNotice('Booking confirmed. It is now on your active trips.', 'Accepted');
    } catch (error: unknown) {
      this.showNotice(error instanceof Error ? error.message : 'This booking can no longer be accepted.');
    }
  }

  private async declineCloudRequest(ride: LocalRide): Promise<void> {
    try {
      const saved = await this.ridesApi.declineBooking(ride.id);
      this.localRides.saveRide(saved);
      this.applyRides();
      this.showNotice('Request declined. It stays in trip history.', 'Declined');
    } catch (error: unknown) {
      this.showNotice(error instanceof Error ? error.message : 'This booking can no longer be declined.');
    }
  }

  private async referCloudRequest(rideId: string, proposedDriverId: string): Promise<void> {
    try {
      const saved = await this.ridesApi.referBooking(rideId, proposedDriverId);
      this.localRides.saveRide(saved);
      this.dialog = null;
      this.applyRides();
      this.showNotice(
        `Pending referral saved for ${saved.referralProposedDriverName || 'the replacement driver'}. The booking assignment is unchanged.`,
        'Referral pending',
      );
    } catch (error: unknown) {
      this.showNotice(error instanceof Error ? error.message : 'The referral could not be saved.');
    }
  }

  private async setCloudAvailability(status: 'available' | 'offline'): Promise<void> {
    if (this.cloudAvailability === status) {
      this.showNotice(`You are already ${this.availabilityName(status)}.`, 'Availability');
      return;
    }
    this.availabilityUpdating = true;
    this.availabilityError = '';
    try {
      if (this.auth.cloudAuthEnabled) {
        await this.auth.setCloudDriverAvailability(status);
      } else {
        await this.ridesApi.setOwnAvailability(status);
      }
      this.cloudAvailability = status;

      this.showNotice(`You are now ${this.availabilityName(status)}.`, 'Availability updated');
    } catch (error: unknown) {
      this.availabilityError = error instanceof Error ? error.message : 'Unable to update availability.';
      this.showNotice(this.availabilityError);
    } finally {
      this.availabilityUpdating = false;
      this.changes.markForCheck();
    }
  }

  private savePendingReferral(rideId: string, proposedDriverId: string): void {
    if (this.ridesApi.cloudBookings) {
      void this.referCloudRequest(rideId, proposedDriverId);
      return;
    }
    this.localRides.reloadFromStorage();
    const driverId = this.sessionDriverId();
    const current = this.localRides.getRideById(rideId);
    if (!current || !driverId || !this.canRefer(current, driverId)) {
      this.dialog = null;
      this.showNotice('This request is not waiting for you.');
      return;
    }
    if (current.referralStatus === 'pending') {
      this.dialog = null;
      this.showNotice('This ride already has a pending referral.');
      return;
    }
    const proposed = this.auth.listApprovedDrivers().find((driver) => driver.id === proposedDriverId);
    if (!proposed || !this.isReplacementEligible(proposed, current, driverId)) {
      this.showNotice('That driver is no longer available. Choose another driver.');
      if (this.dialog?.kind === 'refer') {
        this.dialog.referralDrivers = this.eligibleReplacementDrivers(current, driverId);
        this.dialog.selectedReferralId = '';
      }
      return;
    }
    const saved = this.localRides.updateRide(current.id, {
      referralStatus: 'pending',
      referralOriginalDriverId: driverId,
      referralProposedDriverId: proposed.id,
      referralProposedDriverName: proposed.fullName,
    });
    this.dialog = null;
    if (!saved) {
      this.showNotice('The referral could not be saved.');
      return;
    }
    this.notifications.referralReceived(proposed.id, saved);
    this.applyRides();
    this.showNotice(`Pending referral saved for ${proposed.fullName}. The booking assignment is unchanged.`, 'Referral pending');
  }

  private eligibleReplacementDrivers(ride: LocalRide, originalDriverId: string): ReferralDriverOption[] {
    return this.auth.listApprovedDrivers()
      .filter((driver) => this.isReplacementEligible(driver, ride, originalDriverId))
      .map((driver) => ({
        id: driver.id,
        name: driver.fullName,
        vehicleType: driver.vehicleType?.trim() || 'Not provided',
        plateNumber: driver.plateNumber?.trim() || 'Not provided',
        availability: 'Available',
        ratingText: this.referralRatingText(driver.id),
      }));
  }

  private isReplacementEligible(
    driver: LocalCareRideUser,
    ride: LocalRide,
    originalDriverId: string,
  ): boolean {
    if (driver.id === originalDriverId) {
      return false;
    }
    if (this.auth.accountStatusOf(driver) !== 'approved') {
      return false;
    }
    if (this.auth.readAvailability(driver) !== 'available') {
      return false;
    }
    if (ride.status !== 'Scheduled') {
      return true;
    }
    return !this.samePickupConflict(ride, driver.id);
  }

  private referralRatingText(driverId: string): string {
    return this.localRides.driverRatingSummary(driverId);
  }

  private samePickupConflict(ride: LocalRide, driverId: string): LocalRide | null {
    const pickup = this.pickupKey(ride);
    if (!pickup) {
      return null;
    }
    const reserving: LocalRideStatus[] = [
      'Driver Assigned',
      'Driver On The Way',
      'Arrived',
      'Picked Up',
      'In Progress',
    ];
    return this.localRides.getRides().find((other) =>
      other.id !== ride.id &&
      other.driverId === driverId &&
      reserving.includes(other.status) &&
      this.pickupKey(other) === pickup,
    ) ?? null;
  }

  private pickupKey(ride: LocalRide): string | null {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ride.date || '') || !/^\d{2}:\d{2}/.test(ride.time || '')) {
      return null;
    }
    return `${ride.date}T${ride.time.slice(0, 5)}`;
  }

  private confirmedOverlap(
    ride: LocalRide,
    driverId: string,
  ): { blocked: LocalRide | null; unchecked: boolean } {
    const start = this.pickupStart(ride);
    const confirmed = this.localRides.getRides().filter((other) =>
      other.id !== ride.id &&
      other.driverId === driverId &&
      [
        'Driver Assigned',
        'Driver On The Way',
        'Arrived',
        'Picked Up',
        'In Progress',
      ].includes(other.status),
    );
    if (start === null) {
      return { blocked: null, unchecked: true };
    }
    let unchecked = false;
    const windowMs = 90 * 60 * 1000;
    for (const other of confirmed) {
      const otherStart = this.pickupStart(other);
      if (otherStart === null) {
        unchecked = true;
        continue;
      }
      const overlaps = start < otherStart + windowMs && start + windowMs > otherStart;
      if (overlaps) {
        return { blocked: other, unchecked: false };
      }
    }
    return { blocked: null, unchecked };
  }

  private pickupStart(ride: LocalRide): number | null {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ride.date || '') || !/^\d{2}:\d{2}/.test(ride.time || '')) {
      return null;
    }
    const parsed = new Date(`${ride.date}T${ride.time.slice(0, 5)}`);
    return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
  }

  private sessionDriverId(): string | null {
    if (this.ridesApi.cloudBookings && this.ridesApi.cloudProfileId) {
      return this.ridesApi.cloudProfileId;
    }
    const account = this.auth.getLocalAccount();
    if (!account || account.accountType !== 'driver') {
      return null;
    }
    if (this.auth.accountStatusOf(account) !== 'approved') {
      return null;
    }
    return account.id;
  }

  private applyRides(): void {
    const sessionDriverId = this.sessionDriverId();
    this.me = this.localRides.findDriver(sessionDriverId) ?? this.localRides.localDemoDriver();
    this.requestRides = sessionDriverId
      ? this.ridesApi.cloudBookings
        ? this.cloudAvailableRides.filter((ride) => this.canRespond(ride))
        : this.localRides.getRides().filter((ride) => this.canRespond(ride))
      : [];
    const scheduleOwner = sessionDriverId;
    this.scheduleRides = this.localRides.getDriverScheduleRides(scheduleOwner ?? undefined).filter((ride) =>
      Boolean(scheduleOwner) && (
        ride.driverId === scheduleOwner ||
        (ride.status === 'Scheduled' && ride.preferredDriverId === scheduleOwner)
      ) && (!this.ridesApi.cloudBookings || isProfileUuid(ride.id)),
    );
    this.rides = this.localRides.getDriverQueueRides().filter((ride) =>
      Boolean(scheduleOwner) && ride.driverId === scheduleOwner
        && (!this.ridesApi.cloudBookings || isProfileUuid(ride.id)),
    );
    this.historyRides = this.localRides.getDriverHistoryRides().filter((ride) =>
      Boolean(scheduleOwner) && ride.driverId === scheduleOwner
        && (!this.ridesApi.cloudBookings || isProfileUuid(ride.id)),
    );
    this.clientReviews = sessionDriverId
      ? this.localRides.getDriverClientReviews(sessionDriverId).filter((ride) => ride.driverId === sessionDriverId)
      : [];
    this.stopSharingIfUnassigned();
  }

  private stopSharingIfUnassigned(): void {
    const rideId = this.driverGps.snapshot.rideId;
    if (!this.driverGps.trackingActive || !rideId) {
      return;
    }
    const ride = this.localRides.getRideById(rideId);
    if (!ride || !this.canShareLocation(ride)) {
      this.driverGps.stop();
    }
  }
}
