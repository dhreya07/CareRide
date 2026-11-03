import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  accessibilityOutline,
  callOutline,
  earOutline,
  eyeOutline,
  informationCircleOutline,
  logOutOutline,
  medkitOutline,
  peopleOutline,
  personOutline,
  saveOutline,
  walkOutline,
} from 'ionicons/icons';

import { AppNavigationComponent } from '../../shared/app-navigation.component';
import { AuthService } from '../../core/services/auth.service';
import { ProfileService } from '../../core/services/profile.service';

interface LocalProfile {
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

@Component({
  selector: 'app-profile',
  standalone: true,

  imports: [
    CommonModule,
    FormsModule,
    IonIcon,
    AppNavigationComponent
  ],

  templateUrl: './profile.page.html',
  styleUrls: ['./profile.page.scss']
})
export class ProfilePage implements OnInit {

  email = '';
  name = '';
  phone = '';
  address = '';

  passengerType =
    'Prefer not to say';

  assistance: string[] = [];

  otherNeeds = '';

  emergencyName = '';
  emergencyPhone = '';

  isSaved = false;
  formError = '';


  readonly needs: string[] = [
    'Wheelchair assistance',
    'Walking assistance',
    'Visual assistance',
    'Hearing assistance',
    'Companion assistance'
  ];

  readonly needIcons: Record<string, string> = {
    'Wheelchair assistance': 'accessibility-outline',
    'Walking assistance': 'walk-outline',
    'Visual assistance': 'eye-outline',
    'Hearing assistance': 'ear-outline',
    'Companion assistance': 'people-outline',
  };


  constructor(
    private auth: AuthService,
    private profiles: ProfileService,
    private router: Router
  ) {
    addIcons({
      accessibilityOutline,
      callOutline,
      earOutline,
      eyeOutline,
      informationCircleOutline,
      logOutOutline,
      medkitOutline,
      peopleOutline,
      personOutline,
      saveOutline,
      walkOutline,
    });
  }

  get initials(): string {
    const parts = this.name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) {
      return 'CR';
    }
    if (parts.length === 1) {
      return parts[0].slice(0, 2).toUpperCase();
    }
    return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  }


  // =========================
  // LOAD PROFILE
  // =========================

  ngOnInit(): void {
    this.loadProfile();
  }

  ionViewWillEnter(): void {

    this.loadProfile();

  }


  private loadProfile(): void {
    const account = this.auth.getLocalAccount();
    if (account) {
      this.profiles.hydrateFromAccount({
        email: account.email,
        name: account.fullName,
        phone: account.phone,
        address: account.address,
        passengerType: account.bookingIntent === 'family' ? 'Family member' : undefined,
      });
    }
    void this.profiles.load()
      .then((profile) => {
        if (!profile) {
          this.email = this.auth.getLocalEmail();
          if (!this.name) {
            this.name = this.auth.getLocalDisplayName();
          }
          return;
        }
        this.email = profile.email || this.auth.getLocalEmail();
        this.name = profile.name || this.auth.getLocalDisplayName();
        this.phone = profile.phone || '';
        this.address = profile.address || '';
        this.passengerType = profile.passengerType || 'Prefer not to say';
        this.assistance = Array.isArray(profile.assistance) ? profile.assistance : [];
        this.otherNeeds = profile.otherNeeds || '';
        this.emergencyName = profile.emergencyName || '';
        this.emergencyPhone = profile.emergencyPhone || '';
      })
      .catch(() => {
        this.email = this.auth.getLocalEmail();
        if (!this.name) {
          this.name = this.auth.getLocalDisplayName();
        }
      });
  }


  // =========================
  // TOGGLE ASSISTANCE
  // =========================

  toggle(
    need: string
  ): void {

    this.isSaved = false;


    if (
      this.assistance.includes(need)
    ) {

      this.assistance =
        this.assistance.filter(
          value => value !== need
        );

      return;
    }


    this.assistance = [
      ...this.assistance,
      need
    ];

  }


  // =========================
  // SAVE PROFILE
  // =========================

  save(): void {

    this.isSaved = false;
    this.formError = '';


    // Clean text

    this.name =
      this.name.trim();

    this.phone =
      this.phone.trim();

    this.address =
      this.address.trim();

    this.otherNeeds =
      this.otherNeeds.trim();

    this.emergencyName =
      this.emergencyName.trim();

    this.emergencyPhone =
      this.emergencyPhone.trim();


    // Full name

    if (!this.name) {
      this.failSave('Please enter your full name.');
      return;
    }


    // Contact number

    if (!this.phone) {
      this.failSave('Please enter your contact number.');
      return;
    }


    if (
      !this.isValidPhilippinePhone(
        this.phone
      )
    ) {

      this.failSave(
        'Please enter a valid Philippine mobile number. Example: 09171234567'
      );
      return;

    }


    // Address

    if (!this.address) {
      this.failSave('Please enter your home address.');
      return;
    }


    // Emergency contact

    if (!this.emergencyName) {
      this.failSave('Please enter an emergency contact name.');
      return;
    }


    if (!this.emergencyPhone) {
      this.failSave('Please enter an emergency contact number.');
      return;
    }


    if (
      !this.isValidPhilippinePhone(
        this.emergencyPhone
      )
    ) {

      this.failSave(
        'Please enter a valid emergency contact number. Example: 09171234567'
      );
      return;

    }


    // Prevent same personal and emergency number

    if (
      this.normalizePhone(this.phone) ===
      this.normalizePhone(
        this.emergencyPhone
      )
    ) {

      this.failSave(
        'Your emergency contact should use a different phone number from your personal contact number.'
      );
      return;

    }


    const profile: LocalProfile = {

      email:
        this.email.trim().toLowerCase() || this.auth.getLocalEmail(),

      name:
        this.name,

      phone:
        this.phone,

      address:
        this.address,

      passengerType:
        this.passengerType,

      assistance: [
        ...this.assistance
      ],

      otherNeeds:
        this.otherNeeds,

      emergencyName:
        this.emergencyName,

      emergencyPhone:
        this.emergencyPhone

    };


    void this.profiles.save(profile)
      .then((message) => {
        this.isSaved = true;
        this.formError = '';
        alert(message);
      })
      .catch((error: unknown) => {
        this.failSave(
          error instanceof Error
            ? error.message
            : 'Unable to save your profile. Please try again.'
        );
      });

  }

  private failSave(message: string): void {
    this.formError = message;
    alert(message);
  }


  // =========================
  // CALL EMERGENCY CONTACT
  // =========================

  callEmergencyContact(): void {

    const phoneNumber =
      this.emergencyPhone.trim();


    if (!phoneNumber) {

      alert(
        'Please add an emergency contact number first.'
      );

      return;

    }


    if (
      !this.isValidPhilippinePhone(
        phoneNumber
      )
    ) {

      alert(
        'The emergency contact number is invalid.'
      );

      return;

    }


    const confirmed = confirm(

      'Call Emergency Contact?\n\n' +

      (
        this.emergencyName ||
        'Emergency Contact'
      ) +

      '\n' +

      phoneNumber

    );


    if (!confirmed) {
      return;
    }


    window.location.href =
      `tel:${phoneNumber}`;

  }


  // =========================
  // PHONE VALIDATION
  // =========================

  private isValidPhilippinePhone(
    phone: string
  ): boolean {

    const clean =
      phone.replace(
        /[\s()-]/g,
        ''
      );


    return (
      /^09\d{9}$/.test(clean) ||
      /^\+639\d{9}$/.test(clean)
    );

  }


  private normalizePhone(
    phone: string
  ): string {

    const clean =
      phone.replace(
        /[\s()-]/g,
        ''
      );


    if (
      clean.startsWith('+63')
    ) {

      return '0' +
        clean.substring(3);

    }


    return clean;

  }


  // =========================
  // SIGN OUT
  // =========================

  async signOut(): Promise<void> {

    const confirmed = confirm(
      'Sign out of CareRide?'
    );


    if (!confirmed) {
      return;
    }


    try {
      await this.auth.signOut();
      await this.router.navigateByUrl('/login');
    } catch (error) {
      alert(
        error instanceof Error
          ? error.message
          : 'Unable to sign out. Please try again.'
      );
    }

  }

}