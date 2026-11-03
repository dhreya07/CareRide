# CareRide setup notes

## Local app

- Run `npm install` after pulling dependency changes.
- Run `ionic serve` or `ng serve --port 8100`.
- Open `http://localhost:8100` (or `http://127.0.0.1:8100`).
- Without Supabase keys, the app uses on-device storage. Public registration always creates a **passenger** account.
- Local demo accounts (not available through public registration):
  - Admin: `admin@careride.local` / `CareRideAdmin1` → `/admin`
  - Driver: `driver@careride.local` / `CareRideDriver1` → `/driver`
- After sign-in, users are redirected by role. Passenger routes stay on `/dashboard`.

## Supabase

1. Create a Supabase project.
2. Copy the project URL and public anon/publishable key into `src/environments/environment.ts` and `environment.prod.ts`. Never put a service-role key in the app.
3. Run `supabase/migrations/202610120001_care_ride_schema.sql`. If that file already ran earlier, also run `supabase/migrations/202610270001_three_role_alignment.sql`.
4. Configure Auth email confirmation and allowed redirect URLs.
5. Public signup always creates `profiles.role = 'passenger'`. Provision **driver** and **admin** only as a trusted operator, for example:

```
update public.profiles set role = 'admin' where email = 'admin@example.com';
update public.profiles set role = 'driver' where email = 'driver@example.com';
insert into public.drivers (profile_id, is_available)
  select id, true from public.profiles where email = 'driver@example.com'
  on conflict (profile_id) do update set is_available = true;
```

6. Ride assignment uses `assign_ride_driver`. Status changes use `transition_ride_status`. Both are server-side RPCs with RLS enabled. Frontend route guards are UX only.

## Maps

Add a Google Maps **browser** API key to `environment.googleMaps.apiKey`.

Enable and restrict:
- Maps JavaScript API
- Geocoding API
- HTTP referrer restriction to the app origin

Then use **Lookup pickup on map** / **Lookup destination on map** on Request Ride. Coordinates are stored with the ride. Live vehicle tracking is not implemented.

## SMS

The client calls the `send-ride-notification` Edge Function after a ride is saved. A failed SMS does not cancel the ride.

Deploy:

```
supabase functions deploy send-ride-notification
```

Set these **server-side** secrets (never in the Ionic app):

- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_FROM_NUMBER`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

SMS delivery is not verified until those secrets are set and a test message succeeds.

## Current limits

- Local preview stores users and rides in `localStorage`. That is for development only and is not a production security model.
- Live tracking and SMS delivery need the configured backend secrets above.
- Do not deploy without reviewing RLS, auth settings, accessibility, privacy, and emergency escalation for the local operating context.
