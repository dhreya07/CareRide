import { Component, DestroyRef, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { AlertController, IonIcon } from '@ionic/angular';
import { AppNavigationComponent } from '../../shared/app-navigation.component';
import { LocalRide } from '../../core/models/local-ride.model';
import { AuthService } from '../../core/services/auth.service';
import { LocalRideService, RideProgressStep } from '../../core/services/local-ride.service';
import { RideService } from '../../core/services/ride.service';

@Component({
  selector: 'app-scheduled-rides',
  standalone: true,
  host: { class: 'ion-page' },
  imports: [CommonModule, RouterLink, IonIcon, AppNavigationComponent],
  templateUrl: './scheduled-rides.page.html',
  styleUrls: ['./scheduled-rides.page.scss'],
})
export class ScheduledRidesPage implements OnInit {
  rides: LocalRide[] = [];
  private readonly destroyRef = inject(DestroyRef);

  constructor(
    private localRides: LocalRideService,
    private ridesApi: RideService,
    private auth: AuthService,
    private router: Router,
    private alerts: AlertController,
  ) {}

  ngOnInit(): void {
    this.localRides.rides$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.loadRides());
  }

  ionViewWillEnter(): void {
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

  referralNotice(ride: LocalRide): string | null {
    if (ride.referralStatus === 'pending') {
      const name = ride.referralProposedDriverName?.trim() || 'the replacement driver';
      return `Driver change pending. Waiting for ${name} to respond.`;
    }
    if (ride.referralStatus === 'accepted_by_replacement') {
      const name = ride.referralProposedDriverName?.trim() || 'The replacement driver';
      return `${name} accepted the driver change. Review it on Home before the assigned driver changes.`;
    }
    return null;
  }

  needsPassengerConfirm(ride: LocalRide): boolean {
    return ride.referralStatus === 'accepted_by_replacement';
  }

  assistanceText(ride: LocalRide): string {
    return ride.assistance.length ? ride.assistance.join(', ') : 'None selected';
  }

  assistanceSummary(ride: LocalRide): string {
    return this.assistanceText(ride);
  }

  cancellingId: string | null = null;

  canCancel(ride: LocalRide): boolean {
    return this.ownsRide(ride) && this.localRides.canCancel(ride);
  }

  statusTone(ride: LocalRide): string {
    return this.localRides.statusTone(ride.status);
  }

  hasAssignedDriver(ride: LocalRide): boolean {
    return this.localRides.hasAssignedDriver(ride);
  }

  driverLocationTitle(ride: LocalRide): string {
    return this.localRides.driverLocationTitle(ride);
  }

  driverLocationDetail(ride: LocalRide): string {
    return this.localRides.driverLocationDetail(ride);
  }

  formatDate(ride: LocalRide): string {
    return this.localRides.formatDate(ride.date);
  }

  formatTime(ride: LocalRide): string {
    return this.localRides.formatTime(ride.time);
  }

  viewDetails(ride: LocalRide): void {
    void this.router.navigate(['/ride-details', ride.id], { state: { ride } });
  }

  async cancelRide(ride: LocalRide): Promise<void> {
    if (this.cancellingId || !this.canCancel(ride)) {
      return;
    }
    this.cancellingId = ride.id;
    try {
      const alert = await this.alerts.create({
        header: 'Cancel booking',
        message: 'This booking will be cancelled. It stays in your ride history and is not deleted.',
        backdropDismiss: false,
        buttons: [
          { text: 'Keep booking', role: 'cancel' },
          { text: 'Cancel booking', role: 'confirm' },
        ],
      });
      await alert.present();
      const { role } = await alert.onDidDismiss();
      if (role !== 'confirm') {
        return;
      }
      const cancelled = this.ridesApi.cloudBookings
        ? await this.cancelCloudRide(ride.id)
        : this.cancelOwnedRide(ride.id);
      const notice = await this.alerts.create({
        header: cancelled ? 'Booking cancelled' : 'Booking not cancelled',
        message: cancelled
          ? 'This booking is cancelled and is now in Ride History.'
          : 'This booking can no longer be cancelled.',
        buttons: ['OK'],
      });
      await notice.present();
    } finally {
      this.cancellingId = null;
    }
  }

  private ownsRide(ride: LocalRide): boolean {
    const account = this.auth.getLocalAccount();
    return Boolean(
      account &&
      account.accountType === 'passenger' &&
      ride.passengerName.trim().toLowerCase() === account.fullName.trim().toLowerCase(),
    );
  }

  private async cancelCloudRide(id: string): Promise<boolean> {
    const ride = this.localRides.getRideById(id);
    if (!ride || !this.canCancel(ride)) {
      return false;
    }
    const cancelled = await this.ridesApi.cancelRide(id);
    return Boolean(cancelled);
  }

  private cancelOwnedRide(id: string): boolean {
    this.localRides.reloadFromStorage();
    const ride = this.localRides.getRideById(id);
    if (!ride || !this.canCancel(ride)) {
      return false;
    }
    return Boolean(this.localRides.cancelRide(ride.id));
  }

  private loadRides(): void {
    const account = this.auth.getLocalAccount();
    if (!account || account.accountType !== 'passenger') {
      this.rides = [];
      return;
    }
    const name = account.fullName.trim().toLowerCase();
    this.rides = this.localRides.getScheduledRides().filter(
      (ride) => ride.passengerName.trim().toLowerCase() === name,
    );
  }
}
