import { registerCareIcons } from './icons';

describe('CareRide icon registration', () => {
  it('registers business-outline before the registration form renders it', () => {
    registerCareIcons();

    const ionicWindow = window as Window & { Ionicons?: { map?: Map<string, unknown> } };
    expect(ionicWindow.Ionicons?.map?.has('business-outline')).toBe(true);
  });
});
