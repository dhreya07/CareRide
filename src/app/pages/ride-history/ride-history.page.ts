import { Component, DestroyRef, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular';

import { AppNavigationComponent } from '../../shared/app-navigation.component';
import { LocalRide } from '../../core/models/local-ride.model';
import { AuthService } from '../../core/services/auth.service';
import { LocalRideService, RideProgressStep } from '../../core/services/local-ride.service';
import { RideService } from '../../core/services/ride.service';
import { DropoffProofService } from '../../core/services/dropoff-proof.service';
import { isProfileUuid } from '../../core/models/profile-id';

type HistoryFilter = 'all' | 'accepted' | 'completed' | 'not-completed';

@Component({
  selector: 'app-ride-history',
  standalone: true,
  host: { class: 'ion-page' },

  templateUrl: './ride-history.page.html',
  styleUrls: ['./ride-history.page.scss'],

  imports: [
    CommonModule,
    RouterLink,
    IonIcon,
    AppNavigationComponent
  ]
})
export class RideHistoryPage implements OnInit {

  rides: LocalRide[] = [];
  selectedFilter: HistoryFilter = 'all';
  readonly dropoffProofUrls = new Map<string, string>();
  proofLoadError = '';
  historyLoadError = '';
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private refreshInFlight = false;
  private readonly destroyRef = inject(DestroyRef);


  constructor(
    private localRides: LocalRideService,
    private ridesApi: RideService,
    private auth: AuthService,
    private router: Router,
    private dropoffProofs: DropoffProofService,
  ) {}

  ngOnInit(): void {
    this.localRides.rides$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.loadRides());
    this.destroyRef.onDestroy(() => this.stopAutoRefresh());
  }


  // =========================
  // LOAD HISTORY
  // =========================

  ionViewWillEnter(): void {
    this.refresh();
    this.startAutoRefresh();
  }

  ionViewDidLeave(): void {
    this.stopAutoRefresh();
  }


  // =========================
  // REFRESH HISTORY
  // =========================

  refresh(): void {
    if (this.refreshInFlight) {
      return;
    }
    this.localRides.reloadFromStorage();
    if (!this.ridesApi.cloudBookings) {
      return;
    }
    this.refreshInFlight = true;
    void this.ridesApi.hydrateFromCloud()
      .then(() => {
        this.historyLoadError = '';
        this.loadRides();
        return this.loadDropoffProofs();
      })
      .catch(() => {
        // Do not replace a real empty history with a silent failure. Existing
        // cached cloud rides remain visible while the next automatic refresh retries.
        this.historyLoadError = 'Ride history could not be refreshed right now. Please check your connection and try again.';
      })
      .finally(() => { this.refreshInFlight = false; });
  }

  private startAutoRefresh(): void {
    this.stopAutoRefresh();
    if (!this.ridesApi.cloudBookings) {
      return;
    }
    this.refreshTimer = setInterval(() => this.refresh(), 5_000);
  }

  private stopAutoRefresh(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  progressSteps(ride: LocalRide): RideProgressStep[] {
    return this.localRides.rideProgress(ride).steps;
  }

  progressOutcome(ride: LocalRide): string | null {
    const terminal = this.localRides.rideProgress(ride).terminal;
    if (!terminal) {
      return null;
    }
    return terminal === 'Declined'
      ? 'This booking was declined. It was not completed.'
      : terminal === 'Reported'
        ? 'This booking was reported. It was not completed.'
        : 'This booking was cancelled. It was not completed.';
  }

  rideTypeLabel(ride: LocalRide): string {
    return this.localRides.rideTimingLabel(ride);
  }

  assignedDriver(ride: LocalRide): string {
    return this.localRides.assignedDriverLabel(ride);
  }

  vehicleText(ride: LocalRide): string {
    return this.localRides.assignedVehicleLabel(ride);
  }

  plateText(ride: LocalRide): string {
    return this.localRides.assignedPlateLabel(ride);
  }

  private loadRides(): void {
    const allRides = this.localRides.getRides();
    if (this.ridesApi.cloudBookings) {
      // Cloud authentication does not create a local careride_users entry.
      // The authenticated query is already limited by booking RLS, so filtering
      // UUID rows keeps preserved device-only rides out without hiding cloud rides.
      this.rides = allRides.filter((ride) => isProfileUuid(ride.id));
    } else {
      const account = this.auth.getLocalAccount();
      if (!account || account.accountType !== 'passenger') {
        this.rides = [];
        return;
      }
      const name = account.fullName.trim().toLowerCase();
      this.rides = allRides.filter((ride) => ride.passengerName.trim().toLowerCase() === name);
    }
    this.rides.sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
    void this.loadDropoffProofs();
  }

  proofUrl(ride: LocalRide): string | null {
    return this.dropoffProofUrls.get(ride.id) ?? null;
  }

  private async loadDropoffProofs(): Promise<void> {
    if (!this.ridesApi.cloudBookings) {
      this.dropoffProofUrls.clear();
      return;
    }
    try {
      const proofs = await this.dropoffProofs.listForCurrentPassenger();
      const historyIds = new Set(this.rides.filter((ride) => ride.status === 'Completed').map((ride) => ride.id));
      const urls = await Promise.all(proofs
        .filter((proof) => historyIds.has(proof.bookingId))
        .map(async (proof) => ({ bookingId: proof.bookingId, url: await this.dropoffProofs.createViewUrl(proof) })));
      this.dropoffProofUrls.clear();
      for (const item of urls) {
        if (item.url) this.dropoffProofUrls.set(item.bookingId, item.url);
      }
      this.proofLoadError = '';
    } catch {
      this.proofLoadError = 'A safe-arrival photo could not be loaded right now.';
    }
  }


  // =========================
  // DATE
  // =========================

  formatDate(
    ride: LocalRide
  ): string {

    return this.localRides.formatDate(
      ride.date
    );

  }


  // =========================
  // TIME
  // =========================

  formatTime(
    ride: LocalRide
  ): string {

    return this.localRides.formatTime(
      ride.time
    );

  }


  // =========================
  // VIEW DETAILS
  // =========================

  needsRating(ride: LocalRide): boolean {
    return ride.status === 'Completed' && !ride.clientRating && Boolean(ride.driverId);
  }

  ratingStarCount(rating: number | null | undefined): number {
    return Math.max(0, Math.min(5, Math.round(rating ?? 0)));
  }

  viewDetails(
    ride: LocalRide
  ): void {

    if (!ride || !ride.id) {

      alert(
        'Unable to open this ride.'
      );

      return;

    }

    this.router.navigate(['/ride-details', ride.id], {
      queryParams: { from: 'history', ...(this.needsRating(ride) ? { focus: 'rating' } : {}) },
      state: { ride },
    });

  }

  // =========================
  // NUMBER OF HISTORY RIDES
  // =========================

  get rideCount(): number {

    return this.rides.length;

  }

  statusTone(ride: LocalRide): string {
    return this.localRides.statusTone(ride.status);
  }

  get acceptedCount(): number {
    return this.rides.filter((ride) => this.isAccepted(ride)).length;
  }

  get completedCount(): number {
    return this.rides.filter((ride) => ride.status === 'Completed').length;
  }

  get notCompletedCount(): number {
    return this.rides.filter((ride) => ['Rejected', 'Cancelled'].includes(ride.status)).length;
  }

  get displayedRides(): LocalRide[] {
    return this.rides.filter((ride) => {
      switch (this.selectedFilter) {
        case 'accepted': return this.isAccepted(ride);
        case 'completed': return ride.status === 'Completed';
        case 'not-completed': return ['Rejected', 'Cancelled'].includes(ride.status);
        default: return true;
      }
    });
  }

  selectFilter(filter: HistoryFilter): void {
    this.selectedFilter = filter;
  }

  filterLabel(): string {
    const labels: Record<HistoryFilter, string> = {
      all: 'booking activity',
      accepted: 'accepted rides',
      completed: 'completed rides',
      'not-completed': 'cancelled or declined rides',
    };
    return labels[this.selectedFilter];
  }

  statusLabel(ride: LocalRide): string {
    if (ride.status === 'Rejected') return 'Declined';
    if (this.isAccepted(ride)) return ride.status === 'In Progress' ? 'In progress' : 'Accepted';
    return ride.status;
  }

  private isAccepted(ride: LocalRide): boolean {
    return ['Driver Assigned', 'Driver On The Way', 'Arrived', 'Picked Up', 'In Progress'].includes(ride.status);
  }

}
