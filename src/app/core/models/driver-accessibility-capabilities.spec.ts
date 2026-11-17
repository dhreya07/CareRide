import {
  DRIVER_ACCESSIBILITY_OPTIONS,
  mapDriverAccessibilitySelections,
  normalizeDriverAccessibilityCapabilities,
} from './driver-accessibility-capabilities';

describe('driver accessibility capability mapping', () => {
  it('maps every visible choice to its database identifier while retaining readable labels', () => {
    const options = DRIVER_ACCESSIBILITY_OPTIONS;
    expect(options).toHaveLength(10);
    expect(mapDriverAccessibilitySelections(options.map((option) => option.key))).toEqual([
      'boarding_exiting_assistance',
      'caregiver_seating',
      'walker_storage',
      'folded_wheelchair_storage',
      'wheelchair_ramp',
      'wheelchair_lift',
      'wheelchair_securement',
      'passenger_restraints',
      'mobility_assistance_training',
      'working_air_conditioning',
    ]);
    expect(options.find((option) => option.key === 'wheelchairRamp')?.label).toBe('Wheelchair ramp');
  });

  it('rejects unsupported UI selections and database identifiers', () => {
    expect(() => mapDriverAccessibilitySelections(['adminVerifiedAccessibility']))
      .toThrow('Unsupported driver accessibility selection');
    expect(() => normalizeDriverAccessibilityCapabilities(['admin_verified_accessibility']))
      .toThrow('Unsupported driver accessibility capability');
  });

  it('keeps transfer_assistance as a supported non-UI database identifier', () => {
    expect(DRIVER_ACCESSIBILITY_OPTIONS.some((option) => (option.key as string) === 'transfer_assistance')).toBe(false);
    expect(normalizeDriverAccessibilityCapabilities([' transfer_assistance '])).toEqual(['transfer_assistance']);
  });
});
