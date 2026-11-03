import { ChangeDetectorRef, Component, DestroyRef, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular';

import { AccountRole, normalizeAccountRole } from '../../core/models/care-ride.models';
import { LocalRide } from '../../core/models/local-ride.model';
import { LocalRideService, RideProgressStep } from '../../core/services/local-ride.service';
import { AuthService } from '../../core/services/auth.service';
import { RideService } from '../../core/services/ride.service';
import { DriverGpsFix, DriverGpsService, isDriverFixStale, poorAccuracyNote } from '../../core/services/driver-gps.service';
import { MapsService } from '../../core/services/maps.service';
import { LocationMapComponent } from '../../shared/location-map.component';

@Component({
  selector: 'app-ride-details',
  standalone: true,
  host: { class: 'ion-page' },
  imports: [CommonModule, FormsModule, RouterLink, IonIcon, LocationMapComponent],
  template: `
    <div class="details-page care-frame">
      <div class="details-shell care-shell">
        <div class="shell-scroll">
          <header class="app-topbar">
            <a [routerLink]="homePath" class="app-brand">Care<span>Ride</span></a>
            <a [routerLink]="homePath" class="profile-chip" aria-label="Back">
              <ion-icon name="arrow-back-outline"></ion-icon>
            </a>
          </header>

          <ng-container *ngIf="ride; else missing">
            <p class="eyebrow">RIDE {{ ride.id }}</p>
            <h1 class="page-title">Ride details</h1>
            <p class="page-subtitle">Full information for this transportation request.</p>

            <span class="status-pill">{{ ride.status }}</span>

            <section class="detail-card" *ngIf="isPassenger">
              <h2>Progress</h2>
              <div class="detail-row"><small>Booking ID</small><strong>{{ ride.id }}</strong></div>
              <div class="detail-row"><small>Ride type</small><strong>{{ rideTypeLabel }}</strong></div>
              <div class="detail-row"><small>Assigned driver</small><strong>{{ assignedDriverLabel }}</strong></div>
              <div class="detail-row"><small>Vehicle</small><strong>{{ vehicleText }}</strong></div>
              <div class="detail-row"><small>Plate</small><strong>{{ plateText }}</strong></div>
              <ol class="progress-timeline" aria-label="Booking progress">
                <li *ngFor="let step of progressSteps" [class.done]="step.state === 'done'" [class.current]="step.state === 'current'">
                  <span class="progress-mark" aria-hidden="true"></span>
                  <span>
                    <strong>{{ step.label }}</strong>
                    <small>{{ step.text }}</small>
                  </span>
                </li>
              </ol>
              <p class="page-subtitle" *ngIf="progressOutcome">{{ progressOutcome }}</p>
              <p class="page-subtitle" *ngIf="referralNotice">
                {{ referralNotice }}
                <a *ngIf="needsPassengerConfirm" routerLink="/dashboard">Review driver change</a>
              </p>
            </section>

            <section class="detail-card">
              <h2>Schedule</h2>
              <div class="detail-row"><small>Date</small><strong>{{ formatDate(ride.date) }}</strong></div>
              <div class="detail-row"><small>Time</small><strong>{{ formatTime(ride.time) }}</strong></div>
              <div class="detail-row"><small>Purpose</small><strong>{{ ride.purpose || 'Not specified' }}</strong></div>
            </section>

            <section class="detail-card">
              <h2>Passenger</h2>
              <div class="detail-row"><small>Name</small><strong>{{ ride.passengerName || 'Passenger' }}</strong></div>
              <div class="detail-row">
                <small>Booking</small>
                <strong>{{ ride.passengerType === 'family' ? 'Booked by a family member' : 'Self booking' }}</strong>
              </div>
              <div class="detail-row" *ngIf="ride.notes">
                <small>Passenger notes</small>
                <strong>{{ ride.notes }}</strong>
              </div>
            </section>

            <section class="detail-card" *ngIf="!hasAssignedDriver && ride.preferredDriverName">
              <h2>Preferred driver</h2>
              <div class="detail-row"><small>Driver</small><strong>{{ ride.preferredDriverName }}</strong></div>
              <div class="detail-row" *ngIf="ride.preferredVehicleLabel"><small>Vehicle</small><strong>{{ ride.preferredVehicleLabel }}</strong></div>
              <div class="detail-row" *ngIf="ride.preferredDriverRating">
                <small>Rating</small>
                <strong>{{ ride.preferredDriverRating | number:'1.1-1' }} ★</strong>
              </div>
              <p class="page-subtitle">Waiting for the driver to accept this request.</p>
            </section>

            <section class="detail-card" *ngIf="hasAssignedDriver">
              <h2>Assigned driver</h2>
              <div class="detail-row"><small>Driver</small><strong>{{ assignedDriverLabel }}</strong></div>
              <div class="detail-row" *ngIf="ride.vehicleLabel"><small>Vehicle</small><strong>{{ ride.vehicleLabel }}</strong></div>
              <div class="detail-row" *ngIf="ride.driverPhone"><small>Driver phone</small><strong>{{ ride.driverPhone }}</strong></div>
              <div class="detail-row">
                <small>Driver location</small>
                <strong>{{ driverLocationTitle }} · {{ driverLocationDetail }}</strong>
              </div>
              <div class="driver-map" *ngIf="driverMapUrl">
                <iframe
                  [src]="driverMapUrl"
                  title="Driver location map"
                  loading="lazy"
                  referrerpolicy="no-referrer-when-downgrade"
                ></iframe>
              </div>
              <p class="page-subtitle">This map shows the trip pickup and destination. It is not a live driver position.</p>
              <button type="button" class="text-action" (click)="openDriverMap()">Open driver map</button>
            </section>

            <section class="detail-card" *ngIf="hasAssignedDriver && canSeeDriverGps">
              <h2>Live driver location</h2>
              <ng-container *ngIf="liveDriverFix as fix; else waitingForDriver">
                <app-location-map
                  [pickup]="ridePoint(ride.pickupLatitude, ride.pickupLongitude)"
                  [destination]="ridePoint(ride.destinationLatitude, ride.destinationLongitude)"
                  [driver]="{ latitude: fix.latitude, longitude: fix.longitude }"
                  [driverAccuracyMeters]="fix.accuracyMeters"
                ></app-location-map>
                <p class="page-subtitle">
                  Last update {{ formatRatedAt(fix.capturedAt) }}.
                  <span *ngIf="fix.accuracyMeters !== null"> GPS ±{{ fix.accuracyMeters | number:'1.0-0' }} m.</span>
                </p>
                <p class="page-subtitle" *ngIf="driverFixStale">This location update is stale. It is not a new position.</p>
                <p class="page-subtitle" *ngIf="poorAccuracy(fix)">{{ poorAccuracy(fix) }}</p>
                <p class="page-subtitle" *ngIf="driverFixOffline">The sharing device is offline.</p>
              </ng-container>
              <ng-template #waitingForDriver>
                <p class="page-subtitle">Waiting for driver location</p>
              </ng-template>
            </section>

            <section class="detail-card">
              <h2>Route</h2>
              <div class="detail-row"><small>Pickup</small><strong>{{ pickupPlaceLabel || ride.pickupLocation }}</strong></div>
              <div class="detail-row"><small>Destination</small><strong>{{ destinationPlaceLabel || ride.destination }}</strong></div>
              <button type="button" class="text-action" (click)="openPickupMap()">Open pickup map</button>
              <button type="button" class="text-action" (click)="openDestinationMap()">Open destination map</button>
            </section>

            <section class="detail-card">
              <h2>Assistance</h2>
              <div class="detail-row"><small>Needs</small><strong>{{ assistanceText }}</strong></div>
              <div class="detail-row" *ngIf="ride.otherAssistanceNotes">
                <small>Other assistance notes</small>
                <strong>{{ ride.otherAssistanceNotes }}</strong>
              </div>
            </section>

            <section class="detail-card">
              <h2>Emergency contact</h2>
              <div class="detail-row"><small>Name</small><strong>{{ ride.emergencyContactName || 'Not provided' }}</strong></div>
              <div class="detail-row"><small>Phone</small><strong>{{ ride.emergencyContactNumber || 'No number provided' }}</strong></div>
              <button
                type="button"
                class="text-action"
                *ngIf="ride.emergencyContactNumber"
                (click)="callEmergency()"
              >
                Call emergency contact
              </button>
            </section>

            <section class="detail-card" *ngIf="ride.status === 'Completed' && isPassenger">
              <h2>Rate your driver</h2>
              <div class="detail-row"><small>Driver</small><strong>{{ assignedDriverLabel }}</strong></div>
              <div class="detail-row"><small>Vehicle</small><strong>{{ vehicleText }}</strong></div>
              <div class="detail-row"><small>Plate</small><strong>{{ plateText }}</strong></div>
              <ng-container *ngIf="ride.clientRating; else rateForm">
                <p class="page-subtitle" *ngIf="ratingThanks">Thank you. Your rating was saved.</p>
                <div class="detail-row"><small>Your rating</small><strong>{{ ride.clientRating }} of 5 stars</strong></div>
                <div class="detail-row" *ngIf="ride.clientComment">
                  <small>Feedback</small>
                  <strong>{{ ride.clientComment }}</strong>
                </div>
                <div class="detail-row" *ngIf="ride.ratedAt">
                  <small>Submitted</small>
                  <strong>{{ formatRatedAt(ride.ratedAt) }}</strong>
                </div>
              </ng-container>
              <ng-template #rateForm>
                <ng-container *ngIf="ride.driverId; else noDriver">
                  <p class="page-subtitle">Choose 1 to 5 stars. Written feedback is optional.</p>
                  <div class="star-row" role="group" aria-label="Star rating">
                    <button
                      type="button"
                      *ngFor="let star of [1,2,3,4,5]"
                      class="star-button"
                      [class.on]="pendingStars >= star"
                      [attr.aria-pressed]="pendingStars >= star"
                      [attr.aria-label]="star + (star === 1 ? ' star' : ' stars')"
                      (click)="pendingStars = star; ratingError = ''"
                    >
                      ★
                    </button>
                  </div>
                  <p class="page-subtitle">{{ pendingStars ? pendingStars + ' of 5 stars selected' : 'No stars selected yet' }}</p>
                  <label class="comment-field">
                    <span>Feedback, optional</span>
                    <textarea
                      rows="3"
                      [(ngModel)]="pendingComment"
                      name="pendingComment"
                      placeholder="Tell us how the trip went."
                    ></textarea>
                  </label>
                  <p class="page-subtitle" *ngIf="ratingError" role="alert">{{ ratingError }}</p>
                  <button type="button" class="primary-button" [disabled]="ratingBusy" (click)="submitRating()">
                    Submit Rating
                  </button>
                </ng-container>
                <ng-template #noDriver>
                  <p class="page-subtitle">This completed trip has no assigned driver, so it cannot be rated.</p>
                </ng-template>
              </ng-template>
            </section>

            <button
              type="button"
              class="primary-button"
              (click)="goHome()"
            >
              {{ backLabel }}
            </button>
          </ng-container>

          <ng-template #missing>
            <h1 class="page-title">{{ hiddenFromPassenger ? 'Booking unavailable' : 'Ride not found' }}</h1>
            <p class="page-subtitle">
              {{ hiddenFromPassenger
                ? 'This booking is not on your account.'
                : 'This ride is not in CareRide records on this device.' }}
            </p>
            <button type="button" class="primary-button" (click)="goHome()">{{ backLabel }}</button>
          </ng-template>
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host { display:block; width:100%; height:100%; }
    .details-page { background:#9BA8AB; color:#06141B; }
    .details-shell { background:#CCD0CF; }
    .eyebrow { margin:0 0 8px; color:#11212D; font-size:12px; font-weight:800; letter-spacing:.08em; }
    .page-subtitle { margin:8px 0 16px; color:#4A5C6A; font-size:14px; line-height:1.5; }
    .status-pill { display:inline-block; background:#11212D; color:#CCD0CF; border-radius:999px; padding:6px 10px; font-size:12px; font-weight:800; margin-bottom:14px; }
    .detail-card { margin-bottom:12px; padding:16px; border-radius:18px; background:#fff; }
    .detail-card h2 { margin:0 0 8px; font-size:16px; font-weight:800; color:#06141B; }
    .detail-row { padding:12px 0; border-top:1px solid #CCD0CF; }
    .detail-row:first-of-type { border-top:0; }
    .detail-row small { display:block; font-size:11px; letter-spacing:.08em; text-transform:uppercase; color:#4A5C6A; font-weight:800; margin-bottom:4px; }
    .detail-row strong { font-size:16px; font-weight:650; line-height:1.4; }
    .text-action { display:block; width:100%; margin-top:8px; padding:12px 0 0; border:0; background:transparent; color:#11212D; font:inherit; font-size:14px; font-weight:800; text-align:left; cursor:pointer; }
    .primary-button { width:100%; min-height:48px; margin:12px 0 24px; border:0; border-radius:12px; background:#11212D; color:#CCD0CF; font:inherit; font-size:14px; font-weight:800; cursor:pointer; }
    .star-row { display:flex; gap:8px; margin:8px 0 12px; }
    .star-row { flex-wrap:wrap; }
    .star-button { width:56px; height:56px; border:0; border-radius:12px; background:#CCD0CF; color:#9BA8AB; font-size:28px; cursor:pointer; }
    .star-button:disabled, .primary-button:disabled { opacity:.55; cursor:not-allowed; }
    .star-button.on { background:#11212D; color:#CCD0CF; }
    .comment-field { display:grid; gap:6px; margin-bottom:8px; }
    .comment-field span { font-size:16px; font-weight:800; color:#06141B; }
    .comment-field em { font-style:normal; color:#8B2942; }
    .comment-field textarea { width:100%; padding:12px; border:0; border-radius:14px; background:#CCD0CF; font:inherit; }
    .driver-map { margin:12px 0 4px; overflow:hidden; border-radius:16px; background:#CCD0CF; }
    .driver-map iframe { display:block; width:100%; height:220px; border:0; }
    .progress-timeline { list-style:none; margin:12px 0 0; padding:0; }
    .progress-timeline li { display:grid; grid-template-columns:18px 1fr; gap:10px; padding-bottom:12px; }
    .progress-timeline li:last-child { padding-bottom:0; }
    .progress-mark { width:14px; height:14px; margin-top:4px; border:2px solid #9BA8AB; border-radius:50%; background:#fff; }
    .progress-timeline .done .progress-mark { border-color:#11212D; background:#11212D; }
    .progress-timeline .current .progress-mark { border-color:#11212D; background:#CCD0CF; box-shadow:0 0 0 3px #11212D; }
    .progress-timeline strong, .progress-timeline small { display:block; }
    .progress-timeline strong { font-size:16px; }
    .progress-timeline small { color:#253745; font-size:15px; }
  `],
})
export class RideDetailsPage implements OnInit {
  ride: LocalRide | null = null;
  role: AccountRole | null = null;
  hiddenFromPassenger = false;
  pendingStars = 0;
  pendingComment = '';
  ratingError = '';
  ratingThanks = false;
  ratingBusy = false;
  driverMapUrl: SafeResourceUrl | null = null;
  pickupPlaceLabel = '';
  destinationPlaceLabel = '';
  private placeLabelToken = 0;
  private readonly destroyRef = inject(DestroyRef);

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private localRides: LocalRideService,
    private ridesApi: RideService,
    private auth: AuthService,
    private changes: ChangeDetectorRef,
    private sanitizer: DomSanitizer,
    private driverGps: DriverGpsService,
    private maps: MapsService,
  ) {}

  ngOnInit(): void {
    this.route.paramMap.subscribe(() => this.showRide());
    this.localRides.rides$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        const id = this.readRideId();
        this.applyRide(this.localRides.getRideById(id));
      });
    this.driverGps.changes$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.changes.markForCheck());
  }

  ionViewWillEnter(): void {
    this.showRide();
  }

  get homePath(): string {
    if (this.role === 'driver') {
      return '/driver';
    }
    if (this.role === 'admin') {
      return '/admin';
    }
    return '/scheduled-rides';
  }

  get backLabel(): string {
    if (this.role === 'driver') {
      return 'Back to driver dashboard';
    }
    if (this.role === 'admin') {
      return 'Back to operations';
    }
    return 'Back to scheduled rides';
  }

  get isPassenger(): boolean {
    const account = this.auth.getLocalAccount();
    return Boolean(account && normalizeAccountRole(account.accountType) === 'passenger');
  }

  get progressSteps(): RideProgressStep[] {
    return this.ride ? this.localRides.rideProgress(this.ride).steps : [];
  }

  get progressOutcome(): string | null {
    if (!this.ride) {
      return null;
    }
    const terminal = this.localRides.rideProgress(this.ride).terminal;
    if (!terminal) {
      return null;
    }
    return terminal === 'Declined'
      ? 'This booking was declined. It was not completed.'
      : terminal === 'Reported'
        ? 'This booking was reported. It was not completed.'
        : 'This booking was cancelled. It was not completed.';
  }

  get rideTypeLabel(): string {
    return this.ride ? this.localRides.rideTimingLabel(this.ride) : '';
  }

  get assignedDriverLabel(): string {
    return this.ride ? this.localRides.assignedDriverLabel(this.ride) : 'Not assigned';
  }

  get vehicleText(): string {
    return this.ride ? this.localRides.assignedVehicleLabel(this.ride) : 'Not provided';
  }

  get plateText(): string {
    return this.ride ? this.localRides.assignedPlateLabel(this.ride) : 'Not provided';
  }

  get referralNotice(): string | null {
    if (!this.ride) {
      return null;
    }
    if (this.ride.referralStatus === 'pending') {
      const name = this.ride.referralProposedDriverName?.trim() || 'the replacement driver';
      return `Driver change pending. Waiting for ${name} to respond.`;
    }
    if (this.ride.referralStatus === 'accepted_by_replacement') {
      const name = this.ride.referralProposedDriverName?.trim() || 'The replacement driver';
      return `${name} accepted the driver change. Review it on Home before the assigned driver changes.`;
    }
    return null;
  }

  get needsPassengerConfirm(): boolean {
    return this.ride?.referralStatus === 'accepted_by_replacement';
  }

  get assistanceText(): string {
    if (!this.ride) {
      return '';
    }
    return this.ride.assistance?.length ? this.ride.assistance.join(', ') : 'None selected';
  }

  get hasAssignedDriver(): boolean {
    return this.ride ? this.localRides.hasAssignedDriver(this.ride) : false;
  }

  get driverLocationTitle(): string {
    return this.ride ? this.localRides.driverLocationTitle(this.ride) : '';
  }

  get driverLocationDetail(): string {
    return this.ride ? this.localRides.driverLocationDetail(this.ride) : '';
  }

  get canSeeDriverGps(): boolean {
    return this.isPassenger || this.role === 'driver';
  }

  get liveDriverFix(): DriverGpsFix | null {
    return this.ride && this.canSeeDriverGps ? this.driverGps.fixForRide(this.ride.id) : null;
  }

  get driverFixStale(): boolean {
    const fix = this.liveDriverFix;
    return Boolean(fix && isDriverFixStale(fix.capturedAt));
  }

  get driverFixOffline(): boolean {
    return this.driverGps.snapshot.offline && Boolean(this.liveDriverFix);
  }

  poorAccuracy(fix: DriverGpsFix): string | null {
    return poorAccuracyNote(fix.accuracyMeters);
  }

  ridePoint(latitude: number | null, longitude: number | null): { latitude: number; longitude: number } | null {
    if (latitude === null || longitude === null) {
      return null;
    }
    return { latitude, longitude };
  }

  formatDate(date: string): string {
    return this.localRides.formatDate(date);
  }

  formatTime(time: string): string {
    return this.localRides.formatTime(time);
  }

  goHome(): void {
    void this.router.navigateByUrl(this.homePath);
  }

  openDriverMap(): void {
    if (!this.ride) {
      return;
    }
    window.open(this.localRides.driverMapsUrl(this.ride), '_blank', 'noopener');
  }

  openPickupMap(): void {
    if (!this.ride) {
      return;
    }
    const query = this.coordsQuery(this.ride.pickupLatitude, this.ride.pickupLongitude, this.ride.pickupLocation);
    window.open(query, '_blank', 'noopener');
  }

  openDestinationMap(): void {
    if (!this.ride) {
      return;
    }
    const query = this.coordsQuery(
      this.ride.destinationLatitude,
      this.ride.destinationLongitude,
      this.ride.destination,
    );
    window.open(query, '_blank', 'noopener');
  }

  callEmergency(): void {
    const phone = this.ride?.emergencyContactNumber?.trim();
    if (!phone) {
      return;
    }
    window.location.href = `tel:${phone}`;
  }

  formatRatedAt(value: string): string {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return value;
    }
    return parsed.toLocaleString(undefined, {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  submitRating(): void {
    if (this.ratingBusy || !this.ride || !this.isPassenger) {
      return;
    }
    const account = this.auth.getLocalAccount();
    if (!account || this.ride.passengerName.trim().toLowerCase() !== account.fullName.trim().toLowerCase()) {
      this.ratingError = 'You can rate only your own completed trip.';
      return;
    }
    if (this.ride.status !== 'Completed' || !this.ride.driverId) {
      this.ratingError = 'Only a completed trip with an assigned driver can be rated.';
      return;
    }
    if (this.ride.clientRating) {
      this.ratingError = 'This trip has already been rated.';
      return;
    }
    if (!Number.isInteger(this.pendingStars) || this.pendingStars < 1 || this.pendingStars > 5) {
      this.ratingError = 'Choose a star rating from 1 to 5.';
      return;
    }
    if (this.ridesApi.cloudBookings) {
      void this.rateCloudRide();
      return;
    }
    this.ratingBusy = true;
    const updated = this.localRides.rateCompletedRide(
      this.ride.id,
      this.pendingStars,
      this.pendingComment,
      { id: account.id, fullName: account.fullName },
    );
    this.ratingBusy = false;
    if (!updated) {
      this.ratingError = 'This trip cannot be rated, or it was already rated.';
      this.applyRide(this.localRides.getRideById(this.ride.id));
      return;
    }
    this.ratingError = '';
    this.ratingThanks = true;
    this.ride = updated;
    this.changes.detectChanges();
  }

  private async rateCloudRide(): Promise<void> {
    if (!this.ride) {
      return;
    }
    this.ratingBusy = true;
    try {
      const updated = await this.ridesApi.rateBooking(this.ride.id, this.pendingStars, this.pendingComment);
      this.ratingError = '';
      this.ratingThanks = true;
      this.ride = updated;
    } catch (error: unknown) {
      this.ratingError = error instanceof Error
        ? error.message
        : 'This trip cannot be rated, or it was already rated.';
    } finally {
      this.ratingBusy = false;
      this.changes.detectChanges();
    }
  }

  private coordsQuery(latitude: number | null, longitude: number | null, fallback: string): string {
    if (latitude !== null && longitude !== null) {
      return `https://www.google.com/maps?q=${latitude},${longitude}`;
    }
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fallback)}`;
  }

  private showRide(): void {
    const id = this.readRideId();
    this.localRides.reloadFromStorage();
    const fromState = this.rideFromHistory();
    this.applyRide(
      this.localRides.getRideById(id) ??
      (fromState && (!id || fromState.id === id) ? fromState : null),
    );

    void this.auth.getCurrentRole().then((role) => {
      this.role = role;
      this.changes.markForCheck();
    });

    if (!id) {
      return;
    }
    void this.ridesApi
      .getLocalRide(id)
      .then((ride) => {
        if (ride) {
          this.applyRide(ride);
        }
      })
      .catch(() => {
        if (!this.ride) {
          this.applyRide(this.localRides.getRideById(id));
        }
      });
  }

  private applyRide(ride: LocalRide | null): void {
    const account = this.auth.getLocalAccount();
    const role = account ? normalizeAccountRole(account.accountType) : null;
    const passengerBlocked = Boolean(
      ride &&
      role === 'passenger' &&
      ride.passengerName.trim().toLowerCase() !== account!.fullName.trim().toLowerCase(),
    );
    const driverBlocked = Boolean(
      ride &&
      role === 'driver' &&
      ride.driverId !== account!.id &&
      ride.preferredDriverId !== account!.id &&
      ride.referralOriginalDriverId !== account!.id &&
      ride.referralProposedDriverId !== account!.id,
    );
    if (passengerBlocked || driverBlocked) {
      this.ride = null;
      this.hiddenFromPassenger = true;
      this.driverMapUrl = null;
      this.changes.detectChanges();
      return;
    }
    this.hiddenFromPassenger = false;
    this.ride = ride;
    this.bindDriverMap();
    if (ride) {
      this.restorePlaceLabels(ride);
    } else {
      this.pickupPlaceLabel = '';
      this.destinationPlaceLabel = '';
    }
    this.changes.detectChanges();
  }

  private restorePlaceLabels(ride: LocalRide): void {
    const token = ++this.placeLabelToken;
    void this.maps.readableBookingLabel(ride.pickupLocation, ride.pickupLatitude, ride.pickupLongitude)
      .then((label) => {
        if (token === this.placeLabelToken) {
          this.pickupPlaceLabel = label;
          this.changes.markForCheck();
        }
      });
    void this.maps.readableBookingLabel(ride.destination, ride.destinationLatitude, ride.destinationLongitude)
      .then((label) => {
        if (token === this.placeLabelToken) {
          this.destinationPlaceLabel = label;
          this.changes.markForCheck();
        }
      });
  }

  private bindDriverMap(): void {
    if (!this.ride || !this.localRides.hasAssignedDriver(this.ride)) {
      this.driverMapUrl = null;
      return;
    }
    this.driverMapUrl = this.sanitizer.bypassSecurityTrustResourceUrl(
      this.localRides.driverMapEmbedUrl(this.ride),
    );
  }

  private readRideId(): string {
    const param =
      this.route.snapshot.paramMap.get('id') ??
      this.route.snapshot.params['id'] ??
      this.route.parent?.snapshot.paramMap.get('id') ??
      '';
    if (param) {
      return decodeURIComponent(param);
    }
    const match = /\/ride-details\/([^/?#]+)/.exec(this.router.url);
    return match ? decodeURIComponent(match[1]) : '';
  }

  private rideFromHistory(): LocalRide | null {
    const state = (typeof history === 'undefined' ? null : history.state) as { ride?: LocalRide } | null;
    return state?.ride?.id ? state.ride : null;
  }
}
