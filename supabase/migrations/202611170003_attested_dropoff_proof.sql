-- Staging-only follow-up. Camera proof is validated near the confirmed
-- destination without retaining raw Driver GPS coordinates in the database.
-- Apply after 202611170001_secure_dropoff_proofs.sql. Never run on CareRide1.

begin;

do $$
begin
  if to_regclass('public.booking_dropoff_proofs') is null
     or to_regprocedure('public.submit_booking_dropoff_proof(uuid,text)') is null
     or to_regprocedure('careride_private.require_actor()') is null then
    raise exception 'Apply the secure dropoff proof migration before this file';
  end if;
end;
$$;

alter table public.booking_dropoff_proofs
  add column if not exists captured_at timestamptz,
  add column if not exists destination_verified boolean not null default false;

create or replace function public.submit_booking_dropoff_proof_attested(
  p_booking_id uuid,
  p_storage_path text,
  p_captured_at timestamptz,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_m double precision
)
returns public.booking_dropoff_proofs
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := careride_private.require_actor();
  saved public.bookings;
  proof public.booking_dropoff_proofs;
  distance_to_destination double precision;
  expected_path_pattern text;
begin
  perform careride_private.require_role(actor, 'driver', 'Only an approved driver can submit a safe-arrival photo');
  select * into saved from public.bookings where id = p_booking_id for update;
  if not found or saved.driver_id is distinct from actor then
    raise exception 'Only the assigned driver can submit a safe-arrival photo';
  end if;
  if saved.status <> 'Completed' then
    raise exception 'Complete the ride before submitting a safe-arrival photo';
  end if;
  if p_accuracy_m is null or p_accuracy_m < 0 or p_accuracy_m > 100
     or p_latitude is null or p_latitude not between -90 and 90
     or p_longitude is null or p_longitude not between -180 and 180
     or p_captured_at is null
     or p_captured_at > clock_timestamp()
     or p_captured_at < clock_timestamp() - interval '5 minutes' then
    raise exception 'A fresh accurate GPS fix is required to verify safe arrival';
  end if;
  if saved.destination_latitude is null or saved.destination_longitude is null
     or saved.destination_latitude not between -90 and 90
     or saved.destination_longitude not between -180 and 180 then
    raise exception 'This booking has no confirmed destination location';
  end if;

  distance_to_destination := 6371000 * acos(least(1.0, greatest(-1.0,
    sin(radians(p_latitude)) * sin(radians(saved.destination_latitude)) +
    cos(radians(p_latitude)) * cos(radians(saved.destination_latitude)) *
    cos(radians(saved.destination_longitude) - radians(p_longitude))
  )));
  if distance_to_destination > 250 then
    raise exception 'The safe-arrival photo must be taken near the confirmed destination';
  end if;

  expected_path_pattern := '^bookings/' || saved.id::text || '/[0-9a-f-]{36}\.jpg$';
  if p_storage_path is null or p_storage_path !~ expected_path_pattern then
    raise exception 'The arrival photo path is invalid';
  end if;
  if exists (select 1 from public.booking_dropoff_proofs where booking_id = saved.id) then
    raise exception 'A safe-arrival photo was already submitted for this booking';
  end if;
  if not exists (
    select 1 from storage.objects
    where bucket_id = 'careride-dropoff-proofs'
      and name = p_storage_path
      and owner_id = actor::text
  ) then
    raise exception 'The arrival photo upload was not found';
  end if;

  insert into public.booking_dropoff_proofs (
    booking_id, driver_id, storage_path, captured_at, destination_verified
  ) values (
    saved.id, actor, p_storage_path, p_captured_at, true
  ) returning * into proof;

  perform careride_private.record_booking_event(saved.id, 'dropoff_proof_uploaded', saved.status, saved.status, null);
  perform careride_private.notify_booking(
    saved.passenger_id, saved.id, 'dropoff_proof_uploaded',
    'Safe arrival photo available',
    'Your driver added a GPS-verified safe-arrival photo to this completed ride.'
  );
  return proof;
end;
$$;

revoke all on function public.submit_booking_dropoff_proof_attested(uuid, text, timestamptz, double precision, double precision, double precision)
  from public, anon, authenticated, authenticator, service_role;
grant execute on function public.submit_booking_dropoff_proof_attested(uuid, text, timestamptz, double precision, double precision, double precision) to authenticated;

commit;
