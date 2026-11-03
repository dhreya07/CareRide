import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AccountRole } from '../models/care-ride.models';
import { AuthService } from '../services/auth.service';
import { recoveryResetUrl } from '../services/password-recovery';

export const authGuard: CanActivateFn = async (route) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const roles = route.data['roles'] as readonly AccountRole[] | undefined;
  if (await auth.hasAccess(roles)) {
    return true;
  }
  if (await auth.isSignedIn()) {
    return router.createUrlTree([await auth.homePath()]);
  }
  return router.createUrlTree(['/login']);
};

export const guestGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const recovery = typeof window === 'undefined' ? null : recoveryResetUrl(window.location.href);
  if (recovery) {
    const url = new URL(recovery);
    return router.createUrlTree(['/reset-password'], {
      queryParams: Object.fromEntries(url.searchParams.entries()),
      fragment: url.hash.startsWith('#') ? url.hash.slice(1) : undefined,
    });
  }
  if (!(await auth.isSignedIn())) {
    return true;
  }
  return router.createUrlTree([await auth.homePath()]);
};
