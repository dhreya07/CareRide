import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { LoginPage } from './login.page';

describe('LoginPage cloud sign-in preparation', () => {
  afterEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
  });

  it('sends an approved local driver to the driver page', async () => {
    const homePath = vi.fn();
    const { component, navigate } = await createLogin({
      cloudAuthEnabled: false,
      configured: false,
      signIn: vi.fn().mockResolvedValue('driver'),
      homePath,
    });
    component.email = 'driver@careride.local';
    component.password = 'CareRideDriver1';

    await component.login();

    expect(navigate).toHaveBeenCalledWith(['/driver']);
    expect(homePath).not.toHaveBeenCalled();
  });

  it('uses the freshly authenticated cloud role without a redundant profile request', async () => {
    localStorage.setItem('careride_logged_in', 'true');
    localStorage.setItem('careride_user_type', 'passenger');
    const homePath = vi.fn().mockResolvedValue('/admin');
    const { component, navigate } = await createLogin({
      cloudAuthEnabled: true,
      configured: false,
      signIn: vi.fn().mockResolvedValue('admin'),
      homePath,
    });
    component.email = 'admin@example.com';
    component.password = 'secret-pass';

    await component.login();

    expect(homePath).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(['/admin']);
    expect(navigate).not.toHaveBeenCalledWith(['/dashboard']);
  });

  it('shows the pending and rejected messages and does not open a dashboard', async () => {
    const pending = await createLogin({
      cloudAuthEnabled: true,
      configured: false,
      signIn: vi.fn().mockRejectedValue(new Error(
        'Account Under Review. An admin must approve this account before you can sign in.',
      )),
      homePath: vi.fn().mockResolvedValue('/dashboard'),
    });
    pending.component.email = 'pat@example.com';
    pending.component.password = 'secret-pass';

    await pending.component.login();

    expect(pending.component.errorMessage).toContain('Account Under Review');
    expect(pending.navigate).not.toHaveBeenCalled();

    TestBed.resetTestingModule();
    const rejected = await createLogin({
      cloudAuthEnabled: true,
      configured: false,
      signIn: vi.fn().mockRejectedValue(new Error(
        'Account Registration Rejected. This account cannot sign in.',
      )),
      homePath: vi.fn().mockResolvedValue('/driver'),
    });
    rejected.component.email = 'pat@example.com';
    rejected.component.password = 'secret-pass';

    await rejected.component.login();

    expect(rejected.component.errorMessage).toContain('Account Registration Rejected');
    expect(rejected.navigate).not.toHaveBeenCalled();
  });

  it('shows invalid-credential and email-confirmation guidance and clears loading on login errors', async () => {
    const invalid = await createLogin({
      cloudAuthEnabled: true,
      configured: false,
      signIn: vi.fn().mockRejectedValue(new Error('Incorrect email or password. Check your details and try again.')),
      homePath: vi.fn(),
    });
    invalid.component.email = 'pat@example.com';
    invalid.component.password = 'secret-pass';
    await invalid.component.login();
    expect(invalid.component.errorMessage).toContain('Incorrect email or password');
    expect(invalid.component.isLoading).toBe(false);

    TestBed.resetTestingModule();
    const unconfirmed = await createLogin({
      cloudAuthEnabled: true,
      configured: false,
      signIn: vi.fn().mockRejectedValue(new Error('Please confirm your email address using the link we sent before signing in.')),
      homePath: vi.fn(),
    });
    unconfirmed.component.email = 'pat@example.com';
    unconfirmed.component.password = 'secret-pass';
    await unconfirmed.component.login();
    expect(unconfirmed.component.errorMessage).toContain('confirm your email address');
    expect(unconfirmed.component.isLoading).toBe(false);
  });

  it('shows a useful network failure instead of leaving login loading', async () => {
    const { component, navigate } = await createLogin({
      cloudAuthEnabled: true,
      configured: false,
      signIn: vi.fn().mockRejectedValue(new Error('Unable to reach CareRide right now. Check your internet connection and try again.')),
      homePath: vi.fn(),
    });
    component.email = 'pat@example.com';
    component.password = 'secret-pass';
    await component.login();
    expect(component.errorMessage).toContain('Check your internet connection');
    expect(component.isLoading).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('does not treat an unverified cloud profile as a successful login', async () => {
    const { component, navigate } = await createLogin({
      cloudAuthEnabled: true,
      configured: false,
      signIn: vi.fn().mockRejectedValue(new Error('No CareRide profile is linked to this account.')),
      homePath: vi.fn().mockResolvedValue('/login'),
    });
    component.email = 'pat@example.com';
    component.password = 'secret-pass';

    await component.login();

    expect(component.errorMessage).toContain('No CareRide profile');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('does not send a Supabase reset while cloud auth is off', async () => {
    const sendPasswordReset = vi.fn();
    const { component } = await createLogin({
      cloudAuthEnabled: false,
      configured: true,
      signIn: vi.fn(),
      homePath: vi.fn(),
      sendPasswordReset,
    });

    component.email = 'admin@careride.local';
    component.forgotPassword();

    expect(sendPasswordReset).not.toHaveBeenCalled();
    expect(component.errorMessage).toBe(
      'Password recovery is available after Supabase authentication is connected.',
    );
  });
});

async function createLogin(auth: {
  cloudAuthEnabled: boolean;
  configured: boolean;
  signIn: ReturnType<typeof vi.fn>;
  homePath: ReturnType<typeof vi.fn>;
  sendPasswordReset?: ReturnType<typeof vi.fn>;
}) {
  await TestBed.configureTestingModule({
    imports: [LoginPage],
    providers: [
      provideRouter([]),
      { provide: AuthService, useValue: auth },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(LoginPage);
  fixture.detectChanges();
  const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  return { component: fixture.componentInstance, navigate };
}
