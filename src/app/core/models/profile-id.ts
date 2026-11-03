const PROFILE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** True for a Supabase profile id. Local CareRide ids such as CR-* are not profile ids. */
export function isProfileUuid(value: string | null | undefined): value is string {
  return Boolean(value) && PROFILE_UUID.test(value as string);
}
