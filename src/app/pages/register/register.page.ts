import { ChangeDetectorRef, Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { IonIcon } from '@ionic/angular';
import {
  DRIVER_ACCESSIBILITY_OPTIONS,
  DriverAccessibilitySelection,
  mapDriverAccessibilitySelections,
} from '../../core/models/driver-accessibility-capabilities';
import {
  DRIVER_VEHICLE_BODY_TYPES,
  DRIVER_VEHICLE_BRANDS,
  DRIVER_VEHICLE_COLORS,
  PHILIPPINE_DRIVER_VEHICLE_CATALOG,
  PHILIPPINE_VEHICLE_CAPACITY_CONFIGURATIONS,
  DriverVehicleBodyType,
  DriverVehicleModelEntry,
} from './philippine-vehicle-catalog';

const OTHER_VEHICLE_OPTION = 'Other / Not Listed';
const MANUAL_VEHICLE_OPTION = 'Manual entry (Admin review)';

@Component({
  selector: 'app-register',
  templateUrl: './register.page.html',
  styleUrls: ['./register.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IonIcon
  ]
})
export class RegisterPage {

  screen: 'choose' | 'passenger' | 'driver' = 'choose';
  accountType: string = 'passenger';

  fullName: string = '';
  email: string = '';
  phone: string = '';
  address: string = '';

  password: string = '';
  confirmPassword: string = '';

  showPassword: boolean = false;
  showConfirmPassword: boolean = false;

  driverFullName = '';
  driverEmail = '';
  driverPhone = '';
  driverAddress = '';
  driverPassword = '';
  driverConfirmPassword = '';
  driverLicense = '';
  driverLicenseExpirationDate = '';
  driverVehicleType = '';
  driverPlate = '';
  driverEmergencyContactName = '';
  driverEmergencyContactPhone = '';
  driverVehicleBodyType = '';
  driverVehicleBrand = '';
  driverVehicleModel = '';
  driverVehicleVariant = '';
  driverVehicleModelYearChoice = '';
  driverVehicleBrandOther = '';
  driverVehicleModelOther = '';
  driverVehicleVariantOther = '';
  driverVehicleModelYearManual: number | null = null;
  driverVehicleColor = '';
  driverPassengerSeatingCapacity: number | null = null;
  driverVehicleSeatingModified: 'no' | 'yes' | 'unsure' | '' = '';
  driverVehicleCapacityConfigurationId = '';
  driverCapacityCatalogDerived = false;
  driverWheelchair = false;
  driverSeniorAssistance = false;
  driverConsent = false;
  driverStep = 1;
  driverAccessibility: Record<DriverAccessibilitySelection, boolean> = {
    boardingExitingAssistance: false,
    caregiverSeating: false,
    walkerStorage: false,
    foldedWheelchairStorage: false,
    wheelchairRamp: false,
    wheelchairLift: false,
    wheelchairSecurement: false,
    passengerRestraints: false,
    mobilityAssistanceTraining: false,
    workingAirConditioning: false,
  };
  readonly driverSteps = [
    'Account information',
    'Driver information',
    'Vehicle information',
  ];
  readonly driverAccessibilityOptions = DRIVER_ACCESSIBILITY_OPTIONS;
  showDriverPassword = false;
  showDriverConfirmPassword = false;

  readonly vehicleBodyTypes = DRIVER_VEHICLE_BODY_TYPES;
  readonly vehicleBrands = DRIVER_VEHICLE_BRANDS;
  readonly vehicleColors = DRIVER_VEHICLE_COLORS;
  readonly vehicleOtherOption = OTHER_VEHICLE_OPTION;
  readonly vehicleManualOption = MANUAL_VEHICLE_OPTION;

  errorMessage: string = '';
  successMessage: string = '';
  isLoading: boolean = false;

  constructor(
    private router: Router,
    private auth: AuthService,
    private changeDetector: ChangeDetectorRef,
  ) {}

  // =========================
  // ACCOUNT TYPE
  // =========================

  selectAccountType(type: string): void {
    if (type !== 'passenger' && type !== 'family') {
      return;
    }
    this.accountType = type;
    this.clearMessages();
  }

  choosePassenger(): void {
    this.screen = 'passenger';
    this.accountType = 'passenger';
    this.clearMessages();
  }

  chooseDriver(): void {
    this.screen = 'driver';
    this.clearMessages();
  }

  backToChoices(): void {
    if (this.isLoading) {
      return;
    }
    this.screen = 'choose';
    this.clearMessages();
  }

  // =========================
  // PASSWORD VISIBILITY
  // =========================

  togglePassword(): void {
    this.showPassword = !this.showPassword;
  }

  toggleConfirmPassword(): void {
    this.showConfirmPassword = !this.showConfirmPassword;
  }

  toggleDriverPassword(): void {
    this.showDriverPassword = !this.showDriverPassword;
  }

  toggleDriverConfirmPassword(): void {
    this.showDriverConfirmPassword = !this.showDriverConfirmPassword;
  }

  get driverProgressPercent(): number {
    return (this.driverStep / this.driverSteps.length) * 100;
  }

  get maximumVehicleModelYear(): number {
    return new Date().getFullYear() + 1;
  }

  get availableDriverVehicleModels(): readonly DriverVehicleModelEntry[] {
    return PHILIPPINE_DRIVER_VEHICLE_CATALOG.filter((entry) =>
      entry.bodyType === this.driverVehicleBodyType && entry.brand === this.driverVehicleBrand);
  }

  get availableDriverVehicleVariants(): readonly string[] {
    return this.availableDriverVehicleModels.find((entry) => entry.model === this.driverVehicleModel)?.variants ?? [];
  }

  get availableDriverVehicleModelYears(): readonly number[] {
    // No complete authoritative PH year-by-variant source is currently curated.
    return [];
  }

  get resolvedDriverVehicleBrand(): string {
    return this.driverVehicleBrand === OTHER_VEHICLE_OPTION ? this.driverVehicleBrandOther.trim() : this.driverVehicleBrand;
  }

  get resolvedDriverVehicleModel(): string {
    return this.driverVehicleModel === OTHER_VEHICLE_OPTION ? this.driverVehicleModelOther.trim() : this.driverVehicleModel;
  }

  get resolvedDriverVehicleVariant(): string {
    return this.driverVehicleVariant === MANUAL_VEHICLE_OPTION ? this.driverVehicleVariantOther.trim() : this.driverVehicleVariant;
  }

  get resolvedDriverVehicleYear(): number | null {
    return this.driverVehicleModelYearManual;
  }

  get exactDriverVehicleCapacityConfiguration() {
    if (this.driverVehicleSeatingModified !== 'no' || !this.driverVehicleModelYearManual || !this.driverVehicleCapacityConfigurationId) return undefined;
    return PHILIPPINE_VEHICLE_CAPACITY_CONFIGURATIONS.find((configuration) =>
      configuration.id === this.driverVehicleCapacityConfigurationId
      && configuration.brand === this.resolvedDriverVehicleBrand
      && configuration.model === this.resolvedDriverVehicleModel
      && configuration.variant === this.resolvedDriverVehicleVariant
      && configuration.modelYear === this.driverVehicleModelYearManual);
  }

  get availableDriverVehicleCapacityConfigurations() {
    if (!this.driverVehicleModelYearManual) return [];
    return PHILIPPINE_VEHICLE_CAPACITY_CONFIGURATIONS.filter((configuration) =>
      configuration.brand === this.resolvedDriverVehicleBrand
      && configuration.model === this.resolvedDriverVehicleModel
      && configuration.variant === this.resolvedDriverVehicleVariant
      && configuration.modelYear === this.driverVehicleModelYearManual);
  }

  get driverCapacityBasis(): string {
    if (this.driverCapacityCatalogDerived && this.exactDriverVehicleCapacityConfiguration) {
      return `Catalog-derived: ${this.exactDriverVehicleCapacityConfiguration.sourceLabel}`;
    }
    if (this.driverPassengerSeatingCapacity !== null) return 'Manually declared by driver';
    return 'Not provided';
  }

  get driverCapacityVerificationStatus(): string {
    return 'Pending Admin Verification';
  }

  get vehicleRequiresAdminReview(): boolean {
    return this.driverVehicleBrand === OTHER_VEHICLE_OPTION || this.driverVehicleModel === OTHER_VEHICLE_OPTION
      || this.driverVehicleVariant === MANUAL_VEHICLE_OPTION || this.driverVehicleModelYearManual !== null;
  }

  get vehicleAdminReviewReasons(): string[] {
    const reasons: string[] = [];
    if (this.driverVehicleBrand === OTHER_VEHICLE_OPTION) reasons.push('brand');
    if (this.driverVehicleModel === OTHER_VEHICLE_OPTION) reasons.push('model');
    if (this.driverVehicleVariant === MANUAL_VEHICLE_OPTION) reasons.push('variant');
    if (this.driverVehicleModelYearManual !== null) reasons.push('model year');
    return reasons;
  }

  changeDriverVehicleBodyType(value: DriverVehicleBodyType | ''): void {
    this.driverVehicleBodyType = value;
    // Keep the legacy required vehicle_type value populated from the selected body type.
    this.driverVehicleType = value;
    this.resetDriverVehicleAfterBodyType();
    this.clearMessages();
  }

  changeDriverVehicleBrand(value: string): void {
    this.driverVehicleBrand = value;
    this.driverVehicleBrandOther = '';
    this.resetDriverVehicleAfterBrand();
    this.clearMessages();
  }

  changeDriverVehicleModel(value: string): void {
    this.driverVehicleModel = value;
    this.driverVehicleModelOther = '';
    this.resetDriverVehicleAfterModel();
    this.clearMessages();
  }

  changeDriverVehicleVariant(value: string): void {
    this.driverVehicleVariant = value;
    this.driverVehicleVariantOther = '';
    this.driverVehicleModelYearManual = null;
    this.driverVehicleModelYearChoice = '';
    this.driverVehicleCapacityConfigurationId = '';
    this.driverVehicleSeatingModified = '';
    this.resetDriverCapacity();
    this.clearMessages();
  }

  changeDriverVehicleYearChoice(value: string): void {
    this.driverVehicleModelYearChoice = value;
    this.driverVehicleModelYearManual = null;
    this.driverVehicleCapacityConfigurationId = '';
    this.resetDriverCapacity();
    this.applyExactCatalogCapacity();
    this.clearMessages();
  }

  changeDriverVehicleModelYear(value: number | null): void {
    this.driverVehicleModelYearManual = value;
    this.driverVehicleCapacityConfigurationId = '';
    this.selectSingleExactCapacityConfiguration();
    this.resetDriverCapacity();
    this.applyExactCatalogCapacity();
    this.clearMessages();
  }

  changeDriverVehicleSeatingModification(value: 'no' | 'yes' | 'unsure' | ''): void {
    this.driverVehicleSeatingModified = value;
    this.selectSingleExactCapacityConfiguration();
    this.resetDriverCapacity();
    this.applyExactCatalogCapacity();
    this.clearMessages();
  }

  changeDriverVehicleCapacityConfiguration(value: string): void {
    this.driverVehicleCapacityConfigurationId = value;
    this.resetDriverCapacity();
    this.applyExactCatalogCapacity();
    this.clearMessages();
  }

  normalizeDriverPlate(value: string): void {
    this.driverPlate = value.toLocaleUpperCase('en-PH');
    this.clearMessages();
  }

  private resetDriverVehicleAfterBodyType(): void {
    this.driverVehicleBrand = '';
    this.driverVehicleBrandOther = '';
    this.resetDriverVehicleAfterBrand();
    this.driverVehicleSeatingModified = '';
    this.driverVehicleCapacityConfigurationId = '';
    this.resetDriverCapacity();
  }

  private resetDriverVehicleAfterBrand(): void {
    this.driverVehicleModel = '';
    this.driverVehicleModelOther = '';
    this.resetDriverVehicleAfterModel();
    this.driverVehicleSeatingModified = '';
    this.driverVehicleCapacityConfigurationId = '';
    this.resetDriverCapacity();
  }

  private resetDriverVehicleAfterModel(): void {
    this.driverVehicleVariant = '';
    this.driverVehicleVariantOther = '';
    this.driverVehicleModelYearManual = null;
    this.driverVehicleModelYearChoice = '';
    this.driverVehicleCapacityConfigurationId = '';
    this.driverVehicleSeatingModified = '';
    this.resetDriverCapacity();
  }

  private resetDriverCapacity(): void {
    this.driverPassengerSeatingCapacity = null;
    this.driverCapacityCatalogDerived = false;
  }

  private applyExactCatalogCapacity(): void {
    const configuration = this.exactDriverVehicleCapacityConfiguration;
    if (!configuration) return;
    this.driverPassengerSeatingCapacity = configuration.passengerSeatsExcludingDriver;
    this.driverCapacityCatalogDerived = true;
  }

  private selectSingleExactCapacityConfiguration(): void {
    const configurations = this.availableDriverVehicleCapacityConfigurations;
    if (this.driverVehicleSeatingModified === 'no' && configurations.length === 1) {
      this.driverVehicleCapacityConfigurationId = configurations[0].id;
    }
  }

  get selectedDriverAccessibility(): string[] {
    return this.driverAccessibilityOptions
      .filter((option) => this.driverAccessibility[option.key])
      .map((option) => option.label);
  }

  /** Prepared for V3 metadata; the current registration submit remains legacy-only. */
  get selectedDriverAccessibilityIdentifiers(): string[] {
    return mapDriverAccessibilitySelections(
      this.driverAccessibilityOptions
        .filter((option) => this.driverAccessibility[option.key])
        .map((option) => option.key),
    );
  }

  onDriverFormSubmit(): Promise<void> | void {
    if (this.driverStep < this.driverSteps.length) {
      this.nextDriverStep();
      return;
    }
    return this.registerDriver();
  }

  nextDriverStep(): void {
    if (this.isLoading || this.driverStep >= this.driverSteps.length) return;
    this.clearMessages();
    if (!this.validateDriverStep(this.driverStep)) return;
    this.driverStep += 1;
  }

  previousDriverStep(): void {
    if (this.isLoading || this.driverStep <= 1) return;
    this.clearMessages();
    this.driverStep -= 1;
  }

  editDriverStep(step: number): void {
    if (this.isLoading || step < 1 || step >= this.driverStep || step > this.driverSteps.length) return;
    this.clearMessages();
    this.driverStep = step;
  }

  // =========================
  // REGISTER
  // =========================

  register(): Promise<void> | void {

    this.clearMessages();

    const fullNameValue = this.fullName.trim();
    const emailValue = this.email.trim().toLowerCase();
    const phoneValue = this.phone.trim();
    const addressValue = this.address.trim();
    const passwordValue = this.password.trim();
    const confirmPasswordValue = this.confirmPassword.trim();

    // Full name
    if (!fullNameValue) {
      this.errorMessage = 'Please enter your full name.';
      return;
    }

    // Email
    if (!emailValue) {
      this.errorMessage = 'Please enter your email address.';
      return;
    }

    // Simple email validation
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailPattern.test(emailValue)) {
      this.errorMessage = 'Please enter a valid email address.';
      return;
    }

    // Phone
    if (!phoneValue) {
      this.errorMessage = 'Please enter your phone number.';
      return;
    }

    const cleanedPhone = phoneValue.replace(/[\s()-]/g, '');

    if (!/^(09\d{9}|\+639\d{9})$/.test(cleanedPhone)) {
      this.errorMessage =
        'Please enter a valid Philippine mobile number.';
      return;
    }

    // Password
    if (!passwordValue) {
      this.errorMessage = 'Please enter a password.';
      return;
    }

    if (passwordValue.length < 6) {
      this.errorMessage =
        'Password must contain at least 6 characters.';
      return;
    }

    // Confirm password
    if (!confirmPasswordValue) {
      this.errorMessage = 'Please confirm your password.';
      return;
    }

    if (passwordValue !== confirmPasswordValue) {
      this.errorMessage = 'Passwords do not match.';
      return;
    }

    if (this.isLoading) {
      return;
    }

    this.isLoading = true;

    return this.auth.register(
      emailValue,
      passwordValue,
      fullNameValue,
      phoneValue,
      this.accountType === 'family' ? 'family' : 'self',
      addressValue,
      'passenger',
    )
      .then((result) => {
        if (result?.accountStatus === 'pending') {
          this.password = '';
          this.confirmPassword = '';
          this.successMessage = this.pendingRegistrationMessage(
            'Account submitted. An admin must accept it before you can sign in.',
            result.emailConfirmationRequired,
          );
        } else {
          this.successMessage = this.auth.configured
            ? 'Account created. Check your email if confirmation is required, then sign in.'
            : 'Account submitted. An admin must accept it before you can sign in.';
        }
        this.returnToLogin();
      })
      .catch((error: unknown) => {
        this.errorMessage = error instanceof Error
          ? error.message
          : 'Unable to create the account. Please try again.';
      })
      .finally(() => {
        this.isLoading = false;
        // This app runs without Zone.js; refresh the async success/error state.
        this.changeDetector.detectChanges();
      });
  }

  registerDriver(): Promise<void> | void {
    this.clearMessages();

    if (this.isLoading || this.driverStep !== this.driverSteps.length) return;
    for (let step = 1; step < this.driverSteps.length; step += 1) {
      if (!this.validateDriverStep(step)) {
        this.driverStep = step;
        return;
      }
    }
    if (!this.validateDriverStep(this.driverSteps.length)) return;

    const fullNameValue = this.driverFullName.trim();
    const emailValue = this.driverEmail.trim().toLowerCase();
    const phoneValue = this.driverPhone.trim();
    const addressValue = this.driverAddress.trim();
    const passwordValue = this.driverPassword.trim();
    const confirmPasswordValue = this.driverConfirmPassword.trim();
    const licenseValue = this.driverLicense.trim();
    const vehicleValue = this.driverVehicleType.trim();
    const plateValue = this.driverPlate.trim();

    this.isLoading = true;
    return this.auth.register(
      emailValue,
      passwordValue,
      fullNameValue,
      phoneValue,
      'self',
      addressValue,
      'driver',
      {
        licenseNumber: licenseValue,
        vehicleType: vehicleValue,
        plateNumber: plateValue,
        wheelchairAccessible: this.driverWheelchair,
        seniorAssistance: this.driverSeniorAssistance,
      },
    )
      .then((result) => {
        this.driverPassword = '';
        this.driverConfirmPassword = '';
        this.successMessage = this.pendingRegistrationMessage(
          'Driver account submitted. An admin must approve it before you can sign in.',
          result?.emailConfirmationRequired === true,
        );
        this.returnToLogin();
      })
      .catch((error: unknown) => {
        this.errorMessage = error instanceof Error
          ? error.message
          : 'Unable to create the driver account. Please try again.';
      })
      .finally(() => {
        this.isLoading = false;
        this.changeDetector.detectChanges();
      });
  }

  private validateDriverStep(step: number): boolean {
    const fail = (message: string): false => {
      this.errorMessage = message;
      return false;
    };

    if (step === 1) {
      const emailValue = this.driverEmail.trim().toLowerCase();
      const cleanedPhone = this.driverPhone.trim().replace(/[\s()-]/g, '');
      const passwordValue = this.driverPassword.trim();
      const confirmPasswordValue = this.driverConfirmPassword.trim();
      if (!emailValue) return fail('Please enter your email address.');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailValue)) return fail('Please enter a valid email address.');
      if (!cleanedPhone) return fail('Please enter your mobile number.');
      if (!/^(09\d{9}|\+639\d{9})$/.test(cleanedPhone)) return fail('Please enter a valid Philippine mobile number.');
      if (!passwordValue) return fail('Please enter a password.');
      if (passwordValue.length < 6) return fail('Password must contain at least 6 characters.');
      if (!confirmPasswordValue) return fail('Please confirm your password.');
      if (passwordValue !== confirmPasswordValue) return fail('Password and confirm password must match.');
      return true;
    }

    if (step === 2) {
      if (!this.driverFullName.trim()) return fail('Please enter your full name.');
      if (!this.driverAddress.trim()) return fail('Please enter your complete address.');
      if (!this.driverLicense.trim()) return fail("Please enter your driver's license number.");
      return true;
    }

    if (step === 3) {
      if (!this.driverPlate.trim()) return fail('Please enter the vehicle plate number.');
      if (!this.vehicleBodyTypes.includes(this.driverVehicleBodyType as DriverVehicleBodyType)) return fail('Please select the vehicle body type.');
      if (!this.driverVehicleBrand || (this.driverVehicleBrand === OTHER_VEHICLE_OPTION && !this.driverVehicleBrandOther.trim())) return fail('Please select or enter the vehicle brand.');
      if (!this.driverVehicleModel || (this.driverVehicleModel === OTHER_VEHICLE_OPTION && !this.driverVehicleModelOther.trim())) return fail('Please select or enter the vehicle model.');
      if (!this.driverConsent) return fail('Please confirm the information and consent before submitting.');
      return true;
    }
    return true;
  }

  // =========================
  // CLEAR MESSAGES
  // =========================

  clearMessages(): void {
    this.errorMessage = '';
    this.successMessage = '';
  }

  private pendingRegistrationMessage(approval: string, emailConfirmationRequired: boolean): string {
    if (!emailConfirmationRequired) {
      return approval;
    }
    return `${approval} Check your email to confirm this address before you sign in.`;
  }

  private returnToLogin(): void {
    setTimeout(() => {
      void this.router.navigate(['/login']);
    }, 2200);
  }

  // =========================
  // BACK TO LOGIN
  // =========================

  backToLogin(): void {

    if (this.isLoading) {
      return;
    }

    this.router.navigate(['/login']);
  }
}
