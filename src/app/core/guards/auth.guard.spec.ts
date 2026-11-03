import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { authGuard, guestGuard } from './auth.guard';

@Component({ standalone: true, template: '' })
class GuardProbeComponent {}

describe('route guards with cloud profile checks', () => {
  afterEach(() => {
    localStorage.clear();
    window.history.replaceState({}, '', '/');
    TestBed.resetTestingModule();
  });

  it('lets an approved passenger, driver, and admin open only their own area', async () => {
    await expect(open('/dashboard', access('passenger'))).resolves.toBe('/dashboard');
    TestBed.resetTestingModule();
    await expect(open('/driver', access('driver'))).resolves.toBe('/driver');
    TestBed.resetTestingModule();
    await expect(open('/admin', access('admin'))).resolves.toBe('/admin');
  });

  it('sends an approved driver away from the passenger dashboard', async () => {
    const url = await open('/dashboard', access('driver'));
    expect(url).toBe('/driver');
  });

  it('keeps pending and rejected sessions on the login page despite a stored admin role', async () => {
    localStorage.setItem('careride_logged_in', 'true');
    localStorage.setItem('careride_user_type', 'admin');
    localStorage.setItem('careride_user_name', 'Stale Admin');
    const pending = {
      hasAccess: vi.fn(async () => false),
      isSignedIn: vi.fn(async () => false),
      homePath: vi.fn(async () => {
        throw new Error('A stored role must not choose the destination.');
      }),
    };

    await expect(open('/admin', pending)).resolves.toBe('/login');
    expect(pending.homePath).not.toHaveBeenCalled();

    TestBed.resetTestingModule();
    localStorage.setItem('careride_logged_in', 'true');
    localStorage.setItem('careride_user_type', 'admin');
    const rejected = {
      hasAccess: vi.fn(async () => false),
      isSignedIn: vi.fn(async () => false),
      homePath: vi.fn(async () => '/admin'),
    };
    await expect(open('/dashboard', rejected)).resolves.toBe('/login');
    expect(rejected.homePath).not.toHaveBeenCalled();
  });

  it('sends a recovery hash that opened login to the reset page', async () => {
    window.history.replaceState(
      {},
      '',
      '/login#access_token=token-a&refresh_token=token-b&type=recovery',
    );

    const url = await open('/login', {
      hasAccess: vi.fn(async () => false),
      isSignedIn: vi.fn(async () => false),
      homePath: vi.fn(async () => '/login'),
    });

    expect(url.startsWith('/reset-password')).toBe(true);
    expect(url).toContain('type=recovery');
  });

  it('allows an unapproved visitor to open login and sends an approved admin home', async () => {
    await expect(open('/login', {
      hasAccess: vi.fn(async () => false),
      isSignedIn: vi.fn(async () => false),
      homePath: vi.fn(async () => '/admin'),
    })).resolves.toBe('/login');

    TestBed.resetTestingModule();
    localStorage.setItem('careride_user_type', 'passenger');
    await expect(open('/login', access('admin'))).resolves.toBe('/admin');
  });
});

function access(role: 'passenger' | 'driver' | 'admin') {
  const destination = role === 'admin' ? '/admin' : role === 'driver' ? '/driver' : '/dashboard';
  return {
    hasAccess: vi.fn(async (roles?: readonly string[]) => !roles?.length || roles.includes(role)),
    isSignedIn: vi.fn(async () => true),
    homePath: vi.fn(async () => destination),
  };
}

async function open(path: string, auth: {
  hasAccess: ReturnType<typeof vi.fn>;
  isSignedIn: ReturnType<typeof vi.fn>;
  homePath: ReturnType<typeof vi.fn>;
}): Promise<string> {
  await TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: 'login', canActivate: [guestGuard], component: GuardProbeComponent },
        { path: 'reset-password', component: GuardProbeComponent },
        { path: 'dashboard', canActivate: [authGuard], data: { roles: ['passenger'] }, component: GuardProbeComponent },
        { path: 'driver', canActivate: [authGuard], data: { roles: ['driver'] }, component: GuardProbeComponent },
        { path: 'admin', canActivate: [authGuard], data: { roles: ['admin'] }, component: GuardProbeComponent },
      ]),
      { provide: AuthService, useValue: auth },
    ],
  }).compileComponents();
  const router = TestBed.inject(Router);
  await router.navigateByUrl(path);
  return router.url;
}
