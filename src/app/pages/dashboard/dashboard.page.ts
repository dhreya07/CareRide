import { Component, DestroyRef, OnDestroy, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { AlertController, IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  arrowForwardOutline,
  calendarOutline,
  carOutline,
  navigateOutline,
  notificationsOutline,
  personCircleOutline,
  personOutline,
  shieldCheckmarkOutline,
  starOutline,
  timeOutline,
} from 'ionicons/icons';

import { LocalRideService } from '../../core/services/local-ride.service';
import { AuthService } from '../../core/services/auth.service';
import { NotificationService } from '../../core/services/notification.service';
import { RideService } from '../../core/services/ride.service';
import { LocalRide } from '../../core/models/local-ride.model';
import { AppNavigationComponent } from '../../shared/app-navigation.component';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  host: { class: 'ion-page' },

  imports: [
    CommonModule,
    IonIcon,
    AppNavigationComponent
  ],

  templateUrl: './dashboard.page.html',
  styleUrls: ['./dashboard.page.scss']
})
export class DashboardPage implements OnInit, OnDestroy {
  private readonly destroyRef = inject(DestroyRef);

  // =========================
  // USER
  // =========================

  userName = 'Andrea';
  greeting = 'Good day';

  clockTime = '';
  clockAmpm = '';
  clockWeekday = '';
  clockDate = '';
  hourDeg = 0;
  minuteDeg = 0;
  readonly clockMarks = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

  private clockTimer: ReturnType<typeof setInterval> | null = null;
  private clockStamp = '';


  // =========================
  // NOTIFICATIONS
  // =========================

  notificationCount = 0;


  // =========================
  // UPCOMING RIDE
  // =========================

  hasUpcomingRide = false;
  unratedRide: LocalRide | null = null;
  driverChangeNotices: LocalRide[] = [];
  respondingReferralId: string | null = null;

  upcomingRide = {
    id: '',
    date: '',
    time: '',
    pickup: '',
    destination: '',
    status: '',
    driverName: '',
    hasDriver: false,
    location: '',
  };


  constructor(
    private router: Router,
    private localRides: LocalRideService,
    private ridesApi: RideService,
    private auth: AuthService,
    private alerts: AlertController,
    private notifications: NotificationService,
  ) {
    addIcons({
      arrowForwardOutline,
      calendarOutline,
      carOutline,
      navigateOutline,
      notificationsOutline,
      personCircleOutline,
      personOutline,
      shieldCheckmarkOutline,
      starOutline,
      timeOutline,
    });
  }


  // =========================
  // REFRESH DASHBOARD
  // =========================

  ngOnInit(): void {
    this.userName = this.formatPersonName(this.auth.getLocalDisplayName());
    this.startClock();
    this.localRides.rides$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.loadUpcomingRide();
        this.unratedRide = this.localRides.getUnratedCompletedRides().find((ride) => this.ownsRide(ride)) ?? null;
        this.driverChangeNotices = this.driverChangeRides();
      });
    this.notifications.changes$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.refreshNotificationCount());
    void this.refreshDashboard();
  }

  ionViewWillEnter(): void {
    this.userName = this.formatPersonName(this.auth.getLocalDisplayName());
    this.refreshNotificationCount();
    void this.refreshDashboard();
    this.startClock();
  }

  ionViewDidLeave(): void {
    this.stopClock();
  }

  ngOnDestroy(): void {
    this.stopClock();
  }

  private startClock(): void {
    if (this.clockTimer !== null) {
      return;
    }
    this.tickClock(true);
    this.clockTimer = setInterval(() => this.tickClock(), 1000);
  }

  private stopClock(): void {
    if (this.clockTimer !== null) {
      clearInterval(this.clockTimer);
      this.clockTimer = null;
    }
  }

  private tickClock(force = false): void {
    const now = new Date();
    const stamp = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}-${now.getMinutes()}`;
    if (!force && stamp === this.clockStamp) {
      return;
    }
    this.clockStamp = stamp;

    const hour = now.getHours();
    const minutes = now.getMinutes();

    if (hour < 12) {
      this.greeting = 'Good morning';
    } else if (hour < 18) {
      this.greeting = 'Good afternoon';
    } else {
      this.greeting = 'Good evening';
    }

    const hour12 = hour % 12 || 12;
    this.clockTime = `${hour12}:${String(minutes).padStart(2, '0')}`;
    this.clockAmpm = hour >= 12 ? 'PM' : 'AM';
    this.clockWeekday = now.toLocaleDateString(undefined, { weekday: 'long' });
    this.clockDate = now.toLocaleDateString(undefined, {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });

    this.hourDeg = (hour % 12) * 30 + minutes * 0.5;
    this.minuteDeg = minutes * 6;
  }


  // =========================
  // LOAD UPCOMING RIDE
  // =========================

  private async refreshDashboard(): Promise<void> {
    try {
      await this.ridesApi.hydrateFromCloud();
    } catch {
      // Upcoming ride still comes from on-device records.
    }
    this.loadUpcomingRide();
    this.unratedRide = this.localRides.getUnratedCompletedRides().find((ride) => this.ownsRide(ride)) ?? null;
    this.driverChangeNotices = this.driverChangeRides();
  }

  private loadUpcomingRide(): void {

    const ride: LocalRide | null =
      this.localRides.getScheduledRides().find((item) => this.ownsRide(item)) ?? null;

    this.hasUpcomingRide = Boolean(ride);

    if (!ride) {

      this.upcomingRide = {
        id: '',
        date: '',
        time: '',
        pickup: '',
        destination: '',
        status: '',
        driverName: '',
        hasDriver: false,
        location: '',
      };

      return;
    }


    this.upcomingRide = {

      id: ride.id,

      date:
        this.localRides.formatDate(
          ride.date
        ),

      time:
        this.localRides.formatTime(
          ride.time
        ),

      pickup:
        ride.pickupLocation,

      destination:
        ride.destination,

      status:
        ride.status,

      driverName: ride.driverName || '',
      hasDriver: this.localRides.hasAssignedDriver(ride),
      location: this.localRides.hasAssignedDriver(ride)
        ? `${this.localRides.driverLocationTitle(ride)} · ${this.localRides.driverLocationDetail(ride)}`
        : '',

    };

  }


  // =========================
  // HOME
  // =========================

  private formatPersonName(name: string): string {
    return name
      .trim()
      .split(/\s+/)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join(' ') || 'Passenger';
  }

  goHome(): void {

    this.router.navigate([
      '/dashboard'
    ]);

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
  // SCHEDULED RIDES
  // =========================

  scheduledRides(): void {

    this.router.navigate([
      '/scheduled-rides'
    ]);

  }


  // =========================
  // RIDE HISTORY
  // =========================

  rideHistory(): void {

    this.router.navigate([
      '/ride-history'
    ]);

  }


  // =========================
  // SAFETY CENTER
  // =========================

  safety(): void {

    this.router.navigate([
      '/safety'
    ]);

  }


  // =========================
  // PROFILE
  // =========================

  profile(): void {

    this.router.navigate([
      '/profile'
    ]);

  }


  referralOriginalName(ride: LocalRide): string {
    return this.accountName(ride.referralOriginalDriverId) || 'Your current driver';
  }

  referralReplacementName(ride: LocalRide): string {
    return this.accountName(ride.referralProposedDriverId) || ride.referralProposedDriverName || 'Replacement driver';
  }

  referralVehicle(ride: LocalRide): string {
    const account = this.driverAccount(ride.referralProposedDriverId);
    return account?.vehicleType?.trim() || 'Not provided';
  }

  referralPlate(ride: LocalRide): string {
    const account = this.driverAccount(ride.referralProposedDriverId);
    return account?.plateNumber?.trim() || 'Not provided';
  }

  referralRating(ride: LocalRide): string {
    return ride.referralProposedDriverId
      ? this.localRides.driverRatingSummary(ride.referralProposedDriverId)
      : 'Not yet rated';
  }

  confirmDriverChange(ride: LocalRide): void {
    void this.answerDriverChange(ride, 'confirm');
  }

  declineDriverChange(ride: LocalRide): void {
    void this.answerDriverChange(ride, 'decline');
  }

  private driverChangeRides(): LocalRide[] {
    return this.localRides.getRides().filter((ride) =>
      ride.referralStatus === 'accepted_by_replacement' &&
      Boolean(ride.referralProposedDriverId) &&
      this.ownsRide(ride) &&
      this.localRides.canCancel(ride),
    );
  }

  private ownsRide(ride: LocalRide): boolean {
    const account = this.auth.getLocalAccount();
    if (!account || account.accountType !== 'passenger') {
      return false;
    }
    return ride.passengerName.trim().toLowerCase() === account.fullName.trim().toLowerCase();
  }

  private driverAccount(driverId: string | null | undefined) {
    if (!driverId) {
      return null;
    }
    return this.auth.listManagedAccounts().find((account) => account.id === driverId) ?? null;
  }

  private accountName(driverId: string | null | undefined): string {
    return this.driverAccount(driverId)?.fullName || '';
  }

  private async answerDriverChange(ride: LocalRide, decision: 'confirm' | 'decline'): Promise<void> {
    if (this.respondingReferralId) {
      return;
    }
    this.respondingReferralId = ride.id;
    const action = decision === 'confirm' ? 'Confirm' : 'Decline';
    const message = decision === 'confirm'
      ? `Confirm ${this.referralReplacementName(ride)} as your driver?`
      : 'Decline this driver change? Your current driver stays on this booking.';
    try {
      const alert = await this.alerts.create({
        header: decision === 'confirm' ? 'Confirm driver change' : 'Decline driver change',
        message,
        backdropDismiss: false,
        buttons: [
          { text: 'Cancel', role: 'cancel' },
          { text: action, role: 'confirm' },
        ],
      });
      await alert.present();
      const { role } = await alert.onDidDismiss();
      if (role !== 'confirm') {
        return;
      }
      if (decision === 'confirm') {
        this.applyDriverConfirmation(ride.id);
      } else {
        this.applyDriverDecline(ride.id);
      }
    } finally {
      this.respondingReferralId = null;
    }
  }

  private applyDriverConfirmation(rideId: string): void {
    if (this.ridesApi.cloudBookings) {
      void this.confirmCloudDriver(rideId);
      return;
    }
    this.localRides.reloadFromStorage();
    const ride = this.localRides.getRideById(rideId);
    if (!ride || !this.ownsRide(ride) || ride.referralStatus !== 'accepted_by_replacement' || !this.localRides.canCancel(ride)) {
      this.driverChangeNotices = this.driverChangeRides();
      void this.presentNotice('This booking was cancelled or is no longer waiting for a driver change.');
      return;
    }
    const replacement = this.driverAccount(ride.referralProposedDriverId);
    const reason = this.replacementBlockReason(ride, replacement);
    if (!replacement || reason) {
      void this.presentNotice(reason || 'That driver is no longer eligible. The booking was not changed.');
      return;
    }
    const vehicle = [replacement.vehicleType?.trim(), replacement.plateNumber?.trim()].filter(Boolean).join(' · ');
    const saved = this.localRides.updateRide(ride.id, {
      driverId: replacement.id,
      driverName: replacement.fullName,
      driverPhone: replacement.phone,
      vehicleLabel: vehicle || ride.vehicleLabel || null,
      preferredDriverId: replacement.id,
      preferredDriverName: replacement.fullName,
      preferredDriverPhone: replacement.phone,
      preferredVehicleLabel: vehicle || ride.preferredVehicleLabel || null,
      referralStatus: 'passenger_confirmed',
      referralOriginalDriverId: ride.referralOriginalDriverId,
      referralProposedDriverId: replacement.id,
      referralProposedDriverName: replacement.fullName,
    });
    this.driverChangeNotices = this.driverChangeRides();
    if (!saved) {
      void this.presentNotice('The driver change could not be saved.');
      return;
    }
    this.notifications.driverChangeConfirmed(saved);
    void this.presentNotice(`${replacement.fullName} is now the driver for this booking.`);
  }

  private applyDriverDecline(rideId: string): void {
    if (this.ridesApi.cloudBookings) {
      void this.declineCloudDriver(rideId);
      return;
    }
    this.localRides.reloadFromStorage();
    const ride = this.localRides.getRideById(rideId);
    if (!ride || !this.ownsRide(ride) || ride.referralStatus !== 'accepted_by_replacement' || !this.localRides.canCancel(ride)) {
      this.driverChangeNotices = this.driverChangeRides();
      void this.presentNotice('This booking was cancelled or is no longer waiting for a driver change.');
      return;
    }
    const saved = this.localRides.updateRide(ride.id, {
      referralStatus: 'passenger_declined',
      referralOriginalDriverId: ride.referralOriginalDriverId,
      referralProposedDriverId: ride.referralProposedDriverId,
      referralProposedDriverName: ride.referralProposedDriverName,
    });
    this.driverChangeNotices = this.driverChangeRides();
    if (!saved) {
      void this.presentNotice('The decline could not be saved.');
      return;
    }
    this.notifications.driverChangeDeclined(saved);
    void this.presentNotice('You declined the driver change. Your original driver is still assigned.');
  }

  private async confirmCloudDriver(rideId: string): Promise<void> {
    try {
      const saved = await this.ridesApi.confirmDriverChange(rideId);
      this.localRides.saveRide(saved);
      this.driverChangeNotices = this.driverChangeRides();
      void this.presentNotice(`${saved.driverName || 'The replacement driver'} is now the driver for this booking.`);
    } catch (error: unknown) {
      this.driverChangeNotices = this.driverChangeRides();
      void this.presentNotice(error instanceof Error ? error.message : 'The driver change could not be saved.');
    }
  }

  private async declineCloudDriver(rideId: string): Promise<void> {
    try {
      const saved = await this.ridesApi.declineDriverChange(rideId);
      this.localRides.saveRide(saved);
      this.driverChangeNotices = this.driverChangeRides();
      void this.presentNotice('You declined the driver change. Your original driver is still assigned.');
    } catch (error: unknown) {
      this.driverChangeNotices = this.driverChangeRides();
      void this.presentNotice(error instanceof Error ? error.message : 'The decline could not be saved.');
    }
  }

  private replacementBlockReason(
    ride: LocalRide,
    replacement: ReturnType<DashboardPage['driverAccount']>,
  ): string | null {
    if (!replacement || replacement.accountType !== 'driver' || this.auth.accountStatusOf(replacement) !== 'approved') {
      return 'That driver is no longer approved. The booking was not changed.';
    }
    const availability = this.auth.readAvailability(replacement);
    if (ride.status === 'Scheduled') {
      if (availability === 'offline' || availability === 'unknown') {
        return 'That driver is no longer available for this trip. The booking was not changed.';
      }
      if (this.localRides.hasSamePickupReservation(replacement.id, ride)) {
        return 'That driver already has an accepted ride at this pickup time. The booking was not changed.';
      }
      return null;
    }
    if (availability !== 'available') {
      return 'That driver is no longer available. The booking was not changed.';
    }
    return null;
  }

  private async presentNotice(message: string): Promise<void> {
    const alert = await this.alerts.create({
      header: 'Driver change',
      message,
      buttons: ['OK'],
    });
    await alert.present();
  }

  // =========================
  // NOTIFICATIONS
  // =========================

  openNotifications(): void {
    void this.router.navigate(['/notifications']);
  }

  private refreshNotificationCount(): void {
    const account = this.auth.getLocalAccount();
    this.notificationCount = account ? this.notifications.unreadCount(account.id) : 0;
  }


  // =========================
  // VIEW UPCOMING RIDE
  // =========================

  statusTone(status: string): string {
    return this.localRides.statusTone(status as LocalRide['status']);
  }

  rateUnratedRide(): void {
    if (!this.unratedRide?.id) {
      return;
    }
    void this.router.navigate(['/ride-details', this.unratedRide.id], {
      state: { ride: this.unratedRide },
    });
  }

  viewUpcomingRide(): void {

    if (
      this.hasUpcomingRide &&
      this.upcomingRide.id
    ) {

      this.router.navigate(['/ride-details', this.upcomingRide.id], {
        state: { ride: this.upcomingRide },
      });

      return;
    }


    // No upcoming ride
    this.requestRide();

  }

}