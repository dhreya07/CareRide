-- Staging-only follow-up: a Passenger can read the assigned Driver's one
-- fresh location only for that Passenger's own ride in progress.
-- Do not run against CareRide1 production.

begin;

do $$
begin
  if to_regclass('public.bookings') is null
     or to_regclass('careride_private.driver_locations') is null
     or to_regprocedure('careride_private.require_actor()') is null
     or to_regprocedure('careride_private.require_role(uuid,text,text)') is null then
    raise exception 'Apply the bookings and secure Driver GPS migrations before this file';
  end if;
end;
$$;

create or replace function public.get_active_booking_driver_location(p_booking_id uuid)
returns table (
  latitude double precision,
  longitude double precision,
  accuracy_m double precision,
  captured_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := careride_private.require_actor();
  assigned_driver uuid;
begin
  perform careride_private.require_role(
    actor,
    'passenger',
    'Only the booking passenger can view live driver location'
  );

  select b.driver_id
  into assigned_driver
  from public.bookings as b
  where b.id = p_booking_id
    and b.passenger_id = actor
    and b.status = 'In Progress';

  if not found or assigned_driver is null then
    raise exception 'Active booking not found' using errcode = 'P0002';
  end if;

  -- driver_locations stores a latest fix only. An empty result is intentional
  -- when the fix is unavailable, stale, inaccurate, or future-dated.
  return query
  select
    l.latitude,
    l.longitude,
    l.accuracy_m,
    l.captured_at
  from careride_private.driver_locations as l
  where l.driver_id = assigned_driver
    and l.latitude between -90 and 90
    and l.longitude between -180 and 180
    and l.accuracy_m between 0 and 100
    and l.captured_at <= clock_timestamp()
    and l.captured_at >= clock_timestamp() - interval '30 seconds'
    and l.received_at <= clock_timestamp()
    and l.received_at >= clock_timestamp() - interval '30 seconds';
end;
$$;

revoke all on function public.get_active_booking_driver_location(uuid)
  from public, anon, authenticated, authenticator, service_role;
grant execute on function public.get_active_booking_driver_location(uuid) to authenticated;

commit;
