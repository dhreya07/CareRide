import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { RegisterPage } from './register.page';

describe('RegisterPage cloud registration preparation', () => {
  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
    TestBed.resetTestingModule();
  });

  it('keeps the local passenger message and still returns to login', async () => {
    const register = vi.fn().mockResolvedValue(undefined);
    const { component, navigate } = await createRegister({ configured: false, register });
    fillPassenger(component);
    vi.useFakeTimers();

    await component.register();
    await vi.advanceTimersByTimeAsync(2200);

    expect(register).toHaveBeenCalledWith(
      'pat@example.com',
      'secret-pass',
      'Pat Rider',
      '09171234567',
      'family',
      'Manila',
      'passenger',
    );
    expect(component.successMessage).toBe(
      'Account submitted. An admin must accept it before you can sign in.',
    );
    expect(navigate).toHaveBeenCalledWith(['/login']);
    expect(navigate).not.toHaveBeenCalledWith(['/dashboard']);
  });

  it('asks a cloud passenger to confirm email and does not open a dashboard', async () => {
    const register = vi.fn().mockResolvedValue({
      accountStatus: 'pending',
      emailConfirmationRequired: true,
    });
    const { component, navigate } = await createRegister({ configured: false, register });
    fillPassenger(component);
    vi.useFakeTimers();

    await component.register();

    expect(component.successMessage).toBe(
      'Account submitted. An admin must accept it before you can sign in. Check your email to confirm this address before you sign in.',
    );
    expect(component.password).toBe('');
    expect(navigate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2200);
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(['/login']);
  });

  it('passes the driver vehicle fields and keeps a new driver on the login page', async () => {
    const register = vi.fn().mockResolvedValue({
      accountStatus: 'pending',
      emailConfirmationRequired: false,
    });
    const { component, navigate } = await createRegister({ configured: false, register });
    component.driverFullName = 'Dee Driver';
    component.driverEmail = 'dee@example.com';
    component.driverPhone = '09170000002';
    component.driverAddress = 'Quezon City';
    component.driverPassword = 'secret-pass';
    component.driverConfirmPassword = 'secret-pass';
    component.driverLicense = 'N01-23-456789';
    component.driverVehicleType = 'van';
    component.driverPlate = 'ABC 123';
    component.driverWheelchair = true;
    component.driverSeniorAssistance = false;
    vi.useFakeTimers();

    await component.registerDriver();
    await vi.advanceTimersByTimeAsync(2200);

    expect(register).toHaveBeenCalledWith(
      'dee@example.com',
      'secret-pass',
      'Dee Driver',
      '09170000002',
      'self',
      'Quezon City',
      'driver',
      {
        licenseNumber: 'N01-23-456789',
        vehicleType: 'van',
        plateNumber: 'ABC 123',
        wheelchairAccessible: true,
        seniorAssistance: false,
      },
    );
    expect(component.successMessage).toBe(
      'Driver account submitted. An admin must approve it before you can sign in.',
    );
    expect(component.driverPassword).toBe('');
    expect(navigate).toHaveBeenCalledWith(['/login']);
    expect(navigate).not.toHaveBeenCalledWith(['/driver']);
  });
});

function fillPassenger(component: RegisterPage): void {
  component.accountType = 'family';
  component.fullName = 'Pat Rider';
  component.email = 'pat@example.com';
  component.phone = '09171234567';
  component.address = 'Manila';
  component.password = 'secret-pass';
  component.confirmPassword = 'secret-pass';
}

async function createRegister(auth: {
  configured: boolean;
  register: ReturnType<typeof vi.fn>;
}) {
  await TestBed.configureTestingModule({
    imports: [RegisterPage],
    providers: [
      provideRouter([]),
      { provide: AuthService, useValue: auth },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(RegisterPage);
  fixture.detectChanges();
  const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  return { component: fixture.componentInstance, navigate };
}
