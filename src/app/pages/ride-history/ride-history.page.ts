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
  private readonly destroyRef = inject(DestroyRef);


  constructor(
    private localRides: LocalRideService,
    private ridesApi: RideService,
    private auth: AuthService,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.localRides.rides$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.loadRides());
  }


  // =========================
  // LOAD HISTORY
  // =========================

  ionViewWillEnter(): void {

    this.refresh();

  }


  // =========================
  // REFRESH HISTORY
  // =========================

  refresh(): void {
    this.localRides.reloadFromStorage();
    void this.ridesApi.hydrateFromCloud().catch(() => undefined);
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
    const account = this.auth.getLocalAccount();
    if (!account || account.accountType !== 'passenger') {
      this.rides = [];
      return;
    }
    const name = account.fullName.trim().toLowerCase();
    this.rides = this.localRides.getHistoryRides().filter(
      (ride) => ride.passengerName.trim().toLowerCase() === name,
    );
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

  viewDetails(
    ride: LocalRide
  ): void {

    if (!ride || !ride.id) {

      alert(
        'Unable to open this ride.'
      );

      return;

    }

    this.router.navigate(['/ride-details', ride.id], { state: { ride } });

  }


  // =========================
  // REQUEST RIDE
  // =========================

  requestRide(): void {

    this.router.navigate([
      '/request-ride'
    ]);

  }


  // =========================
  // REQUEST AGAIN
  // =========================

  requestAgain(
    ride: LocalRide
  ): void {

    if (!ride) {

      this.requestRide();

      return;

    }


    const confirmed = confirm(

      'Request another ride?\n\n' +

      'Previous pickup:\n' +
      ride.pickupLocation +

      '\n\nPrevious destination:\n' +
      ride.destination +

      '\n\nYou can enter or update the trip details on the next page.'

    );


    if (!confirmed) {
      return;
    }


    this.router.navigate([
      '/request-ride'
    ]);

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

}