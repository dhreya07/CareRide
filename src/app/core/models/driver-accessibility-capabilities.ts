/** Database identifiers accepted by both V3 migrations. */
export type DriverAccessibilityCapability =
  | 'boarding_exiting_assistance'
  | 'caregiver_seating'
  | 'walker_storage'
  | 'folded_wheelchair_storage'
  | 'wheelchair_ramp'
  | 'wheelchair_lift'
  | 'wheelchair_securement'
  | 'passenger_restraints'
  | 'mobility_assistance_training'
  | 'working_air_conditioning'
  | 'transfer_assistance';

/** Frontend keys map explicitly to the persisted snake_case identifiers. */
export const DRIVER_ACCESSIBILITY_OPTIONS = [
  { key: 'boardingExitingAssistance', label: 'Boarding and exiting assistance', databaseId: 'boarding_exiting_assistance' },
  { key: 'caregiverSeating', label: 'Caregiver seating', databaseId: 'caregiver_seating' },
  { key: 'walkerStorage', label: 'Walker storage', databaseId: 'walker_storage' },
  { key: 'foldedWheelchairStorage', label: 'Folded wheelchair storage', databaseId: 'folded_wheelchair_storage' },
  { key: 'wheelchairRamp', label: 'Wheelchair ramp', databaseId: 'wheelchair_ramp' },
  { key: 'wheelchairLift', label: 'Wheelchair lift', databaseId: 'wheelchair_lift' },
  { key: 'wheelchairSecurement', label: 'Wheelchair securement', databaseId: 'wheelchair_securement' },
  { key: 'passengerRestraints', label: 'Passenger restraints', databaseId: 'passenger_restraints' },
  { key: 'mobilityAssistanceTraining', label: 'Mobility-assistance training', databaseId: 'mobility_assistance_training' },
  { key: 'workingAirConditioning', label: 'Working air conditioning', databaseId: 'working_air_conditioning' },
] as const satisfies readonly {
  key: string;
  label: string;
  databaseId: DriverAccessibilityCapability;
}[];

export type DriverAccessibilitySelection = (typeof DRIVER_ACCESSIBILITY_OPTIONS)[number]['key'];

const optionByKey = new Map<string, (typeof DRIVER_ACCESSIBILITY_OPTIONS)[number]>(
  DRIVER_ACCESSIBILITY_OPTIONS.map((option) => [option.key, option]),
);
const supportedDatabaseIds = new Set<DriverAccessibilityCapability>([
  ...DRIVER_ACCESSIBILITY_OPTIONS.map((option) => option.databaseId),
  // Retained as a database/API identifier; it is not a current form option.
  'transfer_assistance',
]);

export function mapDriverAccessibilitySelections(
  selections: readonly string[],
): DriverAccessibilityCapability[] {
  const seen = new Set<string>();
  return selections.map((selection) => {
    const option = optionByKey.get(selection);
    if (!option) {
      throw new Error(`Unsupported driver accessibility selection: ${selection}`);
    }
    if (seen.has(selection)) {
      throw new Error(`Duplicate driver accessibility selection: ${selection}`);
    }
    seen.add(selection);
    return option.databaseId;
  });
}

/** Validates untrusted adapter input before it is placed in signup metadata. */
export function normalizeDriverAccessibilityCapabilities(
  capabilities: readonly string[],
): DriverAccessibilityCapability[] {
  const normalized: DriverAccessibilityCapability[] = [];
  const seen = new Set<string>();
  for (const capability of capabilities) {
    const value = capability.trim();
    if (!supportedDatabaseIds.has(value as DriverAccessibilityCapability)) {
      throw new Error(`Unsupported driver accessibility capability: ${value || '(empty)'}`);
    }
    if (seen.has(value)) {
      throw new Error(`Duplicate driver accessibility capability: ${value}`);
    }
    seen.add(value);
    normalized.push(value as DriverAccessibilityCapability);
  }
  return normalized;
}
