import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MapsService } from '../core/services/maps.service';
import { HealthcareFacility, HealthcareFacilityService } from '../core/services/healthcare-facilities';
import { LocationPickerComponent, PickedLocation, locationPickerPhoneLayout } from './location-picker.component';

describe('full-screen location picker', () => {
  let fixture: ComponentFixture<LocationPickerComponent>;
  let picker: LocationPickerComponent;
  let confirmed: PickedLocation[];
  let cancelled: number;
  let nearby: ReturnType<typeof vi.fn>;

  const hospital: HealthcareFacility = {
    id: 'node/1',
    name: 'Provincial Hospital',
    unnamed: false,
    kind: 'hospital',
    latitude: 13.42,
    longitude: 121.19,
  };
  const clinic: HealthcareFacility = {
    id: 'node/2',
    name: '',
    unnamed: true,
    kind: 'clinic',
    latitude: 13.43,
    longitude: 121.2,
  };

  beforeEach(() => {
    confirmed = [];
    cancelled = 0;
    nearby = vi.fn(async () => [hospital, clinic]);
    TestBed.configureTestingModule({
      imports: [LocationPickerComponent],
      providers: [
        { provide: MapsService, useValue: {
          coordinateLabel: (latitude: number, longitude: number) => `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`,
          reverseGeocode: vi.fn(async () => 'Clinic gate'),
          describePlace: vi.fn(async (latitude: number, longitude: number, preferred?: string) => ({
            title: preferred && preferred !== 'Selected map location' && !/^-?\d+\.\d+/.test(preferred)
              ? preferred
              : 'Selected map location',
            detail: `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`,
          })),
          currentPosition: vi.fn(() => new Promise(() => undefined)),
          searchLocations: vi.fn(async () => [{ id: 'p1', label: 'Calapan hospital', latitude: 13.41, longitude: 121.18 }]),
        } },
        { provide: HealthcareFacilityService, useValue: { nearby } },
      ],
    });
    fixture = TestBed.createComponent(LocationPickerComponent);
    picker = fixture.componentInstance;
    picker.confirmed.subscribe((selection) => confirmed.push(selection));
    picker.cancelled.subscribe(() => { cancelled += 1; });
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
    document.body.style.overflow = '';
  });

  it('uses a phone layout on a narrow screen and keeps the sheet available', () => {
    expect(locationPickerPhoneLayout(360)).toBe(true);
    expect(locationPickerPhoneLayout(800)).toBe(false);
    picker.phoneLayout = true;
    fixture.detectChanges();
    expect(fixture.nativeElement.classList.contains('phone')).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('Confirm Pickup');
    expect(fixture.nativeElement.textContent).toContain('Choose Pickup');
    expect(fixture.nativeElement.textContent).not.toContain('Coordinates');
  });

  it('does not confirm a destination from the pickup map center', () => {
    picker.role = 'destination';
    picker.currentLocation = { latitude: 13.401, longitude: 121.201 };
    picker.otherLatitude = 13.401;
    picker.otherLongitude = 121.201;
    picker.initialLabel = '';
    picker.initialLatitude = null;
    picker.initialLongitude = null;
    picker.ngOnInit();
    picker.noteMapMoved(13.45, 121.25, true);

    picker.confirmSelection();

    expect(confirmed).toEqual([]);
    expect(picker.selectionMessage).toContain('Choose a search result');
    expect(picker.draftLatitude).toBeNull();
  });

  it('does not treat zooming or panning alone as a destination selection', () => {
    picker.role = 'destination';
    picker.otherLatitude = 13.401;
    picker.otherLongitude = 121.201;
    picker.initialLatitude = null;
    picker.initialLongitude = null;
    picker.initialLabel = '';
    picker.ngOnInit();
    picker.noteMapMoved(13.389, 121.176, true);
    picker.confirmSelection();

    expect(confirmed).toEqual([]);
    expect(picker.selectionReady).toBe(false);
  });

  it('requires Use This Location after adjusting before confirm', async () => {
    picker.role = 'destination';
    picker.otherLatitude = 13.401;
    picker.otherLongitude = 121.201;
    picker.beginAdjusting();
    picker.noteMapMoved(13.45, 121.21, true);

    expect(confirmed).toEqual([]);
    picker.confirmSelection();
    expect(confirmed).toEqual([]);
    expect(picker.selectionMessage).toContain('Use This Location');

    picker.useAdjustedPoint();
    picker.confirmSelection();

    expect(confirmed).toEqual([expect.objectContaining({
      latitude: 13.45,
      longitude: 121.21,
      source: 'manual',
    })]);
  });

  it('rejects Use This Location when the map was not moved from the starting center', () => {
    picker.role = 'destination';
    picker.otherLatitude = 13.401;
    picker.otherLongitude = 121.201;
    picker.ngOnInit();
    picker.beginAdjusting();
    picker.useAdjustedPoint();

    expect(picker.selectionReady).toBe(false);
    expect(picker.selectionMessage).toContain('Move the map');
    picker.confirmSelection();
    expect(confirmed).toEqual([]);
  });

  it('cancels without emitting a new location', () => {
    picker.noteMapMoved(13.5, 121.3);
    picker.cancel();

    expect(cancelled).toBe(1);
    expect(confirmed).toEqual([]);
  });

  it('shows hospital and health-center markers by name and filters them', () => {
    picker.facilities = [hospital, clinic, {
      id: 'way/3',
      name: 'City Health Center',
      unnamed: false,
      kind: 'health-center',
      latitude: 13.44,
      longitude: 121.21,
    }];

    expect(picker.visibleFacilities().map((facility) => picker.facilityTitle(facility))).toContain('Provincial Hospital');
    expect(picker.facilityTitle(clinic)).toBe('Unnamed clinic');

    picker.setFilter('hospital');
    expect(picker.visibleFacilities().map((facility) => facility.kind)).toEqual(['hospital']);

    picker.chooseFacility(hospital);
    expect(picker.draftLatitude).toBe(13.42);
    expect(picker.draftLongitude).toBe(121.19);
    expect(picker.draftTitle).toBe('Provincial Hospital');
    expect(picker.selectedFacilityId).toBe('node/1');

    (picker as unknown as { holdSelection: boolean }).holdSelection = true;
    picker.noteMapMoved(1, 1);
    expect(picker.draftTitle).toBe('Provincial Hospital');
    expect(picker.draftLatitude).toBe(13.42);
  });

  it('confirms a chosen hospital name without moving its coordinates', () => {
    picker.chooseFacility(hospital);
    picker.confirmSelection();

    expect(confirmed[0]).toMatchObject({
      label: 'Provincial Hospital',
      latitude: 13.42,
      longitude: 121.19,
      source: 'search',
    });
  });

  it('selects a street or barangay from search and ignores a stale response', async () => {
    const maps = TestBed.inject(MapsService) as unknown as {
      searchLocations: ReturnType<typeof vi.fn>;
    };
    let resolveFirst: (places: Array<{ id: string; label: string; latitude: number; longitude: number }>) => void = () => undefined;
    maps.searchLocations
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveFirst = resolve;
      }))
      .mockResolvedValueOnce([{
        id: 'street-1',
        label: 'J.P. Rizal Street, Balite',
        latitude: 13.4112,
        longitude: 121.1811,
      }]);

    picker.searchQuery = 'riz';
    const first = picker.runSearch();
    picker.searchQuery = 'rizal street';
    await picker.runSearch();
    resolveFirst([{ id: 'old', label: 'Old result', latitude: 1, longitude: 2 }]);
    await first;

    expect(picker.searchResults.map((place) => place.label)).toEqual(['J.P. Rizal Street, Balite']);
    picker.chooseSearchResult(picker.searchResults[0]);
    picker.confirmSelection();

    expect(confirmed[0]).toMatchObject({
      label: 'J.P. Rizal Street, Balite',
      latitude: 13.4112,
      longitude: 121.1811,
    });
    expect(picker.selectedSearchId).toBe('street-1');
    expect(picker.searchResults[0].label).toBe('J.P. Rizal Street, Balite');
  });

  it('keeps a search result name and address when reverse geocoding returns another place', async () => {
    const maps = TestBed.inject(MapsService) as unknown as {
      describePlace: ReturnType<typeof vi.fn>;
    };
    maps.describePlace.mockResolvedValueOnce({ title: 'Wrong Barangay', detail: 'Wrong Road' });
    picker.chooseSearchResult({
      id: 'mmg',
      label: 'MMG Hospital, J.P. Rizal Street, Calapan',
      latitude: 13.389,
      longitude: 121.176,
    });
    await Promise.resolve();

    expect(picker.draftTitle).toContain('MMG Hospital');
    expect(picker.draftDetail).toBe('J.P. Rizal Street, Calapan');
    expect(picker.draftLatitude).toBe(13.389);
    expect(picker.draftLongitude).toBe(121.176);
    picker.confirmSelection();
    expect(confirmed.at(-1)).toMatchObject({
      label: 'MMG Hospital, J.P. Rizal Street, Calapan',
      detail: 'J.P. Rizal Street, Calapan',
      latitude: 13.389,
      longitude: 121.176,
    });
  });

  it('selects a real GPS fix and does not invent one when GPS fails', async () => {
    const maps = TestBed.inject(MapsService) as unknown as {
      currentPosition: ReturnType<typeof vi.fn>;
    };
    picker.ngOnInit();
    const before = { latitude: picker.draftLatitude, longitude: picker.draftLongitude };
    maps.currentPosition.mockRejectedValueOnce(new Error('Location permission was denied. You can still choose a point on the map.'));
    picker.useMyLocation();
    await Promise.resolve();
    await Promise.resolve();

    expect(picker.gpsMessage).toContain('permission was denied');
    expect(picker.draftLatitude).toBe(before.latitude);
    expect(picker.draftLongitude).toBe(before.longitude);
    expect(picker.draftSource).not.toBe('gps');
    expect(picker.selectionReady).toBe(false);

    maps.currentPosition.mockResolvedValueOnce({
      latitude: 13.51234,
      longitude: 121.31234,
      accuracyMeters: 9,
      source: 'device-gps',
    });
    picker.useMyLocation();
    await Promise.resolve();
    await Promise.resolve();
    picker.confirmSelection();

    expect(confirmed.at(-1)).toMatchObject({
      latitude: 13.51234,
      longitude: 121.31234,
      source: 'gps',
    });
    expect(confirmed.at(-1)?.label).not.toMatch(/^-?\d+\.\d+/);
  });

  it('confirms a manual map point without waiting for an address lookup', () => {
    picker.beginAdjusting();
    picker.noteMapMoved(13.45551, 121.20012, true);
    picker.useAdjustedPoint();
    picker.confirmSelection();

    expect(confirmed[0]).toMatchObject({
      latitude: 13.45551,
      longitude: 121.20012,
    });
    expect(confirmed[0].label).not.toMatch(/hospital/i);
  });

  it('keeps MMG Hospital when a map move is not a new manual selection', () => {
    picker.chooseSearchResult({
      id: 'mmg',
      label: 'MMG Hospital',
      latitude: 13.389,
      longitude: 121.176,
    });
    picker.noteMapMoved(13.41, 121.18, false);
    picker.confirmSelection();

    expect(confirmed.at(-1)).toMatchObject({
      label: 'MMG Hospital',
      latitude: 13.389,
      longitude: 121.176,
    });
  });

  it('does not change a chosen hospital when the destination map is only explored', () => {
    picker.role = 'destination';
    picker.chooseSearchResult({
      id: 'mmg',
      label: 'MMG Hospital',
      latitude: 13.389,
      longitude: 121.176,
    });
    picker.noteMapMoved(13.5, 121.3, true);

    expect(picker.draftTitle).toBe('MMG Hospital');
    expect(picker.draftLatitude).toBe(13.389);
    expect(picker.adjustingLocation).toBe(false);

    picker.beginAdjusting();
    picker.noteMapMoved(13.5, 121.3, true);
    expect(picker.draftTitle).toBe('MMG Hospital');
    picker.useAdjustedPoint();

    expect(picker.draftTitle).toBe('Finding this place…');
    expect(picker.draftLatitude).toBe(13.5);
    expect(picker.adjustingLocation).toBe(false);
  });

  it('keeps Luna Hospital until Use This Location replaces it after adjusting', () => {
    picker.chooseSearchResult({
      id: 'luna',
      label: 'Luna Hospital',
      latitude: 13.4,
      longitude: 121.2,
    });
    picker.beginAdjusting();
    picker.noteMapMoved(13.45, 121.25, true);

    expect(picker.draftTitle).toBe('Luna Hospital');
    expect(picker.draftLatitude).toBe(13.4);

    picker.useAdjustedPoint();
    expect(picker.draftTitle).toBe('Finding this place…');
    expect(picker.draftLatitude).toBe(13.45);
    expect(picker.draftLongitude).toBe(121.25);
  });

  it('names only a verified hospital within 75 meters and keeps the pin coordinates', () => {
    picker.facilities = [
      {
        id: 'mmg',
        name: 'MMG Hospital',
        unnamed: false,
        kind: 'hospital',
        latitude: 13.38905,
        longitude: 121.17605,
      },
      {
        id: 'luna',
        name: 'Luna Hospital',
        unnamed: false,
        kind: 'hospital',
        latitude: 13.5,
        longitude: 121.3,
      },
    ];
    picker.chooseFacility({
      id: 'mmg',
      name: 'MMG Hospital',
      unnamed: false,
      kind: 'hospital',
      latitude: 13.389,
      longitude: 121.176,
    });
    picker.noteMapMoved(13.5, 121.3, true);

    expect(picker.draftTitle).toBe('MMG Hospital');
    expect(picker.draftLatitude).toBe(13.389);
    expect(picker.draftLongitude).toBe(121.176);
  });

  it('opens the destination picker ready to show hospitals', () => {
    picker.role = 'destination';
    picker.ngOnInit();

    expect(picker.facilityFilter).toBe('hospital');
  });

  it('selects MMG Hospital from the facility list and keeps its coordinates', () => {
    const mmg: HealthcareFacility = {
      id: 'mmg',
      name: 'MMG Hospital',
      unnamed: false,
      kind: 'hospital',
      latitude: 13.3891,
      longitude: 121.1764,
    };
    picker.facilities = [mmg];
    picker.chooseFacility(mmg);
    picker.confirmSelection();

    expect(picker.selectedFacility()?.name).toBe('MMG Hospital');
    expect(confirmed.at(-1)).toMatchObject({
      label: 'MMG Hospital',
      latitude: 13.3891,
      longitude: 121.1764,
    });
  });

  it('does not select a search result that has no usable coordinates', () => {
    picker.chooseFacility(hospital);
    picker.chooseSearchResult({ id: 'bad', label: 'Unmapped place', latitude: Number.NaN, longitude: 121 });

    expect(picker.searchMessage).toContain('no usable coordinates');
    expect(picker.draftLatitude).toBe(13.42);
    expect(picker.draftLongitude).toBe(121.19);
  });

  it('does not query facilities again while the map is only panned', async () => {
    picker.noteMapMoved(13.412, 121.181);
    picker.noteMapMoved(13.413, 121.182);
    expect(nearby).not.toHaveBeenCalled();

    await picker.searchThisArea();
    picker.noteMapMoved(13.414, 121.183);

    expect(nearby).toHaveBeenCalledTimes(1);
    expect(picker.showSearchArea).toBe(false);
  });

  it('uses a fresh device location when Current location is pressed', async () => {
    const maps = TestBed.inject(MapsService) as unknown as {
      currentPosition: ReturnType<typeof vi.fn>;
    };
    picker.currentLocation = { latitude: 13.4, longitude: 121.2 };
    maps.currentPosition.mockResolvedValueOnce({
      latitude: 13.401,
      longitude: 121.202,
      accuracyMeters: 12,
      source: 'device-gps',
    });
    picker.useMyLocation();
    await Promise.resolve();
    await Promise.resolve();
    picker.confirmSelection();

    expect(maps.currentPosition).toHaveBeenCalled();
    expect(confirmed[0]).toMatchObject({
      latitude: 13.401,
      longitude: 121.202,
      source: 'gps',
    });
    expect(confirmed[0].label).not.toMatch(/^-?\d+\.\d+/);
  });

  it('falls back to the last GPS reading when a fresh reading fails', async () => {
    const maps = TestBed.inject(MapsService) as unknown as {
      currentPosition: ReturnType<typeof vi.fn>;
    };
    picker.currentLocation = { latitude: 13.401, longitude: 121.202 };
    picker.currentAccuracyMeters = 109;
    maps.currentPosition.mockRejectedValueOnce(new Error('Location request timed out.'));
    picker.useMyLocation();
    await Promise.resolve();
    await Promise.resolve();
    picker.confirmSelection();

    expect(picker.gpsMessage).toContain('last GPS reading');
    expect(confirmed[0]).toMatchObject({
      latitude: 13.401,
      longitude: 121.202,
      source: 'gps',
    });
  });

  it('keeps the selected coordinates when facility loading fails', async () => {
    nearby.mockRejectedValueOnce(new Error('Nearby facilities could not be loaded. You can still pan the map and confirm a point.'));
    picker.beginAdjusting();
    picker.noteMapMoved(13.4, 121.2, true);
    picker.useAdjustedPoint();

    await picker.searchThisArea();

    expect(picker.facilities).toEqual([]);
    expect(picker.facilitiesMessage).toContain('could not be loaded');
    expect(picker.facilitiesFailed).toBe(true);
    picker.confirmSelection();
    expect(confirmed[0]).toMatchObject({ latitude: 13.4, longitude: 121.2 });
  });

  it('restores a confirmed destination without treating pickup as selected', () => {
    picker.role = 'destination';
    picker.initialLatitude = 13.389;
    picker.initialLongitude = 121.176;
    picker.initialLabel = 'MMG Hospital';
    picker.otherLatitude = 13.401;
    picker.otherLongitude = 121.201;
    picker.ngOnInit();

    expect(picker.selectionReady).toBe(true);
    expect(picker.draftLatitude).toBe(13.389);
    expect(picker.draftTitle).toBe('MMG Hospital');
    picker.confirmSelection();
    expect(confirmed[0]).toMatchObject({
      label: 'MMG Hospital',
      latitude: 13.389,
      longitude: 121.176,
    });
  });

  it('rejects confirming the pickup coordinates as the destination', () => {
    picker.role = 'destination';
    picker.otherLatitude = 13.401;
    picker.otherLongitude = 121.201;
    picker.beginAdjusting();
    picker.noteMapMoved(13.401, 121.201, true);
    picker.useAdjustedPoint();
    picker.confirmSelection();

    expect(confirmed).toEqual([]);
    expect(picker.selectionMessage).toContain('different place');
  });
});
