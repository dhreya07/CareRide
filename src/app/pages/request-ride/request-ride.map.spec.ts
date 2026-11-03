import { ChangeDetectorRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AlertController } from '@ionic/angular';
import { Router } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { LocalRideService } from '../../core/services/local-ride.service';
import { MapsService } from '../../core/services/maps.service';
import { ProfileService } from '../../core/services/profile.service';
import { RideService } from '../../core/services/ride.service';
import { SupabaseService } from '../../core/services/supabase.service';
import { RequestRidePage } from './request-ride.page';
import { RoadRouteService } from '../../core/services/road-route.service';

describe('Request Ride map selection', () => {
  let page: RequestRidePage;
  let rides: { submitPassengerRide: ReturnType<typeof vi.fn>; cloudBookings: boolean };
  let liveFix: ((fix: { latitude: number; longitude: number; accuracyMeters: number | null; source: 'device-gps' }) => void) | null;
  let liveError: ((message: string, denied: boolean) => void) | null;
  let stopLiveGps: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.clear();
    liveFix = null;
    liveError = null;
    stopLiveGps = vi.fn();
    rides = {
      cloudBookings: false,
      submitPassengerRide: vi.fn(async () => ({ id: 'CR-NEW' })),
    };
    TestBed.configureTestingModule({
      providers: [
        RequestRidePage,
        { provide: RideService, useValue: rides },
        {
          provide: LocalRideService,
          useValue: {
            hasOngoingRide: () => false,
            isDriverBusyAt: () => false,
            driverRatingSummary: () => 'Not yet rated',
            getDriverClientReviews: () => [],
          },
        },
        {
          provide: MapsService,
          useValue: {
            configured: false,
            searchUnavailableMessage: () => 'Address search needs a Google Maps browser key. You can still tap or drag the map.',
            searchPlaces: vi.fn(async () => []),
            getUnavailableMessage: () => 'Map lookup is optional.',
            reverseGeocode: vi.fn(async () => 'Clinic gate'),
            currentPosition: vi.fn(async () => ({ latitude: 14.6, longitude: 120.98 })),
            geolocationPermission: vi.fn(async () => 'prompt'),
            watchDeviceGps: vi.fn((
              onFix: (fix: { latitude: number; longitude: number; accuracyMeters: number | null; source: 'device-gps' }) => void,
              onError: (message: string, denied: boolean) => void,
            ) => {
              liveFix = onFix;
              liveError = onError;
              return stopLiveGps;
            }),
            coordinateLabel: (latitude: number, longitude: number) => `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`,
            describePlace: vi.fn(async (latitude: number, longitude: number) => ({
              title: 'Selected map location',
              detail: `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`,
            })),
          },
        },
        {
          provide: AlertController,
          useValue: { create: vi.fn(async () => ({ present: async () => undefined })) },
        },
        { provide: Router, useValue: { navigate: vi.fn(async () => true) } },
        { provide: ChangeDetectorRef, useValue: { markForCheck: () => undefined, detectChanges: () => undefined } },
        {
          provide: AuthService,
          useValue: {
            listApprovedDrivers: () => [approvedDriver()],
            accountStatusOf: () => 'approved',
            readAvailability: () => 'available',
            getLocalDisplayName: () => 'Pat',
          },
        },
        { provide: ProfileService, useValue: { loadLocal: () => null } },
        { provide: SupabaseService, useValue: { configured: false } },
        {
          provide: RoadRouteService,
          useValue: {
            drivingRoute: vi.fn(async () => ({
              status: 'unavailable',
              message: 'No driving route was found between these points.',
            })),
          },
        },
      ],
    });
    page = TestBed.inject(RequestRidePage);
  });

  afterEach(() => {
    page.ngOnDestroy();
    localStorage.clear();
    TestBed.resetTestingModule();
  });

  it('sets a pickup from the map and keeps the rest of the form', async () => {
    page.purpose = 'Checkup';
    page.selectMapMode('pickup');

    await page.onMapPicked({ latitude: 14.6, longitude: 120.98 });

    expect(page.pickupLocation).toBe('Clinic gate');
    expect(page.pickupLatitude).toBe(14.6);
    expect(page.pickupLongitude).toBe(120.98);
    expect(page.destination).toBe('');
    expect(page.purpose).toBe('Checkup');
  });

  it('sets a destination without clearing the pickup', async () => {
    page.applySelectedPoint('pickup', 14.6, 120.98, 'Home');
    page.selectMapMode('destination');

    await page.onMapPicked({ latitude: 14.55, longitude: 121.02 });

    expect(page.pickupLocation).toBe('Home');
    expect(page.pickupLatitude).toBe(14.6);
    expect(page.destination).toBe('Clinic gate');
    expect(page.destinationLatitude).toBe(14.55);
    expect(page.destinationLongitude).toBe(121.02);
  });

  it('can change a selected pickup without resetting the destination', () => {
    page.applySelectedPoint('pickup', 14.6, 120.98, 'Home');
    page.applySelectedPoint('destination', 14.55, 121.02, 'Clinic');

    page.applySelectedPoint('pickup', 14.61, 120.99, 'New home');

    expect(page.pickupLocation).toBe('New home');
    expect(page.pickupLatitude).toBe(14.61);
    expect(page.destination).toBe('Clinic');
  });

  it('starts the GPS watch only after location permission is granted', async () => {
    const maps = TestBed.inject(MapsService) as unknown as {
      watchDeviceGps: ReturnType<typeof vi.fn>;
      geolocationPermission: ReturnType<typeof vi.fn>;
    };

    await page.ionViewDidEnter();
    expect(maps.watchDeviceGps).not.toHaveBeenCalled();

    maps.geolocationPermission.mockResolvedValueOnce('granted');
    await page.ionViewDidEnter();
    liveFix?.({ latitude: 13.2, longitude: 121.2, accuracyMeters: 9, source: 'device-gps' });

    expect(maps.watchDeviceGps).toHaveBeenCalledTimes(1);
    expect(page.liveLatitude).toBe(13.2);
    expect(page.pickupLatitude).toBeNull();
    expect(page.destinationLatitude).toBeNull();
  });

  it('places a destination while pickup is still unconfirmed', async () => {
    page.applySelectedPoint('pickup', 13.41, 121.18, 'Gate', null, 'manual');
    expect(page.pickupConfirmed).toBe(false);
    page.selectMapMode('destination');

    await page.onMapPicked({ latitude: 13.45, longitude: 121.2 });

    expect(page.destinationLatitude).toBe(13.45);
    expect(page.destinationLongitude).toBe(121.2);
    expect(page.destination).toBe('Clinic gate');
    expect(page.pickupLatitude).toBe(13.41);
    expect(page.pickupLongitude).toBe(121.18);
    expect(page.pickupConfirmed).toBe(false);

    page.confirmMapPoint();

    expect(page.destinationConfirmed).toBe(true);
    expect(page.pickupConfirmed).toBe(false);
  });

  it('keeps destination coordinates when reverse geocoding fails', async () => {
    const maps = TestBed.inject(MapsService) as unknown as {
      reverseGeocode: ReturnType<typeof vi.fn>;
    };
    maps.reverseGeocode.mockRejectedValueOnce(new Error('offline'));
    page.selectMapMode('destination');

    await page.onMapPicked({ latitude: 13.4118123, longitude: 121.1809456 });

    expect(page.destinationLatitude).toBe(13.4118123);
    expect(page.destinationLongitude).toBe(121.1809456);
    expect(page.destination).toBe('13.41181, 121.18095');
    expect(page.pickupLatitude).toBeNull();
  });

  it('shows a denied GPS watch without moving the pickup marker', async () => {
    page.applySelectedPoint('pickup', 13.41, 121.18, 'Confirmed gate', null, 'manual');
    page.confirmMapPoint();

    await page.useCurrentLocation();
    liveError?.('Location permission was denied. You can still choose a point on the map.', true);

    expect(page.liveGpsError).toContain('permission was denied');
    expect(page.pickupLatitude).toBe(13.41);
    expect(page.pickupLongitude).toBe(121.18);
    expect(stopLiveGps).toHaveBeenCalled();
  });

  it('moves only the blue-dot reading and keeps a confirmed pickup fixed', async () => {
    page.applySelectedPoint('pickup', 13.41111, 121.18111, 'Gate', null, 'manual');
    page.confirmMapPoint();
    page.applySelectedPoint('destination', 13.42, 121.19, 'Hospital', null, 'search');
    page.confirmMapPoint();

    await page.useCurrentLocation();
    liveFix?.({ latitude: 13.5, longitude: 121.2, accuracyMeters: 18, source: 'device-gps' });
    liveFix?.({ latitude: 13.51, longitude: 121.21, accuracyMeters: 22, source: 'device-gps' });

    expect(page.liveLatitude).toBe(13.51);
    expect(page.liveLongitude).toBe(121.21);
    expect(page.liveAccuracyMeters).toBe(22);
    expect(page.pickupLatitude).toBe(13.41111);
    expect(page.pickupLongitude).toBe(121.18111);
    expect(page.destinationLatitude).toBe(13.42);
    expect(page.destinationLongitude).toBe(121.19);
    expect(page.pickupAccuracyMeters).toBeNull();
  });

  it('moves only the dragged marker and keeps the other coordinates', async () => {
    page.applySelectedPoint('pickup', 13.41111, 121.18111, 'Pickup pin', null, 'manual');
    page.applySelectedPoint('destination', 13.42222, 121.19222, 'Destination pin', null, 'manual');

    await page.onMarkerMoved({ role: 'destination', point: { latitude: 13.43333, longitude: 121.19333 } });

    expect(page.pickupLatitude).toBe(13.41111);
    expect(page.pickupLongitude).toBe(121.18111);
    expect(page.destinationLatitude).toBe(13.43333);
    expect(page.destinationLongitude).toBe(121.19333);
    expect(page.destinationSource).toBe('manual');
    expect(page.destinationAccuracyMeters).toBeNull();
    expect(page.destinationConfirmed).toBe(false);
  });

  it('uses a search result’s coordinates and does not mark it as GPS', () => {
    page.selectMapMode('destination');
    page.choosePlace({
      id: 'place-1',
      label: 'Oriental Mindoro Provincial Hospital',
      latitude: 13.40841,
      longitude: 121.17682,
    });

    expect(page.destination).toBe('Oriental Mindoro Provincial Hospital');
    expect(page.destinationLatitude).toBe(13.40841);
    expect(page.destinationLongitude).toBe(121.17682);
    expect(page.destinationSource).toBe('search');
    expect(page.destinationAccuracyMeters).toBeNull();
    expect(page.pickupLatitude).toBeNull();
  });

  it('keeps selected coordinates when reverse geocoding fails', async () => {
    const maps = TestBed.inject(MapsService) as unknown as {
      reverseGeocode: ReturnType<typeof vi.fn>;
    };
    maps.reverseGeocode.mockRejectedValueOnce(new Error('offline'));

    await page.placeManualPoint('pickup', 13.4118123, 121.1809456);

    expect(page.pickupLatitude).toBe(13.4118123);
    expect(page.pickupLongitude).toBe(121.1809456);
    expect(page.pickupLocation).toBe('13.41181, 121.18095');
  });

  it('requires confirmation for map points and still accepts a typed address without coordinates', async () => {
    fillBookableForm(page, 'now');
    page.pickupConfirmed = false;

    await page.submitRideRequest();
    expect(page.formError).toBe('Confirm the pickup on the map before submitting.');
    expect(rides.submitPassengerRide).not.toHaveBeenCalled();

    page.pickupLatitude = null;
    page.pickupLongitude = null;
    page.destinationLatitude = null;
    page.destinationLongitude = null;
    page.pickupLocation = 'Home gate';
    page.destination = 'Clinic entrance';

    await page.submitRideRequest();
    expect(rides.submitPassengerRide).toHaveBeenCalledWith(expect.objectContaining({
      pickupLocation: 'Home gate',
      destination: 'Clinic entrance',
      pickupLatitude: null,
      destinationLatitude: null,
    }));
  });

  it('requires both pickup and destination before submit', async () => {
    page.pickupLocation = '';
    page.destination = '';

    await page.submitRideRequest();

    expect(page.formError).toBe('Please enter both pickup location and destination.');
    expect(rides.submitPassengerRide).not.toHaveBeenCalled();
  });

  it('stops watching when the page is left and recenters only on request', async () => {
    const recenter = vi.fn();
    (page as unknown as { locationMap: { recenter: typeof recenter } }).locationMap = { recenter };

    await page.useCurrentLocation();
    liveFix?.({ latitude: 13.1, longitude: 121.1, accuracyMeters: 10, source: 'device-gps' });
    liveFix?.({ latitude: 13.2, longitude: 121.2, accuracyMeters: 11, source: 'device-gps' });

    expect(recenter).toHaveBeenCalledTimes(1);
    expect(recenter).toHaveBeenCalledWith({ latitude: 14.6, longitude: 120.98 });
    expect(page.liveLatitude).toBe(13.2);

    page.recenterOnMe();
    expect(recenter).toHaveBeenLastCalledWith({ latitude: 13.2, longitude: 121.2 });

    page.ionViewDidLeave();
    expect(stopLiveGps).toHaveBeenCalled();
  });

  it('marks a stale GPS reading without moving the confirmed pickup', () => {
    vi.useFakeTimers();
    try {
      page.applySelectedPoint('pickup', 13.41, 121.18, 'Gate', null, 'manual');
      page.confirmMapPoint();
      void page.useCurrentLocation();
      liveFix?.({ latitude: 13.5, longitude: 121.2, accuracyMeters: 20, source: 'device-gps' });
      page.liveCapturedAt = new Date(Date.now() - 31000).toISOString();
      vi.advanceTimersByTime(5000);

      expect(page.liveGpsStale).toBe(true);
      expect(page.liveLatitude).toBe(13.5);
      expect(page.pickupLatitude).toBe(13.41);
    } finally {
      vi.useRealTimers();
    }
  });

  it('saves the confirmed markers instead of the moving GPS dot', async () => {
    fillBookableForm(page, 'now');
    await page.useCurrentLocation();
    liveFix?.({ latitude: 9.1, longitude: 118.2, accuracyMeters: 8, source: 'device-gps' });

    await page.submitRideRequest();

    expect(rides.submitPassengerRide).toHaveBeenCalledWith(expect.objectContaining({
      pickupLatitude: 14.6,
      pickupLongitude: 120.98,
      destinationLatitude: 14.55,
      destinationLongitude: 121.02,
    }));
  });

  it('submits an immediate booking with the selected coordinates', async () => {
    fillBookableForm(page, 'now');

    await page.submitRideRequest();

    expect(rides.submitPassengerRide).toHaveBeenCalledWith(expect.objectContaining({
      status: 'Pending',
      pickupLocation: 'Home',
      destination: 'Clinic',
      pickupLatitude: 14.6,
      pickupLongitude: 120.98,
      destinationLatitude: 14.55,
      destinationLongitude: 121.02,
      pickupAccuracyMeters: 12,
      preferredDriverId: 'CR-DEMO-DRIVER',
    }));
  });

  it('shows a reverse-geocoded pickup name and keeps the selected coordinates', async () => {
    const maps = TestBed.inject(MapsService) as unknown as {
      describePlace: ReturnType<typeof vi.fn>;
    };
    maps.describePlace.mockResolvedValueOnce({ title: 'J.P. Rizal Street', detail: 'Balite, Calapan' });
    page.openLocationPicker('pickup');

    await page.confirmLocationPicker({
      latitude: 13.4118123,
      longitude: 121.1809456,
      label: '13.41181, 121.18095',
      detail: '13.41181, 121.18095',
      source: 'manual',
    });

    expect(page.pickupLocation).toBe('J.P. Rizal Street');
    expect(page.pickupDetail).toBe('Balite, Calapan');
    expect(page.pickupLatitude).toBe(13.4118123);
    expect(page.pickupLongitude).toBe(121.1809456);
    expect(page.placeTitle('pickup')).toBe('J.P. Rizal Street');
  });

  it('shows Selected map location when destination lookup fails', async () => {
    page.openLocationPicker('destination');

    await page.confirmLocationPicker({
      latitude: 13.41181,
      longitude: 121.18095,
      label: '13.41181, 121.18095',
      source: 'manual',
    });

    expect(page.destination).toBe('Selected map location');
    expect(page.destinationLatitude).toBe(13.41181);
    expect(page.destinationLongitude).toBe(121.18095);
    expect(page.placeTitle('destination')).toBe('Selected map location');
    expect(page.placeDetail('destination')).not.toContain('13.41181');
  });

  it('does not save a destination that is the same point as pickup', async () => {
    page.openLocationPicker('pickup');
    await page.confirmLocationPicker({
      latitude: 13.401,
      longitude: 121.201,
      label: 'Masipit',
      detail: 'Calapan',
      source: 'gps',
    });
    page.openLocationPicker('destination');
    await page.confirmLocationPicker({
      latitude: 13.40102,
      longitude: 121.20102,
      label: 'Selected map location',
      source: 'manual',
    });

    expect(page.destinationLatitude).toBeNull();
    expect(page.destination).not.toBe('Masipit');
    expect(page.locationNotice).toContain('different place');
    expect(page.pickerRole).toBe('destination');
    expect(page.roadSummary).not.toContain('0.0');
    expect(page.pickupLocation).toBe('Masipit');
    expect(page.pickupLatitude).toBe(13.401);
  });

  it('allows the same barangay name when coordinates clearly differ', async () => {
    page.openLocationPicker('pickup');
    await page.confirmLocationPicker({
      latitude: 13.401,
      longitude: 121.201,
      label: 'Masipit',
      detail: 'Calapan',
      source: 'manual',
    });
    page.openLocationPicker('destination');
    await page.confirmLocationPicker({
      latitude: 13.41,
      longitude: 121.19,
      label: 'Masipit',
      detail: 'Another point in Masipit',
      source: 'manual',
    });

    expect(page.destinationLatitude).toBe(13.41);
    expect(page.destinationLongitude).toBe(121.19);
    expect(page.destination).toBe('Masipit');
    expect(page.destinationConfirmed).toBe(true);
    expect(page.pickupLatitude).toBe(13.401);
  });

  it('blocks review when pickup and destination coordinates are the same point', async () => {
    fillBookableForm(page, 'now');
    page.pickupLatitude = 13.401;
    page.pickupLongitude = 121.201;
    page.pickupLocation = 'Masipit';
    page.pickupConfirmed = true;
    page.destinationLatitude = 13.40101;
    page.destinationLongitude = 121.20101;
    page.destination = 'Gate';
    page.destinationConfirmed = true;

    await page.goToReview();

    expect(page.step).toBe('form');
    expect(page.formError).toContain('same point');
  });

  it('does not present a zero-length drive as a successful route', async () => {
    const roads = TestBed.inject(RoadRouteService) as unknown as {
      drivingRoute: ReturnType<typeof vi.fn>;
    };
    roads.drivingRoute.mockResolvedValueOnce({
      status: 'ok',
      distanceMeters: 0,
      durationSeconds: 0,
      coordinates: [
        { latitude: 13.401, longitude: 121.201 },
        { latitude: 13.401, longitude: 121.201 },
      ],
    });
    page.pickupLatitude = 13.401;
    page.pickupLongitude = 121.201;
    page.pickupLocation = 'Masipit';
    page.pickupConfirmed = true;
    page.destinationLatitude = 13.45;
    page.destinationLongitude = 121.25;
    page.destination = 'MMG Hospital';
    page.destinationConfirmed = true;

    await page.updateRoadRoute();

    expect(page.roadSummary).toBe('');
    expect(page.roadRoute).toBeNull();
    expect(page.routeUnavailable).toContain('same point');
  });

  it('saves pickup and destination separately and keeps both after review', async () => {
    page.openLocationPicker('pickup');
    await page.confirmLocationPicker({
      latitude: 13.401,
      longitude: 121.201,
      label: 'Masipit',
      detail: 'Calapan',
      source: 'gps',
    });
    page.openLocationPicker('destination');
    await page.confirmLocationPicker({
      latitude: 13.42,
      longitude: 121.19,
      label: 'MMG Hospital',
      detail: 'Tawiran, Calapan',
      source: 'search',
    });

    expect(page.pickupLocation).toBe('Masipit');
    expect(page.pickupLatitude).toBe(13.401);
    expect(page.pickupLongitude).toBe(121.201);
    expect(page.destination).toBe('MMG Hospital');
    expect(page.destinationLatitude).toBe(13.42);
    expect(page.destinationLongitude).toBe(121.19);

    page.step = 'review';
    page.editRequest();

    expect(page.pickupLocation).toBe('Masipit');
    expect(page.pickupLatitude).toBe(13.401);
    expect(page.destination).toBe('MMG Hospital');
    expect(page.destinationLongitude).toBe(121.19);
  });

  it('keeps a selected hospital name and its mapped coordinates', async () => {
    page.openLocationPicker('destination');

    await page.confirmLocationPicker({
      latitude: 13.42,
      longitude: 121.19,
      label: 'Provincial Hospital',
      detail: 'Balite, Calapan',
      source: 'search',
    });

    expect(page.destination).toBe('Provincial Hospital');
    expect(page.destinationDetail).toBe('Balite, Calapan');
    expect(page.placeTitle('destination')).toBe('Provincial Hospital');
    expect(page.placeDetail('destination')).toBe('Balite, Calapan');
    expect(page.destinationLatitude).toBe(13.42);
    expect(page.destinationLongitude).toBe(121.19);
    expect(page.destinationConfirmed).toBe(true);
  });

  it('restores the map after review without changing the route or coordinates', () => {
    const refreshSize = vi.fn(() => true);
    (page as unknown as { locationMap: { refreshSize: () => boolean } }).locationMap = { refreshSize };
    page.pickupLatitude = 13.41;
    page.pickupLongitude = 121.18;
    page.pickupLocation = 'Gate';
    page.pickupConfirmed = true;
    page.destinationLatitude = 13.45;
    page.destinationLongitude = 121.22;
    page.destination = 'Provincial Hospital';
    page.destinationConfirmed = true;
    page.roadSummary = '4.2 km · 9 min by road';
    page.roadRoute = [
      { latitude: 13.41, longitude: 121.18 },
      { latitude: 13.45, longitude: 121.22 },
    ];
    page.step = 'review';
    const roads = TestBed.inject(RoadRouteService) as unknown as {
      drivingRoute: ReturnType<typeof vi.fn>;
    };

    page.editRequest();
    page.editRequest();

    expect(page.step).toBe('form');
    expect(refreshSize).toHaveBeenCalled();
    expect(page.pickupLatitude).toBe(13.41);
    expect(page.destinationLatitude).toBe(13.45);
    expect(page.pickupLocation).toBe('Gate');
    expect(page.destination).toBe('Provincial Hospital');
    expect(page.roadSummary).toBe('4.2 km · 9 min by road');
    expect(roads.drivingRoute).not.toHaveBeenCalled();
  });

  it('opens the full-screen map from the preview without moving a confirmed pickup', () => {
    page.pickupLatitude = 13.1;
    page.pickupLongitude = 121.1;
    page.pickupLocation = 'Gate';
    page.pickupConfirmed = true;

    page.onPreviewMapPressed();

    expect(page.pickerRole).toBe('destination');
    expect(page.pickupLatitude).toBe(13.1);
    expect(page.pickupLocation).toBe('Gate');
  });

  it('shows the road distance and route when both confirmed points change', async () => {
    const roads = TestBed.inject(RoadRouteService) as unknown as {
      drivingRoute: ReturnType<typeof vi.fn>;
    };
    const geometry = [
      { latitude: 13.41, longitude: 121.18 },
      { latitude: 13.43, longitude: 121.2 },
      { latitude: 13.45, longitude: 121.22 },
    ];
    roads.drivingRoute.mockResolvedValue({
      status: 'ok',
      distanceMeters: 4200,
      durationSeconds: 540,
      coordinates: geometry,
    });
    page.pickupLatitude = 13.41;
    page.pickupLongitude = 121.18;
    page.pickupLocation = 'Gate';
    page.pickupConfirmed = true;
    page.openLocationPicker('destination');

    await page.confirmLocationPicker({
      latitude: 13.45,
      longitude: 121.22,
      label: 'Provincial Hospital',
      source: 'search',
    });

    expect(roads.drivingRoute).toHaveBeenCalledTimes(1);
    expect(page.roadSummary).toBe('4.2 km · 9 min by road');
    expect(page.roadRoute).toEqual(geometry);
    expect(page.routeUnavailable).toBe('');
    expect(page.destinationLatitude).toBe(13.45);
    expect(page.destinationLongitude).toBe(121.22);

    await page.useCurrentLocation();
    liveFix?.({ latitude: 9.1, longitude: 118.2, accuracyMeters: 12, source: 'device-gps' });
    expect(roads.drivingRoute).toHaveBeenCalledTimes(1);
    expect(page.pickupLatitude).toBe(13.41);

    page.openLocationPicker('destination');
    await page.confirmLocationPicker({
      latitude: 13.5,
      longitude: 121.3,
      label: 'City Health Center',
      source: 'search',
    });
    expect(roads.drivingRoute).toHaveBeenCalledTimes(2);
    expect(page.destinationLatitude).toBe(13.5);
  });

  it('keeps the booking coordinates when no driving route exists', async () => {
    fillBookableForm(page, 'now');
    await page.updateRoadRoute();

    expect(page.routeUnavailable).toContain('No driving route');
    expect(page.roadRoute).toBeNull();
    expect(page.roadSummary).toBe('');

    await page.submitRideRequest();
    expect(rides.submitPassengerRide).toHaveBeenCalledWith(expect.objectContaining({
      status: 'Pending',
      pickupLatitude: 14.6,
      pickupLongitude: 120.98,
      destinationLatitude: 14.55,
      destinationLongitude: 121.02,
    }));
  });

  it('opens the full-screen picker and saves a point only after confirmation', async () => {
    page.pickupLatitude = 13.1;
    page.pickupLongitude = 121.1;
    page.pickupLocation = 'Gate';
    page.pickupConfirmed = true;

    page.openLocationPicker('destination');
    expect(page.pickerRole).toBe('destination');
    expect(page.destinationLatitude).toBeNull();

    page.cancelLocationPicker();
    expect(page.pickerRole).toBeNull();
    expect(page.pickupLatitude).toBe(13.1);
    expect(page.destinationLatitude).toBeNull();

    page.openLocationPicker('destination');
    page.confirmLocationPicker({
      latitude: 13.42,
      longitude: 121.19,
      label: 'Provincial Hospital',
      source: 'search',
    });

    expect(page.pickerRole).toBeNull();
    expect(page.destinationLatitude).toBe(13.42);
    expect(page.destinationLongitude).toBe(121.19);
    expect(page.destination).toBe('Provincial Hospital');
    expect(page.destinationConfirmed).toBe(true);
    expect(page.pickupLatitude).toBe(13.1);
    expect(page.pickupConfirmed).toBe(true);

    await page.useCurrentLocation();
    liveFix?.({ latitude: 9.1, longitude: 118.2, accuracyMeters: 12, source: 'device-gps' });
    expect(page.pickupLatitude).toBe(13.1);
    expect(page.destinationLatitude).toBe(13.42);
  });

  it('submits a scheduled booking with the same location fields', async () => {
    fillBookableForm(page, 'schedule');

    await page.submitRideRequest();

    expect(rides.submitPassengerRide).toHaveBeenCalledWith(expect.objectContaining({
      status: 'Scheduled',
      pickupLatitude: 14.6,
      destinationLatitude: 14.55,
    }));
  });
});

describe('stored rides without coordinates', () => {
  afterEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
  });

  it('keeps an older local ride and adds coordinates only on the new ride', () => {
    localStorage.setItem('careride.local.rides', JSON.stringify([{
      id: 'CR-OLD',
      passengerType: 'self',
      passengerName: 'Pat',
      pickupLocation: 'Home',
      destination: 'Clinic',
      purpose: 'Visit',
      date: '2026-03-04',
      time: '09:30',
      assistance: [],
      otherAssistanceNotes: '',
      notes: '',
      emergencyContactName: 'Kim',
      emergencyContactNumber: '0917',
      status: 'Pending',
      createdAt: '2026-03-04T01:00:00.000Z',
      updatedAt: '2026-03-04T01:00:00.000Z',
    }]));
    TestBed.configureTestingModule({
      providers: [{ provide: AuthService, useValue: {} }],
    });
    const local = TestBed.inject(LocalRideService);

    const created = local.createRide({
      passengerType: 'self',
      passengerName: 'Pat',
      pickupLocation: '14.60000, 120.98000',
      destination: '14.55000, 121.02000',
      purpose: 'Visit',
      date: '2026-04-02',
      time: '10:00',
      assistance: [],
      otherAssistanceNotes: '',
      notes: '',
      emergencyContactName: 'Kim',
      emergencyContactNumber: '0917',
      pickupLatitude: 14.6,
      pickupLongitude: 120.98,
      destinationLatitude: 14.55,
      destinationLongitude: 121.02,
      pickupAccuracyMeters: 16,
      status: 'Scheduled',
    });

    expect(local.getRideById('CR-OLD')?.pickupLatitude).toBeNull();
    expect(local.getRideById('CR-OLD')?.pickupAccuracyMeters).toBeNull();
    expect(local.getRideById(created.id)?.pickupLatitude).toBe(14.6);
    expect(local.getRideById(created.id)?.pickupAccuracyMeters).toBe(16);
    expect(local.getRides()).toHaveLength(2);
  });
});

function fillBookableForm(page: RequestRidePage, rideType: 'now' | 'schedule'): void {
  page.rideType = rideType;
  page.pickupLocation = 'Home';
  page.destination = 'Clinic';
  page.purpose = 'Checkup';
  page.passengerType = 'self';
  page.passengerName = 'Pat';
  page.emergencyContactName = 'Kim';
  page.emergencyContactNumber = '09170000000';
  page.pickupLatitude = 14.6;
  page.pickupLongitude = 120.98;
  page.destinationLatitude = 14.55;
  page.destinationLongitude = 121.02;
  page.pickupAccuracyMeters = 12;
  page.pickupConfirmed = true;
  page.destinationConfirmed = true;
  if (rideType === 'schedule') {
    page.rideDate = '2026-12-20';
    page.rideTime = '09:30';
  }
  page.refreshDrivers();
  page.selectedDriverId = 'CR-DEMO-DRIVER';
}

function approvedDriver() {
  return {
    id: 'CR-DEMO-DRIVER',
    accountType: 'driver',
    fullName: 'Dee Driver',
    email: 'dee@example.com',
    phone: '09170000000',
    address: '',
    password: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    approvalStatus: 'approved',
    availability: 'available',
  };
}
