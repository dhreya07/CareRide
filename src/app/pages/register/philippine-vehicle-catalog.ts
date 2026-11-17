/**
 * Philippine-market passenger vehicle name catalog for registration assistance.
 * Names are not an authoritative fitment/capacity database; uncertain variants
 * and every model year use the explicit Admin-review manual-entry path.
 */
export type DriverVehicleBodyType = 'Sedan' | 'Hatchback' | 'MPV' | 'SUV' | 'Van';

export const DRIVER_VEHICLE_BODY_TYPES: readonly DriverVehicleBodyType[] = [
  'Sedan', 'Hatchback', 'MPV', 'SUV', 'Van',
];

export const DRIVER_VEHICLE_BRANDS = [
  'Toyota', 'Mitsubishi', 'Honda', 'Suzuki', 'Hyundai', 'Nissan', 'Isuzu', 'Kia',
  'Other / Not Listed',
] as const;

export const DRIVER_VEHICLE_COLORS = [
  'White', 'Black', 'Silver', 'Gray', 'Red', 'Blue', 'Brown', 'Beige', 'Green', 'Other',
] as const;

export interface DriverVehicleModelEntry {
  readonly bodyType: DriverVehicleBodyType;
  readonly brand: Exclude<(typeof DRIVER_VEHICLE_BRANDS)[number], 'Other / Not Listed'>;
  readonly model: string;
  /** Kept empty unless an authoritative PH source supports exact variant names. */
  readonly variants: readonly string[];
}

export interface DriverVehicleCapacityConfiguration {
  readonly id: string;
  readonly brand: string;
  readonly model: string;
  readonly variant: string;
  readonly modelYear: number;
  /** Conventional usable passenger seats; driver seat and wheelchair positions are excluded. */
  readonly passengerSeatsExcludingDriver: number;
  readonly seatingConfiguration: string;
  readonly sourceLabel: string;
  readonly sourceUrl: string;
}

/**
 * No entries are populated until a primary source documents the exact year,
 * variant and seating configuration. Registration must never infer capacity
 * from a model name alone.
 */
export const PHILIPPINE_VEHICLE_CAPACITY_CONFIGURATIONS: readonly DriverVehicleCapacityConfiguration[] = [];

const entries = (
  brand: DriverVehicleModelEntry['brand'],
  bodyType: DriverVehicleBodyType,
  models: string[],
  knownVariants: Readonly<Record<string, readonly string[]>> = {},
): DriverVehicleModelEntry[] => models.map((model) => ({
  brand, bodyType, model, variants: knownVariants[model] ?? [],
}));

/** Model names are offered by body type; variant and year are manual pending stronger data. */
export const PHILIPPINE_DRIVER_VEHICLE_CATALOG: readonly DriverVehicleModelEntry[] = [
  ...entries('Toyota', 'Sedan', ['Vios', 'ATIV', 'Corolla Altis', 'Camry', 'Corona', 'Cressida'], {
    Vios: ['1.3 XLE CVT', '1.3 XLE M/T', '1.3 XE CVT', '1.3 J M/T'],
    ATIV: ['1.5 HEV CVT', '1.5 G CVT', '1.3 E CVT', '1.3 E M/T'],
  }),
  ...entries('Toyota', 'Hatchback', ['Wigo', 'Yaris', 'Starlet'], {
    Wigo: ['G CVT', 'E CVT', 'J M/T'],
  }),
  ...entries('Toyota', 'MPV', ['Avanza', 'Innova', 'Veloz', 'Innova Zenix', 'Sienta', 'Previa'], {
    Avanza: ['1.5 G CVT', '1.3 E CVT', '1.3 E M/T', '1.3 J M/T'],
    Innova: ['2.8L V DSL A/T', '2.8L G DSL A/T', '2.8L G DSL M/T', '2.8L E DSL A/T', '2.8 XE A/T', '2.8L J DSL M/T'],
  }),
  ...entries('Toyota', 'SUV', ['Fortuner', 'RAV4', 'Raize', 'Corolla Cross', 'Rush', 'Land Cruiser Prado', 'Land Cruiser']),
  ...entries('Toyota', 'Van', ['HiAce', 'Alphard', 'Coaster']),
  ...entries('Mitsubishi', 'Sedan', ['Mirage G4', 'Lancer', 'Galant']),
  ...entries('Mitsubishi', 'Hatchback', ['Mirage', 'Colt']),
  ...entries('Mitsubishi', 'MPV', ['Xpander', 'Xpander Cross', 'Adventure', 'Space Wagon']),
  ...entries('Mitsubishi', 'SUV', ['Montero Sport', 'Pajero', 'ASX', 'Outlander', 'XFORCE']),
  ...entries('Mitsubishi', 'Van', ['L300', 'Versa Van', 'Delica']),
  ...entries('Honda', 'Sedan', ['City', 'Civic', 'Accord'], {
    City: ['1.5 RS CVT Honda SENSING', '1.5 V CVT Honda SENSING', '1.5 S CVT Honda SENSING'],
    Civic: ['RS e:HEV E-CVT', 'RS Turbo CVT', 'V Turbo CVT'],
  }),
  ...entries('Honda', 'Hatchback', ['Brio', 'City Hatchback', 'Jazz', 'Fit'], {
    Brio: ['1.2 RS Black Top CVT', '1.2 V CVT'],
    'City Hatchback': ['1.5 RS CVT'],
  }),
  ...entries('Honda', 'MPV', ['BR-V', 'Mobilio', 'Freed', 'Odyssey']),
  ...entries('Honda', 'SUV', ['HR-V', 'CR-V', 'Pilot']),
  ...entries('Honda', 'Van', ['Stepwgn']),
  ...entries('Suzuki', 'Sedan', ['Dzire', 'Ciaz', 'Esteem']),
  ...entries('Suzuki', 'Hatchback', ['S-Presso', 'Swift', 'Celerio', 'Alto']),
  ...entries('Suzuki', 'MPV', ['Ertiga', 'XL7', 'APV']),
  ...entries('Suzuki', 'SUV', ['Fronx', 'Jimny', 'Jimny 5-Door', 'Vitara', 'Grand Vitara', 'e VITARA']),
  ...entries('Suzuki', 'Van', ['Every', 'Carry']),
  ...entries('Hyundai', 'Sedan', ['Accent', 'Elantra', 'Sonata']),
  ...entries('Hyundai', 'Hatchback', ['Eon', 'i10', 'Getz']),
  ...entries('Hyundai', 'MPV', ['Stargazer', 'Stargazer X', 'Custin', 'Staria', 'Staria Hybrid']),
  ...entries('Hyundai', 'SUV', ['Venue', 'Creta', 'Kona', 'Tucson', 'Santa Fe', 'Palisade']),
  ...entries('Hyundai', 'Van', ['Grand Starex', 'Starex', 'H-100']),
  ...entries('Nissan', 'Sedan', ['Almera', 'Sentra', 'Sylphy', 'Altima']),
  ...entries('Nissan', 'Hatchback', ['March', 'Tiida']),
  ...entries('Nissan', 'MPV', ['Livina', 'Serena']),
  ...entries('Nissan', 'SUV', ['Kicks', 'Terra', 'X-Trail', 'Patrol', 'Juke']),
  ...entries('Nissan', 'Van', ['Urvan', 'NV350 Urvan']),
  ...entries('Isuzu', 'Sedan', []),
  ...entries('Isuzu', 'Hatchback', []),
  ...entries('Isuzu', 'MPV', ['Crosswind', 'Hi-Lander']),
  ...entries('Isuzu', 'SUV', ['MU-X', 'Alterra', 'Trooper']),
  ...entries('Isuzu', 'Van', ['Traviz']),
  ...entries('Kia', 'Sedan', ['Soluto', 'Rio', 'Forte']),
  ...entries('Kia', 'Hatchback', ['Picanto', 'Rio']),
  ...entries('Kia', 'MPV', ['Carnival', 'Grand Carnival', 'Carens', 'Rondo']),
  ...entries('Kia', 'SUV', ['Sonet', 'Seltos', 'Sportage', 'Sorento', 'Stonic', 'Soul']),
  ...entries('Kia', 'Van', ['K2500']),
];
