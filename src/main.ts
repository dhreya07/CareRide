import { bootstrapApplication } from '@angular/platform-browser';
import { RouteReuseStrategy, provideRouter, withComponentInputBinding, withPreloading, PreloadAllModules } from '@angular/router';
import { IonicRouteStrategy, provideIonicAngular } from '@ionic/angular';

import { routes } from './app/app.routes';
import { AppComponent } from './app/app.component';
import { installAdminAuthProbe } from './app/core/services/admin-auth-probe';
import { installAdminAuthTestDialog } from './app/core/services/admin-auth-test-dialog';
import { installPasswordRecoveryTestDialog } from './app/core/services/password-recovery-test-dialog';
import { redirectRecoveryCallback } from './app/core/services/password-recovery';

if (!redirectRecoveryCallback()) {
  installAdminAuthProbe();
  installAdminAuthTestDialog();
  installPasswordRecoveryTestDialog();

  bootstrapApplication(AppComponent, {
    providers: [
      { provide: RouteReuseStrategy, useClass: IonicRouteStrategy },
      provideIonicAngular(),
      provideRouter(routes, withPreloading(PreloadAllModules), withComponentInputBinding()),
    ],
  });
}
