import { Component } from '@angular/core';
import { IonApp, IonRouterOutlet } from '@ionic/angular';
import { installAdminAuthProbe } from './core/services/admin-auth-probe';
import { installAdminAuthTestDialog } from './core/services/admin-auth-test-dialog';
import { installPasswordRecoveryTestDialog } from './core/services/password-recovery-test-dialog';
import { registerCareIcons } from './core/icons';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  imports: [IonApp, IonRouterOutlet],
})
export class AppComponent {
  constructor() {
    registerCareIcons();
    installAdminAuthProbe();
    installAdminAuthTestDialog();
    installPasswordRecoveryTestDialog();
  }
}
