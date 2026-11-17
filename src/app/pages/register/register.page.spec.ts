import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AuthService } from '../../core/services/auth.service';
import { RegisterPage } from './register.page';
import { PHILIPPINE_DRIVER_VEHICLE_CATALOG } from './philippine-vehicle-catalog';

describe('RegisterPage', () => {
  let component: RegisterPage;
  let fixture: ComponentFixture<RegisterPage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(RegisterPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => vi.useRealTimers());

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('does not advance past an incomplete required step', () => {
    component.nextDriverStep();

    expect(component.driverStep).toBe(1);
    expect(component.errorMessage).toBe('Please enter your email address.');
  });

  it('gates progression on valid step fields and retains entries when moving back', () => {
    component.driverEmail = 'driver@example.com';
    component.driverPhone = '09171234567';
    component.driverPassword = 'secure-pass';
    component.driverConfirmPassword = 'secure-pass';
    component.nextDriverStep();
    expect(component.driverStep).toBe(2);

    component.driverFullName = 'Dee Driver';
    component.driverAddress = 'Manila';
    component.driverLicense = 'N01-23-456789';
    component.nextDriverStep();
    expect(component.driverStep).toBe(3);

    component.previousDriverStep();
    expect(component.driverStep).toBe(2);
    expect(component.driverFullName).toBe('Dee Driver');
  });

  it('exposes the three ordered driver registration steps', () => {
    component.driverStep = 3;
    component.driverAccessibility.boardingExitingAssistance = true;
    component.driverAccessibility.workingAirConditioning = true;

    expect(component.driverSteps).toEqual(['Account information', 'Driver information', 'Vehicle information']);
    expect(component.driverProgressPercent).toBe(100);
    expect(component.selectedDriverAccessibility).toEqual([
      'Boarding and exiting assistance',
      'Working air conditioning',
    ]);
    expect(component.selectedDriverAccessibilityIdentifiers).toEqual([
      'boarding_exiting_assistance',
      'working_air_conditioning',
    ]);
  });

  it('filters models by the selected brand and body type', () => {
    component.changeDriverVehicleBodyType('Sedan');
    component.changeDriverVehicleBrand('Toyota');
    expect(component.availableDriverVehicleModels.map((entry) => entry.model)).toContain('Vios');
    expect(component.availableDriverVehicleModels.map((entry) => entry.model)).not.toContain('HiAce');
    expect(PHILIPPINE_DRIVER_VEHICLE_CATALOG.find((entry) => entry.brand === 'Toyota' && entry.model === 'Vios')?.variants).toContain('1.3 XLE CVT');
    expect(PHILIPPINE_DRIVER_VEHICLE_CATALOG.find((entry) => entry.brand === 'Toyota' && entry.model === 'HiAce')?.variants).toEqual([]);
  });

  it('clears dependent selections when a parent changes and retains them across step navigation', () => {
    component.changeDriverVehicleBodyType('Van');
    component.changeDriverVehicleBrand('Toyota');
    component.changeDriverVehicleModel('HiAce');
    component.changeDriverVehicleVariant(component.vehicleManualOption);
    component.driverVehicleVariantOther = 'Commuter';
    component.driverVehicleModelYearChoice = component.vehicleManualOption;
    component.driverVehicleModelYearManual = 2020;
    component.driverVehicleSeatingModified = 'yes';
    component.driverPassengerSeatingCapacity = 4;
    component.driverPlate = 'ABC 1234';
    component.driverVehicleType = 'Accessible van';
    component.driverVehicleColor = 'White';
    component.driverLicense = 'N01-23-456789';
    component.driverLicenseExpirationDate = '2030-12-31';
    component.driverStep = 3;
    component.previousDriverStep();
    component.nextDriverStep();

    expect(component.driverVehicleModel).toBe('HiAce');
    expect(component.driverVehicleVariantOther).toBe('Commuter');
    expect(component.driverVehicleModelYearManual).toBe(2020);
    expect(component.vehicleRequiresAdminReview).toBe(true);
    expect(component.driverCapacityBasis).toBe('Manually declared by driver');
    expect(component.driverCapacityVerificationStatus).toBe('Pending Admin Verification');

    component.changeDriverVehicleBrand('Honda');
    expect(component.driverVehicleModel).toBe('');
    expect(component.driverVehicleVariantOther).toBe('');
    expect(component.driverVehicleModelYearManual).toBeNull();
    expect(component.driverVehicleSeatingModified).toBe('');
    expect(component.driverPassengerSeatingCapacity).toBeNull();
  });

  it('does not infer capacity from a model name without an exact sourced configuration', () => {
    component.changeDriverVehicleBodyType('Hatchback');
    component.changeDriverVehicleBrand('Toyota');
    component.changeDriverVehicleModel('Wigo');
    component.changeDriverVehicleVariant('G CVT');
    component.changeDriverVehicleYearChoice(component.vehicleManualOption);
    component.changeDriverVehicleModelYear(2024);
    component.changeDriverVehicleSeatingModification('no');

    expect(component.exactDriverVehicleCapacityConfiguration).toBeUndefined();
    expect(component.driverPassengerSeatingCapacity).toBeNull();
    expect(component.driverCapacityCatalogDerived).toBe(false);
  });

  it('normalizes the plate number to uppercase', () => {
    component.normalizeDriverPlate('abc 1234');
    expect(component.driverPlate).toBe('ABC 1234');
  });

  it('submits only legacy-supported driver fields until V3 persistence is deployed', async () => {
    vi.useFakeTimers();
    const auth = TestBed.inject(AuthService);
    vi.spyOn(auth, 'register').mockResolvedValue({
      accountStatus: 'pending',
      emailConfirmationRequired: false,
    });

    Object.assign(component, {
      driverStep: 3,
      driverConsent: true,
      driverEmail: 'driver@example.com',
      driverPhone: '09171234567',
      driverPassword: 'secure-pass',
      driverConfirmPassword: 'secure-pass',
      driverFullName: 'Dee Driver',
      driverAddress: 'Manila',
      driverLicense: 'N01-23-456789',
      driverLicenseExpirationDate: '2030-12-31',
      driverVehicleType: 'Accessible van',
      driverPlate: 'ABC 1234',
      driverVehicleBodyType: 'Van',
      driverVehicleBrand: 'Toyota',
      driverVehicleModel: 'HiAce',
      driverVehicleVariant: component.vehicleManualOption,
      driverVehicleVariantOther: 'Commuter',
      driverVehicleModelYearChoice: component.vehicleManualOption,
      driverVehicleModelYearManual: 2024,
      driverVehicleColor: 'White',
      driverPassengerSeatingCapacity: 10,
      driverVehicleSeatingModified: 'no',
      driverEmergencyContactName: 'Kim Driver',
      driverEmergencyContactPhone: '09170000003',
      driverWheelchair: false,
      driverSeniorAssistance: false,
    });
    component.driverAccessibility.boardingExitingAssistance = true;

    await component.registerDriver();

    expect(auth.register).toHaveBeenCalledWith(
      'driver@example.com',
      'secure-pass',
      'Dee Driver',
      '09171234567',
      'self',
      'Manila',
      'driver',
      {
        licenseNumber: 'N01-23-456789',
        vehicleType: 'Accessible van',
        plateNumber: 'ABC 1234',
        wheelchairAccessible: false,
        seniorAssistance: false,
      },
    );
  });

  it('uses the selected body type for the legacy vehicle_type field', () => {
    component.changeDriverVehicleBodyType('Van');
    expect(component.driverVehicleType).toBe('Van');
  });

  it('requires only the simplified vehicle details and consent on the final step', () => {
    component.driverStep = 3;
    component.driverEmail = 'driver@example.com';
    component.driverPhone = '09171234567';
    component.driverPassword = 'secure-pass';
    component.driverConfirmPassword = 'secure-pass';
    component.driverFullName = 'Dee Driver';
    component.driverAddress = 'Manila';
    component.driverLicense = 'N01-23-456789';
    component.driverPlate = 'ABC 1234';
    component.changeDriverVehicleBodyType('SUV');
    component.changeDriverVehicleBrand('Toyota');
    component.changeDriverVehicleModel('Fortuner');
    component.driverConsent = false;

    component.registerDriver();

    expect(component.driverStep).toBe(3);
    expect(component.errorMessage).toBe('Please confirm the information and consent before submitting.');
  });
});
