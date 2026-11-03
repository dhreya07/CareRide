import { ChangeDetectorRef, Component, DestroyRef, OnDestroy, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs/operators';
import { AlertController, IonIcon } from '@ionic/angular';

import { normalizeAccountRole } from '../../core/models/care-ride.models';
import { LocalDriverOption, LocalRide } from '../../core/models/local-ride.model';
import { LocalRideService } from '../../core/services/local-ride.service';
import { AuthService, LocalCareRideUser } from '../../core/services/auth.service';
import { CloudManagedAccount } from '../../core/services/supabase-auth.adapter';
import { RideService } from '../../core/services/ride.service';
import { AdminNavigationComponent } from '../../shared/admin-navigation.component';

type ReferralHistoryFilter =
  | 'all'
  | 'pending'
  | 'accepted_by_replacement'
  | 'passenger_confirmed'
  | 'passenger_declined';

interface AdminDialog {
  kind: 'assign' | 'reject' | 'cancel' | 'notice' | 'drivers' | 'driver-profile';
  title: string;
  confirmLabel?: string;
  message?: string;
  ride?: LocalRide;
  driverId?: string;
  driverName?: string;
  driverPhone?: string;
  vehicleId?: string;
  vehicleLabel?: string;
  driverRating?: number;
  drivers?: LocalDriverOption[];
  cloudChoices?: LocalDriverOption[];
  reviews?: LocalRide[];
  busy?: boolean;
}

@Component({
  selector: 'app-admin',
  standalone: true,
  host: { class: 'ion-page' },
  imports: [CommonModule, IonIcon, AdminNavigationComponent],
  templateUrl: './admin.page.html',
  styleUrls: ['./admin.page.scss'],
})
export class AdminPage implements OnInit, OnDestroy {
  rides: LocalRide[] = [];
  listTab: 'active' | 'accounts' | 'accepted' | 'history' | 'drivers' = 'active';
  managedAccounts: LocalCareRideUser[] = [];
  accountGroup: 'passenger' | 'driver' = 'passenger';
  accountFilter: 'pending' | 'approved' | 'rejected' = 'pending';
  reviewingAccountId: string | null = null;
  accountsLoading = false;
  accountsError = '';
  fetching = false;
  clockWeekday = '';
  clockDate = '';
  clockTime = '';
  dialog: AdminDialog | null = null;

  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private clockTimer: ReturnType<typeof setInterval> | null = null;
  private readonly destroyRef = inject(DestroyRef);
  private readonly onStorage = () => {
    this.applyRides();
  };

  constructor(
    private localRides: LocalRideService,
    private ridesApi: RideService,
    private auth: AuthService,
    private router: Router,
    private alerts: AlertController,
    private changes: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.localRides.rides$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.applyRides());
    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => this.syncViewFromUrl());
    this.syncViewFromUrl();
    window.addEventListener('storage', this.onStorage);
    void this.fetchRides();
    this.startAutoFetch();
    this.startClock();
    if (this.auth.cloudAuthEnabled) {
      this.refreshAccounts();
    }
  }

  ionViewWillEnter(): void {
    void this.fetchRides();
    this.startAutoFetch();
    this.startClock();
  }

  ionViewDidLeave(): void {
    this.stopAutoFetch();
    this.stopClock();
  }

  ngOnDestroy(): void {
    this.stopAutoFetch();
    this.stopClock();
    window.removeEventListener('storage', this.onStorage);
  }

  selectReportPeriod(period: 'all' | 'today' | 'week' | 'month'): void {
    this.reportPeriod = period;
  }

  get activityRides(): LocalRide[] {
    if (this.reportPeriod === 'all') {
      return this.rides;
    }
    return this.rides.filter((ride) => this.createdInPeriod(ride.createdAt));
  }

  get bookingsMissingCreatedAt(): number {
    if (this.reportPeriod === 'all') {
      return 0;
    }
    return this.rides.filter((ride) => !this.parseTimestamp(ride.createdAt)).length;
  }

  get totalCount(): number {
    return this.activityRides.length;
  }

  get pendingCount(): number {
    return this.activityRides.filter((ride) => this.isPendingStatus(ride)).length;
  }

  get confirmedCount(): number {
    return this.activityRides.filter((ride) => ride.status === 'Driver Assigned').length;
  }

  get ongoingCount(): number {
    return this.activityRides.filter((ride) => this.isOngoingStatus(ride)).length;
  }

  get completedCount(): number {
    return this.activityRides.filter((ride) => ride.status === 'Completed').length;
  }

  get cancelledCount(): number {
    return this.activityRides.filter((ride) => ride.status === 'Cancelled').length;
  }

  get declinedCount(): number {
    return this.activityRides.filter((ride) => ride.status === 'Rejected').length;
  }

  get reportedCount(): number {
    return this.activityRides.filter((ride) => ride.status === 'Reported').length;
  }

  get bookingStatusBars(): Array<{ label: string; count: number; percent: number; tone: string }> {
    const total = this.totalCount;
    return [
      { label: 'Pending', count: this.pendingCount, tone: 'pending' },
      { label: 'Confirmed', count: this.confirmedCount, tone: 'confirmed' },
      { label: 'Ongoing', count: this.ongoingCount, tone: 'ongoing' },
      { label: 'Completed', count: this.completedCount, tone: 'completed' },
      { label: 'Cancelled', count: this.cancelledCount, tone: 'cancelled' },
      { label: 'Declined', count: this.declinedCount, tone: 'declined' },
      { label: 'Reported', count: this.reportedCount, tone: 'reported' },
    ].map((row) => ({
      ...row,
      percent: total > 0 ? (row.count / total) * 100 : 0,
    }));
  }

  get registeredPassengerCount(): number {
    return this.accountsByRole('passenger').length;
  }

  get registeredDriverCount(): number {
    return this.accountsByRole('driver').length;
  }

  get approvedDriverCount(): number {
    if (this.auth.cloudAuthEnabled) {
      return this.accountsByRole('driver').filter((account) => this.auth.accountStatusOf(account) === 'approved').length;
    }
    return this.auth.listApprovedDrivers().length;
  }

  get pendingPassengerCount(): number {
    return this.accountsByRole('passenger').filter((account) => this.auth.accountStatusOf(account) === 'pending').length;
  }

  get pendingDriverCount(): number {
    return this.accountsByRole('driver').filter((account) => this.auth.accountStatusOf(account) === 'pending').length;
  }

  get availableDriverCount(): number {
    return this.auth.listApprovedDrivers().filter((driver) => this.auth.readAvailability(driver) === 'available').length;
  }

  get referralMetricsAvailable(): boolean {
    return this.reportPeriod === 'all';
  }

  get referralAttemptCount(): number {
    return this.referralRides.length;
  }

  get referralAcceptedCount(): number {
    return this.referralRides.filter((ride) => ride.referralStatus === 'accepted_by_replacement').length;
  }

  get performanceMetricsAvailable(): boolean {
    return this.reportPeriod === 'all';
  }

  get driverPerformance(): Array<{
    id: string;
    name: string;
    completed: number;
    reviews: number;
    averageLabel: string;
    reviewLabel: string;
  }> {
    if (!this.performanceMetricsAvailable) {
      return [];
    }
    return this.auth.listApprovedDrivers()
      .map((driver) => {
        const completedRides = this.rides.filter(
          (ride) => ride.status === 'Completed' && ride.driverId === driver.id,
        );
        const reviews = completedRides.filter(
          (ride) =>
            Number.isInteger(ride.clientRating) &&
            (ride.clientRating ?? 0) >= 1 &&
            (ride.clientRating ?? 0) <= 5,
        );
        const averageLabel = reviews.length
          ? `${(Math.round((reviews.reduce((sum, ride) => sum + (ride.clientRating ?? 0), 0) / reviews.length) * 10) / 10).toFixed(1)} ★`
          : 'Not yet rated';
        const reviewLabel = reviews.length === 1 ? '1 review' : `${reviews.length} reviews`;
        return {
          id: driver.id,
          name: driver.fullName.trim() || 'Driver',
          completed: completedRides.length,
          reviews: reviews.length,
          averageLabel,
          reviewLabel,
        };
      })
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  get completedRidesOutsideApprovedDrivers(): number {
    if (!this.performanceMetricsAvailable) {
      return 0;
    }
    const approvedIds = new Set(this.auth.listApprovedDrivers().map((driver) => driver.id));
    return this.rides.filter(
      (ride) => ride.status === 'Completed' && (!ride.driverId || !approvedIds.has(ride.driverId)),
    ).length;
  }

  get activeRides(): LocalRide[] {
    return this.rides.filter(
      (ride) => !['Completed', 'Cancelled', 'Rejected', 'Reported'].includes(ride.status),
    );
  }

  get historyRides(): LocalRide[] {
    return this.rides.filter((ride) =>
      ['Completed', 'Cancelled', 'Rejected', 'Reported'].includes(ride.status),
    );
  }

  get pendingRides(): LocalRide[] {
    return this.rides.filter(
      (ride) => ride.status === 'Pending' || ride.status === 'Scheduled',
    );
  }

  get acceptedRides(): LocalRide[] {
    return this.rides.filter((ride) =>
      [
        'Driver Assigned',
        'Driver On The Way',
        'Arrived',
        'Picked Up',
        'In Progress',
      ].includes(ride.status),
    );
  }

  get visibleRides(): LocalRide[] {
    if (this.listTab === 'history') {
      return this.historyRides;
    }
    if (this.listTab === 'accepted') {
      return this.acceptedRides;
    }
    return this.rides.filter((ride) => this.matchesBookingFilter(ride));
  }

  bookingFilter: 'all' | 'pending' | 'confirmed' | 'ongoing' | 'completed' | 'cancelled' | 'declined' = 'all';
  reportPeriod: 'all' | 'today' | 'week' | 'month' = 'all';
  referralFilter: ReferralHistoryFilter = 'all';
  driverAvailabilityFilter: 'all' | 'available' | 'busy' | 'offline' = 'all';

  get approvedDrivers(): LocalCareRideUser[] {
    return this.auth.listApprovedDrivers();
  }

  get visibleApprovedDrivers(): LocalCareRideUser[] {
    if (this.driverAvailabilityFilter === 'all') {
      return this.approvedDrivers;
    }
    return this.approvedDrivers.filter(
      (driver) => this.driverAvailability(driver) === this.driverAvailabilityFilter,
    );
  }

  selectDriverFilter(filter: 'all' | 'available' | 'busy' | 'offline'): void {
    this.driverAvailabilityFilter = filter;
  }

  driverCount(filter: 'all' | 'available' | 'busy' | 'offline'): number {
    if (filter === 'all') {
      return this.approvedDrivers.length;
    }
    return this.approvedDrivers.filter((driver) => this.driverAvailability(driver) === filter).length;
  }

  driverAvailability(driver: LocalCareRideUser): 'available' | 'busy' | 'offline' | 'unknown' {
    return this.auth.readAvailability(driver);
  }

  driverAvailabilityLabel(driver: LocalCareRideUser): string {
    const status = this.driverAvailability(driver);
    if (status === 'available') {
      return 'Available';
    }
    if (status === 'busy') {
      return 'Busy';
    }
    if (status === 'offline') {
      return 'Offline';
    }
    return 'Unknown';
  }

  driverRatingText(driver: LocalCareRideUser): string {
    return this.localRides.driverRatingSummary(driver.id);
  }

  driverVehicleType(driver: LocalCareRideUser): string {
    return driver.vehicleType?.trim() || 'Not provided';
  }

  driverPlate(driver: LocalCareRideUser): string {
    return driver.plateNumber?.trim() || 'Not provided';
  }

  get driverEmptyTitle(): string {
    if (this.approvedDrivers.length === 0) {
      return 'No approved drivers';
    }
    return 'No drivers in this filter';
  }

  get driverEmptyCopy(): string {
    if (this.approvedDrivers.length === 0) {
      return 'Approved driver accounts will appear here. Pending and rejected applications stay in Accounts.';
    }
    return 'No approved driver currently matches this availability filter.';
  }

  selectBookingFilter(
    filter: 'all' | 'pending' | 'confirmed' | 'ongoing' | 'completed' | 'cancelled' | 'declined',
  ): void {
    this.bookingFilter = filter;
  }

  bookingFilterCount(
    filter: 'all' | 'pending' | 'confirmed' | 'ongoing' | 'completed' | 'cancelled' | 'declined',
  ): number {
    if (filter === 'all') {
      return this.rides.length;
    }
    return this.rides.filter((ride) => this.matchesBookingFilter(ride, filter)).length;
  }

  bookingTypeLabel(ride: LocalRide): string {
    if (ride.status === 'Scheduled') {
      return 'Scheduled';
    }
    if (ride.status === 'Pending') {
      return 'Immediate';
    }
    const pickupDay = /^(\d{4}-\d{2}-\d{2})/.exec(ride.date)?.[1];
    const createdDay = /^(\d{4}-\d{2}-\d{2})/.exec(ride.createdAt)?.[1];
    if (pickupDay && createdDay && pickupDay > createdDay) {
      return 'Scheduled';
    }
    return 'Immediate';
  }

  assignedDriverName(ride: LocalRide): string {
    return ride.driverName?.trim() || 'Not assigned';
  }

  createdLabel(ride: LocalRide): string {
    return ride.createdAt ? this.localRides.formatDate(ride.createdAt) : 'Not available';
  }

  get referralRides(): LocalRide[] {
    return this.rides.filter((ride) => Boolean(ride.referralStatus));
  }

  get visibleReferrals(): LocalRide[] {
    return this.referralRides.filter((ride) => this.matchesReferralFilter(ride));
  }

  get pendingReferralCount(): number {
    return this.referralRides.filter((ride) => ride.referralStatus === 'pending').length;
  }

  get confirmedReferralCount(): number {
    return this.referralRides.filter((ride) => ride.referralStatus === 'passenger_confirmed').length;
  }

  get declinedReferralCount(): number {
    return this.referralRides.filter((ride) => ride.referralStatus === 'passenger_declined').length;
  }

  selectReferralFilter(filter: ReferralHistoryFilter): void {
    this.referralFilter = filter;
  }

  referralFilterCount(filter: ReferralHistoryFilter): number {
    if (filter === 'all') {
      return this.referralRides.length;
    }
    return this.referralRides.filter((ride) => ride.referralStatus === filter).length;
  }

  referralTone(ride: LocalRide): 'pending' | 'active' | 'completed' | 'cancelled' {
    if (ride.referralStatus === 'passenger_declined') {
      return 'cancelled';
    }
    if (ride.referralStatus === 'passenger_confirmed') {
      return 'completed';
    }
    if (ride.referralStatus === 'accepted_by_replacement') {
      return 'active';
    }
    return 'pending';
  }

  referralStatusLabel(ride: LocalRide): string {
    switch (ride.referralStatus) {
      case 'pending':
        return 'Pending';
      case 'accepted_by_replacement':
        return 'Accepted by replacement';
      case 'passenger_confirmed':
        return 'Passenger confirmed';
      case 'passenger_declined':
        return 'Passenger declined';
      default:
        return 'Not recorded';
    }
  }

  referralOriginalName(ride: LocalRide): string {
    return this.referralAccountName(ride.referralOriginalDriverId);
  }

  referralReplacementName(ride: LocalRide): string {
    return this.referralAccountName(ride.referralProposedDriverId, ride.referralProposedDriverName);
  }

  referralResponseLabel(ride: LocalRide): string {
    if (
      ride.referralStatus === 'accepted_by_replacement' ||
      ride.referralStatus === 'passenger_confirmed' ||
      ride.referralStatus === 'passenger_declined'
    ) {
      return 'Accepted';
    }
    return 'Not recorded';
  }

  referralDecisionLabel(ride: LocalRide): string {
    if (ride.referralStatus === 'passenger_confirmed') {
      return 'Confirmed';
    }
    if (ride.referralStatus === 'passenger_declined') {
      return 'Declined';
    }
    return 'Not recorded';
  }

  referralEvents(ride: LocalRide): string[] {
    const events = ['Referral created'];
    if (
      ride.referralStatus === 'accepted_by_replacement' ||
      ride.referralStatus === 'passenger_confirmed' ||
      ride.referralStatus === 'passenger_declined'
    ) {
      events.push('Replacement driver accepted');
    }
    if (ride.referralStatus === 'passenger_confirmed') {
      events.push('Passenger confirmed');
      if (ride.driverId && ride.driverId === ride.referralProposedDriverId) {
        events.push('Booking reassigned');
      }
    }
    if (ride.referralStatus === 'passenger_declined') {
      events.push('Passenger declined');
    }
    return events;
  }

  get referralEmptyTitle(): string {
    return this.referralFilter === 'all' ? 'No referrals yet' : 'No referrals in this filter';
  }

  private matchesReferralFilter(ride: LocalRide): boolean {
    if (this.referralFilter === 'all') {
      return true;
    }
    return ride.referralStatus === this.referralFilter;
  }

  private referralAccountName(driverId: string | null | undefined, storedName?: string | null): string {
    const account = driverId
      ? this.auth.listManagedAccounts().find((item) => item.id === driverId)
      : undefined;
    return account?.fullName?.trim() || storedName?.trim() || 'Not available';
  }

  private accountsByRole(role: 'passenger' | 'driver'): LocalCareRideUser[] {
    const accounts = this.auth.cloudAuthEnabled ? this.managedAccounts : this.auth.listManagedAccounts();
    return accounts.filter(
      (account) => normalizeAccountRole(account.accountType) === role,
    );
  }

  private createdInPeriod(value: string | null | undefined): boolean {
    const period = this.reportPeriod;
    const parsed = this.parseTimestamp(value);
    if (!parsed || period === 'all') {
      return false;
    }
    return parsed >= this.periodStart(period) && parsed < this.periodEnd(period);
  }

  private parseTimestamp(value: string | null | undefined): Date | null {
    if (!value?.trim()) {
      return null;
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  private periodStart(period: 'today' | 'week' | 'month'): Date {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (period === 'week') {
      start.setDate(start.getDate() - start.getDay());
    }
    if (period === 'month') {
      start.setDate(1);
    }
    return start;
  }

  private periodEnd(period: 'today' | 'week' | 'month'): Date {
    const start = this.periodStart(period);
    const end = new Date(start);
    if (period === 'today') {
      end.setDate(end.getDate() + 1);
    } else if (period === 'week') {
      end.setDate(end.getDate() + 7);
    } else {
      end.setMonth(end.getMonth() + 1);
    }
    return end;
  }

  private isPendingStatus(ride: LocalRide): boolean {
    return ride.status === 'Pending' || ride.status === 'Scheduled';
  }

  private isOngoingStatus(ride: LocalRide): boolean {
    return ['Driver On The Way', 'Arrived', 'Picked Up', 'In Progress'].includes(ride.status);
  }

  private matchesBookingFilter(
    ride: LocalRide,
    filter: AdminPage['bookingFilter'] = this.bookingFilter,
  ): boolean {
    switch (filter) {
      case 'pending':
        return this.isPendingStatus(ride);
      case 'confirmed':
        return ride.status === 'Driver Assigned';
      case 'ongoing':
        return this.isOngoingStatus(ride);
      case 'completed':
        return ride.status === 'Completed';
      case 'cancelled':
        return ride.status === 'Cancelled';
      case 'declined':
        return ride.status === 'Rejected';
      default:
        return true;
    }
  }

  get pageTitle(): string {
    if (this.listTab === 'history') {
      return 'History';
    }
    if (this.listTab === 'accounts') {
      return 'Accounts';
    }
    if (this.listTab === 'drivers') {
      return 'Drivers';
    }
    if (this.listTab === 'accepted') {
      return 'Accepted';
    }
    return 'Bookings';
  }

  get emptyTitle(): string {
    if (this.listTab === 'active' && this.bookingFilter !== 'all') {
      return 'No bookings in this filter';
    }
    if (this.listTab === 'accepted') {
      return 'No accepted requests yet';
    }
    if (this.listTab === 'history') {
      return 'No completed rides yet';
    }
    return 'No bookings yet';
  }

  private syncViewFromUrl(): void {
    const path = this.router.url.split('?')[0];
    if (path.endsWith('/history')) {
      this.listTab = 'history';
      return;
    }
    if (path.endsWith('/accounts')) {
      this.listTab = 'accounts';
      this.refreshAccounts();
      return;
    }
    if (path.endsWith('/drivers')) {
      this.listTab = 'drivers';
      return;
    }
    if (path.endsWith('/accepted')) {
      this.listTab = 'accepted';
      return;
    }
    this.listTab = 'active';
  }

  canAssign(ride: LocalRide): boolean {
    return ride.status === 'Pending' || ride.status === 'Scheduled';
  }

  canCancel(ride: LocalRide): boolean {
    return this.localRides.canCancel(ride);
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

  driverCoordinates(ride: LocalRide): string {
    const coords = this.localRides.driverCoordinates(ride);
    if (!coords) {
      return '';
    }
    return `${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)}`;
  }

  openDriverLocation(ride: LocalRide): void {
    window.open(this.localRides.driverMapsUrl(ride), '_blank', 'noopener');
  }

  callDriver(ride: LocalRide): void {
    const phone = ride.driverPhone?.trim();
    if (!phone) {
      this.showNotice('No driver phone number is stored for this assignment.');
      return;
    }
    window.location.href = `tel:${phone}`;
  }

  statusTone(ride: LocalRide): string {
    return this.localRides.statusTone(ride.status);
  }

  showTab(tab: 'active' | 'accounts' | 'accepted' | 'history' | 'drivers'): void {
    this.listTab = tab;
    if (tab === 'accounts') {
      this.refreshAccounts();
    }
  }

  get cloudAccountsEnabled(): boolean {
    return this.auth.cloudAuthEnabled;
  }

  reloadAccounts(): void {
    this.refreshAccounts();
  }

  accountRegisteredOn(user: LocalCareRideUser): string {
    const parsed = Date.parse(user.createdAt);
    if (Number.isNaN(parsed)) {
      return '';
    }
    return new Date(parsed).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }

  accountKind(user: LocalCareRideUser): string {
    if (this.isDriverAccount(user)) {
      return 'Driver';
    }
    if (user.bookingIntent === 'family') {
      return 'Family member';
    }
    return 'Passenger';
  }

  selectAccountGroup(group: 'passenger' | 'driver'): void {
    this.accountGroup = group;
  }

  selectAccountFilter(filter: 'pending' | 'approved' | 'rejected'): void {
    this.accountFilter = filter;
  }

  accountCount(group: 'passenger' | 'driver'): number {
    return this.managedAccounts.filter((user) => this.inAccountGroup(user, group)).length;
  }

  statusCount(filter: 'pending' | 'approved' | 'rejected'): number {
    return this.managedAccounts.filter(
      (user) => this.inAccountGroup(user, this.accountGroup) && this.matchesAccountFilter(user, filter),
    ).length;
  }

  accountStatusLabel(user: LocalCareRideUser): string {
    const status = this.auth.accountStatusOf(user);
    if (status === 'approved') {
      return 'Approved';
    }
    if (status === 'declined') {
      return 'Rejected';
    }
    return 'Pending';
  }

  accountStatusClass(user: LocalCareRideUser): string {
    const status = this.auth.accountStatusOf(user);
    if (status === 'approved') {
      return 'active';
    }
    if (status === 'declined') {
      return 'cancelled';
    }
    return 'pending';
  }

  vehicleLines(user: LocalCareRideUser): { label: string; value: string }[] {
    const lines: { label: string; value: string }[] = [];
    if (user.vehicleType?.trim()) {
      lines.push({ label: 'Vehicle', value: user.vehicleType.trim() });
    }
    if (user.plateNumber?.trim()) {
      lines.push({ label: 'Plate', value: user.plateNumber.trim() });
    }
    if (user.licenseNumber?.trim()) {
      lines.push({ label: 'License', value: user.licenseNumber.trim() });
    }
    if (user.wheelchairAccessible) {
      lines.push({ label: 'Access', value: 'Wheelchair accessible' });
    }
    if (user.seniorAssistance) {
      lines.push({ label: 'Access', value: 'Senior assistance available' });
    }
    return lines;
  }

  get visibleAccounts(): LocalCareRideUser[] {
    return this.managedAccounts.filter(
      (user) => this.inAccountGroup(user, this.accountGroup) && this.matchesAccountFilter(user, this.accountFilter),
    );
  }

  get accountEmptyTitle(): string {
    const group = this.accountGroup === 'driver' ? 'driver' : 'passenger';
    if (this.accountCount(this.accountGroup) === 0) {
      return this.accountGroup === 'driver' ? 'No driver accounts' : 'No passenger accounts';
    }
    const status = this.accountFilter === 'rejected' ? 'rejected' : this.accountFilter;
    return `No ${status} ${group} accounts`;
  }

  get accountEmptyCopy(): string {
    if (this.accountCount(this.accountGroup) === 0) {
      return this.accountGroup === 'driver'
        ? 'Driver applications appear here after someone registers as a driver.'
        : 'Passenger registrations appear here after someone creates a passenger account.';
    }
    return 'Choose another status to see the other accounts in this group.';
  }

  private inAccountGroup(user: LocalCareRideUser, group: 'passenger' | 'driver'): boolean {
    return group === 'driver' ? this.isDriverAccount(user) : !this.isDriverAccount(user);
  }

  private isDriverAccount(user: LocalCareRideUser): boolean {
    return normalizeAccountRole(user.accountType) === 'driver';
  }

  private matchesAccountFilter(
    user: LocalCareRideUser,
    filter: 'pending' | 'approved' | 'rejected',
  ): boolean {
    const status = this.auth.accountStatusOf(user);
    if (filter === 'rejected') {
      return status === 'declined';
    }
    return status === filter;
  }

  canReviewAccount(user: LocalCareRideUser): boolean {
    return normalizeAccountRole(user.accountType) !== 'admin' && this.auth.accountStatusOf(user) === 'pending';
  }

  confirmAccountDecision(user: LocalCareRideUser, decision: 'approved' | 'rejected'): Promise<void> {
    if (this.reviewingAccountId) {
      return Promise.resolve();
    }
    if (!this.canReviewAccount(user)) {
      this.showNotice('This account has already been approved or rejected.');
      return Promise.resolve();
    }
    this.reviewingAccountId = user.id;
    const action = decision === 'approved' ? 'Approve' : 'Reject';
    const name = user.fullName.replace(/[<>]/g, '').trim() || 'This applicant';
    const kind = this.isDriverAccount(user) ? 'driver' : 'passenger';
    const message = decision === 'approved'
      ? `${action} ${name}'s ${kind} account? They will be able to sign in.`
      : `${action} ${name}'s ${kind} account? The account stays on file and cannot sign in.`;
    return this.alerts.create({
      header: `${action} account`,
      message,
      backdropDismiss: false,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        { text: action, role: 'confirm' },
      ],
    }).then(async (alert) => {
      await alert.present();
      const { role } = await alert.onDidDismiss();
      if (role !== 'confirm') {
        this.reviewingAccountId = null;
        return;
      }
      this.applyAccountDecision(user.id, decision, name);
      if (!this.auth.cloudAuthEnabled) {
        this.reviewingAccountId = null;
      }
    }).catch(() => {
      this.reviewingAccountId = null;
      this.showNotice('Unable to open the confirmation.');
    });
  }

  private applyAccountDecision(id: string, decision: 'approved' | 'rejected', name: string): void {
    if (this.auth.cloudAuthEnabled) {
      void this.applyCloudAccountDecision(id, decision, name);
      return;
    }
    try {
      if (decision === 'approved') {
        this.auth.acceptAccount(id);
      } else {
        this.auth.declineAccount(id);
      }
      this.refreshAccounts();
      this.accountFilter = decision;
      this.showNotice(
        decision === 'approved'
          ? `${name} is approved and can sign in.`
          : `${name} was rejected. The account is still saved.`,
        decision === 'approved' ? 'Account approved' : 'Account rejected',
      );
    } catch (error: unknown) {
      this.refreshAccounts();
      this.showNotice(error instanceof Error ? error.message : 'Unable to update this account.');
    }
  }

  private async applyCloudAccountDecision(
    id: string,
    decision: 'approved' | 'rejected',
    name: string,
  ): Promise<void> {
    try {
      await this.auth.reviewCloudAccount(id, decision);
      await this.loadCloudAccounts();
      this.accountFilter = decision;
      this.showNotice(
        decision === 'approved'
          ? `${name} is approved and can sign in.`
          : `${name} was rejected. The account is still saved.`,
        decision === 'approved' ? 'Account approved' : 'Account rejected',
      );
    } catch (error: unknown) {
      this.showNotice(error instanceof Error ? error.message : 'Unable to update this account.');
    } finally {
      this.reviewingAccountId = null;
      this.changes.detectChanges();
    }
  }

  private refreshAccounts(): void {
    if (!this.auth.cloudAuthEnabled) {
      this.accountsLoading = false;
      this.accountsError = '';
      this.managedAccounts = this.auth.listManagedAccounts();
      return;
    }
    void this.loadCloudAccounts();
  }

  private async loadCloudAccounts(): Promise<void> {
    this.accountsLoading = true;
    this.accountsError = '';
    this.changes.detectChanges();
    try {
      const accounts = await this.auth.listCloudAccounts();
      this.managedAccounts = accounts.map((account) => this.cloudAccountAsLocal(account));
    } catch (error: unknown) {
      this.managedAccounts = [];
      this.accountsError = error instanceof Error ? error.message : 'Accounts could not be loaded.';
    } finally {
      this.accountsLoading = false;
      this.changes.detectChanges();
    }
  }

  private cloudAccountAsLocal(account: CloudManagedAccount): LocalCareRideUser {
    return {
      id: account.id,
      accountType: account.role,
      fullName: account.fullName,
      email: account.email,
      phone: account.phone,
      address: account.address,
      password: '',
      createdAt: account.createdAt,
      approvalStatus: account.accountStatus,
      licenseNumber: account.licenseNumber,
      vehicleType: account.vehicleType,
      plateNumber: account.plateNumber,
      wheelchairAccessible: account.wheelchairAccessible,
      seniorAssistance: account.seniorAssistance,
    };
  }

  assignDriver(ride: LocalRide): void {
    if (!this.canAssign(ride)) {
      this.showNotice('This ride cannot be assigned at its current status.');
      return;
    }
    void this.openAssignDialog(ride);
  }

  openAvailableDrivers(): void {
    if (this.ridesApi.cloudBookings) {
      void this.openCloudDriverList();
      return;
    }
    this.dialog = {
      kind: 'drivers',
      title: 'Available drivers',
      confirmLabel: 'Done',
      drivers: this.localRides.getAvailableDrivers(),
    };
  }

  selectAssignmentDriver(driver: LocalDriverOption): void {
    if (!this.dialog || this.dialog.kind !== 'assign') {
      return;
    }
    this.dialog.driverId = driver.driverId;
    this.dialog.driverName = driver.driverName;
    this.dialog.driverPhone = driver.driverPhone;
    this.dialog.vehicleLabel = driver.vehicleLabel;
    this.dialog.driverRating = driver.rating;
  }

  driverActiveRide(driver: LocalDriverOption): LocalRide | null {
    return this.localRides.getDriverActiveRide(driver.driverId);
  }

  openDriverProfile(driver: LocalDriverOption): void {
    this.dialog = {
      kind: 'driver-profile',
      title: driver.driverName,
      confirmLabel: 'Done',
      driverId: driver.driverId,
      driverName: driver.driverName,
      driverPhone: driver.driverPhone,
      vehicleLabel: driver.vehicleLabel,
      driverRating: driver.rating,
      ride: this.driverActiveRide(driver) ?? undefined,
      reviews: this.localRides.getDriverClientReviews(driver.driverId),
    };
  }

  callDriverPhone(phone: string | null | undefined): void {
    const value = phone?.trim();
    if (!value) {
      this.showNotice('No driver phone number is stored.');
      return;
    }
    window.location.href = `tel:${value}`;
  }

  openDriverMapFor(driver: LocalDriverOption): void {
    const ride = this.driverActiveRide(driver);
    if (!ride) {
      this.showNotice(`${driver.driverName} has no active trip to track yet.`);
      return;
    }
    this.openDriverLocation(ride);
  }

  ratingLabel(rating: number | null | undefined, count?: number): string {
    if (rating === null || rating === undefined) {
      return '';
    }
    return this.localRides.ratingLabel(rating, count);
  }

  cancelRide(ride: LocalRide): void {
    if (!this.localRides.canCancel(ride)) {
      this.showNotice('This ride can no longer be cancelled at its current stage.');
      return;
    }
    this.dialog = {
      kind: 'cancel',
      title: 'Cancel this ride?',
      confirmLabel: 'Cancel ride',
      ride,
    };
  }

  rejectRide(ride: LocalRide): void {
    if (!this.canAssign(ride)) {
      this.showNotice('This request can no longer be rejected.');
      return;
    }
    this.dialog = {
      kind: 'reject',
      title: 'Reject this request?',
      confirmLabel: 'Reject request',
      ride,
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
    if (this.dialog.kind === 'notice' || this.dialog.kind === 'drivers' || this.dialog.kind === 'driver-profile') {
      this.dialog = null;
      return;
    }
    if (this.dialog.kind === 'assign') {
      void this.completeAssign();
      return;
    }
    if (this.dialog.kind === 'cancel' && this.dialog.ride) {
      void this.completeCancel(this.dialog.ride);
      return;
    }
    if (this.dialog.kind === 'reject' && this.dialog.ride) {
      void this.completeReject(this.dialog.ride);
    }
  }

  private showNotice(message: string, title = 'CareRide'): void {
    this.dialog = { kind: 'notice', title, message, confirmLabel: 'OK' };
  }

  private async openCloudDriverList(): Promise<void> {
    try {
      const drivers = (await this.ridesApi.listAvailableDrivers()).map((driver) => this.cloudDriverOption(driver));
      this.dialog = {
        kind: 'drivers',
        title: 'Available drivers',
        confirmLabel: 'Done',
        drivers,
      };
    } catch (error: unknown) {
      this.showNotice(error instanceof Error ? error.message : 'Available drivers could not be loaded.');
    }
  }

  private cloudDriverOption(driver: Awaited<ReturnType<RideService['listAvailableDrivers']>>[number]): LocalDriverOption {
    return {
      driverId: driver.id,
      driverName: driver.name,
      driverPhone: driver.phone,
      vehicleId: driver.id,
      vehicleLabel: driver.vehicleLabel,
      rating: driver.rating ?? 0,
      ratingCount: driver.ratingCount,
      available: driver.availability === 'available',
    };
  }

  private async openAssignDialog(ride: LocalRide): Promise<void> {
    if (this.ridesApi.cloudBookings) {
      try {
        const drivers = (await this.ridesApi.listAvailableDrivers()).map((driver) => this.cloudDriverOption(driver));
        const preferred = drivers.find((driver) => driver.driverId === ride.preferredDriverId) ?? null;
        this.dialog = {
          kind: 'assign',
          title: 'Assign driver',
          confirmLabel: 'Assign driver',
          ride,
          cloudChoices: drivers,
          driverId: preferred?.driverId,
          driverName: preferred?.driverName ?? ride.preferredDriverName ?? undefined,
          driverPhone: preferred?.driverPhone,
          vehicleLabel: preferred?.vehicleLabel ?? ride.preferredVehicleLabel ?? undefined,
          driverRating: preferred?.rating ?? ride.preferredDriverRating ?? undefined,
        };
      } catch (error: unknown) {
        this.showNotice(error instanceof Error ? error.message : 'Available drivers could not be loaded.');
      }
      return;
    }
    if (!ride.preferredDriverId && !ride.preferredDriverName) {
      this.showNotice('This passenger did not select a driver. They need to request again and choose an available driver.');
      return;
    }

    const rosterDriver = this.localRides.findDriver(ride.preferredDriverId, ride.date, ride.time);
    this.dialog = {
      kind: 'assign',
      title: 'Accept request',
      confirmLabel: 'Accept request',
      ride,
      driverId: ride.preferredDriverId || rosterDriver?.driverId,
      driverName: ride.preferredDriverName || rosterDriver?.driverName,
      driverPhone: ride.preferredDriverPhone || rosterDriver?.driverPhone,
      vehicleId: rosterDriver?.vehicleId,
      vehicleLabel: ride.preferredVehicleLabel || rosterDriver?.vehicleLabel,
      driverRating: ride.preferredDriverRating ?? rosterDriver?.rating,
    };
  }

  private async completeAssign(): Promise<void> {
    const dialog = this.dialog;
    if (!dialog?.ride || dialog.kind !== 'assign') {
      return;
    }
    dialog.busy = true;
    try {
      if (this.ridesApi.cloudBookings) {
        if (!dialog.driverId) {
          this.showNotice('Choose a Supabase driver profile before assigning.');
          return;
        }
        const assigned = await this.ridesApi.assignBooking(dialog.ride.id, dialog.driverId);
        this.localRides.saveRide(assigned);
        await this.fetchRides();
        this.dialog = null;
        void this.router.navigateByUrl('/admin/accepted');
        return;
      }
      const updated = this.localRides.updateRide(dialog.ride.id, {
        status: 'Driver Assigned',
        driverId: dialog.driverId ?? null,
        driverName: dialog.driverName ?? null,
        driverPhone: dialog.driverPhone ?? null,
        vehicleLabel: dialog.vehicleLabel ?? null,
        driverRating: dialog.driverRating ?? dialog.ride.preferredDriverRating ?? null,
      });
      if (!updated && !this.ridesApi.configured) {
        this.showNotice('Unable to assign the ride.');
        return;
      }
      await this.fetchRides();
      this.dialog = null;
      void this.router.navigateByUrl('/admin/accepted');
    } catch (error: unknown) {
      this.showNotice(error instanceof Error ? error.message : 'Unable to assign the ride.');
    }
  }

  private async completeCancel(ride: LocalRide): Promise<void> {
    if (this.dialog) {
      this.dialog.busy = true;
    }
    try {
      const cancelled = await this.ridesApi.cancelRide(ride.id);
      if (!cancelled) {
        this.showNotice('Unable to cancel the ride.');
        return;
      }
      this.applyRides();
      this.showNotice('Ride cancelled successfully.', 'Cancelled');
    } catch (error: unknown) {
      this.showNotice(error instanceof Error ? error.message : 'Unable to cancel the ride.');
    }
  }

  private async completeReject(ride: LocalRide): Promise<void> {
    if (this.dialog) {
      this.dialog.busy = true;
    }
    try {
      const rejected = await this.ridesApi.rejectRide(ride.id);
      if (!rejected) {
        this.showNotice('Unable to reject the ride.');
        return;
      }
      this.applyRides();
      this.showNotice('Ride request rejected. It will appear in History.', 'Rejected');
    } catch (error: unknown) {
      this.showNotice(error instanceof Error ? error.message : 'Unable to reject the ride.');
    }
  }

  viewRide(ride: LocalRide): void {
    void this.router.navigate(['/ride-details', ride.id], { state: { ride } });
  }

  signOut(): void {
    void this.auth.signOut().then(() => this.router.navigate(['/login']));
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

  trackRide(_index: number, ride: LocalRide): string {
    return ride.id;
  }

  private clockStamp = '';

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
    this.clockWeekday = now.toLocaleDateString(undefined, { weekday: 'long' });
    this.clockDate = now.toLocaleDateString(undefined, {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
    const hour = now.getHours();
    const minute = String(now.getMinutes()).padStart(2, '0');
    const hour12 = hour % 12 || 12;
    this.clockTime = `${hour12}:${minute} ${hour >= 12 ? 'PM' : 'AM'}`;
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
    try {
      this.localRides.reloadFromStorage();
      await this.ridesApi.hydrateFromCloud();
    } catch {
      this.localRides.reloadFromStorage();
    } finally {
      this.applyRides();
      this.fetching = false;
    }
  }

  private applyRides(): void {
    this.rides = this.localRides.getRides();
  }
}
