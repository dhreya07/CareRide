import { ChangeDetectorRef, Component, DestroyRef, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
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
  successMessage = '';

  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private auth: AuthService,
    private changeDetector: ChangeDetectorRef,
    private destroyRef: DestroyRef,
  ) {}

  ngOnInit(): void {
    const confirmation = this.route.snapshot.queryParamMap.get('authConfirmation');
    if (confirmation === 'confirmed') {
      this.successMessage = 'Email confirmed. Sign in to check your account status; pending accounts still require Admin approval.';
    } else if (confirmation === 'failed') {
      this.errorMessage = 'Email confirmation could not be verified. The link may be invalid or expired. Request a new confirmation email.';
    }
    if (confirmation) {
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { authConfirmation: null },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
    }

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
    this.successMessage = '';
  }

  login(): Promise<void> | void {

    this.errorMessage = '';
    this.successMessage = '';

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
        if (!this.destroyRef.destroyed) {
          this.changeDetector.detectChanges();
        }
      });
  }

  /**
   * AuthService returns the role from the freshly approved database profile.
   * The destination guard independently checks access; no display role is used.
   */
  private async destinationFor(role: string): Promise<string | null> {
    if (role !== 'passenger' && role !== 'driver' && role !== 'admin') {
      return null;
    }
    return homePathForRole(role);
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
      })
      .finally(() => {
        if (!this.destroyRef.destroyed) {
          this.changeDetector.detectChanges();
        }
      });
  }

  socialLogin(provider: string): void {

    alert(
      `${provider} sign in will be connected later.`
    );
  }
}

