import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { homePathForRole } from '../../core/models/care-ride.models';
import { IonIcon } from '@ionic/angular';

@Component({
  selector: 'app-login',
  standalone: true,
  host: { class: 'ion-page' },
  imports: [
    CommonModule,
    FormsModule,
    IonIcon
  ],
  templateUrl: './login.page.html',
  styleUrls: ['./login.page.scss']
})
export class LoginPage implements OnInit {

  email = '';
  password = '';

  rememberMe = false;
  showPassword = false;
  isLoading = false;

  errorMessage = '';

  constructor(
    private router: Router,
    private auth: AuthService,
  ) {}

  ngOnInit(): void {

    const rememberedEmail =
      localStorage.getItem('careride_remembered_email');

    const registeredEmail =
      localStorage.getItem('careride_last_registered_email');

    if (rememberedEmail) {
      this.email = rememberedEmail;
      this.rememberMe = true;
    } else if (registeredEmail) {
      this.email = registeredEmail;
    }
  }

  togglePassword(): void {
    this.showPassword = !this.showPassword;
  }

  clearError(): void {
    this.errorMessage = '';
  }

  login(): Promise<void> | void {

    this.errorMessage = '';

    const emailValue = this.email.trim();
    const passwordValue = this.password.trim();

    if (!emailValue) {
      this.errorMessage =
        'Please enter your email address.';
      return;
    }

    if (!passwordValue) {
      this.errorMessage =
        'Please enter your password.';
      return;
    }

    if (passwordValue.length < 6) {
      this.errorMessage =
        'Password must contain at least 6 characters.';
      return;
    }

    if (this.isLoading) {
      return;
    }

    this.isLoading = true;

    if (this.rememberMe) {
      localStorage.setItem(
        'careride_remembered_email',
        emailValue
      );
    } else {
      localStorage.removeItem(
        'careride_remembered_email'
      );
    }

    return this.auth.signIn(emailValue, passwordValue)
      .then(async (role) => {
        const destination = await this.destinationFor(role);
        if (!destination) {
          this.errorMessage = 'No CareRide profile is linked to this account.';
          return;
        }
        await this.router.navigate([destination]);
      })
      .catch((error: unknown) => {
        this.errorMessage = error instanceof Error
          ? error.message
          : 'Unable to sign in. Please try again.';
      })
      .finally(() => {
        this.isLoading = false;
      });
  }

  /**
   * Local sign-in keeps the role AuthService already checked.
   * Cloud sign-in asks for the profile home again, so a stored display role cannot choose the page.
   */
  private async destinationFor(role: string): Promise<string | null> {
    if (role !== 'passenger' && role !== 'driver' && role !== 'admin') {
      return null;
    }
    if (!this.auth.cloudAuthEnabled) {
      return homePathForRole(role);
    }
    const verified = await this.auth.homePath();
    if (verified !== '/dashboard' && verified !== '/driver' && verified !== '/admin') {
      return null;
    }
    return verified;
  }

  goToRegister(): void {
    this.router.navigate(['/register']);
  }

  forgotPassword(): void {
    const emailValue = this.email.trim();
    if (!this.auth.cloudAuthEnabled) {
      this.errorMessage = 'Password recovery is available after Supabase authentication is connected.';
      return;
    }
    if (!emailValue) {
      this.errorMessage = 'Enter your email address first, then try password recovery.';
      return;
    }
    void this.auth.sendPasswordReset(emailValue)
      .then(() => {
        this.errorMessage = '';
        alert('If this email is registered, a password reset message will be sent.');
      })
      .catch((error: unknown) => {
        this.errorMessage = error instanceof Error
          ? error.message
          : 'Unable to send a password reset message.';
      });
  }

  socialLogin(provider: string): void {

    alert(
      `${provider} sign in will be connected later.`
    );
  }
}

