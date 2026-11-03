import { Injectable } from '@angular/core';
import { AssistanceNeed, PassengerType } from '../models/care-ride.models';
import { SupabaseService } from './supabase.service';

const STORAGE_KEY = 'careride.local.profile';

export interface CareRideProfile {
  email?: string;
  name: string;
  phone: string;
  address: string;
  passengerType: string;
  assistance: string[];
  otherNeeds: string;
  emergencyName: string;
  emergencyPhone: string;
}

export interface AccountProfileSeed {
  email: string;
  name: string;
  phone: string;
  address?: string;
  passengerType?: string;
}

@Injectable({ providedIn: 'root' })
export class ProfileService {
  constructor(private supabase: SupabaseService) {}

  loadLocal(): CareRideProfile | null {
    return this.loadLocalFor(this.currentEmail()) ?? this.readStored(STORAGE_KEY);
  }

  hydrateFromAccount(account: AccountProfileSeed): CareRideProfile {
    const email = (account.email || '').trim().toLowerCase();
    const accountName = (account.name || '').trim();
    const accountPhone = (account.phone || '').trim();
    const existing = this.loadLocalFor(email) ?? this.adoptGlobalIfSamePerson(accountName);
    const merged: CareRideProfile = {
      email,
      name: existing?.name?.trim() || accountName,
      phone: existing?.phone?.trim() || accountPhone,
      address: existing?.address?.trim() || (account.address || '').trim(),
      passengerType: this.preferPassengerType(existing?.passengerType, account.passengerType),
      assistance: Array.isArray(existing?.assistance) ? existing.assistance : [],
      otherNeeds: existing?.otherNeeds || '',
      emergencyName: existing?.emergencyName || '',
      emergencyPhone: existing?.emergencyPhone || '',
    };
    this.saveLocalFor(email, merged);
    return merged;
  }

  async load(): Promise<CareRideProfile | null> {
    const local = this.loadLocal();
    if (!this.supabase.client) {
      return local;
    }

    const client = this.supabase.client;
    const { data: userData, error: userError } = await client.auth.getUser();
    if (userError || !userData.user) {
      return local;
    }

    const userId = userData.user.id;
    const [{ data: profile }, { data: passenger }, { data: contact }] = await Promise.all([
      client.from('profiles').select('full_name, phone').eq('id', userId).maybeSingle(),
      client.from('passengers').select('passenger_type, address, assistance_needs, assistance_notes').eq('profile_id', userId).maybeSingle(),
      client.from('emergency_contacts').select('full_name, phone').eq('profile_id', userId).limit(1).maybeSingle(),
    ]);

    const merged: CareRideProfile = {
      email: userData.user.email || local?.email || '',
      name: (profile?.full_name as string) || local?.name || '',
      phone: (profile?.phone as string) || local?.phone || '',
      address: (passenger?.address as string) || local?.address || '',
      passengerType: this.fromPassengerType(passenger?.passenger_type as string | undefined) || local?.passengerType || 'Prefer not to say',
      assistance: passenger?.assistance_needs
        ? this.fromAssistanceNeeds(passenger.assistance_needs as AssistanceNeed[])
        : local?.assistance || [],
      otherNeeds: (passenger?.assistance_notes as string) || local?.otherNeeds || '',
      emergencyName: (contact?.full_name as string) || local?.emergencyName || '',
      emergencyPhone: (contact?.phone as string) || local?.emergencyPhone || '',
    };
    this.saveLocal(merged);
    return merged;
  }

  saveLocal(profile: CareRideProfile): void {
    const email = (profile.email || this.currentEmail()).trim().toLowerCase();
    if (email) {
      this.saveLocalFor(email, { ...profile, email });
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  }

  private currentEmail(): string {
    return (localStorage.getItem('careride_user_email') || '').trim().toLowerCase();
  }

  private loadLocalFor(email: string): CareRideProfile | null {
    if (!email) {
      return null;
    }
    return this.readStored(`${STORAGE_KEY}.${email}`);
  }

  private saveLocalFor(email: string, profile: CareRideProfile): void {
    const payload = JSON.stringify(profile);
    localStorage.setItem(`${STORAGE_KEY}.${email}`, payload);
    localStorage.setItem(STORAGE_KEY, payload);
  }

  private readStored(key: string): CareRideProfile | null {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      return JSON.parse(raw) as CareRideProfile;
    } catch {
      return null;
    }
  }

  private adoptGlobalIfSamePerson(name: string): CareRideProfile | null {
    const global = this.readStored(STORAGE_KEY);
    if (!global?.name || !name) {
      return null;
    }
    if (global.name.trim().toLowerCase() !== name.trim().toLowerCase()) {
      return null;
    }
    return global;
  }

  private preferPassengerType(existing?: string, seeded?: string): string {
    if (existing && existing !== 'Prefer not to say') {
      return existing;
    }
    return seeded || existing || 'Prefer not to say';
  }

  async save(profile: CareRideProfile): Promise<string> {
    this.saveLocal(profile);
    if (!this.supabase.client) {
      return 'Profile saved on this device. Connect Supabase to store it in your CareRide account.';
    }

    const client = this.supabase.client;
    const { data: userData, error: userError } = await client.auth.getUser();
    if (userError || !userData.user) {
      throw new Error('Sign in before saving your profile to CareRide.');
    }

    const userId = userData.user.id;
    const { error: profileError } = await client
      .from('profiles')
      .update({ full_name: profile.name, phone: profile.phone })
      .eq('id', userId);
    if (profileError) throw new Error(profileError.message);

    const { error: passengerError } = await client
      .from('passengers')
      .update({
        passenger_type: this.toPassengerType(profile.passengerType),
        address: profile.address,
        assistance_needs: this.toAssistanceNeeds(profile.assistance),
        assistance_notes: profile.otherNeeds || null,
      })
      .eq('profile_id', userId);
    if (passengerError) throw new Error(passengerError.message);

    const { error: deleteError } = await client.from('emergency_contacts').delete().eq('profile_id', userId);
    if (deleteError) throw new Error(deleteError.message);

    const { error: contactError } = await client.from('emergency_contacts').insert({
      profile_id: userId,
      full_name: profile.emergencyName,
      phone: profile.emergencyPhone,
      relationship: 'emergency',
    });
    if (contactError) throw new Error(contactError.message);

    return 'Profile saved to your CareRide account.';
  }

  private fromPassengerType(value: string | undefined): string {
    if (value === 'elderly') return 'Elderly';
    if (value === 'pwd') return 'Person with a disability';
    return '';
  }

  private fromAssistanceNeeds(values: AssistanceNeed[]): string[] {
    const map: Record<string, string> = {
      wheelchair: 'Wheelchair assistance',
      walking: 'Walking assistance',
      visual: 'Visual assistance',
      hearing: 'Hearing assistance',
      companion: 'Companion assistance',
      other: 'Other special assistance',
    };
    return values.map((value) => map[value] ?? value);
  }

  private toPassengerType(value: string): PassengerType {
    if (value === 'Elderly') return 'elderly';
    if (value === 'Person with a disability') return 'pwd';
    return 'other';
  }

  private toAssistanceNeeds(values: string[]): AssistanceNeed[] {
    const map: Record<string, AssistanceNeed> = {
      'Wheelchair assistance': 'wheelchair',
      'Walking assistance': 'walking',
      'Visual assistance': 'visual',
      'Hearing assistance': 'hearing',
      'Companion assistance': 'companion',
    };
    return values.map((value) => map[value] ?? 'other');
  }
}
