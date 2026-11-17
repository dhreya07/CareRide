import { Component, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
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
  ) {
    registerCareIcons();
    installAdminAuthProbe();
    installAdminAuthTestDialog();
    installPasswordRecoveryTestDialog();
    if (Capacitor.isNativePlatform()) {
      void this.listenForNativeCallbacks();
    } else if (typeof window !== 'undefined' && isBrowserSignupCallback(window.location.href)) {
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

  private async handleCallback(url: string, native: boolean): Promise<void> {
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
