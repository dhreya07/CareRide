
export const environment = {
  production: false,

  // Public client values only.
  // Never put a service-role or secret key here.
  supabase: {
    url: 'https://equgimeazblvoarklbee.supabase.co',
    anonKey: 'sb_publishable__XxIMnQpdKgHNLQUKdhgIw_ZP-nsmhs',

    // Staging-only cloud booking storage. Existing local rides remain on-device
    // and are not migrated automatically.
    // Staging bookings use the approved Supabase booking RPCs. Production keeps
    // its own environment setting and is intentionally not changed here.
    cloudMigration: true,

    // Enable Supabase Auth for development testing.
    cloudAuthEnabled: true,
  },

  googleMaps: { apiKey: '' },
};

/*
 * For easier debugging in development mode,
 * you can import the following file.
 */
// import 'zone.js/plugins/zone-error';
