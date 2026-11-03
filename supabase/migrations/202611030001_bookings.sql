-- CareRide1 bookings. Security-reviewed. Not applied.
-- Do not run supabase db push.
-- Paste this file alone into the Supabase SQL editor after 202611020001_auth_and_profiles.sql.
-- Do not run the older ride_requests migrations. Those tables are not part of CareRide1.
-- Driver availability stays on public.driver_details. This file does not replace it.
-- This script is one transaction. A failed check rolls every change back.

begin;

do $$
begin
  if to_regnamespace('careride_private') is null
     or to_regclass('public.profiles') is null
     or to_regclass('public.driver_details') is null
     or to_regprocedure('public.is_admin()') is null then
    raise exception 'Apply the CareRide1 profiles migration before bookings';
  end if;
  if to_regclass('public.ride_requests') is not null
     or to_regclass('public.passengers') is not null
     or to_regclass('public.drivers') is not null then
    raise exception 'Old CareRide ride tables are present. Do not combine this file with the old migrations';
  end if;
  if to_regclass('public.bookings') is not null then
    raise exception 'public.bookings already exists';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'anon')
     or not exists (select 1 from pg_roles where rolname = 'authenticated')
     or not exists (select 1 from pg_roles where rolname = 'authenticator')
     or not exists (select 1 from pg_roles where rolname = 'service_role')
     or not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    raise exception 'Supabase API roles are missing';
  end if;
  if (
    select count(*)
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name in ('id', 'role', 'account_status', 'full_name', 'phone')
  ) <> 5
  or (
    select count(*)
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'driver_details'
      and column_name in ('user_id', 'availability', 'vehicle_type', 'plate_number')
  ) <> 4 then
    raise exception 'profiles or driver_details is missing a column this migration uses';
  end if;
end;
$$;

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  passenger_id uuid not null references public.profiles (id),
  passenger_type text not null default 'self',
  passenger_name text not null,
  pickup_location text not null,
  destination text not null,
  purpose text not null default '',
  ride_date date not null,
  ride_time time not null,
  assistance text[] not null default '{}',
  other_assistance_notes text not null default '',
  notes text not null default '',
  emergency_contact_name text not null default '',
  emergency_contact_number text not null default '',
  pickup_latitude double precision,
  pickup_longitude double precision,
  destination_latitude double precision,
  destination_longitude double precision,
  driver_id uuid references public.profiles (id),
  driver_name text,
  driver_phone text,
  vehicle_label text,
  driver_rating numeric(3, 1),
  preferred_driver_id uuid references public.profiles (id),
  preferred_driver_name text,
  preferred_driver_phone text,
  preferred_vehicle_label text,
  preferred_driver_rating numeric(3, 1),
  client_rating smallint,
  client_comment text,
  rated_at timestamptz,
  rated_by uuid references public.profiles (id),
  referral_status text,
  referral_original_driver_id uuid references public.profiles (id),
  referral_proposed_driver_id uuid references public.profiles (id),
  referral_proposed_driver_name text,
  booking_kind text not null,
  status text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bookings_passenger_type_check check (passenger_type in ('self', 'family')),
  constraint bookings_kind_check check (booking_kind in ('immediate', 'scheduled')),
  constraint bookings_kind_status_check check (
    not (booking_kind = 'immediate' and status = 'Scheduled')
    and not (booking_kind = 'scheduled' and status = 'Pending')
  ),
  constraint bookings_status_check check (status in (
    'Pending', 'Scheduled', 'Driver Assigned', 'Driver On The Way', 'Arrived',
    'Picked Up', 'In Progress', 'Completed', 'Cancelled', 'Rejected', 'Reported'
  )),
  constraint bookings_referral_status_check check (
    referral_status is null or referral_status in (
      'pending', 'accepted_by_replacement', 'passenger_confirmed', 'passenger_declined'
    )
  ),
  constraint bookings_client_rating_check check (client_rating is null or client_rating between 1 and 5),
  constraint bookings_passenger_not_driver check (driver_id is null or driver_id <> passenger_id),
  constraint bookings_passenger_not_preferred check (
    preferred_driver_id is null or preferred_driver_id <> passenger_id
  )
);

create table public.booking_events (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete cascade,
  actor_id uuid references public.profiles (id),
  event text not null,
  from_status text,
  to_status text,
  note text,
  created_at timestamptz not null default now()
);

create table public.booking_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  booking_id uuid references public.bookings (id) on delete cascade,
  event text not null,
  title text not null,
  message text not null,
  read boolean not null default false,
  created_at timestamptz not null default now(),
  constraint booking_notifications_event_check check (event in (
    'booking_request', 'booking_accepted', 'booking_declined', 'referral_received',
    'referral_confirmation_needed', 'driver_change_confirmed', 'driver_change_declined',
    'ride_started', 'ride_completed', 'booking_cancelled'
  ))
);

create index bookings_passenger_idx on public.bookings (passenger_id, created_at desc);
create index bookings_driver_idx on public.bookings (driver_id, status);
create index bookings_preferred_driver_idx on public.bookings (preferred_driver_id, status);
create index bookings_referral_driver_idx on public.bookings (referral_proposed_driver_id, referral_status);
create index booking_events_booking_idx on public.booking_events (booking_id, created_at);
create index booking_notifications_recipient_idx on public.booking_notifications (recipient_id, created_at desc);

create unique index bookings_one_ongoing_per_driver
  on public.bookings (driver_id)
  where driver_id is not null
    and status in ('Driver On The Way', 'Arrived', 'Picked Up', 'In Progress');

create unique index bookings_driver_exact_slot
  on public.bookings (driver_id, ride_date, ride_time)
  where driver_id is not null
    and (
      status in ('Driver Assigned', 'Driver On The Way', 'Arrived', 'Picked Up', 'In Progress')
      or (
        referral_status = 'passenger_confirmed'
        and status in ('Pending', 'Scheduled')
      )
    );

create or replace function careride_private.touch_booking_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = pg_catalog.now();
  return new;
end;
$$;

create or replace function careride_private.guard_booking_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and (
    new.id is distinct from old.id
    or new.passenger_id is distinct from old.passenger_id
    or new.booking_kind is distinct from old.booking_kind
    or new.created_at is distinct from old.created_at
  ) then
    raise exception 'Protected booking fields cannot change';
  end if;
  return new;
end;
$$;

create trigger touch_booking_updated_at
  before update on public.bookings
  for each row execute function careride_private.touch_booking_updated_at();

create trigger guard_booking_identity
  before update on public.bookings
  for each row execute function careride_private.guard_booking_identity();

create or replace function careride_private.record_booking_event(
  p_booking_id uuid,
  p_event text,
  p_from text,
  p_to text,
  p_note text
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  insert into public.booking_events (booking_id, actor_id, event, from_status, to_status, note)
  values (p_booking_id, auth.uid(), p_event, p_from, p_to, p_note);
end;
$$;

create or replace function careride_private.notify_booking(
  p_recipient uuid,
  p_booking_id uuid,
  p_event text,
  p_title text,
  p_message text
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_recipient is null or p_recipient = auth.uid() then
    return;
  end if;
  insert into public.booking_notifications (recipient_id, booking_id, event, title, message)
  values (p_recipient, p_booking_id, p_event, p_title, p_message);
end;
$$;

create or replace function careride_private.approved_role(p_user_id uuid)
returns text
language sql
stable
set search_path = ''
as $$
  select role
  from public.profiles
  where id = p_user_id
    and account_status = 'approved'
    and role in ('passenger', 'driver', 'admin');
$$;

create or replace function careride_private.require_actor()
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
begin
  if actor is null then
    raise exception 'Sign in before continuing';
  end if;
  return actor;
end;
$$;

create or replace function careride_private.require_role(
  p_user_id uuid,
  p_role text,
  p_message text
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if careride_private.approved_role(p_user_id) is distinct from p_role then
    raise exception using message = p_message;
  end if;
end;
$$;

create or replace function careride_private.lock_driver(p_driver uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_driver is null then
    return;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(874214, pg_catalog.hashtext(p_driver::text));
end;
$$;

create or replace function careride_private.driver_availability(p_driver uuid)
returns text
language sql
stable
set search_path = ''
as $$
  select availability
  from public.driver_details
  where user_id = p_driver;
$$;

create or replace function careride_private.driver_snapshot(p_driver uuid)
returns table (
  driver_name text,
  driver_phone text,
  vehicle_label text,
  driver_rating numeric
)
language sql
stable
set search_path = ''
as $$
  select
    pr.full_name,
    pr.phone,
    nullif(
      btrim(concat_ws(
        ' · ',
        nullif(btrim(dd.vehicle_type), ''),
        nullif(btrim(dd.plate_number), '')
      )),
      ''
    ),
    (
      select round(avg(done.client_rating)::numeric, 1)
      from public.bookings done
      where done.driver_id = pr.id
        and done.status = 'Completed'
        and done.client_rating between 1 and 5
    )
  from public.profiles pr
  join public.driver_details dd on dd.user_id = pr.id
  where pr.id = p_driver
    and pr.role = 'driver'
    and pr.account_status = 'approved';
$$;

create or replace function careride_private.schedule_block_reason(
  p_driver uuid,
  p_booking_id uuid,
  p_ride_date date,
  p_ride_time time,
  p_kind text
)
returns text
language plpgsql
set search_path = ''
as $$
begin
  if p_kind = 'immediate' and exists (
    select 1
    from public.bookings other
    where other.driver_id = p_driver
      and other.id is distinct from p_booking_id
      and (
        other.status in ('Driver Assigned', 'Driver On The Way', 'Arrived', 'Picked Up', 'In Progress')
        or (
          other.status in ('Pending', 'Scheduled')
          and other.referral_status = 'passenger_confirmed'
        )
      )
      and (p_ride_date + p_ride_time) < (other.ride_date + other.ride_time) + interval '90 minutes'
      and (p_ride_date + p_ride_time) + interval '90 minutes' > (other.ride_date + other.ride_time)
  ) then
    return 'This overlaps a confirmed trip. It was not accepted.';
  end if;

  if p_kind = 'immediate' and exists (
    select 1
    from public.bookings other
    where other.driver_id = p_driver
      and other.id is distinct from p_booking_id
      and other.status in ('Driver On The Way', 'Arrived', 'Picked Up', 'In Progress')
  ) then
    return 'You already have a ride in progress';
  end if;

  if p_kind = 'scheduled' and exists (
    select 1
    from public.bookings other
    where other.driver_id = p_driver
      and other.id is distinct from p_booking_id
      and other.ride_date = p_ride_date
      and other.ride_time = p_ride_time
      and (
        other.status in ('Driver Assigned', 'Driver On The Way', 'Arrived', 'Picked Up', 'In Progress')
        or (
          other.status in ('Pending', 'Scheduled')
          and other.referral_status = 'passenger_confirmed'
        )
      )
  ) then
    return 'You already have an accepted ride during this time';
  end if;

  return null;
end;
$$;

create or replace function careride_private.booking_visible(
  p_booking public.bookings,
  p_actor uuid
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select public.is_admin()
    or p_booking.passenger_id = p_actor
    or p_booking.driver_id = p_actor
    or p_booking.preferred_driver_id = p_actor
    or p_booking.referral_proposed_driver_id = p_actor
    or p_booking.referral_original_driver_id = p_actor;
$$;

create or replace function careride_private.driver_has_ongoing(
  p_driver uuid,
  p_booking_id uuid
)
returns boolean
language sql
set search_path = ''
as $$
  select exists (
    select 1
    from public.bookings other
    where other.driver_id = p_driver
      and other.id is distinct from p_booking_id
      and other.status in ('Driver On The Way', 'Arrived', 'Picked Up', 'In Progress')
  );
$$;

revoke all on function careride_private.touch_booking_updated_at() from public, anon, authenticated, authenticator, service_role, supabase_auth_admin;
revoke all on function careride_private.guard_booking_identity() from public, anon, authenticated, authenticator, service_role, supabase_auth_admin;
revoke all on function careride_private.record_booking_event(uuid, text, text, text, text) from public, anon, authenticated, authenticator, service_role, supabase_auth_admin;
revoke all on function careride_private.notify_booking(uuid, uuid, text, text, text) from public, anon, authenticated, authenticator, service_role, supabase_auth_admin;
revoke all on function careride_private.approved_role(uuid) from public, anon, authenticated, authenticator, service_role, supabase_auth_admin;
revoke all on function careride_private.require_actor() from public, anon, authenticated, authenticator, service_role, supabase_auth_admin;
revoke all on function careride_private.require_role(uuid, text, text) from public, anon, authenticated, authenticator, service_role, supabase_auth_admin;
revoke all on function careride_private.lock_driver(uuid) from public, anon, authenticated, authenticator, service_role, supabase_auth_admin;
revoke all on function careride_private.driver_availability(uuid) from public, anon, authenticated, authenticator, service_role, supabase_auth_admin;
revoke all on function careride_private.driver_snapshot(uuid) from public, anon, authenticated, authenticator, service_role, supabase_auth_admin;
revoke all on function careride_private.schedule_block_reason(uuid, uuid, date, time, text) from public, anon, authenticated, authenticator, service_role, supabase_auth_admin;
revoke all on function careride_private.booking_visible(public.bookings, uuid) from public, anon, authenticated, authenticator, service_role, supabase_auth_admin;
revoke all on function careride_private.driver_has_ongoing(uuid, uuid) from public, anon, authenticated, authenticator, service_role, supabase_auth_admin;

create or replace function public.create_booking(p_booking jsonb)
returns public.bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := careride_private.require_actor();
  preferred uuid := nullif(p_booking ->> 'preferred_driver_id', '')::uuid;
  next_status text := coalesce(p_booking ->> 'status', 'Pending');
  kind text;
  v_passenger_type text := btrim(coalesce(p_booking ->> 'passenger_type', 'self'));
  v_passenger_name text := btrim(coalesce(p_booking ->> 'passenger_name', ''));
  v_pickup_location text := btrim(coalesce(p_booking ->> 'pickup_location', ''));
  v_destination text := btrim(coalesce(p_booking ->> 'destination', ''));
  v_ride_date date;
  v_ride_time time;
  pickup_lat double precision;
  pickup_lng double precision;
  destination_lat double precision;
  destination_lng double precision;
  preferred_name text;
  preferred_phone text;
  preferred_vehicle text;
  preferred_rating numeric;
  preferred_availability text;
  snap record;
  saved public.bookings;
begin
  perform careride_private.require_role(actor, 'passenger', 'Only an approved passenger can request a ride');
  if p_booking is null or jsonb_typeof(p_booking) <> 'object' then
    raise exception 'Booking details are missing';
  end if;
  if next_status not in ('Pending', 'Scheduled') then
    raise exception 'A new booking must be Pending or Scheduled';
  end if;
  kind := case when next_status = 'Scheduled' then 'scheduled' else 'immediate' end;
  if v_passenger_name = '' or v_pickup_location = '' or v_destination = '' then
    raise exception 'A booking needs a passenger, pickup, and destination';
  end if;
  if char_length(v_passenger_name) > 200
     or char_length(v_pickup_location) > 500
     or char_length(v_destination) > 500
     or char_length(coalesce(p_booking ->> 'notes', '')) > 4000 then
    raise exception 'Booking details are too long';
  end if;
  if v_passenger_type not in ('self', 'family') then
    raise exception 'Passenger type must be self or family';
  end if;
  if nullif(p_booking ->> 'ride_date', '') is null or nullif(p_booking ->> 'ride_time', '') is null then
    raise exception 'A booking needs a date and time';
  end if;
  v_ride_date := (p_booking ->> 'ride_date')::date;
  v_ride_time := pg_catalog.date_trunc(
    'minute',
    current_date + (p_booking ->> 'ride_time')::time
  )::time;
  if jsonb_typeof(coalesce(p_booking -> 'assistance', '[]'::jsonb)) <> 'array' then
    raise exception 'Assistance must be a list';
  end if;
  pickup_lat := nullif(p_booking ->> 'pickup_latitude', '')::double precision;
  pickup_lng := nullif(p_booking ->> 'pickup_longitude', '')::double precision;
  destination_lat := nullif(p_booking ->> 'destination_latitude', '')::double precision;
  destination_lng := nullif(p_booking ->> 'destination_longitude', '')::double precision;
  if pickup_lat is not null and (pickup_lat < -90 or pickup_lat > 90 or pickup_lng is null or pickup_lng < -180 or pickup_lng > 180)
     or destination_lat is not null and (destination_lat < -90 or destination_lat > 90 or destination_lng is null or destination_lng < -180 or destination_lng > 180) then
    raise exception 'Booking coordinates are not valid';
  end if;
  if preferred is not null then
    if preferred = actor or careride_private.approved_role(preferred) is distinct from 'driver' then
      raise exception 'The preferred driver is not an approved driver';
    end if;
    select dd.availability
    into preferred_availability
    from public.driver_details dd
    where dd.user_id = preferred
    for update;
    if preferred_availability is distinct from 'available' then
      raise exception 'That driver is no longer available';
    end if;
    select * into snap from careride_private.driver_snapshot(preferred);
    if not found then
      raise exception 'The preferred driver is not an approved driver';
    end if;
    preferred_name := snap.driver_name;
    preferred_phone := snap.driver_phone;
    preferred_vehicle := snap.vehicle_label;
    preferred_rating := snap.driver_rating;
  end if;

  insert into public.bookings (
    passenger_id, passenger_type, passenger_name, pickup_location, destination, purpose,
    ride_date, ride_time, assistance, other_assistance_notes, notes,
    emergency_contact_name, emergency_contact_number,
    pickup_latitude, pickup_longitude, destination_latitude, destination_longitude,
    preferred_driver_id, preferred_driver_name, preferred_driver_phone,
    preferred_vehicle_label, preferred_driver_rating, booking_kind, status
  )
  values (
    actor,
    v_passenger_type,
    v_passenger_name,
    v_pickup_location,
    v_destination,
    left(coalesce(p_booking ->> 'purpose', ''), 200),
    v_ride_date,
    v_ride_time,
    coalesce(
      (select array_agg(value) from jsonb_array_elements_text(p_booking -> 'assistance')),
      '{}'::text[]
    ),
    left(coalesce(p_booking ->> 'other_assistance_notes', ''), 2000),
    left(coalesce(p_booking ->> 'notes', ''), 4000),
    left(coalesce(p_booking ->> 'emergency_contact_name', ''), 200),
    left(coalesce(p_booking ->> 'emergency_contact_number', ''), 40),
    pickup_lat,
    pickup_lng,
    destination_lat,
    destination_lng,
    preferred,
    preferred_name,
    preferred_phone,
    preferred_vehicle,
    preferred_rating,
    kind,
    next_status
  )
  returning * into saved;

  perform careride_private.record_booking_event(saved.id, 'booking_created', null, saved.status, null);
  if preferred is not null then
    perform careride_private.notify_booking(
      preferred, saved.id, 'booking_request', 'New booking request',
      saved.passenger_name || ' requested a ride.'
    );
  end if;
  return saved;
end;
$$;

create or replace function public.accept_booking(p_booking_id uuid)
returns public.bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := careride_private.require_actor();
  saved public.bookings;
  previous text;
  snap record;
  blocked text;
begin
  select * into saved from public.bookings where id = p_booking_id for update;
  if not found or not careride_private.booking_visible(saved, actor) then
    raise exception 'Booking not found';
  end if;
  perform careride_private.require_role(actor, 'driver', 'Only an approved driver can accept a booking');
  if actor is distinct from saved.preferred_driver_id and actor is distinct from saved.driver_id then
    raise exception 'This booking is not waiting for you';
  end if;
  if saved.status not in ('Pending', 'Scheduled')
     or saved.referral_status in ('pending', 'accepted_by_replacement') then
    raise exception 'This booking can no longer be accepted';
  end if;
  perform careride_private.lock_driver(actor);
  blocked := careride_private.schedule_block_reason(
    actor, saved.id, saved.ride_date, saved.ride_time, saved.booking_kind
  );
  if blocked is not null then
    raise exception using message = blocked;
  end if;
  select * into snap from careride_private.driver_snapshot(actor);
  if not found then
    raise exception 'Only an approved driver can accept a booking';
  end if;

  previous := saved.status;
  update public.bookings
  set status = 'Driver Assigned',
      driver_id = actor,
      driver_name = snap.driver_name,
      driver_phone = snap.driver_phone,
      vehicle_label = snap.vehicle_label,
      driver_rating = snap.driver_rating
  where id = saved.id
    and status = previous
    and (referral_status is null or referral_status = 'passenger_declined' or referral_status = 'passenger_confirmed')
  returning * into saved;
  if not found then
    raise exception 'This booking can no longer be accepted';
  end if;

  perform careride_private.record_booking_event(saved.id, 'booking_accepted', previous, saved.status, null);
  perform careride_private.notify_booking(
    saved.passenger_id, saved.id, 'booking_accepted', 'Driver accepted',
    coalesce(saved.driver_name, 'Your driver') || ' accepted the booking.'
  );
  return saved;
exception
  when unique_violation then
    if sqlerrm like '%bookings_one_ongoing_per_driver%' then
      raise exception 'You already have a ride in progress';
    elsif sqlerrm like '%bookings_driver_exact_slot%' then
      raise exception 'You already have an accepted ride during this time';
    else
      raise;
    end if;
end;
$$;

create or replace function public.decline_booking(p_booking_id uuid)
returns public.bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := careride_private.require_actor();
  saved public.bookings;
  previous text;
  snap record;
begin
  select * into saved from public.bookings where id = p_booking_id for update;
  if not found or not careride_private.booking_visible(saved, actor) then
    raise exception 'Booking not found';
  end if;
  perform careride_private.require_role(actor, 'driver', 'This booking is not waiting for you');
  if actor is distinct from saved.preferred_driver_id and actor is distinct from saved.driver_id then
    raise exception 'This booking is not waiting for you';
  end if;
  if saved.status not in ('Pending', 'Scheduled')
     or saved.referral_status in ('pending', 'accepted_by_replacement') then
    raise exception 'This booking can no longer be declined';
  end if;
  select * into snap from careride_private.driver_snapshot(actor);
  if not found then
    raise exception 'This booking is not waiting for you';
  end if;
  previous := saved.status;
  update public.bookings
  set status = 'Rejected',
      driver_id = actor,
      driver_name = snap.driver_name,
      driver_phone = snap.driver_phone,
      vehicle_label = snap.vehicle_label,
      driver_rating = snap.driver_rating
  where id = saved.id
    and status = previous
  returning * into saved;
  if not found then
    raise exception 'This booking can no longer be declined';
  end if;
  perform careride_private.record_booking_event(saved.id, 'booking_declined', previous, saved.status, null);
  perform careride_private.notify_booking(
    saved.passenger_id, saved.id, 'booking_declined', 'Driver declined',
    'The driver declined the booking.'
  );
  return saved;
end;
$$;

create or replace function public.refer_booking(p_booking_id uuid, p_proposed_driver_id uuid)
returns public.bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := careride_private.require_actor();
  saved public.bookings;
  snap record;
  blocked text;
  proposed_availability text;
begin
  select * into saved from public.bookings where id = p_booking_id for update;
  if not found or not careride_private.booking_visible(saved, actor) then
    raise exception 'Booking not found';
  end if;
  perform careride_private.require_role(actor, 'driver', 'This request is not waiting for you');
  if actor is distinct from coalesce(saved.driver_id, saved.preferred_driver_id) then
    raise exception 'This request is not waiting for you';
  end if;
  if saved.status not in ('Pending', 'Scheduled')
     or saved.referral_status in ('pending', 'accepted_by_replacement', 'passenger_confirmed') then
    raise exception 'This ride already has a pending referral or can no longer be referred';
  end if;
  if p_proposed_driver_id is null
     or p_proposed_driver_id = actor
     or p_proposed_driver_id = saved.passenger_id
     or careride_private.approved_role(p_proposed_driver_id) is distinct from 'driver' then
    raise exception 'That driver is no longer available';
  end if;
  select dd.availability
  into proposed_availability
  from public.driver_details dd
  where dd.user_id = p_proposed_driver_id
  for update;
  if proposed_availability is distinct from 'available' then
    raise exception 'That driver is no longer available';
  end if;
  perform careride_private.lock_driver(p_proposed_driver_id);
  if saved.booking_kind = 'scheduled' then
    blocked := careride_private.schedule_block_reason(
      p_proposed_driver_id, saved.id, saved.ride_date, saved.ride_time, 'scheduled'
    );
    if blocked is not null then
      raise exception 'That driver is no longer available';
    end if;
  end if;
  select * into snap from careride_private.driver_snapshot(p_proposed_driver_id);
  if not found then
    raise exception 'That driver is no longer available';
  end if;

  update public.bookings
  set referral_status = 'pending',
      referral_original_driver_id = actor,
      referral_proposed_driver_id = p_proposed_driver_id,
      referral_proposed_driver_name = snap.driver_name
  where id = saved.id
    and status = saved.status
    and (referral_status is null or referral_status = 'passenger_declined')
  returning * into saved;
  if not found then
    raise exception 'This ride already has a pending referral or can no longer be referred';
  end if;

  perform careride_private.record_booking_event(saved.id, 'referral_pending', saved.status, saved.status, null);
  perform careride_private.notify_booking(
    p_proposed_driver_id, saved.id, 'referral_received', 'Referral request',
    'A driver referred a booking to you.'
  );
  return saved;
end;
$$;

create or replace function public.accept_referral(p_booking_id uuid)
returns public.bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := careride_private.require_actor();
  saved public.bookings;
begin
  select * into saved from public.bookings where id = p_booking_id for update;
  if not found or not careride_private.booking_visible(saved, actor) then
    raise exception 'Booking not found';
  end if;
  perform careride_private.require_role(actor, 'driver', 'This referral is not waiting for you');
  if actor is distinct from saved.referral_proposed_driver_id
     or saved.referral_status is distinct from 'pending'
     or saved.status not in ('Pending', 'Scheduled') then
    raise exception 'This referral is not waiting for you';
  end if;
  update public.bookings
  set referral_status = 'accepted_by_replacement'
  where id = saved.id
    and referral_status = 'pending'
    and referral_proposed_driver_id = actor
    and status in ('Pending', 'Scheduled')
  returning * into saved;
  if not found then
    raise exception 'This referral is not waiting for you';
  end if;
  perform careride_private.record_booking_event(saved.id, 'referral_accepted', saved.status, saved.status, null);
  perform careride_private.notify_booking(
    saved.passenger_id, saved.id, 'referral_confirmation_needed', 'Confirm driver change',
    coalesce(saved.referral_proposed_driver_name, 'A replacement driver') || ' accepted a referral.'
  );
  return saved;
end;
$$;

create or replace function public.confirm_driver_change(p_booking_id uuid)
returns public.bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := careride_private.require_actor();
  saved public.bookings;
  proposed uuid;
  availability text;
  snap record;
  blocked text;
begin
  select * into saved from public.bookings where id = p_booking_id for update;
  if not found or actor is distinct from saved.passenger_id then
    raise exception 'Booking not found';
  end if;
  perform careride_private.require_role(actor, 'passenger', 'Only the passenger can confirm a driver change');
  if saved.referral_status is distinct from 'accepted_by_replacement'
     or saved.status not in ('Pending', 'Scheduled', 'Driver Assigned') then
    raise exception 'This booking is no longer waiting for a driver change';
  end if;
  proposed := saved.referral_proposed_driver_id;
  if proposed is null or careride_private.approved_role(proposed) is distinct from 'driver' then
    raise exception 'That driver is no longer approved';
  end if;
  select dd.availability
  into availability
  from public.driver_details dd
  where dd.user_id = proposed
  for update;
  if saved.booking_kind = 'scheduled' then
    if availability is null or availability = 'offline' then
      raise exception 'That driver is no longer available for this trip';
    end if;
  elsif availability is distinct from 'available' then
    raise exception 'That driver is no longer available';
  end if;
  perform careride_private.lock_driver(proposed);
  blocked := careride_private.schedule_block_reason(
    proposed, saved.id, saved.ride_date, saved.ride_time, saved.booking_kind
  );
  if blocked is not null then
    raise exception 'That driver already has an accepted ride at this pickup time';
  end if;
  select * into snap from careride_private.driver_snapshot(proposed);
  if not found then
    raise exception 'That driver is no longer approved';
  end if;

  update public.bookings
  set driver_id = proposed,
      driver_name = snap.driver_name,
      driver_phone = snap.driver_phone,
      vehicle_label = snap.vehicle_label,
      driver_rating = snap.driver_rating,
      preferred_driver_id = proposed,
      preferred_driver_name = snap.driver_name,
      preferred_driver_phone = snap.driver_phone,
      preferred_vehicle_label = snap.vehicle_label,
      preferred_driver_rating = snap.driver_rating,
      referral_status = 'passenger_confirmed'
  where id = saved.id
    and referral_status = 'accepted_by_replacement'
    and status = saved.status
  returning * into saved;
  if not found then
    raise exception 'This booking is no longer waiting for a driver change';
  end if;
  perform careride_private.record_booking_event(saved.id, 'driver_change_confirmed', saved.status, saved.status, null);
  perform careride_private.notify_booking(
    saved.driver_id, saved.id, 'driver_change_confirmed', 'Driver change confirmed',
    'The passenger confirmed you for this booking.'
  );
  return saved;
exception
  when unique_violation then
    if sqlerrm like '%bookings_driver_exact_slot%' or sqlerrm like '%bookings_one_ongoing_per_driver%' then
      raise exception 'That driver already has an accepted ride at this pickup time';
    end if;
    raise;
end;
$$;

create or replace function public.decline_driver_change(p_booking_id uuid)
returns public.bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := careride_private.require_actor();
  saved public.bookings;
  proposed uuid;
begin
  select * into saved from public.bookings where id = p_booking_id for update;
  if not found or actor is distinct from saved.passenger_id then
    raise exception 'Booking not found';
  end if;
  perform careride_private.require_role(actor, 'passenger', 'Only the passenger can decline a driver change');
  if saved.referral_status is distinct from 'accepted_by_replacement'
     or saved.status not in ('Pending', 'Scheduled', 'Driver Assigned') then
    raise exception 'This booking is no longer waiting for a driver change';
  end if;
  proposed := saved.referral_proposed_driver_id;
  update public.bookings
  set referral_status = 'passenger_declined'
  where id = saved.id
    and referral_status = 'accepted_by_replacement'
    and status = saved.status
  returning * into saved;
  if not found then
    raise exception 'This booking is no longer waiting for a driver change';
  end if;
  perform careride_private.record_booking_event(saved.id, 'driver_change_declined', saved.status, saved.status, null);
  perform careride_private.notify_booking(
    proposed, saved.id, 'driver_change_declined', 'Driver change declined',
    'The passenger declined the referral.'
  );
  return saved;
end;
$$;

create or replace function public.cancel_booking(p_booking_id uuid)
returns public.bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := careride_private.require_actor();
  saved public.bookings;
  previous text;
  role text := careride_private.approved_role(actor);
begin
  select * into saved from public.bookings where id = p_booking_id for update;
  if not found or not careride_private.booking_visible(saved, actor) then
    raise exception 'Booking not found';
  end if;
  if role is null or not (
    public.is_admin()
    or (role = 'passenger' and actor = saved.passenger_id)
    or (role = 'driver' and actor = saved.driver_id and saved.status = 'Driver Assigned')
  ) then
    raise exception 'You cannot cancel this booking';
  end if;
  if role = 'passenger' and saved.status not in ('Pending', 'Scheduled', 'Driver Assigned') then
    raise exception 'This booking can no longer be cancelled';
  end if;
  if public.is_admin() and saved.status not in ('Pending', 'Scheduled', 'Driver Assigned') then
    raise exception 'This booking can no longer be cancelled';
  end if;
  previous := saved.status;
  update public.bookings
  set status = 'Cancelled'
  where id = saved.id
    and status = previous
    and status in ('Pending', 'Scheduled', 'Driver Assigned')
  returning * into saved;
  if not found then
    raise exception 'This booking can no longer be cancelled';
  end if;
  perform careride_private.record_booking_event(saved.id, 'booking_cancelled', previous, saved.status, null);
  perform careride_private.notify_booking(
    saved.passenger_id, saved.id, 'booking_cancelled', 'Booking cancelled', 'The booking was cancelled.'
  );
  perform careride_private.notify_booking(
    saved.driver_id, saved.id, 'booking_cancelled', 'Booking cancelled', 'The booking was cancelled.'
  );
  if saved.driver_id is null then
    perform careride_private.notify_booking(
      saved.preferred_driver_id, saved.id, 'booking_cancelled', 'Booking cancelled', 'The booking was cancelled.'
    );
  end if;
  if saved.referral_status = 'pending' then
    perform careride_private.notify_booking(
      saved.referral_proposed_driver_id, saved.id, 'booking_cancelled',
      'Booking cancelled', 'The booking was cancelled.'
    );
  end if;
  return saved;
end;
$$;

create or replace function public.advance_booking(p_booking_id uuid, p_next_status text)
returns public.bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := careride_private.require_actor();
  saved public.bookings;
  previous text;
  allowed boolean := false;
begin
  select * into saved from public.bookings where id = p_booking_id for update;
  if not found or not careride_private.booking_visible(saved, actor) then
    raise exception 'Booking not found';
  end if;
  perform careride_private.require_role(actor, 'driver', 'Only the assigned driver can advance this booking');
  if actor is distinct from saved.driver_id then
    raise exception 'Only the assigned driver can advance this booking';
  end if;
  if saved.referral_status in ('pending', 'accepted_by_replacement') then
    raise exception 'This booking has a driver change that is not finished';
  end if;
  previous := saved.status;
  allowed := (previous = 'Driver Assigned' and p_next_status = 'Driver On The Way')
    or (previous = 'Driver On The Way' and p_next_status = 'Arrived')
    or (previous = 'Arrived' and p_next_status = 'Picked Up')
    or (previous = 'Picked Up' and p_next_status = 'In Progress')
    or (previous = 'In Progress' and p_next_status = 'Completed');
  if not allowed then
    raise exception 'This ride status transition is not permitted';
  end if;
  if p_next_status in ('Driver On The Way', 'Arrived', 'Picked Up', 'In Progress') then
    perform careride_private.lock_driver(actor);
    if careride_private.driver_has_ongoing(actor, saved.id) then
      raise exception 'You already have a ride in progress';
    end if;
  end if;
  update public.bookings
  set status = p_next_status
  where id = saved.id
    and status = previous
  returning * into saved;
  if not found then
    raise exception 'This ride status transition is not permitted';
  end if;
  perform careride_private.record_booking_event(saved.id, 'status_advanced', previous, saved.status, null);
  if saved.status = 'Completed' then
    perform careride_private.notify_booking(
      saved.passenger_id, saved.id, 'ride_completed', 'Ride completed', 'The booking is completed.'
    );
  end if;
  return saved;
exception
  when unique_violation then
    if sqlerrm like '%bookings_one_ongoing_per_driver%' then
      raise exception 'You already have a ride in progress';
    end if;
    raise;
end;
$$;

create or replace function public.start_booking(p_booking_id uuid)
returns public.bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := careride_private.require_actor();
  saved public.bookings;
begin
  select * into saved from public.bookings where id = p_booking_id for update;
  if not found or not careride_private.booking_visible(saved, actor) then
    raise exception 'Booking not found';
  end if;
  perform careride_private.require_role(actor, 'driver', 'Only the assigned driver can start this ride');
  if actor is distinct from saved.driver_id then
    raise exception 'Only the assigned driver can start this ride';
  end if;
  if saved.status <> 'Driver Assigned' then
    raise exception 'Only a confirmed booking can be started';
  end if;
  if saved.referral_status in ('pending', 'accepted_by_replacement') then
    raise exception 'This booking has a driver change that is not finished';
  end if;
  perform careride_private.lock_driver(actor);
  if careride_private.driver_has_ongoing(actor, saved.id) then
    raise exception 'You already have a ride in progress';
  end if;
  update public.bookings
  set status = 'In Progress'
  where id = saved.id
    and status = 'Driver Assigned'
  returning * into saved;
  if not found then
    raise exception 'Only a confirmed booking can be started';
  end if;
  perform careride_private.record_booking_event(saved.id, 'ride_started', 'Driver Assigned', saved.status, null);
  perform careride_private.notify_booking(
    saved.passenger_id, saved.id, 'ride_started', 'Ride started', 'The booking is now in progress.'
  );
  return saved;
exception
  when unique_violation then
    if sqlerrm like '%bookings_one_ongoing_per_driver%' then
      raise exception 'You already have a ride in progress';
    end if;
    raise;
end;
$$;

create or replace function public.complete_booking(p_booking_id uuid)
returns public.bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := careride_private.require_actor();
  saved public.bookings;
  previous text;
begin
  select * into saved from public.bookings where id = p_booking_id for update;
  if not found or not careride_private.booking_visible(saved, actor) then
    raise exception 'Booking not found';
  end if;
  perform careride_private.require_role(actor, 'driver', 'Only the assigned driver can complete this ride');
  if actor is distinct from saved.driver_id then
    raise exception 'Only the assigned driver can complete this ride';
  end if;
  if saved.status not in ('Driver On The Way', 'Arrived', 'Picked Up', 'In Progress') then
    raise exception 'Start the ride before completing it';
  end if;
  previous := saved.status;
  update public.bookings
  set status = 'Completed'
  where id = saved.id
    and status = previous
  returning * into saved;
  if not found then
    raise exception 'Start the ride before completing it';
  end if;
  perform careride_private.record_booking_event(saved.id, 'ride_completed', previous, saved.status, null);
  perform careride_private.notify_booking(
    saved.passenger_id, saved.id, 'ride_completed', 'Ride completed', 'The booking is completed.'
  );
  return saved;
end;
$$;

create or replace function public.rate_completed_booking(
  p_booking_id uuid,
  p_stars integer,
  p_comment text
)
returns public.bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := careride_private.require_actor();
  saved public.bookings;
begin
  if p_stars is null or p_stars < 1 or p_stars > 5 then
    raise exception 'A rating must be from 1 to 5';
  end if;
  if char_length(coalesce(p_comment, '')) > 2000 then
    raise exception 'The rating comment is too long';
  end if;
  select * into saved from public.bookings where id = p_booking_id for update;
  if not found or actor is distinct from saved.passenger_id then
    raise exception 'Booking not found';
  end if;
  perform careride_private.require_role(actor, 'passenger', 'Only the passenger can rate this ride');
  if saved.status <> 'Completed' or saved.driver_id is null or saved.client_rating is not null then
    raise exception 'This ride cannot be rated';
  end if;
  update public.bookings
  set client_rating = p_stars,
      client_comment = nullif(btrim(coalesce(p_comment, '')), ''),
      rated_at = pg_catalog.now(),
      rated_by = actor
  where id = saved.id
    and status = 'Completed'
    and client_rating is null
  returning * into saved;
  if not found then
    raise exception 'This ride cannot be rated';
  end if;
  perform careride_private.record_booking_event(saved.id, 'ride_rated', saved.status, saved.status, null);
  return saved;
end;
$$;

create or replace function public.assign_booking(p_booking_id uuid, p_driver_id uuid)
returns public.bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := careride_private.require_actor();
  saved public.bookings;
  previous text;
  snap record;
  blocked text;
begin
  if not public.is_admin() then
    raise exception 'Only an approved admin can assign a booking';
  end if;
  if p_driver_id is null or careride_private.approved_role(p_driver_id) is distinct from 'driver' then
    raise exception 'The driver is not approved';
  end if;
  select * into saved from public.bookings where id = p_booking_id for update;
  if not found then
    raise exception 'Booking not found';
  end if;
  if saved.passenger_id = p_driver_id
     or saved.status not in ('Pending', 'Scheduled')
     or saved.referral_status in ('pending', 'accepted_by_replacement') then
    raise exception 'This booking can no longer be assigned';
  end if;
  perform careride_private.lock_driver(p_driver_id);
  blocked := careride_private.schedule_block_reason(
    p_driver_id, saved.id, saved.ride_date, saved.ride_time, saved.booking_kind
  );
  if blocked is not null then
    raise exception using message = blocked;
  end if;
  select * into snap from careride_private.driver_snapshot(p_driver_id);
  if not found then
    raise exception 'The driver is not approved';
  end if;
  previous := saved.status;
  update public.bookings
  set status = 'Driver Assigned',
      driver_id = p_driver_id,
      driver_name = snap.driver_name,
      driver_phone = snap.driver_phone,
      vehicle_label = snap.vehicle_label,
      driver_rating = snap.driver_rating
  where id = saved.id
    and status = previous
    and status in ('Pending', 'Scheduled')
  returning * into saved;
  if not found then
    raise exception 'This booking can no longer be assigned';
  end if;
  perform careride_private.record_booking_event(saved.id, 'booking_assigned', previous, saved.status, null);
  perform careride_private.notify_booking(
    saved.passenger_id, saved.id, 'booking_accepted', 'Driver assigned',
    coalesce(saved.driver_name, 'A driver') || ' was assigned to the booking.'
  );
  perform careride_private.notify_booking(
    saved.driver_id, saved.id, 'booking_request', 'Booking assigned',
    'An admin assigned a booking to you.'
  );
  return saved;
exception
  when unique_violation then
    if sqlerrm like '%bookings_driver_exact_slot%' or sqlerrm like '%bookings_one_ongoing_per_driver%' then
      raise exception 'You already have an accepted ride during this time';
    end if;
    raise;
end;
$$;

revoke all on function public.create_booking(jsonb) from public, anon, authenticated, authenticator, service_role;
revoke all on function public.accept_booking(uuid) from public, anon, authenticated, authenticator, service_role;
revoke all on function public.decline_booking(uuid) from public, anon, authenticated, authenticator, service_role;
revoke all on function public.refer_booking(uuid, uuid) from public, anon, authenticated, authenticator, service_role;
revoke all on function public.accept_referral(uuid) from public, anon, authenticated, authenticator, service_role;
revoke all on function public.confirm_driver_change(uuid) from public, anon, authenticated, authenticator, service_role;
revoke all on function public.decline_driver_change(uuid) from public, anon, authenticated, authenticator, service_role;
revoke all on function public.cancel_booking(uuid) from public, anon, authenticated, authenticator, service_role;
revoke all on function public.advance_booking(uuid, text) from public, anon, authenticated, authenticator, service_role;
revoke all on function public.start_booking(uuid) from public, anon, authenticated, authenticator, service_role;
revoke all on function public.complete_booking(uuid) from public, anon, authenticated, authenticator, service_role;
revoke all on function public.rate_completed_booking(uuid, integer, text) from public, anon, authenticated, authenticator, service_role;
revoke all on function public.assign_booking(uuid, uuid) from public, anon, authenticated, authenticator, service_role;

grant execute on function public.create_booking(jsonb) to authenticated;
grant execute on function public.accept_booking(uuid) to authenticated;
grant execute on function public.decline_booking(uuid) to authenticated;
grant execute on function public.refer_booking(uuid, uuid) to authenticated;
grant execute on function public.accept_referral(uuid) to authenticated;
grant execute on function public.confirm_driver_change(uuid) to authenticated;
grant execute on function public.decline_driver_change(uuid) to authenticated;
grant execute on function public.cancel_booking(uuid) to authenticated;
grant execute on function public.advance_booking(uuid, text) to authenticated;
grant execute on function public.start_booking(uuid) to authenticated;
grant execute on function public.complete_booking(uuid) to authenticated;
grant execute on function public.rate_completed_booking(uuid, integer, text) to authenticated;
grant execute on function public.assign_booking(uuid, uuid) to authenticated;

alter table public.bookings enable row level security;
alter table public.booking_events enable row level security;
alter table public.booking_notifications enable row level security;

revoke all on public.bookings from public, anon, authenticated, service_role;
revoke all on public.booking_events from public, anon, authenticated, service_role;
revoke all on public.booking_notifications from public, anon, authenticated, service_role;
grant select on public.bookings to authenticated;
grant select on public.booking_events to authenticated;
grant select on public.booking_notifications to authenticated;

create policy bookings_select_participant
  on public.bookings
  for select
  to authenticated
  using (
    public.is_admin()
    or passenger_id = (select auth.uid())
    or driver_id = (select auth.uid())
    or preferred_driver_id = (select auth.uid())
    or referral_proposed_driver_id = (select auth.uid())
    or referral_original_driver_id = (select auth.uid())
  );

create policy booking_events_select_participant
  on public.booking_events
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.bookings
      where bookings.id = booking_events.booking_id
    )
  );

create policy booking_notifications_select_own
  on public.booking_notifications
  for select
  to authenticated
  using (recipient_id = (select auth.uid()) or public.is_admin());

comment on table public.bookings is
  'CareRide1 bookings. Direct writes are revoked. Status changes go through the booking functions.';
comment on column public.bookings.booking_kind is
  'immediate or scheduled. Kept after status leaves Pending or Scheduled so later conflict checks still know the original type.';

do $$
declare
  definer_name text;
begin
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'careride_private'
      and p.proname in (
        'touch_booking_updated_at', 'guard_booking_identity', 'record_booking_event',
        'notify_booking', 'approved_role', 'require_actor', 'require_role', 'lock_driver',
        'driver_availability', 'driver_snapshot', 'schedule_block_reason', 'booking_visible',
        'driver_has_ongoing'
      )
      and p.prosecdef
  ) then
    raise exception 'A private booking helper must not be security definer';
  end if;

  select p.proname
  into definer_name
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in (
      'create_booking', 'accept_booking', 'decline_booking', 'refer_booking',
      'accept_referral', 'confirm_driver_change', 'decline_driver_change',
      'cancel_booking', 'advance_booking', 'start_booking', 'complete_booking',
      'rate_completed_booking', 'assign_booking'
    )
    and (
      not p.prosecdef
      or not exists (
        select 1
        from unnest(coalesce(p.proconfig, array[]::text[])) as cfg
        where cfg like 'search_path=%'
      )
    )
  limit 1;
  if definer_name is not null then
    raise exception 'Booking function % is missing security definer or search_path', definer_name;
  end if;

  if not (
    select c.relrowsecurity
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'bookings'
  ) or not (
    select c.relrowsecurity
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'booking_events'
  ) or not (
    select c.relrowsecurity
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'booking_notifications'
  ) then
    raise exception 'Booking tables are missing row level security';
  end if;

  if (
    select count(*)
    from pg_policies
    where schemaname = 'public'
      and policyname in (
        'bookings_select_participant',
        'booking_events_select_participant',
        'booking_notifications_select_own'
      )
      and cmd = 'SELECT'
  ) <> 3 then
    raise exception 'Booking select policies are missing';
  end if;

  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename in ('bookings', 'booking_events', 'booking_notifications')
      and cmd <> 'SELECT'
  ) then
    raise exception 'Booking tables must not have write policies';
  end if;

  if has_table_privilege('anon', 'public.bookings', 'select')
     or has_table_privilege('authenticated', 'public.bookings', 'insert')
     or has_table_privilege('authenticated', 'public.bookings', 'update')
     or has_table_privilege('authenticated', 'public.bookings', 'delete')
     or has_table_privilege('authenticated', 'public.booking_events', 'insert')
     or has_table_privilege('authenticated', 'public.booking_notifications', 'insert')
     or has_table_privilege('authenticated', 'public.booking_notifications', 'update')
     or has_table_privilege('service_role', 'public.bookings', 'update')
     or has_table_privilege('service_role', 'public.booking_notifications', 'select')
     or has_function_privilege('anon', 'public.create_booking(jsonb)', 'execute')
     or has_function_privilege('anon', 'public.assign_booking(uuid, uuid)', 'execute')
     or has_function_privilege('service_role', 'public.assign_booking(uuid, uuid)', 'execute')
     or has_function_privilege('authenticator', 'public.create_booking(jsonb)', 'execute')
     or not has_function_privilege('authenticated', 'public.create_booking(jsonb)', 'execute')
     or not has_function_privilege('authenticated', 'public.assign_booking(uuid, uuid)', 'execute')
     or has_function_privilege('authenticated', 'careride_private.approved_role(uuid)', 'execute')
     or has_function_privilege('authenticated', 'careride_private.notify_booking(uuid, uuid, text, text, text)', 'execute')
     or has_schema_privilege('authenticated', 'careride_private', 'usage')
     or has_function_privilege('supabase_auth_admin', 'careride_private.record_booking_event(uuid, text, text, text, text)', 'execute') then
    raise exception 'Booking grants do not match the intended roles';
  end if;
end;
$$;

commit;
