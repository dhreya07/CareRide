// This file can be replaced during build by using the `fileReplacements` array.
// `ng build` replaces `environment.ts` with `environment.prod.ts`.
// The list of file replacements can be found in `angular.json`.

export const environment = {
  production: false,
  // Public client values only. Never put a service-role or secret key here.
  // cloudMigration stays false until booking data moves to Supabase.
  // cloudAuthEnabled stays false until a later step turns on Supabase sign-in.
  supabase: {
    url: 'https://rvswyreywmibgmiahdhw.supabase.co',
    anonKey: 'sb_publishable_AJI4FYGNrQJBZw1NzDsvlg_YnjlazHr',
    cloudMigration: false,
    cloudAuthEnabled: false,
  },
  // Browser key restricted to this origin and Maps JavaScript API.
  googleMaps: { apiKey: '' },
};

/*
 * For easier debugging in development mode, you can import the following file
 * to ignore zone related error stack frames such as `zone.run`, `zoneDelegate.invokeTask`.
 *
 * This import should be commented out in production mode because it will have a negative impact
 * on performance if an error is thrown.
 */
// import 'zone.js/plugins/zone-error';  // Included with Angular CLI.
