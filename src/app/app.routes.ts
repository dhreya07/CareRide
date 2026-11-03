import { Routes } from '@angular/router';
import { authGuard, guestGuard } from './core/guards/auth.guard';

export const routes: Routes = [

  // =========================
  // DEFAULT ROUTE
  // =========================
  {
    path: '',
    redirectTo: 'login',
    pathMatch: 'full'
  },


  // =========================
  // AUTHENTICATION
  // =========================
  {
    path: 'login',
    canActivate: [guestGuard],
    loadComponent: () =>
      import('./pages/login/login.page')
        .then(m => m.LoginPage)
  },

  {
    path: 'register',
    canActivate: [guestGuard],
    loadComponent: () =>
      import('./pages/register/register.page')
        .then(m => m.RegisterPage)
  },
  {
    path: 'reset-password',
    loadComponent: () =>
      import('./pages/reset-password/reset-password.page')
        .then(m => m.ResetPasswordPage)
  },


  // =========================
  // PASSENGER DASHBOARD
  // =========================
  {
    path: 'notifications',
    canActivate: [authGuard],
    data: { roles: ['passenger', 'driver'] },
    loadComponent: () =>
      import('./pages/notifications/notifications.page')
        .then(m => m.NotificationsPage)
  },
  {
    path: 'dashboard',
    canActivate: [authGuard],
    data: { roles: ['passenger'] },
    loadComponent: () =>
      import('./pages/dashboard/dashboard.page')
        .then(m => m.DashboardPage)
  },


  // =========================
  // REQUEST RIDE
  // =========================
  {
    path: 'request-ride',
    canActivate: [authGuard],
    data: { roles: ['passenger'] },
    loadComponent: () =>
      import('./pages/request-ride/request-ride.page')
        .then(m => m.RequestRidePage)
  },


  // =========================
  // SCHEDULED RIDES
  // =========================
  {
    path: 'scheduled-rides',
    canActivate: [authGuard],
    data: { roles: ['passenger'] },
    loadComponent: () =>
      import('./pages/scheduled-rides/scheduled-rides.page')
        .then(m => m.ScheduledRidesPage)
  },


  // =========================
  // RIDE DETAILS
  // =========================
  {
    path: 'ride-details/:id',
    canActivate: [authGuard],
    data: { roles: ['passenger', 'driver', 'admin'] },
    loadComponent: () =>
      import('./pages/ride-details/ride-details.page')
        .then(m => m.RideDetailsPage)
  },


  // =========================
  // RIDE HISTORY
  // =========================
  {
    path: 'ride-history',
    canActivate: [authGuard],
    data: { roles: ['passenger'] },
    loadComponent: () =>
      import('./pages/ride-history/ride-history.page')
        .then(m => m.RideHistoryPage)
  },


  // =========================
  // PROFILE
  // =========================
  {
    path: 'profile',
    canActivate: [authGuard],
    data: { roles: ['passenger'] },
    loadComponent: () =>
      import('./pages/profile/profile.page')
        .then(m => m.ProfilePage)
  },


  // =========================
  // SAFETY CENTER
  // =========================
  {
    path: 'safety',
    canActivate: [authGuard],
    data: { roles: ['passenger'] },
    loadComponent: () =>
      import('./pages/safety/safety.page')
        .then(m => m.SafetyPage)
  },


  // =========================
  // DRIVER
  // =========================
  {
    path: 'driver',
    canActivate: [authGuard],
    data: { roles: ['driver'] },
    loadComponent: () =>
      import('./pages/driver/driver.page')
        .then(m => m.DriverPage)
  },
  {
    path: 'driver/schedule',
    canActivate: [authGuard],
    data: { roles: ['driver'] },
    loadComponent: () =>
      import('./pages/driver/driver.page')
        .then(m => m.DriverPage)
  },
  {
    path: 'driver/active',
    canActivate: [authGuard],
    data: { roles: ['driver'] },
    loadComponent: () =>
      import('./pages/driver/driver.page')
        .then(m => m.DriverPage)
  },
  {
    path: 'driver/clients',
    canActivate: [authGuard],
    data: { roles: ['driver'] },
    loadComponent: () =>
      import('./pages/driver/driver.page')
        .then(m => m.DriverPage)
  },
  {
    path: 'driver/history',
    canActivate: [authGuard],
    data: { roles: ['driver'] },
    loadComponent: () =>
      import('./pages/driver/driver.page')
        .then(m => m.DriverPage)
  },


  // =========================
  // ADMIN
  // =========================
  {
    path: 'admin',
    canActivate: [authGuard],
    data: { roles: ['admin'] },
    loadComponent: () =>
      import('./pages/admin/admin.page')
        .then(m => m.AdminPage)
  },
  {
    path: 'admin/accounts',
    canActivate: [authGuard],
    data: { roles: ['admin'] },
    loadComponent: () =>
      import('./pages/admin/admin.page')
        .then(m => m.AdminPage)
  },
  {
    path: 'admin/accepted',
    canActivate: [authGuard],
    data: { roles: ['admin'] },
    loadComponent: () =>
      import('./pages/admin/admin.page')
        .then(m => m.AdminPage)
  },
  {
    path: 'admin/history',
    canActivate: [authGuard],
    data: { roles: ['admin'] },
    loadComponent: () =>
      import('./pages/admin/admin.page')
        .then(m => m.AdminPage)
  },
  {
    path: 'admin/drivers',
    canActivate: [authGuard],
    data: { roles: ['admin'] },
    loadComponent: () =>
      import('./pages/admin/admin.page')
        .then(m => m.AdminPage)
  },


  // =========================
  // UNKNOWN ROUTE
  // =========================
  {
    path: '**',
    redirectTo: 'login'
  }

];