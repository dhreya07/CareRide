import { Injectable } from '@angular/core';
import { environment } from '../../../environments/environment';
import { AccountRole, homePathForRole, normalizeAccountRole } from '../models/care-ride.models';
import { ProfileService } from './profile.service';
import { SupabaseService } from './supabase.service';
import {
  CloudAccountProfile,
  CloudManagedAccount,
  PendingRegistrationResult,
  dashboardAccessAllowed,
  SupabaseAuthAdapter,
} from './supabase-auth.adapter';
import {
  clearRecoveryAddress,
  establishPasswordRecovery,
  passwordRecoveryRedirectUrl,
  readRecoveryLink,
  requestPasswordRecovery,
  updatePasswordFromRecovery,
} from './password-recovery';

const LOCAL_USERS_KEY = 'careride_users';
const LOCAL_SESSION_KEY = 'careride_logged_in';
const LOCAL_ROLE_KEY = 'careride_user_type';
const LOCAL_NAME_KEY = 'careride_user_name';
const LOCAL_EMAIL_KEY = 'careride_user_email';

export type AccountApproval = 'pending' | 'approved' | 'declined';
export type DriverAvailability = 'available' | 'busy' | 'offline';

export interface DriverRegistrationDetails {
  licenseNumber: string;
  vehicleType: string;
  plateNumber: string;
  wheelchairAccessible: boolean;
  seniorAssistance: boolean;
}

export interface LocalCareRideUser {
  id: string;
  accountType: string;
  fullName: string;
  email: string;
  phone: string;
  address: string;
  password: string;
  createdAt: string;
  bookingIntent?: 'self' | 'family';
  accountStatus?: AccountApproval;
  approvalStatus?: 'pending' | 'approved' | 'rejected';
  licenseNumber?: string;
  vehicleType?: string;
  plateNumber?: string;
  wheelchairAccessible?: boolean;
  seniorAssistance?: boolean;
  availability?: DriverAvailability;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  constructor(
    private supabase: SupabaseService,
    private profiles: ProfileService,
    private cloudAuth: SupabaseAuthAdapter,
  ) {
    this.ensureLocalDemoAccounts();
  }

  /** True only for the older cloudMigration client. Booking still uses this. */
  get configured(): boolean {
    return this.supabase.configured;
  }

  /** Separate from cloudMigration. Stays false until Supabase sign-in is turned on. */
  get cloudAuthEnabled(): boolean {
    return environment.supabase.cloudAuthEnabled === true;
  }

  async signIn(email: string, password: string): Promise<AccountRole> {
    if (this.cloudAuthEnabled) {
      return this.signInWithCloudAuth(email, password);
    }
    if (this.configured) {
      const client = this.requireClient();
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw new Error(error.message);
      const role = await this.refreshCloudRole();
      return role;
    }

    const users = this.getLocalUsers();
    const emailValue = email.trim().toLowerCase();
    const match = users.find(
      (user) => user.email.toLowerCase() === emailValue && (user.password || '').trim() === password,
    );
    if (!match) {
      throw new Error('Incorrect email or password. Create an account first if you are new to CareRide.');
    }
    const role = normalizeAccountRole(match.accountType);
    if (role !== 'admin') {
      const approval = this.accountStatusOf(match);
      if (approval === 'pending') {
        throw new Error('Account Under Review. An admin must approve this account before you can sign in.');
      }
      if (approval === 'declined') {
        throw new Error('Account Registration Rejected. This account cannot sign in.');
      }
    }
    this.writeLocalSession(role, match.fullName, match.email);
    try {
      this.profiles.hydrateFromAccount({
        email: match.email,
        name: match.fullName,
        phone: match.phone,
        address: match.address,
        passengerType: match.bookingIntent === 'family' ? 'Family member' : undefined,
      });
    } catch {
      // A missing profile field must not block sign-in.
    }
    return role;
  }

  async register(
    email: string,
    password: string,
    fullName: string,
    phone: string,
    bookingIntent: 'self' | 'family',
    address = '',
    accountType: 'passenger' | 'driver' = 'passenger',
    driverDetails?: DriverRegistrationDetails,
  ): Promise<PendingRegistrationResult | void> {
    const role: 'passenger' | 'driver' = accountType === 'driver' ? 'driver' : 'passenger';
    if (this.cloudAuthEnabled) {
      return this.registerWithCloudAuth(
        email,
        password,
        fullName,
        phone,
        bookingIntent,
        address,
        role,
        driverDetails,
      );
    }
    if (this.configured) {
      if (role === 'driver') {
        throw new Error('Driver registration stays on this device until Supabase is connected.');
      }
      const client = this.requireClient();
      const { error } = await client.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName,
            phone,
            address,
            booking_intent: bookingIntent,
          },
        },
      });
      if (error) throw new Error(error.message);
      return;
    }

    const users = this.getLocalUsers();
    const emailValue = email.trim().toLowerCase();
    const cleanedPhone = phone.replace(/[\s()-]/g, '');
    const exists = users.some(
      (user) =>
        user.email.toLowerCase() === emailValue ||
        user.phone.replace(/[\s()-]/g, '') === cleanedPhone,
    );
    if (exists) {
      throw new Error('An account with this email or phone number already exists.');
    }
    if (role === 'driver' && !this.driverDetailsReady(driverDetails)) {
      throw new Error('Driver license, vehicle type, and plate number are required.');
    }

    users.push({
      id: `CR-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
      accountType: role,
      bookingIntent: role === 'driver' ? undefined : bookingIntent,
      fullName,
      email: emailValue,
      phone,
      address,
      password,
      accountStatus: 'pending',
      createdAt: new Date().toISOString(),
      ...(role === 'driver' && driverDetails
        ? {
            approvalStatus: 'pending' as const,
            licenseNumber: driverDetails.licenseNumber.trim(),
            vehicleType: driverDetails.vehicleType.trim(),
            plateNumber: driverDetails.plateNumber.trim().toUpperCase(),
            wheelchairAccessible: driverDetails.wheelchairAccessible,
            seniorAssistance: driverDetails.seniorAssistance,
          }
        : {}),
    });
    localStorage.setItem(LOCAL_USERS_KEY, JSON.stringify(users));
    localStorage.setItem('careride_last_registered_email', emailValue);
    this.profiles.hydrateFromAccount({
      email: emailValue,
      name: fullName,
      phone,
      address,
      passengerType: role === 'driver'
        ? undefined
        : bookingIntent === 'family' ? 'Family member' : 'Prefer not to say',
    });
  }

  async signOut(): Promise<void> {
    if (this.cloudAuthEnabled) {
      await this.cloudAuth.signOut();
      this.clearLocalSession();
      return;
    }
    this.clearLocalSession();
    if (!this.supabase.client) {
      return;
    }
    const { error } = await this.supabase.client.auth.signOut();
    if (error) throw new Error(error.message);
  }

  async sendPasswordReset(email: string): Promise<void> {
    if (!this.cloudAuthEnabled) {
      throw new Error('Password recovery is available after Supabase authentication is connected.');
    }
    await requestPasswordRecovery(email, window.location.origin);
  }

  recoveryRedirectUrl(origin = window.location.origin): string {
    return passwordRecoveryRedirectUrl(origin);
  }

  /**
   * Reads a recovery redirect without logging the URL.
   * A password can be saved only after this returns ready.
   */
  async openPasswordRecovery(href: string): Promise<'expired' | 'ready' | 'missing' | 'disabled'> {
    const link = readRecoveryLink(href);
    clearRecoveryAddress();
    if (link.kind === 'expired') {
      return 'expired';
    }
    if (link.kind === 'missing') {
      return 'missing';
    }
    await establishPasswordRecovery(link);
    return 'ready';
  }

  async updateRecoveredPassword(password: string): Promise<void> {
    await updatePasswordFromRecovery(password);
  }

  async isSignedIn(): Promise<boolean> {
    if (this.cloudAuthEnabled) {
      return dashboardAccessAllowed(await this.cloudAuth.readOwnProfile());
    }
    if (!this.supabase.client) {
      return this.readLocalSessionAccount() !== null;
    }
    const { data, error } = await this.supabase.client.auth.getSession();
    if (error) return false;
    return Boolean(data.session);
  }

  async getCurrentRole(): Promise<AccountRole | null> {
    if (this.cloudAuthEnabled) {
      return this.approvedCloudRole();
    }
    if (this.supabase.client) {
      if (!(await this.isSignedIn())) {
        return null;
      }
      return this.refreshCloudRole();
    }
    const user = this.readLocalSessionAccount();
    return user ? normalizeAccountRole(user.accountType) : null;
  }

  async homePath(): Promise<string> {
    const role = await this.getCurrentRole();
    return role ? homePathForRole(role) : '/login';
  }

  async hasAccess(roles?: readonly AccountRole[]): Promise<boolean> {
    if (this.cloudAuthEnabled) {
      return dashboardAccessAllowed(await this.cloudAuth.readOwnProfile(), roles);
    }
    if (!(await this.isSignedIn())) {
      return false;
    }
    if (!roles?.length) {
      return true;
    }
    const role = await this.getCurrentRole();
    return Boolean(role && roles.includes(role));
  }

  getLocalDisplayName(): string {
    return localStorage.getItem(LOCAL_NAME_KEY) || 'Passenger';
  }

  getLocalEmail(): string {
    return localStorage.getItem(LOCAL_EMAIL_KEY) || '';
  }

  readAvailability(user: LocalCareRideUser): DriverAvailability | 'unknown' {
    if (user.availability === 'available' || user.availability === 'busy' || user.availability === 'offline') {
      return user.availability;
    }
    return 'unknown';
  }

  setMyAvailability(status: DriverAvailability): void {
    if (status !== 'available' && status !== 'busy' && status !== 'offline') {
      throw new Error('Choose Available, Busy, or Offline.');
    }
    const signedIn = localStorage.getItem(LOCAL_SESSION_KEY) === 'true';
    const role = normalizeAccountRole(localStorage.getItem(LOCAL_ROLE_KEY));
    if (!signedIn || role !== 'driver') {
      throw new Error('Only the signed-in driver can update availability.');
    }
    const email = this.getLocalEmail().trim().toLowerCase();
    const users = this.getLocalUsers();
    const match = users.find((user) => user.email.toLowerCase() === email);
    if (!match || normalizeAccountRole(match.accountType) !== 'driver' || match.id !== this.getLocalAccount()?.id) {
      throw new Error('Only the signed-in driver can update availability.');
    }
    match.availability = status;
    localStorage.setItem(LOCAL_USERS_KEY, JSON.stringify(users));
  }

  accountStatusOf(user: LocalCareRideUser): AccountApproval {
    if (user.approvalStatus === 'rejected') {
      return 'declined';
    }
    if (user.approvalStatus === 'approved' || user.approvalStatus === 'pending') {
      return user.approvalStatus;
    }
    const status = user.accountStatus;
    if (status === 'pending' || status === 'declined' || status === 'approved') {
      return status;
    }
    return 'approved';
  }

  private driverDetailsReady(details: DriverRegistrationDetails | undefined): details is DriverRegistrationDetails {
    return Boolean(
      details &&
      details.licenseNumber.trim() &&
      details.vehicleType.trim() &&
      details.plateNumber.trim(),
    );
  }

  listPendingAccounts(): LocalCareRideUser[] {
    return this.listManagedAccounts().filter((user) => this.accountStatusOf(user) === 'pending');
  }

  listManagedAccounts(): LocalCareRideUser[] {
    return this.getLocalUsers()
      .filter((user) => normalizeAccountRole(user.accountType) !== 'admin')
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  listApprovedDrivers(): LocalCareRideUser[] {
    return this.getLocalUsers().filter(
      (user) =>
        normalizeAccountRole(user.accountType) === 'driver' &&
        this.accountStatusOf(user) === 'approved',
    );
  }

  acceptAccount(id: string): void {
    this.applyAccountDecision(id, 'approved');
  }

  declineAccount(id: string): void {
    this.applyAccountDecision(id, 'rejected');
  }

  getLocalAccount(): LocalCareRideUser | null {
    const users = this.getLocalUsers();
    const email = this.getLocalEmail();
    if (email) {
      return users.find((user) => user.email.toLowerCase() === email) || null;
    }
    const name = localStorage.getItem(LOCAL_NAME_KEY);
    if (!name) {
      return null;
    }
    return users.find((user) => user.fullName === name && user.accountType === 'passenger') || null;
  }

  /**
   * Profile loaded through the adapter. Null while cloud auth is off.
   * Pending and rejected rows are returned so the status can be shown,
   * and hasAccess still refuses them.
   */
  async currentCloudProfile(): Promise<CloudAccountProfile | null> {
    if (!this.cloudAuthEnabled) {
      return null;
    }
    return this.cloudAuth.readOwnProfile();
  }

  /** Admin review through public.review_account. Local approval is unchanged while cloud auth is off. */
  async reviewCloudAccount(userId: string, decision: 'approved' | 'rejected'): Promise<void> {
    if (!this.cloudAuthEnabled) {
      throw new Error('Cloud account review is not enabled.');
    }
    await this.cloudAuth.reviewAccount(userId, decision);
  }

  /**
   * Cloud passenger and driver accounts. Empty while cloud auth is off,
   * so the local Admin Accounts list stays in localStorage.
   */
  async listCloudAccounts(): Promise<CloudManagedAccount[]> {
    if (!this.cloudAuthEnabled) {
      return [];
    }
    return this.cloudAuth.listManagedAccounts();
  }

  private async signInWithCloudAuth(email: string, password: string): Promise<AccountRole> {
    const profile = await this.cloudAuth.signIn(email, password);
    const role = this.cloudRole(profile);
    if (!role) {
      await this.cloudAuth.signOut();
      throw new Error('No CareRide profile is linked to this account.');
    }
    this.writeLocalSession(role, profile.fullName, profile.email);
    try {
      this.profiles.hydrateFromAccount({
        email: profile.email,
        name: profile.fullName,
        phone: profile.phone,
        address: profile.address,
        passengerType: profile.bookingIntent === 'family' ? 'Family member' : undefined,
      });
    } catch {
      // A missing profile field must not block sign-in.
    }
    return role;
  }

  private async registerWithCloudAuth(
    email: string,
    password: string,
    fullName: string,
    phone: string,
    bookingIntent: 'self' | 'family',
    address: string,
    role: 'passenger' | 'driver',
    driverDetails?: DriverRegistrationDetails,
  ): Promise<PendingRegistrationResult> {
    if (role === 'driver') {
      return this.cloudAuth.registerDriver({
        email,
        password,
        fullName,
        phone,
        address,
        licenseNumber: driverDetails?.licenseNumber ?? '',
        vehicleType: driverDetails?.vehicleType ?? '',
        plateNumber: driverDetails?.plateNumber ?? '',
        wheelchairAccessible: driverDetails?.wheelchairAccessible,
        seniorAssistance: driverDetails?.seniorAssistance,
      });
    }
    return this.cloudAuth.registerPassenger({
      email,
      password,
      fullName,
      phone,
      address,
      bookingIntent,
    });
  }

  private async approvedCloudRole(): Promise<AccountRole | null> {
    const profile = await this.cloudAuth.readOwnProfile();
    if (!dashboardAccessAllowed(profile)) {
      return null;
    }
    return this.cloudRole(profile);
  }

  /** Uses the profile column only. An unknown value is not treated as passenger. */
  private cloudRole(profile: CloudAccountProfile | null): AccountRole | null {
    if (!profile || !dashboardAccessAllowed(profile)) {
      return null;
    }
    return profile.role === 'passenger' || profile.role === 'driver' || profile.role === 'admin'
      ? profile.role
      : null;
  }

  private async refreshCloudRole(): Promise<AccountRole> {
    const client = this.requireClient();
    const { data: userData, error: userError } = await client.auth.getUser();
    if (userError || !userData.user) {
      throw new Error('Sign in before continuing.');
    }
    const { data, error } = await client
      .from('profiles')
      .select('role, full_name, phone')
      .eq('id', userData.user.id)
      .maybeSingle();
    if (error) {
      throw new Error(error.message);
    }
    const role = normalizeAccountRole(data?.role as string | undefined);
    const fullName = (data?.full_name as string) || '';
    const email = userData.user.email || '';
    this.writeLocalSession(role, fullName, email);
    const meta = userData.user.user_metadata as Record<string, unknown> | undefined;
    this.profiles.hydrateFromAccount({
      email,
      name: fullName || String(meta?.['full_name'] || ''),
      phone: (data?.phone as string) || String(meta?.['phone'] || ''),
      address: String(meta?.['address'] || ''),
      passengerType: meta?.['booking_intent'] === 'family' ? 'Family member' : undefined,
    });
    return role;
  }

  private writeLocalSession(role: AccountRole, fullName: string, email = ''): void {
    localStorage.setItem(LOCAL_SESSION_KEY, 'true');
    localStorage.setItem(LOCAL_ROLE_KEY, role);
    if (fullName) {
      localStorage.setItem(LOCAL_NAME_KEY, fullName);
    }
    if (email) {
      localStorage.setItem(LOCAL_EMAIL_KEY, email.trim().toLowerCase());
    }
  }

  private clearLocalSession(): void {
    localStorage.removeItem(LOCAL_SESSION_KEY);
    localStorage.removeItem(LOCAL_ROLE_KEY);
    localStorage.removeItem(LOCAL_EMAIL_KEY);
    localStorage.removeItem('careride.mock.session');
  }

  private readLocalSessionAccount(): LocalCareRideUser | null {
    if (localStorage.getItem(LOCAL_SESSION_KEY) !== 'true') {
      return null;
    }
    const email = (localStorage.getItem(LOCAL_EMAIL_KEY) || '').trim().toLowerCase();
    const user = email
      ? this.getLocalUsers().find((item) => item.email.toLowerCase() === email) ?? null
      : null;
    if (!user) {
      this.clearLocalSession();
      return null;
    }
    const role = normalizeAccountRole(user.accountType);
    if (role !== 'admin' && this.accountStatusOf(user) !== 'approved') {
      this.clearLocalSession();
      return null;
    }
    if (localStorage.getItem(LOCAL_ROLE_KEY) !== role) {
      localStorage.setItem(LOCAL_ROLE_KEY, role);
    }
    return user;
  }

  private ensureLocalDemoAccounts(): void {
    if (this.cloudAuthEnabled || this.configured) {
      return;
    }
    const users = this.getLocalUsers();
    const demos: LocalCareRideUser[] = [
      {
        id: 'CR-DEMO-ADMIN',
        accountType: 'admin',
        fullName: 'CareRide Admin',
        email: 'admin@careride.local',
        phone: '09170000001',
        address: '',
        password: 'CareRideAdmin1',
        accountStatus: 'approved',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'CR-DEMO-DRIVER',
        accountType: 'driver',
        fullName: 'CareRide Driver',
        email: 'driver@careride.local',
        phone: '09170000002',
        address: '',
        password: 'CareRideDriver1',
        accountStatus: 'approved',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ];
    let changed = false;
    for (const demo of demos) {
      const existing = users.find((user) => user.email === demo.email);
      if (!existing) {
        users.push(demo);
        changed = true;
      }
    }
    if (changed) {
      localStorage.setItem(LOCAL_USERS_KEY, JSON.stringify(users));
    }
  }

  private applyAccountDecision(id: string, decision: 'approved' | 'rejected'): void {
    const signedIn = localStorage.getItem(LOCAL_SESSION_KEY) === 'true';
    const role = normalizeAccountRole(localStorage.getItem(LOCAL_ROLE_KEY));
    if (!signedIn || role !== 'admin') {
      throw new Error('Only an admin can approve or reject accounts.');
    }
    const users = this.getLocalUsers();
    const match = users.find((user) => user.id === id);
    if (!match || normalizeAccountRole(match.accountType) === 'admin') {
      throw new Error('That account cannot be updated.');
    }
    if (this.accountStatusOf(match) !== 'pending') {
      throw new Error('This account has already been approved or rejected.');
    }
    match.approvalStatus = decision;
    match.accountStatus = decision === 'approved' ? 'approved' : 'declined';
    localStorage.setItem(LOCAL_USERS_KEY, JSON.stringify(users));
  }

  private getLocalUsers(): LocalCareRideUser[] {
    try {
      const raw = localStorage.getItem(LOCAL_USERS_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as LocalCareRideUser[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private requireClient() {
    if (!this.supabase.client) {
      throw new Error(
        'Supabase authentication is not configured. Add the project URL and anon key to environment configuration.',
      );
    }
    return this.supabase.client;
  }
}
