import { TestBed } from '@angular/core/testing';
import {
  HealthcareFacilityService,
  distanceMeters,
  facilityLabel,
  filterFacilities,
  facilityIdsWithLabels,
  nearestVerifiedFacility,
  overpassHealthcareQuery,
  parseOverpassHealthcare,
  sortFacilities,
} from './healthcare-facilities';

describe('healthcare facilities', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    TestBed.resetTestingModule();
  });

  it('asks Overpass for hospitals, clinics, and health centers', () => {
    const query = overpassHealthcareQuery(13.4115, 121.1803, 8000);

    expect(query).toContain('["amenity"="hospital"]');
    expect(query).toContain('["amenity"="clinic"]');
    expect(query).toContain('["healthcare"="hospital"]');
    expect(query).toContain('["healthcare"="clinic"]');
    expect(query).toContain('["healthcare"="centre"]');
    expect(query).toContain('around:8000,13.4115,121.1803');
  });

  it('keeps one facility when several tags describe the same place and labels unnamed ones', () => {
    const facilities = parseOverpassHealthcare({
      elements: [
        {
          type: 'node',
          id: 1,
          lat: 13.41,
          lon: 121.18,
          tags: { amenity: 'hospital', healthcare: 'hospital', name: 'Oriental Mindoro Provincial Hospital' },
        },
        {
          type: 'node',
          id: 1,
          lat: 13.41,
          lon: 121.18,
          tags: { amenity: 'hospital', name: 'Oriental Mindoro Provincial Hospital' },
        },
        {
          type: 'way',
          id: 2,
          center: { lat: 13.42, lon: 121.19 },
          tags: { healthcare: 'centre' },
        },
        {
          type: 'node',
          id: 3,
          lat: 13.43,
          lon: 121.2,
          tags: { amenity: 'clinic', name: 'Barangay Health Clinic' },
        },
      ],
    });

    expect(facilities.map((facility) => facility.id)).toEqual(['node/1', 'way/2', 'node/3']);
    expect(facilityLabel(facilities[0])).toBe('Oriental Mindoro Provincial Hospital');
    expect(facilities[1].kind).toBe('health-center');
    expect(facilityLabel(facilities[1])).toBe('Unnamed health center');
    expect(facilities[1].unnamed).toBe(true);
  });

  it('filters and sorts facilities from the nearest point', () => {
    const facilities = parseOverpassHealthcare({
      elements: [
        { type: 'node', id: 10, lat: 13.5, lon: 121.3, tags: { amenity: 'hospital', name: 'Far Hospital' } },
        { type: 'node', id: 11, lat: 13.412, lon: 121.181, tags: { amenity: 'clinic', name: 'Near Clinic' } },
        { type: 'node', id: 12, lat: 13.43, lon: 121.2, tags: { healthcare: 'centre', name: 'City Health Center' } },
      ],
    });
    const sorted = sortFacilities(facilities, { latitude: 13.4115, longitude: 121.1803 });

    expect(sorted[0].name).toBe('Near Clinic');
    expect(distanceMeters(sorted[0], sorted[1])).toBeGreaterThan(0);
    expect(filterFacilities(sorted, 'hospital').map((facility) => facility.name)).toEqual(['Far Hospital']);
    expect(filterFacilities(sorted, 'health-center').map((facility) => facility.name)).toEqual(['City Health Center']);
    expect(nearestVerifiedFacility(facilities, { latitude: 13.412, longitude: 121.181 })?.name).toBe('Near Clinic');
    expect(nearestVerifiedFacility(facilities, { latitude: 13.2, longitude: 121.0 })).toBeNull();
    expect(facilityIdsWithLabels([
      { id: 'luna', x: 0, y: 0, kind: 'hospital' },
      { id: 'clinic', x: 10, y: 0, kind: 'clinic' },
      { id: 'mmg', x: 200, y: 0, kind: 'hospital' },
    ], 80)).toEqual(['luna', 'mmg']);
  });

  it('caches a successful Overpass response and reports a failure without inventing facilities', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        elements: [
          { type: 'node', id: 9, lat: 13.41, lon: 121.18, tags: { amenity: 'hospital', name: 'Provincial Hospital' } },
        ],
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    TestBed.configureTestingModule({});
    const service = TestBed.inject(HealthcareFacilityService);

    const first = await service.nearby(13.4115, 121.1803);
    const second = await service.nearby(13.412, 121.181);

    expect(first[0].name).toBe('Provincial Hospital');
    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = (fetchMock.mock.calls as unknown as unknown[][])[0][0];
    expect(String(calledUrl)).toBe('https://overpass-api.de/api/interpreter');

    fetchMock
      .mockRejectedValueOnce(new Error('offline'))
      .mockRejectedValueOnce(new Error('offline'));
    await expect(service.nearby(14.6, 120.98)).rejects.toThrow('could not be loaded');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('tries the Overpass mirror when the primary endpoint fails', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          elements: [
            { type: 'node', id: 11, lat: 13.389, lon: 121.176, tags: { amenity: 'hospital', name: 'MMG Hospital' } },
          ],
        }),
      });
    vi.stubGlobal('fetch', fetchMock);
    TestBed.configureTestingModule({});
    const service = TestBed.inject(HealthcareFacilityService);

    const facilities = await service.nearby(13.39, 121.18);

    expect(facilities[0].name).toBe('MMG Hospital');
    expect(String((fetchMock.mock.calls as unknown as unknown[][])[0][0])).toBe('https://overpass-api.de/api/interpreter');
    expect(String((fetchMock.mock.calls as unknown as unknown[][])[1][0])).toBe('https://overpass.kumi.systems/api/interpreter');
  });
});
