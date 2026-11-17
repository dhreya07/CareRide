
import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  accessibilityOutline,
  callOutline,
  cameraOutline,
  carOutline,
  documentTextOutline,
  imagesOutline,
  peopleOutline,
  personOutline,
  shieldCheckmarkOutline,
  trashOutline,
} from 'ionicons/icons';

import {
  AuthService,
  LocalCareRideUser,
} from '../../core/services/auth.service';

import {
  CloudAccountProfile,
  SupabaseAuthAdapter,
} from '../../core/services/supabase-auth.adapter';

import {
  DriverProfilePhotoService,
} from '../../core/services/driver-profile-photo.service';

import { DriverNavigationComponent } from '../../shared/driver-navigation.component';

type DriverProfileData = Pick<
  LocalCareRideUser,
  'id' | 'accountType' | 'fullName' | 'email' | 'phone' | 'address'
> & {
  licenseNumber?: string;
  licenseExpirationDate?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  vehicleType?: string;
  vehicleBodyType?: string;
  vehicleBrand?: string;
  vehicleModel?: string;
  vehicleVariant?: string;
  vehicleModelYear?: number;
  vehicleColor?: string;
  plateNumber?: string;
  passengerSeatingCapacity?: number;
  verifiedPassengerSeatingCapacity?: number;
  capacityVerificationStatus?: LocalCareRideUser['capacityVerificationStatus'];
  driverDeclaredAccessibility?: string[];
  adminVerifiedAccessibility?: string[];
  accessibilityVerificationStatus?: LocalCareRideUser['accessibilityVerificationStatus'];
  wheelchairAccessible?: boolean;
  seniorAssistance?: boolean;
};

@Component({
  selector: 'app-driver-profile',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IonIcon,
    DriverNavigationComponent,
  ],
  templateUrl: './driver-profile.page.html',
  styleUrls: ['./driver-profile.page.scss'],
})
export class DriverProfilePage implements OnInit {
  account: DriverProfileData | null = null;

  loading = true;
  loadError = '';

  editing = false;
  saving = false;
  saveError = '';
  saveSuccess = '';

  editFullName = '';
  editPhone = '';

  resettingPassword = false;
  resetMessage = '';
  resetError = '';

  // =========================
  // PROFILE PICTURE
  // =========================

  profilePhoto: string | null = null;
  photoSaving = false;
  photoError = '';
  photoSuccess = '';

  // New compact profile layout: only one detail panel opens at a time.
  activeSection: string | null = null;
  avatarModalOpen = false;
  photoSourceOpen = false;
  readonly avatarColors = [
    { id: 'teal', label: 'Teal', background: '#dcfbef', foreground: '#078b70' },
    { id: 'blue', label: 'Blue', background: '#deefff', foreground: '#397dbb' },
    { id: 'purple', label: 'Purple', background: '#ebe0fa', foreground: '#8054b5' },
    { id: 'peach', label: 'Peach', background: '#ffebdf', foreground: '#b86b46' },
  ];
  avatarColor = 'teal';

  private loadSequence = 0;

  constructor(
    private auth: AuthService,
    private cloudAuth: SupabaseAuthAdapter,
    private photos: DriverProfilePhotoService,
    private changes: ChangeDetectorRef,
  ) {
    addIcons({
      accessibilityOutline,
      callOutline,
      cameraOutline,
      carOutline,
      documentTextOutline,
      imagesOutline,
      peopleOutline,
      personOutline,
      shieldCheckmarkOutline,
      trashOutline,
    });
  }

  ngOnInit(): void {
    void this.loadProfile();
  }

  ionViewWillEnter(): void {
    void this.loadProfile();
  }

  ionViewDidLeave(): void {
    this.loadSequence += 1;

    this.account = null;
    this.loading = false;
    this.loadError = '';

    this.editing = false;
    this.saving = false;
    this.saveError = '';
    this.saveSuccess = '';

    this.resetMessage = '';
    this.resetError = '';

    this.profilePhoto = null;
    this.activeSection = null;
    this.avatarModalOpen = false;
    this.photoSourceOpen = false;
    this.photoError = '';
    this.photoSuccess = '';

    this.changes.markForCheck();
  }

  get showDriverHelp(): boolean {
    return window.location.hash === '#driver-help';
  }

  get name(): string {
    return this.value(this.account?.fullName);
  }

  get initials(): string {
    const parts = this.name.split(/\s+/).filter(Boolean);

    if (parts.length > 1) {
      return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
    }

    return parts[0]?.slice(0, 2).toUpperCase() || 'DR';
  }

  get canEditProfile(): boolean {
    return this.auth.cloudAuthEnabled && !!this.account && !this.loading;
  }

  get canEditPhoto(): boolean {
    return !!this.account && !this.loading && !this.photoSaving;
  }

  get selectedAvatarColor(): typeof this.avatarColors[number] {
    return this.avatarColors.find((color) => color.id === this.avatarColor)
      ?? this.avatarColors[0];
  }

  toggleSection(section: string): void {
    this.activeSection = this.activeSection === section ? null : section;
    if (this.activeSection !== 'personal' && this.editing && !this.saving) {
      this.cancelEditing();
    }
    this.changes.markForCheck();
  }

  openAvatarModal(): void {
    if (!this.account || this.loading) return;
    this.avatarModalOpen = true;
    this.photoSourceOpen = false;
    this.photoError = '';
    this.photoSuccess = '';
    this.changes.markForCheck();
  }

  closeAvatarModal(): void {
    if (this.photoSaving) return;
    this.avatarModalOpen = false;
    this.photoSourceOpen = false;
    this.changes.markForCheck();
  }

  togglePhotoSources(): void {
    if (!this.canEditPhoto) return;
    this.photoSourceOpen = !this.photoSourceOpen;
    this.changes.markForCheck();
  }

  selectAvatarColor(colorId: string): void {
    if (!this.canEditPhoto || !this.account) return;
    if (!this.avatarColors.some((color) => color.id === colorId)) return;
    this.photoError = '';
    this.photoSuccess = '';
    try {
      // Choosing an avatar replaces the locally saved picture.
      this.photos.removePhoto(this.account.id);
      localStorage.setItem(this.avatarColorKey(this.account.id), colorId);
      this.avatarColor = colorId;
      this.profilePhoto = null;
      this.photoSuccess = 'Avatar color saved on this device.';
    } catch (error) {
      this.photoError = error instanceof Error
        ? error.message
        : 'Unable to save your avatar color.';
    }
    this.changes.markForCheck();
  }

  private avatarColorKey(driverId: string): string {
    return `careride_driver_avatar_color_v1_${encodeURIComponent(driverId)}`;
  }

  private loadAvatarColor(): void {
    this.avatarColor = 'teal';
    if (!this.account) return;
    try {
      const stored = localStorage.getItem(this.avatarColorKey(this.account.id));
      if (this.avatarColors.some((color) => color.id === stored)) {
        this.avatarColor = stored!;
      }
    } catch {
      // Storage can be unavailable in restricted browsing environments.
    }
  }

  // =========================
  // PROFILE PICTURE METHODS
  // =========================

  /**
   * Opens the gallery/file picker through a hidden HTML input.
   */
  openGallery(input: HTMLInputElement): void {
    if (!this.canEditPhoto) {
      return;
    }

    this.photoError = '';
    this.photoSuccess = '';

    input.click();
  }

  /**
   * Opens the camera on supported mobile devices.
   * Desktop browsers may show a regular file picker instead.
   */
  openCamera(input: HTMLInputElement): void {
    if (!this.canEditPhoto) {
      return;
    }

    this.photoError = '';
    this.photoSuccess = '';

    input.click();
  }

  /**
   * Validates and saves the selected image locally.
   */
  async onPhotoSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    // Allow selecting the same image again later.
    input.value = '';

    if (!file || !this.account || this.photoSaving) {
      return;
    }

    const driverId = this.account.id;
    const sequence = this.loadSequence;

    this.photoSaving = true;
    this.photoError = '';
    this.photoSuccess = '';

    this.changes.markForCheck();

    try {
      const savedPhoto = await this.photos.savePhoto(
        driverId,
        file,
      );

      if (
        sequence !== this.loadSequence ||
        this.account?.id !== driverId
      ) {
        return;
      }

      this.profilePhoto = savedPhoto;
      this.photoSuccess = 'Profile picture saved on this device.';
      this.photoSourceOpen = false;
    } catch (error) {
      if (sequence !== this.loadSequence) {
        return;
      }

      this.photoError = error instanceof Error
        ? error.message
        : 'Unable to save the selected picture.';
    } finally {
      this.photoSaving = false;
      this.changes.markForCheck();
    }
  }

  /**
   * Removes the saved local picture.
   */
  removeProfilePhoto(): void {
    if (!this.canEditPhoto || !this.account) {
      return;
    }

    this.photoError = '';
    this.photoSuccess = '';

    try {
      this.photos.removePhoto(this.account.id);
      this.profilePhoto = null;
      this.photoSuccess = 'Profile picture removed.';
    } catch (error) {
      this.photoError = error instanceof Error
        ? error.message
        : 'Unable to remove the profile picture.';
    }

    this.changes.markForCheck();
  }

  private loadSavedPhoto(): void {
    this.profilePhoto = this.account
      ? this.photos.getPhoto(this.account.id)
      : null;
    this.loadAvatarColor();

    this.changes.markForCheck();
  }

  // =========================
  // EXISTING PROFILE HELPERS
  // =========================

  value(
    input: string | number | boolean | null | undefined,
  ): string {
    if (
      input === null ||
      input === undefined ||
      input === ''
    ) {
      return 'Not provided';
    }

    if (typeof input === 'boolean') {
      return input ? 'Yes' : 'No';
    }

    const normalized = String(input).trim();

    return normalized || 'Not provided';
  }

  capabilityList(input: string[] | undefined): string {
    if (input === undefined) {
      return 'Not provided';
    }

    if (!input.length) {
      return 'None declared';
    }

    return input
      .map((item) => item.replace(/[_-]/g, ' '))
      .join(', ');
  }

  verificationStatus(
    input: LocalCareRideUser['capacityVerificationStatus'],
  ): string {
    if (!input) {
      return 'Not provided';
    }

    if (input === 'in_review') {
      return 'In review';
    }

    return input.charAt(0).toUpperCase() + input.slice(1);
  }

  // =========================
  // EDIT PROFILE
  // =========================

  startEditing(): void {
    if (!this.canEditProfile || this.saving) {
      return;
    }

    this.editFullName = this.account?.fullName || '';
    this.editPhone = this.account?.phone || '';

    this.saveError = '';
    this.saveSuccess = '';
    this.editing = true;

    this.changes.markForCheck();
  }

  cancelEditing(): void {
    if (this.saving) {
      return;
    }

    this.editing = false;
    this.editFullName = '';
    this.editPhone = '';
    this.saveError = '';

    this.changes.markForCheck();
  }

  async saveProfile(): Promise<void> {
    if (
      !this.canEditProfile ||
      !this.editing ||
      this.saving
    ) {
      return;
    }

    this.saveError = '';
    this.saveSuccess = '';

    const fullName = this.editFullName.trim().replace(/\s+/g, ' ');
    const phone = this.editPhone.trim();

    if (fullName.length < 2 || fullName.length > 120) {
      this.saveError = 'Full name must contain 2 to 120 characters.';
      return;
    }

    if (!/^\+?[0-9\s()-]{7,20}$/.test(phone)) {
      this.saveError = 'Enter a valid phone number.';
      return;
    }

    this.saving = true;
    this.changes.markForCheck();

    try {
      const updated = await this.cloudAuth.updateOwnDriverProfile({
        fullName,
        phone,
      });

      this.account = this.fromCloudProfile(updated);

      this.editing = false;
      this.editFullName = '';
      this.editPhone = '';

      this.saveSuccess = 'Your profile was updated successfully.';
    } catch (error) {
      this.saveError = error instanceof Error
        ? error.message
        : 'Unable to save your profile. Please try again.';
    } finally {
      this.saving = false;
      this.changes.markForCheck();
    }
  }

  // =========================
  // RESET PASSWORD
  // =========================

  async sendResetPassword(): Promise<void> {
    if (
      !this.auth.cloudAuthEnabled ||
      !this.account?.email ||
      this.resettingPassword
    ) {
      return;
    }

    this.resetMessage = '';
    this.resetError = '';
    this.resettingPassword = true;

    this.changes.markForCheck();

    try {
      await this.auth.sendPasswordReset(this.account.email);

      this.resetMessage =
        'Password reset instructions have been requested. Please check your email.';
    } catch (error) {
      this.resetError = error instanceof Error
        ? error.message
        : 'Unable to request password reset. Please try again.';
    } finally {
      this.resettingPassword = false;
      this.changes.markForCheck();
    }
  }

  // =========================
  // LOAD DRIVER PROFILE
  // =========================

  private async loadProfile(): Promise<void> {
    const sequence = ++this.loadSequence;

    this.account = null;
    this.profilePhoto = null;
    this.loadError = '';
    this.loading = true;

    this.editing = false;
    this.saveError = '';
    this.saveSuccess = '';

    this.photoError = '';
    this.photoSuccess = '';
    this.activeSection = null;
    this.avatarModalOpen = false;
    this.photoSourceOpen = false;

    this.changes.markForCheck();

    if (!this.auth.cloudAuthEnabled) {
      const account = this.auth.getLocalAccount();

      this.account =
        account && account.accountType === 'driver'
          ? account
          : null;

      this.loadSavedPhoto();

      this.loading = false;
      this.changes.markForCheck();
      return;
    }

    try {
      const profile = await this.auth.currentCloudProfile();

      if (sequence !== this.loadSequence) {
        return;
      }

      this.account =
        profile?.role === 'driver' &&
        profile.accountStatus === 'approved'
          ? this.fromCloudProfile(profile)
          : null;

      this.loadSavedPhoto();
    } catch {
      if (sequence === this.loadSequence) {
        this.loadError =
          'Driver profile information could not be loaded. Please try again.';
      }
    } finally {
      if (sequence === this.loadSequence) {
        this.loading = false;
        this.changes.markForCheck();
      }
    }
  }

  private fromCloudProfile(
    profile: CloudAccountProfile,
  ): DriverProfileData {
    return {
      id: profile.id,
      accountType: profile.role,
      fullName: profile.fullName,
      email: profile.email,
      phone: profile.phone,
      address: profile.address,
      licenseNumber: profile.licenseNumber,
      vehicleType: profile.vehicleType,
      plateNumber: profile.plateNumber,
      wheelchairAccessible: profile.wheelchairAccessible,
      seniorAssistance: profile.seniorAssistance,
    };
  }
}
