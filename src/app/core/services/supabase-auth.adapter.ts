import { Injectable } from '@angular/core';
import { SupabaseClient } from '@supabase/supabase-js';
import { getSharedSupabaseClient, peekSharedSupabaseClient } from './supabase-client';

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
}

export function filterCloudAccounts(
  accounts: readonly CloudManagedAccount[],
  group: 'passenger' | 'driver',
  status: CloudAccountStatus,
): CloudManagedAccount[] {
  return accounts.filter((account) => account.role === group && account.accountStatus === status);
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
 * Isolated CareRide1 auth adapter. Nothing in the current UI, guards, or
 * localStorage workflows injects this class. It does not use SupabaseService.client.
 */
@Injectable({ providedIn: 'root' })
export class SupabaseAuthAdapter {
  async signIn(email: string, password: string): Promise<CloudAccountProfile> {
    const client = this.getClient();
    const { error } = await client.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    if (error) {
      throw new Error(this.safeMessage(error.message, 'Incorrect email or password.'));
    }

    const profile = await this.readOwnProfile();
    if (!profile || !dashboardAccessAllowed(profile)) {
      await this.signOut();
      throw new Error(this.blockedMessage(profile));
    }
    return profile;
  }

  async registerPassenger(input: PassengerRegistrationInput): Promise<PendingRegistrationResult> {
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

  async registerDriver(input: DriverRegistrationInput): Promise<PendingRegistrationResult> {
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

    return this.signUp(email, input.password, {
      role: 'driver',
      full_name: fullName,
      phone,
      address: (input.address || '').trim(),
      license_number: licenseNumber,
      vehicle_type: vehicleType,
      plate_number: plateNumber,
      wheelchair_accessible: input.wheelchairAccessible ? 'true' : 'false',
      senior_assistance: input.seniorAssistance ? 'true' : 'false',
    });
  }

  async signOut(): Promise<void> {
    const client = peekSharedSupabaseClient();
    if (!client) {
      return;
    }
    const { error } = await client.auth.signOut();
    if (error) {
      throw new Error(this.safeMessage(error.message, 'Sign out did not complete.'));
    }
  }

  async readOwnProfile(): Promise<CloudAccountProfile | null> {
    const client = this.getClient();
    const { data: userData, error: userError } = await client.auth.getUser();
    if (userError || !userData.user) {
      return null;
    }

    const userId = userData.user.id;
    const { data, error } = await client
      .from('profiles')
      .select('id, role, account_status, full_name, email, phone, address')
      .eq('id', userId)
      .maybeSingle();
    if (error) {
      throw new Error(this.safeMessage(error.message, 'The profile could not be read.'));
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

  async canAccessDashboard(roles?: readonly CloudAccountRole[]): Promise<boolean> {
    const profile = await this.readOwnProfile();
    return dashboardAccessAllowed(profile, roles);
  }

  /**
   * Calls public.review_account. The database allows only an approved admin,
   * and only for a pending passenger or driver.
   */
  async reviewAccount(userId: string, decision: 'approved' | 'rejected'): Promise<void> {
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
      throw new Error(this.safeMessage(error.message, 'This account could not be reviewed.'));
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
      throw new Error(this.safeMessage(error.message, 'Accounts could not be loaded.'));
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

    const client = this.getClient();
    const { data, error } = await client.auth.signUp({
      email,
      password,
      options: { data: metadata },
    });
    if (error) {
      throw new Error(this.safeMessage(error.message, 'Unable to create the account.'));
    }
    if (data.session) {
      await client.auth.signOut();
    }
    return {
      accountStatus: 'pending',
      emailConfirmationRequired: !data.session,
    };
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
      throw new Error(this.safeMessage(error.message, 'Passenger details could not be read.'));
    }
    const row = this.asRecord(data);
    if (!row) {
      return;
    }
    profile.bookingIntent = row['booking_intent'] === 'family' ? 'family' : 'self';
    profile.passengerType = this.passengerType(this.text(row['passenger_type']));
    profile.assistance = Array.isArray(row['assistance'])
      ? row['assistance'].filter((item): item is string => typeof item === 'string')
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
      throw new Error(this.safeMessage(error.message, 'Driver details could not be read.'));
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

  private managedAccountFromRow(value: unknown): CloudManagedAccount | null {
    const row = this.asRecord(value);
    const role = row ? this.roleFromColumn(row['role']) : null;
    const accountStatus = row ? this.statusFromColumn(row['account_status']) : null;
    const id = this.text(row?.['id']);
    if (!row || !id || (role !== 'passenger' && role !== 'driver') || !accountStatus) {
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
    const driverIds = accounts.filter((account) => account.role === 'driver').map((account) => account.id);
    if (!driverIds.length) {
      return;
    }
    const { data, error } = await client
      .from('driver_details')
      .select('user_id, license_number, vehicle_type, plate_number, wheelchair_accessible, senior_assistance')
      .in('user_id', driverIds);
    if (error) {
      throw new Error(this.safeMessage(error.message, 'Driver details could not be read.'));
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
    }
  }

  private getClient(): SupabaseClient {
    return getSharedSupabaseClient();
  }

  private roleFromColumn(value: unknown): CloudAccountRole | null {
    return value === 'passenger' || value === 'driver' || value === 'admin' ? value : null;
  }

  private statusFromColumn(value: unknown): CloudAccountStatus | null {
    return value === 'pending' || value === 'approved' || value === 'rejected' ? value : null;
  }

  private passengerType(value: string | undefined): 'elderly' | 'pwd' | 'other' {
    if (value === 'elderly' || value === 'pwd' || value === 'other') {
      return value;
    }
    return 'other';
  }

  private availability(value: unknown): 'available' | 'busy' | 'offline' {
    return value === 'available' || value === 'busy' || value === 'offline' ? value : 'offline';
  }

  private blockedMessage(profile: CloudAccountProfile | null): string {
    if (profile?.accountStatus === 'rejected') {
      return 'Account Registration Rejected. This account cannot sign in.';
    }
    if (profile?.accountStatus === 'pending') {
      return 'Account Under Review. An admin must approve this account before you can sign in.';
    }
    return 'No CareRide profile is linked to this account.';
  }

  private text(value: unknown): string {
    return typeof value === 'string' ? value : '';
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' ? value as Record<string, unknown> : null;
  }

  private safeMessage(message: string, fallback: string): string {
    const text = message.trim();
    if (!text || /sb_publishable_|sb_secret_|service_role|eyJ|bearer\s+/i.test(text)) {
      return fallback;
    }
    if (/duplicate key|profiles_email_key|profiles_phone_key|plate_number/i.test(text)) {
      return 'An account with this email, phone, or plate number already exists.';
    }
    return text;
  }
}
