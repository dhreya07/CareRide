import { Component, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from './core/services/auth.service';
import { homePathForRole } from './core/models/care-ride.models';
import { App } from '@capacitor/app';
import { Capacitor, PluginListenerHandle } from '@capacitor/core';
import { IonApp, IonRouterOutlet } from '@ionic/angular';
import { installAdminAuthProbe } from './core/services/admin-auth-probe';
import { installAdminAuthTestDialog } from './core/services/admin-auth-test-dialog';
import { installPasswordRecoveryTestDialog } from './core/services/password-recovery-test-dialog';
import { registerCareIcons } from './core/icons';
import {
  isBrowserSignupCallback,
  SignupConfirmationCallbackService,
} from './core/services/signup-confirmation-callback';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  imports: [IonApp, IonRouterOutlet],
})
export class AppComponent implements OnDestroy {
  private appUrlListener: PluginListenerHandle | null = null;
  private destroyed = false;

  constructor(
    private readonly router: Router,
    private readonly signupCallback: SignupConfirmationCallbackService,
    private readonly auth: AuthService,
  ) {
    registerCareIcons();
    installAdminAuthProbe();
    installAdminAuthTestDialog();
    installPasswordRecoveryTestDialog();
    if (Capacitor.isNativePlatform()) {
      void this.listenForNativeCallbacks();
    } else if (typeof window !== 'undefined' && (isBrowserSignupCallback(window.location.href) || this.isBrowserGoogleCallback(window.location.href))) {
      void this.handleCallback(window.location.href, false);
    }
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    if (this.appUrlListener) {
      void this.appUrlListener.remove();
      this.appUrlListener = null;
    }
  }

  private async listenForNativeCallbacks(): Promise<void> {
    try {
      const listener = await App.addListener('appUrlOpen', ({ url }) => {
        void this.handleCallback(url, true);
      });
      if (this.destroyed) {
        await listener.remove();
        return;
      }
      this.appUrlListener = listener;

      const launch = await App.getLaunchUrl();
      if (launch?.url) await this.handleCallback(launch.url, true);
    } catch {
      // Link handling failure must not block normal app startup or login.
    }
  }

  private isBrowserGoogleCallback(url: string): boolean {
    try {
      const parsed = new URL(url);

      if (
        !['http:', 'https:'].includes(parsed.protocol) ||
        parsed.pathname !== '/login'
      ) {
        return false;
      }

      const hash = new URLSearchParams(parsed.hash.slice(1));

      return (
        parsed.searchParams.has('code') ||
        hash.has('access_token') ||
        hash.has('error')
      );
    } catch {
      return false;
    }
  }
  private async handleCallback(url: string, native: boolean): Promise<void> {
    // Google OAuth callback is separate from signup confirmation.
    let isGoogleCallback = false;

    try {
      const parsed = new URL(url);
      isGoogleCallback = native
        ? parsed.protocol === 'careride-staging:' &&
          parsed.hostname === 'oauth' &&
          parsed.pathname === '/callback'
        : parsed.pathname === '/login' &&
          (parsed.searchParams.has('code') ||
           parsed.hash.includes('access_token='));
    } catch {
      return;
    }

    if (isGoogleCallback) {
      if (!native && typeof window !== 'undefined') {
        window.history.replaceState(
          {},
          '',
          window.location.pathname
        );
      }

      try {
        const role = await this.auth.completeGoogleSignIn(url);
        await this.router.navigate([homePathForRole(role)], {
          replaceUrl: true,
        });
      } catch (error) {
        await this.router.navigate(['/login'], {
          queryParams: {
            googleError: error instanceof Error
              ? error.message
              : 'Google Sign-In failed.',
          },
          replaceUrl: true,
        });
      }
      return;
    }

    const result = await this.signupCallback.handle(url, native);
    if (result === 'not-callback' || result === 'duplicate' || this.destroyed) return;

    if (!native && typeof window !== 'undefined') {
      // Verification has completed (or failed) before callback material is removed.
      window.history.replaceState({}, '', window.location.pathname);
    }
    await this.router.navigate(['/login'], {
      queryParams: { authConfirmation: result === 'confirmed' ? 'confirmed' : 'failed' },
    });
  }
}



