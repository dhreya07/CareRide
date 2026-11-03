import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { IonIcon } from '@ionic/angular';

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
  driverVehicleType = '';
  driverPlate = '';
  driverWheelchair = false;
  driverSeniorAssistance = false;
  showDriverPassword = false;
  showDriverConfirmPassword = false;

  errorMessage: string = '';
  successMessage: string = '';
  isLoading: boolean = false;

  constructor(
    private router: Router,
    private auth: AuthService,
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
      });
  }

  registerDriver(): Promise<void> | void {
    this.clearMessages();

    const fullNameValue = this.driverFullName.trim();
    const emailValue = this.driverEmail.trim().toLowerCase();
    const phoneValue = this.driverPhone.trim();
    const addressValue = this.driverAddress.trim();
    const passwordValue = this.driverPassword.trim();
    const confirmPasswordValue = this.driverConfirmPassword.trim();
    const licenseValue = this.driverLicense.trim();
    const vehicleValue = this.driverVehicleType.trim();
    const plateValue = this.driverPlate.trim();

    if (!fullNameValue) {
      this.errorMessage = 'Please enter your full name.';
      return;
    }
    if (!emailValue) {
      this.errorMessage = 'Please enter your email address.';
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailValue)) {
      this.errorMessage = 'Please enter a valid email address.';
      return;
    }
    if (!phoneValue) {
      this.errorMessage = 'Please enter your mobile number.';
      return;
    }
    const cleanedPhone = phoneValue.replace(/[\s()-]/g, '');
    if (!/^(09\d{9}|\+639\d{9})$/.test(cleanedPhone)) {
      this.errorMessage = 'Please enter a valid Philippine mobile number.';
      return;
    }
    if (!addressValue) {
      this.errorMessage = 'Please enter your complete address.';
      return;
    }
    if (!passwordValue) {
      this.errorMessage = 'Please enter a password.';
      return;
    }
    if (passwordValue.length < 6) {
      this.errorMessage = 'Password must contain at least 6 characters.';
      return;
    }
    if (!confirmPasswordValue) {
      this.errorMessage = 'Please confirm your password.';
      return;
    }
    if (passwordValue !== confirmPasswordValue) {
      this.errorMessage = 'Password and confirm password must match.';
      return;
    }
    if (!licenseValue) {
      this.errorMessage = 'Please enter your driver\'s license number.';
      return;
    }
    if (!vehicleValue) {
      this.errorMessage = 'Please select a vehicle type.';
      return;
    }
    if (!plateValue) {
      this.errorMessage = 'Please enter the vehicle plate number.';
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
      });
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