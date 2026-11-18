-- Staging-only secure safe-arrival photo proof for completed CareRide bookings.
-- Apply only after 202611030001_bookings.sql and 202611030002_booking_followups.sql.
-- Do not run against CareRide1 production. This migration never makes photos public.

begin;

do $$
begin
  if to_regclass('public.bookings') is null
     or to_regclass('public.booking_notifications') is null
     or to_regclass('public.profiles') is null
     or to_regprocedure('careride_private.approved_role(uuid)') is null
     or to_regprocedure('careride_private.require_actor()') is null
     or to_regprocedure('careride_private.notify_booking(uuid, uuid, text, text, text)') is null
     or to_regclass('storage.buckets') is null
     or to_regclass('storage.objects') is null then
    raise exception 'Apply the CareRide bookings and Storage baselines before safe-arrival proofs';
  end if;

  if exists (
    select 1 from storage.buckets
    where id = 'careride-dropoff-proofs' and public
  ) then
    raise exception 'The safe-arrival proof bucket must remain private';
  end if;
end;
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'careride-dropoff-proofs',
  'careride-dropoff-proofs',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

create table public.booking_dropoff_proofs (
  booking_id uuid primary key references public.bookings (id) on delete cascade,
  driver_id uuid not null references public.profiles (id),
  storage_path text not null unique,
  created_at timestamptz not null default now(),
  constraint booking_dropoff_proofs_path_check check (
    storage_path ~ '^bookings/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f-]{36}\.jpg$'
  )
);

create index booking_dropoff_proofs_driver_idx
  on public.booking_dropoff_proofs (driver_id, created_at desc);

alter table public.booking_notifications
  drop constraint if exists booking_notifications_event_check;

alter table public.booking_notifications
  add constraint booking_notifications_event_check check (event in (
    'booking_request', 'booking_accepted', 'booking_declined', 'referral_received',
    'referral_confirmation_needed', 'driver_change_confirmed', 'driver_change_declined',
    'ride_started', 'ride_completed', 'booking_cancelled', 'referral_declined',
    'dropoff_proof_uploaded'
  ));

create or replace function public.submit_booking_dropoff_proof(
  p_booking_id uuid,
  p_storage_path text
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
  expected_path_pattern text;
begin
  perform careride_private.require_role(actor, 'driver', 'Only an approved driver can submit a safe-arrival photo');

  select * into saved
  from public.bookings
  where id = p_booking_id
  for update;

  if not found or saved.driver_id is distinct from actor then
    raise exception 'Only the assigned driver can submit a safe-arrival photo';
  end if;
  if saved.status <> 'Completed' then
    raise exception 'Complete the ride before submitting a safe-arrival photo';
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

  insert into public.booking_dropoff_proofs (booking_id, driver_id, storage_path)
  values (saved.id, actor, p_storage_path)
  returning * into proof;

  perform careride_private.record_booking_event(saved.id, 'dropoff_proof_uploaded', saved.status, saved.status, null);
  perform careride_private.notify_booking(
    saved.passenger_id,
    saved.id,
    'dropoff_proof_uploaded',
    'Safe arrival photo available',
    'Your driver added a safe-arrival photo to this completed ride.'
  );
  return proof;
end;
$$;

create or replace function public.list_my_dropoff_proofs()
returns table (
  booking_id uuid,
  storage_path text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := careride_private.require_actor();
begin
  perform careride_private.require_role(actor, 'passenger', 'Only an approved passenger can view safe-arrival photos');
  return query
  select proof.booking_id, proof.storage_path, proof.created_at
  from public.booking_dropoff_proofs proof
  join public.bookings booking on booking.id = proof.booking_id
  where booking.passenger_id = actor
  order by proof.created_at desc;
end;
$$;

revoke all on function public.submit_booking_dropoff_proof(uuid, text)
  from public, anon, authenticated, authenticator, service_role;
revoke all on function public.list_my_dropoff_proofs()
  from public, anon, authenticated, authenticator, service_role;
grant execute on function public.submit_booking_dropoff_proof(uuid, text) to authenticated;
grant execute on function public.list_my_dropoff_proofs() to authenticated;

alter table public.booking_dropoff_proofs enable row level security;
revoke all on public.booking_dropoff_proofs from public, anon, authenticated, service_role;

drop policy if exists dropoff_proof_upload_assigned_driver on storage.objects;
create policy dropoff_proof_upload_assigned_driver
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'careride-dropoff-proofs'
    and array_length(storage.foldername(name), 1) = 2
    and (storage.foldername(name))[1] = 'bookings'
    and name ~ '^bookings/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f-]{36}\.jpg$'
    and exists (
      select 1
      from public.bookings booking
      where booking.id::text = (storage.foldername(name))[2]
        and booking.driver_id = (select auth.uid())
        and booking.status = 'Completed'
        and careride_private.approved_role((select auth.uid())) = 'driver'
        and not exists (
          select 1 from public.booking_dropoff_proofs proof
          where proof.booking_id = booking.id
        )
    )
  );

drop policy if exists dropoff_proof_read_booking_participant on storage.objects;
create policy dropoff_proof_read_booking_participant
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'careride-dropoff-proofs'
    and exists (
      select 1
      from public.booking_dropoff_proofs proof
      join public.bookings booking on booking.id = proof.booking_id
      where proof.storage_path = storage.objects.name
        and (booking.passenger_id = (select auth.uid()) or booking.driver_id = (select auth.uid()))
    )
  );

drop policy if exists dropoff_proof_delete_unfinalized_upload on storage.objects;
create policy dropoff_proof_delete_unfinalized_upload
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'careride-dropoff-proofs'
    and owner_id = (select auth.uid())::text
    and not exists (
      select 1 from public.booking_dropoff_proofs proof
      where proof.storage_path = storage.objects.name
    )
  );

comment on table public.booking_dropoff_proofs is
  'One private, metadata-stripped safe-arrival proof photo per completed booking. No public image URLs are stored.';
comment on function public.submit_booking_dropoff_proof(uuid, text) is
  'Assigned approved driver finalizes one previously-uploaded private safe-arrival image for a completed booking.';
comment on function public.list_my_dropoff_proofs() is
  'Approved passenger reads only their completed booking proof metadata; Storage RLS controls the private image.';

commit;
