
import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { SupabaseClient } from '@supabase/supabase-js';
import { createRegistrationClient, getSharedSupabaseClient, peekSharedSupabaseClient } from './supabase-client';
import { environment } from '../../../environments/environment';
import { STAGING_SIGNUP_CALLBACK } from './signup-confirmation-callback';
import type { DriverAccessibilityCapability } from '../models/care-ride.models';
import { normalizeDriverAccessibilityCapabilities } from '../models/driver-accessibility-capabilities';

export type CloudAccountRole = 'passenger' | 'driver' | 'admin';
export type CloudAccountStatus = 'pending' | 'approved' | 'rejected';

export interface CloudAccountProfile {
  id: string;
  role: CloudAccountRole;
  accountStatus: CloudAccountStatus;
  fullName: string;
  email: string;
  phone: string;
  address: string;
  bookingIntent?: 'self' | 'family';
  passengerType?: 'elderly' | 'pwd' | 'other';
  assistance?: string[];
  otherNeeds?: string;
  emergencyName?: string;
  emergencyPhone?: string;
  licenseNumber?: string;
  vehicleType?: string;
  plateNumber?: string;
  wheelchairAccessible?: boolean;
  seniorAssistance?: boolean;
  availability?: 'available' | 'busy' | 'offline';
}

export interface PassengerRegistrationInput {
  email: string;
  password: string;
  fullName: string;
  phone: string;
  address?: string;
  bookingIntent?: 'self' | 'family';
  passengerType?: 'elderly' | 'pwd' | 'other';
  assistance?: string[];
  otherNeeds?: string;
  emergencyName?: string;
  emergencyPhone?: string;
}

export interface DriverRegistrationInput {
  email: string;
  password: string;
  fullName: string;
  phone: string;
  address?: string;
  licenseNumber: string;
  vehicleType: string;
  plateNumber: string;
  wheelchairAccessible?: boolean;
  seniorAssistance?: boolean;
  licenseExpirationDate?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  vehicleBodyType?: string;
  vehicleBrand?: string;
  vehicleModel?: string;
  vehicleVariant?: string;
  vehicleModelYear?: number;
  vehicleColor?: string;
  /** Passenger seats only; excludes the driver. */
  passengerSeatingCapacity?: number;
  driverDeclaredAccessibility?: DriverAccessibilityCapability[];
}

export interface PendingRegistrationResult {
  accountStatus: 'pending';
  emailConfirmationRequired: boolean;
}

/** A passenger or driver row an approved admin can review. Email confirmation is separate. */
export interface CloudManagedAccount {
  id: string;
  role: 'passenger' | 'driver';
  accountStatus: CloudAccountStatus;
  fullName: string;
  email: string;
  phone: string;
  address: string;
  createdAt: string;
  licenseNumber?: string;
  vehicleType?: string;
  plateNumber?: string;
  wheelchairAccessible?: boolean;
  seniorAssistance?: boolean;
  licenseExpirationDate?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  vehicleBodyType?: string;
  vehicleBrand?: string;
  vehicleModel?: string;
  vehicleVariant?: string;
  vehicleModelYear?: number;
  vehicleColor?: string;
  passengerSeatingCapacity?: number;
  verifiedPassengerSeatingCapacity?: number;
  capacityVerificationStatus?: DriverVerificationStatus;
  driverDeclaredAccessibility?: DriverAccessibilityCapability[];
  adminVerifiedAccessibility?: DriverAccessibilityCapability[];
  accessibilityVerificationStatus?: DriverVerificationStatus;
}

export type DriverVerificationStatus = 'unverified' | 'in_review' | 'verified' | 'rejected';

/** Maps V3 columns when supplied by a future migrated read, without querying them now. */
export function mapDriverV3ReadOnlyFields(row: Record<string, unknown>): Partial<CloudManagedAccount> {
  const text = (key: string): string | undefined => {
    const value = row[key];
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  };

  const integer = (key: string): number | undefined => {
    const value = row[key];
    return typeof value === 'number' && Number.isInteger(value) ? value : undefined;
  };

  const stringArray = (key: string): DriverAccessibilityCapability[] | undefined => {
    const value = row[key];
    if (value === undefined || value === null) return undefined;
    if (!Array.isArray(value) || !value.every((item): item is string => typeof item === 'string')) {
      throw new Error(`Invalid driver accessibility data in ${key}`);
    }
    return normalizeDriverAccessibilityCapabilities(value);
  };

  const status = (key: string): DriverVerificationStatus | undefined => {
    const value = row[key];
    return value === 'unverified' || value === 'in_review' || value === 'verified' || value === 'rejected'
      ? value
      : undefined;
  };

  return {
    licenseExpirationDate: text('license_expiration_date'),
    emergencyContactName: text('emergency_contact_name'),
    emergencyContactPhone: text('emergency_contact_phone'),
    vehicleBodyType: text('vehicle_body_type'),
    vehicleBrand: text('vehicle_brand'),
    vehicleModel: text('vehicle_model'),
    vehicleVariant: text('vehicle_variant'),
    vehicleModelYear: integer('vehicle_model_year'),
    vehicleColor: text('vehicle_color'),
    passengerSeatingCapacity: integer('passenger_seating_capacity'),
    verifiedPassengerSeatingCapacity: integer('verified_passenger_seating_capacity'),
    capacityVerificationStatus: status('capacity_verification_status'),
    driverDeclaredAccessibility: stringArray('driver_declared_accessibility'),
    adminVerifiedAccessibility: stringArray('admin_verified_accessibility'),
    accessibilityVerificationStatus: status('accessibility_verification_status'),
  };
}

export function filterCloudAccounts(
  accounts: readonly CloudManagedAccount[],
  group: 'passenger' | 'driver',
  status: CloudAccountStatus,
): CloudManagedAccount[] {
  return accounts.filter(
    (account) => account.role === group && account.accountStatus === status,
  );
}

/**
 * Approved profiles may open a dashboard. A Supabase session is not enough:
 * pending and rejected rows stay out, and the role is the profiles.role value.
 */
export function dashboardAccessAllowed(
  profile: CloudAccountProfile | null,
  roles?: readonly CloudAccountRole[],
): boolean {
  if (!profile || profile.accountStatus !== 'approved') {
    return false;
  }

  if (!roles?.length) {
    return true;
  }

  return roles.includes(profile.role);
}

/**
 * Authentication and approval checks, separate from the booking migration.
 */
@Injectable({ providedIn: 'root' })
export class SupabaseAuthAdapter {

  async signIn(email: string, password: string): Promise<CloudAccountProfile> {
    try {
      return await this.withTimeout(
        this.signInRequest(email, password),
        20000,
        'Sign in is taking too long. Check your connection and try again.',
      );
    } catch (error) {
      throw new Error(this.signInFailureMessage(error));
    }
  }

  private async signInRequest(
    email: string,
    password: string,
  ): Promise<CloudAccountProfile> {
    const client = this.getClient();

    const { data, error } = await client.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });

    if (error) {
      throw new Error(error.message);
    }

    // Password authentication already verified this ID.
    // Always read role and approval from the database.
    const profile = data.user
      ? await this.readProfile(client, data.user.id)
      : null;

    if (!profile || !dashboardAccessAllowed(profile)) {
      await this.signOut();
      throw new Error(this.blockedMessage(profile));
    }

    return profile;
  }

  async registerPassenger(
    input: PassengerRegistrationInput,
  ): Promise<PendingRegistrationResult> {
    const email = input.email.trim().toLowerCase();
    const fullName = input.fullName.trim();
    const phone = input.phone.trim();

    if (!email || !input.password || !fullName || !phone) {
      throw new Error('Name, email, phone, and password are required.');
    }

    const bookingIntent = input.bookingIntent === 'family' ? 'family' : 'self';
    const passengerType = this.passengerType(input.passengerType);

    return this.signUp(email, input.password, {
      role: 'passenger',
      full_name: fullName,
      phone,
      address: (input.address || '').trim(),
      booking_intent: bookingIntent,
      passenger_type: passengerType,
      assistance: Array.isArray(input.assistance) ? input.assistance : [],
      other_needs: (input.otherNeeds || '').trim(),
      emergency_name: (input.emergencyName || '').trim(),
      emergency_phone: (input.emergencyPhone || '').trim(),
    });
  }

  async registerDriver(
    input: DriverRegistrationInput,
  ): Promise<PendingRegistrationResult> {
    const email = input.email.trim().toLowerCase();
    const fullName = input.fullName.trim();
    const phone = input.phone.trim();
    const licenseNumber = input.licenseNumber.trim();
    const vehicleType = input.vehicleType.trim();
    const plateNumber = input.plateNumber.trim();

    if (!email || !input.password || !fullName || !phone) {
      throw new Error('Name, email, phone, and password are required.');
    }

    if (!licenseNumber || !vehicleType || !plateNumber) {
      throw new Error('Driver license, vehicle type, and plate number are required.');
    }

    const metadata: Record<string, string | string[]> = {
      role: 'driver',
      full_name: fullName,
      phone,
      address: (input.address || '').trim(),
      license_number: licenseNumber,
      vehicle_type: vehicleType,
      plate_number: plateNumber,
      wheelchair_accessible: input.wheelchairAccessible ? 'true' : 'false',
      senior_assistance: input.seniorAssistance ? 'true' : 'false',
      driver_declared_accessibility: normalizeDriverAccessibilityCapabilities(
        input.driverDeclaredAccessibility ?? [],
      ),
    };

    this.addOptionalMetadata(metadata, 'license_expiration_date', input.licenseExpirationDate);
    this.addOptionalMetadata(metadata, 'emergency_contact_name', input.emergencyContactName);
    this.addOptionalMetadata(metadata, 'emergency_contact_phone', input.emergencyContactPhone);
    this.addOptionalMetadata(metadata, 'vehicle_body_type', input.vehicleBodyType);
    this.addOptionalMetadata(metadata, 'vehicle_brand', input.vehicleBrand);
    this.addOptionalMetadata(metadata, 'vehicle_model', input.vehicleModel);
    this.addOptionalMetadata(metadata, 'vehicle_variant', input.vehicleVariant);
    this.addOptionalMetadata(metadata, 'vehicle_model_year', input.vehicleModelYear);
    this.addOptionalMetadata(metadata, 'vehicle_color', input.vehicleColor);
    this.addOptionalMetadata(metadata, 'passenger_seating_capacity', input.passengerSeatingCapacity);

    return this.signUp(email, input.password, metadata);
  }

  private addOptionalMetadata(
    metadata: Record<string, string | string[]>,
    key: string,
    value: string | number | undefined,
  ): void {
    if (value === undefined || value === null) {
      return;
    }

    const normalized = String(value).trim();

    if (normalized) {
      metadata[key] = normalized;
    }
  }

  async signOut(): Promise<void> {
    const client = peekSharedSupabaseClient();

    if (!client) {
      return;
    }

    const { error } = await client.auth.signOut();

    if (error) {
      throw new Error(
        this.safeMessage(error.message, 'Sign out did not complete.'),
      );
    }
  }

  async readOwnProfile(): Promise<CloudAccountProfile | null> {
    return this.withTimeout(
      this.readOwnProfileRequest(),
      15000,
      'We could not verify your CareRide account right now. Please try again.',
    );
  }

  private async readOwnProfileRequest(): Promise<CloudAccountProfile | null> {
    const client = this.getClient();

    const { data: userData, error: userError } = await client.auth.getUser();

    if (userError || !userData.user) {
      return null;
    }

    return this.readProfile(client, userData.user.id);
  }

  private async readProfile(
    client: SupabaseClient,
    userId: string,
  ): Promise<CloudAccountProfile | null> {
    const { data, error } = await client
      .from('profiles')
      .select('id, role, account_status, full_name, email, phone, address')
      .eq('id', userId)
      .maybeSingle();

    if (error) {
      throw new Error(
        this.safeMessage(error.message, 'The profile could not be read.'),
      );
    }

    const row = this.asRecord(data);
    const role = this.roleFromColumn(row?.['role']);
    const accountStatus = this.statusFromColumn(row?.['account_status']);

    if (!row || !role || !accountStatus || row['id'] !== userId) {
      return null;
    }

    const profile: CloudAccountProfile = {
      id: userId,
      role,
      accountStatus,
      fullName: this.text(row['full_name']),
      email: this.text(row['email']),
      phone: this.text(row['phone']),
      address: this.text(row['address']),
    };

    if (role === 'passenger') {
      await this.attachPassengerDetails(client, userId, profile);
    } else if (role === 'driver') {
      await this.attachDriverDetails(client, userId, profile);
    }

    return profile;
  }

  async canAccessDashboard(
    roles?: readonly CloudAccountRole[],
  ): Promise<boolean> {
    const profile = await this.readOwnProfile();
    return dashboardAccessAllowed(profile, roles);
  }

  /**
   * Updates only the signed-in approved driver's full name and phone.
   *
   * Does not modify email, account role, approval, license,
   * vehicle details, capacity, or admin-verified information.
   *
   * Existing database permissions and RLS remain authoritative.
   */
  async updateOwnDriverProfile(
    input: {
      fullName: string;
      phone: string;
    },
  ): Promise<CloudAccountProfile> {
    const fullName = input.fullName.trim().replace(/\s+/g, ' ');
    const phone = input.phone.trim();

    if (fullName.length < 2 || fullName.length > 120) {
      throw new Error('Full name must contain 2 to 120 characters.');
    }

    if (!/^\+?[0-9\s()-]{7,20}$/.test(phone)) {
      throw new Error('Enter a valid phone number.');
    }

    const client = this.getClient();

    // Always use the authenticated user's ID.
    // Never accept an account ID from the edit form.
    const { data, error: authError } = await client.auth.getUser();
    const userId = data.user?.id;

    if (authError || !userId) {
      throw new Error('Your session has expired. Please sign in again.');
    }

    // Verify that the signed-in user is an approved driver.
    const currentProfile = await this.readProfile(client, userId);

    if (!currentProfile || !dashboardAccessAllowed(currentProfile, ['driver'])) {
      throw new Error('Only an approved driver can update this profile.');
    }

    // Update only the two allowed personal information columns.
    const { error: updateError } = await client
      .from('profiles')
      .update({
        full_name: fullName,
        phone,
      })
      .eq('id', userId);

    if (updateError) {
      throw new Error(
        this.safeMessage(
          updateError.message,
          'Your profile could not be updated.',
        ),
      );
    }

    // Read the saved data back from Supabase.
    const updatedProfile = await this.readProfile(client, userId);

    // Explicit null check fixes TS18047 and TS2322.
    if (!updatedProfile || !dashboardAccessAllowed(updatedProfile, ['driver'])) {
      throw new Error(
        'The update was submitted, but the saved profile could not be verified.',
      );
    }

    if (
      updatedProfile.fullName !== fullName ||
      updatedProfile.phone !== phone
    ) {
      throw new Error(
        'The requested changes could not be confirmed. Please reload your profile.',
      );
    }

    return updatedProfile;
  }

  /**
   * Calls public.review_account. The database allows only an approved admin,
   * and only for a pending passenger or driver.
   */
  async reviewAccount(
    userId: string,
    decision: 'approved' | 'rejected',
  ): Promise<void> {
    const admin = await this.readOwnProfile();

    if (!admin || !dashboardAccessAllowed(admin, ['admin'])) {
      throw new Error('Only an approved admin can review accounts.');
    }

    if (userId === admin.id) {
      throw new Error('An admin cannot review their own account.');
    }

    if (decision !== 'approved' && decision !== 'rejected') {
      throw new Error('Decision must be approved or rejected.');
    }

    const { error } = await this.getClient().rpc('review_account', {
      p_user_id: userId,
      p_decision: decision,
    });

    if (error) {
      throw new Error(
        this.safeMessage(error.message, 'This account could not be reviewed.'),
      );
    }
  }

  /** Update only the signed-in driver's online/offline status through the auth RPC. */
  async setOwnDriverAvailability(
    status: 'available' | 'offline',
  ): Promise<void> {
    if (status !== 'available' && status !== 'offline') {
      throw new Error('Choose Go Online or Go Offline.');
    }

    const client = this.getClient();

    const { data, error: userError } = await client.auth.getUser();
    const userId = data.user?.id;

    if (userError || !userId) {
      throw new Error('Sign in again before changing your availability.');
    }

    const { error } = await client.rpc('set_driver_availability', {
      p_user_id: userId,
      p_availability: status,
    });

    if (error) {
      throw new Error(
        this.safeMessage(error.message, 'Availability could not be updated.'),
      );
    }
  }

  /**
   * Passenger and driver profiles for an approved admin.
   * public.profiles select is allowed by profiles_select_own_or_admin.
   */
  async listManagedAccounts(): Promise<CloudManagedAccount[]> {
    const admin = await this.readOwnProfile();

    if (!admin || !dashboardAccessAllowed(admin, ['admin'])) {
      throw new Error('Only an approved admin can review accounts.');
    }

    const client = this.getClient();

    const { data, error } = await client
      .from('profiles')
      .select('id, role, account_status, full_name, email, phone, address, created_at')
      .in('role', ['passenger', 'driver'])
      .order('created_at', { ascending: true });

    if (error) {
      throw new Error(
        this.safeMessage(error.message, 'Accounts could not be loaded.'),
      );
    }

    const accounts: CloudManagedAccount[] = [];

    for (const item of Array.isArray(data) ? data : []) {
      const account = this.managedAccountFromRow(item);

      if (account && account.id !== admin.id) {
        accounts.push(account);
      }
    }

    await this.attachListedDriverDetails(client, accounts);

    return accounts;
  }

  private async signUp(
    email: string,
    password: string,
    metadata: Record<string, string | string[]>,
  ): Promise<PendingRegistrationResult> {
    if (metadata['role'] !== 'passenger' && metadata['role'] !== 'driver') {
      throw new Error('Registration cannot create an admin account.');
    }

    const client = createRegistrationClient();

    console.info('[CareRide Registration] Signup request started.');

    const emailRedirectTo = stagingNativeSignupRedirect();

    // Timeout does not cancel a Supabase request.
    // The account may already exist if the timeout fires.
    const signup = client.auth.signUp({
      email,
      password,
      options: {
        data: metadata,
        ...(emailRedirectTo ? { emailRedirectTo } : {}),
      },
    });

    console.info('[CareRide Registration] Supabase signup request dispatched.');

    let response: Awaited<typeof signup>;

    try {
      response = await this.withTimeout(
        signup,
        20000,
        'Registration is taking too long. The account may have been created. Check Supabase or your email before trying again.',
      );
    } catch (error) {
      const failureType = error instanceof Error && /taking too long/i.test(error.message)
        ? 'Timeout'
        : error instanceof Error
          ? error.name
          : 'UnknownError';

      console.warn(
        '[CareRide Registration] Signup did not complete in the app.',
        { failureType },
      );

      throw error;
    }

    if (response.error) {
      console.warn('[CareRide Registration] Supabase rejected signup.', {
        status: response.error.status,
        code: response.error.code,
      });

      throw new Error(
        this.safeMessage(response.error.message, 'Unable to create the account.'),
      );
    }

    console.info('[CareRide Registration] Signup response received.');

    if (!response.data.user?.id || response.data.user.identities?.length === 0) {
      console.warn(
        '[CareRide Registration] Signup response had no usable user identity.',
      );

      throw new Error(
        'Registration could not be confirmed. If you already registered, check your email or contact an admin before trying again.',
      );
    }

    // The existing auth.users trigger creates the pending profile
    // and role details transactionally.
    // No client-side inserts or signup retries.
    // Any returned session lives only in this disposable memory client.

    return {
      accountStatus: 'pending',
      emailConfirmationRequired: !response.data.session,
    };
  }

  private async withTimeout<T>(
    promise: PromiseLike<T>,
    milliseconds: number,
    message: string,
  ): Promise<T> {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error(message)), milliseconds);
    });

    try {
      return await Promise.race([Promise.resolve(promise), timeout]);
    } finally {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    }
  }

  private async attachPassengerDetails(
    client: SupabaseClient,
    userId: string,
    profile: CloudAccountProfile,
  ): Promise<void> {
    const { data, error } = await client
      .from('passenger_details')
      .select('booking_intent, passenger_type, assistance, other_needs, emergency_name, emergency_phone')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      throw new Error(
        this.safeMessage(error.message, 'Passenger details could not be read.'),
      );
    }

    const row = this.asRecord(data);

    if (!row) {
      return;
    }

    profile.bookingIntent = row['booking_intent'] === 'family'
      ? 'family'
      : 'self';

    profile.passengerType = this.passengerType(
      this.text(row['passenger_type']),
    );

    profile.assistance = Array.isArray(row['assistance'])
      ? row['assistance'].filter(
          (item): item is string => typeof item === 'string',
        )
      : [];

    profile.otherNeeds = this.text(row['other_needs']);
    profile.emergencyName = this.text(row['emergency_name']);
    profile.emergencyPhone = this.text(row['emergency_phone']);
  }

  private async attachDriverDetails(
    client: SupabaseClient,
    userId: string,
    profile: CloudAccountProfile,
  ): Promise<void> {
    const { data, error } = await client
      .from('driver_details')
      .select('license_number, vehicle_type, plate_number, wheelchair_accessible, senior_assistance, availability')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      throw new Error(
        this.safeMessage(error.message, 'Driver details could not be read.'),
      );
    }

    const row = this.asRecord(data);

    if (!row) {
      return;
    }

    profile.licenseNumber = this.text(row['license_number']);
    profile.vehicleType = this.text(row['vehicle_type']);
    profile.plateNumber = this.text(row['plate_number']);
    profile.wheelchairAccessible = row['wheelchair_accessible'] === true;
    profile.seniorAssistance = row['senior_assistance'] === true;
    profile.availability = this.availability(row['availability']);
  }

  private managedAccountFromRow(
    value: unknown,
  ): CloudManagedAccount | null {
    const row = this.asRecord(value);
    const role = row ? this.roleFromColumn(row['role']) : null;
    const accountStatus = row
      ? this.statusFromColumn(row['account_status'])
      : null;
    const id = this.text(row?.['id']);

    if (
      !row ||
      !id ||
      (role !== 'passenger' && role !== 'driver') ||
      !accountStatus
    ) {
      return null;
    }

    return {
      id,
      role,
      accountStatus,
      fullName: this.text(row['full_name']),
      email: this.text(row['email']),
      phone: this.text(row['phone']),
      address: this.text(row['address']),
      createdAt: this.text(row['created_at']),
    };
  }

  private async attachListedDriverDetails(
    client: SupabaseClient,
    accounts: CloudManagedAccount[],
  ): Promise<void> {
    const driverIds = accounts
      .filter((account) => account.role === 'driver')
      .map((account) => account.id);

    if (!driverIds.length) {
      return;
    }

    const { data, error } = await client
      .from('driver_details')
      .select('user_id, license_number, vehicle_type, plate_number, wheelchair_accessible, senior_assistance')
      .in('user_id', driverIds);

    if (error) {
      throw new Error(
        this.safeMessage(error.message, 'Driver details could not be read.'),
      );
    }

    const byUser = new Map<string, Record<string, unknown>>();

    for (const item of Array.isArray(data) ? data : []) {
      const row = this.asRecord(item);
      const userId = this.text(row?.['user_id']);

      if (row && userId) {
        byUser.set(userId, row);
      }
    }

    for (const account of accounts) {
      const row = byUser.get(account.id);

      if (!row) {
        continue;
      }

      account.licenseNumber = this.text(row['license_number']);
      account.vehicleType = this.text(row['vehicle_type']);
      account.plateNumber = this.text(row['plate_number']);
      account.wheelchairAccessible = row['wheelchair_accessible'] === true;
      account.seniorAssistance = row['senior_assistance'] === true;

      Object.assign(account, mapDriverV3ReadOnlyFields(row));
    }
  }

  private getClient(): SupabaseClient {
    return getSharedSupabaseClient();
  }

  private roleFromColumn(value: unknown): CloudAccountRole | null {
    return value === 'passenger' ||
      value === 'driver' ||
      value === 'admin'
      ? value
      : null;
  }

  private statusFromColumn(value: unknown): CloudAccountStatus | null {
    return value === 'pending' ||
      value === 'approved' ||
      value === 'rejected'
      ? value
      : null;
  }

  private passengerType(
    value: string | undefined,
  ): 'elderly' | 'pwd' | 'other' {
    if (
      value === 'elderly' ||
      value === 'pwd' ||
      value === 'other'
    ) {
      return value;
    }

    return 'other';
  }

  private availability(
    value: unknown,
  ): 'available' | 'busy' | 'offline' {
    return value === 'available' ||
      value === 'busy' ||
      value === 'offline'
      ? value
      : 'offline';
  }

  private blockedMessage(
    profile: CloudAccountProfile | null,
  ): string {
    if (profile?.accountStatus === 'rejected') {
      return 'Account Registration Rejected. This account cannot sign in.';
    }

    if (profile?.accountStatus === 'pending') {
      return 'Account Under Review. An admin must approve this account before you can sign in.';
    }

    return 'No CareRide profile is linked to this account.';
  }

  private signInFailureMessage(error: unknown): string {
    const details = this.asRecord(error);
    const code = this.text(details?.['code']).toLowerCase();

    const message = error instanceof Error
      ? error.message.trim()
      : this.text(details?.['message']).trim();

    const normalized = `${code} ${message}`.toLowerCase();

    if (/account under review|account registration rejected|no careride profile/i.test(message)) {
      return message;
    }

    if (/email_not_confirmed|email not confirmed|email is not confirmed/.test(normalized)) {
      return 'Please confirm your email address using the link we sent before signing in.';
    }

    if (/invalid_credentials|invalid login credentials|invalid email or password|wrong password/.test(normalized)) {
      return 'Incorrect email or password. Check your details and try again.';
    }

    if (/taking too long|timeout|timed out/.test(normalized)) {
      return 'Sign in is taking too long. Check your connection and try again.';
    }

    if (/failed to fetch|fetch failed|networkerror|network request failed|load failed/.test(normalized)) {
      return 'Unable to reach CareRide right now. Check your internet connection and try again.';
    }

    return this.safeMessage(
      message,
      'Unable to sign in. Please try again.',
    );
  }

  private text(value: unknown): string {
    return typeof value === 'string' ? value : '';
  }

  private asRecord(
    value: unknown,
  ): Record<string, unknown> | null {
    return value && typeof value === 'object'
      ? value as Record<string, unknown>
      : null;
  }

  private safeMessage(
    message: string,
    fallback: string,
  ): string {
    const text = message.trim();

    if (
      !text ||
      /sb_publishable_|sb_secret_|service_role|eyJ|bearer\s+/i.test(text)
    ) {
      return fallback;
    }

    if (/duplicate key|profiles_email_key|profiles_phone_key|plate_number/i.test(text)) {
      return 'An account with this email, phone, or plate number already exists.';
    }

    return text;
  }
}

/** Keep browser redirects unchanged and opt only native staging signup into its deep link. */
export function stagingNativeSignupRedirect(): string | undefined {
  if (
    !Capacitor.isNativePlatform() ||
    !environment.supabase.cloudAuthEnabled
  ) {
    return undefined;
  }

  try {
    return new URL(environment.supabase.url).hostname ===
      'equgimeazblvoarklbee.supabase.co'
      ? STAGING_SIGNUP_CALLBACK
      : undefined;
  } catch {
    return undefined;
  }
}
