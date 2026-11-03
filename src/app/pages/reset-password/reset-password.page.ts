import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';

type RecoveryMode = 'checking' | 'expired' | 'ready' | 'missing' | 'disabled' | 'sent' | 'updated';

@Component({
  selector: 'app-reset-password',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './reset-password.page.html',
  styleUrls: ['./reset-password.page.scss'],
})
export class ResetPasswordPage implements OnInit {
  mode: RecoveryMode = 'checking';
  email = '';
  password = '';
  confirmPassword = '';
  message = '';
  isLoading = false;
  linkCheck: Promise<void> = Promise.resolve();

  constructor(
    private auth: AuthService,
    private changes: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.linkCheck = this.readArrival();
  }

  requestLink(): Promise<void> {
    this.message = '';
    const email = this.email.trim();
    if (!email) {
      this.message = 'Enter your email address first, then request a new link.';
      return Promise.resolve();
    }
    if (this.isLoading) {
      return Promise.resolve();
    }
    this.isLoading = true;
    return this.auth.sendPasswordReset(email)
      .then(() => {
        this.email = '';
        this.mode = 'sent';
        this.message = 'If this email is registered, a password reset message will be sent.';
      })
      .catch((error: unknown) => {
        this.message = error instanceof Error
          ? error.message
          : 'Unable to send a password reset message.';
      })
      .finally(() => {
        this.isLoading = false;
        this.changes.detectChanges();
      });
  }

  savePassword(): Promise<void> {
    this.message = '';
    if (this.password.length < 6) {
      this.message = 'Password must contain at least 6 characters.';
      return Promise.resolve();
    }
    if (this.password !== this.confirmPassword) {
      this.message = 'Passwords do not match.';
      return Promise.resolve();
    }
    if (this.isLoading) {
      return Promise.resolve();
    }
    this.isLoading = true;
    const nextPassword = this.password;
    return this.auth.updateRecoveredPassword(nextPassword)
      .then(() => {
        this.password = '';
        this.confirmPassword = '';
        this.mode = 'updated';
        this.message = 'Your password was updated. Sign in with the new password.';
      })
      .catch((error: unknown) => {
        this.password = '';
        this.confirmPassword = '';
        this.message = error instanceof Error
          ? error.message
          : 'The password could not be updated.';
      })
      .finally(() => {
        this.isLoading = false;
        this.changes.detectChanges();
      });
  }

  private async readArrival(): Promise<void> {
    try {
      this.mode = await this.auth.openPasswordRecovery(window.location.href);
      if (this.mode === 'expired') {
        this.message = 'This recovery link is invalid or has expired. Request a new link.';
      } else if (this.mode === 'disabled') {
        this.message = 'Password recovery is available after Supabase authentication is connected.';
      }
    } catch (error: unknown) {
      this.mode = 'expired';
      this.message = error instanceof Error
        ? error.message
        : 'This recovery link is invalid or has expired. Request a new link.';
    } finally {
      this.changes.detectChanges();
    }
  }
}
