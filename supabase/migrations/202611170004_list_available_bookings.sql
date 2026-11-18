-- CareRide: restricted Driver booking discovery.
-- Staging preparation only. No production deployment.

begin;

create or replace function public.list_available_bookings()
returns table (
  id uuid,
  passenger_type text,
  passenger_name text,
  pickup_location text,
  destination text,
  purpose text,
  ride_date date,
  ride_time time,
  assistance text[],
  other_assistance_notes text,
  notes text,
  pickup_latitude double precision,
  pickup_longitude double precision,
  destination_latitude double precision,
  destination_longitude double precision,
  driver_id uuid,
  preferred_driver_id uuid,
  referral_status text,
  status text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor uuid := careride_private.require_actor();
begin
  perform careride_private.require_role(
    actor,
    'driver',
    'Only an approved driver can list available bookings'
  );

  return query
  select
    b.id,
    b.passenger_type,
    b.passenger_name,
    b.pickup_location,
    b.destination,
    b.purpose,
    b.ride_date,
    b.ride_time,
    b.assistance,
    b.other_assistance_notes,
    b.notes,
    b.pickup_latitude,
    b.pickup_longitude,
    b.destination_latitude,
    b.destination_longitude,
    b.driver_id,
    b.preferred_driver_id,
    b.referral_status,
    b.status,
    b.created_at,
    b.updated_at
  from public.bookings b
  where b.status in ('Pending', 'Scheduled')
   
and (
  -- Requests specifically assigned to this driver
  b.preferred_driver_id = actor
  or b.driver_id = actor

  -- Open requests without a preferred or assigned driver
  or (
    b.preferred_driver_id is null
    and b.driver_id is null
    and exists (
      select 1
      from public.driver_details dd
      where dd.user_id = actor
        and dd.availability = 'available'
    )
  )
)

    and (
      b.referral_status is null
      or b.referral_status in (
        'passenger_declined',
        'passenger_confirmed'
      )
    )
  order by b.created_at desc;
end;
$$;

revoke all on function public.list_available_bookings()
  from public, anon, authenticated, authenticator, service_role;

grant execute on function public.list_available_bookings()
  to authenticated;

commit;