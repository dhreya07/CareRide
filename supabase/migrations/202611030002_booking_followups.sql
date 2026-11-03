-- CareRide1 booking follow-ups. Not applied.
-- Do not run supabase db push.
-- Paste this file alone into the Supabase SQL editor after 202611030001_bookings.sql.
-- It adds driver listing, referral decline, notification read, and safety reports.
-- It does not change existing booking rows or localStorage.

begin;

do $$
begin
  if to_regclass('public.bookings') is null
     or to_regclass('public.booking_notifications') is null
     or to_regclass('public.profiles') is null
     or to_regclass('public.driver_details') is null
     or to_regprocedure('public.is_admin()') is null
     or to_regprocedure('careride_private.approved_role(uuid)') is null
     or to_regprocedure('careride_private.require_actor()') is null
     or to_regprocedure('careride_private.booking_visible(public.bookings, uuid)') is null
     or to_regprocedure('careride_private.record_booking_event(uuid, text, text, text, text)') is null
     or to_regprocedure('careride_private.notify_booking(uuid, uuid, text, text, text)') is null then
    raise exception 'Apply the CareRide1 bookings migration before this follow-up';
  end if;
  if to_regclass('public.booking_safety_reports') is not null then
    raise exception 'public.booking_safety_reports already exists';
  end if;
end;
$$;

alter table public.booking_notifications
  drop constraint booking_notifications_event_check;

alter table public.booking_notifications
  add constraint booking_notifications_event_check check (event in (
    'booking_request', 'booking_accepted', 'booking_declined', 'referral_received',
    'referral_confirmation_needed', 'driver_change_confirmed', 'driver_change_declined',
    'ride_started', 'ride_completed', 'booking_cancelled', 'referral_declined'
  ));

create table public.booking_safety_reports (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete cascade,
  reporter_id uuid not null references public.profiles (id),
  description text not null,
  created_at timestamptz not null default now(),
  constraint booking_safety_reports_description_check check (
    char_length(btrim(description)) between 1 and 2000
  )
);

create index booking_safety_reports_booking_idx
  on public.booking_safety_reports (booking_id, created_at desc);

create or replace function public.list_available_drivers()
returns table (
  driver_id uuid,
  full_name text,
  phone text,
  vehicle_type text,
  plate_number text,
  vehicle_label text,
  availability text,
  wheelchair_accessible boolean,
  senior_assistance boolean,
  rating numeric,
  rating_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in before continuing';
  end if;
  if careride_private.approved_role(auth.uid()) is null then
    raise exception 'Only an approved account can view available drivers';
  end if;

  return query
  select
    pr.id,
    pr.full_name,
    pr.phone,
    dd.vehicle_type,
    dd.plate_number,
    nullif(
      btrim(concat_ws(
        ' · ',
        nullif(btrim(dd.vehicle_type), ''),
        nullif(btrim(dd.plate_number), '')
      )),
      ''
    ),
    dd.availability,
    dd.wheelchair_accessible,
    dd.senior_assistance,
    (
      select round(avg(done.client_rating)::numeric, 1)
      from public.bookings done
      where done.driver_id = pr.id
        and done.status = 'Completed'
        and done.client_rating between 1 and 5
    ),
    (
      select count(*)::integer
      from public.bookings done
      where done.driver_id = pr.id
        and done.status = 'Completed'
        and done.client_rating between 1 and 5
    )
  from public.profiles pr
  join public.driver_details dd on dd.user_id = pr.id
  where pr.role = 'driver'
    and pr.account_status = 'approved'
    and dd.availability = 'available'
    and pr.id is distinct from auth.uid()
  order by pr.full_name;
end;
$$;

create or replace function public.decline_referral(p_booking_id uuid)
returns public.bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := careride_private.require_actor();
  saved public.bookings;
  original uuid;
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
  original := saved.referral_original_driver_id;
  update public.bookings
  set referral_status = null,
      referral_proposed_driver_id = null,
      referral_proposed_driver_name = null
  where id = saved.id
    and referral_status = 'pending'
    and referral_proposed_driver_id = actor
    and status in ('Pending', 'Scheduled')
  returning * into saved;
  if not found then
    raise exception 'This referral is not waiting for you';
  end if;
  perform careride_private.record_booking_event(saved.id, 'referral_declined', saved.status, saved.status, null);
  perform careride_private.notify_booking(
    original, saved.id, 'referral_declined', 'Referral declined',
    'The replacement driver declined the referral.'
  );
  return saved;
end;
$$;

create or replace function public.mark_booking_notification_read(p_notification_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in before continuing';
  end if;
  if not exists (
    select 1
    from public.booking_notifications
    where id = p_notification_id
      and recipient_id = auth.uid()
  ) then
    raise exception 'Notification not found';
  end if;
  update public.booking_notifications
  set read = true
  where id = p_notification_id
    and recipient_id = auth.uid()
    and read = false;
end;
$$;

create or replace function public.mark_all_booking_notifications_read()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in before continuing';
  end if;
  update public.booking_notifications
  set read = true
  where recipient_id = auth.uid()
    and read = false;
end;
$$;

create or replace function public.report_booking_safety(
  p_booking_id uuid,
  p_description text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := careride_private.require_actor();
  saved public.bookings;
  role text := careride_private.approved_role(actor);
  clean text := btrim(coalesce(p_description, ''));
  report_id uuid;
begin
  if clean = '' or char_length(clean) > 2000 then
    raise exception 'Describe the safety concern in 2000 characters or less';
  end if;
  select * into saved from public.bookings where id = p_booking_id for update;
  if not found or not careride_private.booking_visible(saved, actor) then
    raise exception 'Booking not found';
  end if;
  if role is null or not (
    public.is_admin()
    or (role = 'passenger' and actor = saved.passenger_id)
    or (role = 'driver' and (actor = saved.driver_id or actor = saved.preferred_driver_id))
  ) then
    raise exception 'You cannot report this booking';
  end if;
  insert into public.booking_safety_reports (booking_id, reporter_id, description)
  values (saved.id, actor, clean)
  returning id into report_id;
  perform careride_private.record_booking_event(saved.id, 'safety_reported', saved.status, saved.status, null);
  return report_id;
end;
$$;

revoke all on function public.list_available_drivers() from public, anon, authenticated, authenticator, service_role;
revoke all on function public.decline_referral(uuid) from public, anon, authenticated, authenticator, service_role;
revoke all on function public.mark_booking_notification_read(uuid) from public, anon, authenticated, authenticator, service_role;
revoke all on function public.mark_all_booking_notifications_read() from public, anon, authenticated, authenticator, service_role;
revoke all on function public.report_booking_safety(uuid, text) from public, anon, authenticated, authenticator, service_role;

grant execute on function public.list_available_drivers() to authenticated;
grant execute on function public.decline_referral(uuid) to authenticated;
grant execute on function public.mark_booking_notification_read(uuid) to authenticated;
grant execute on function public.mark_all_booking_notifications_read() to authenticated;
grant execute on function public.report_booking_safety(uuid, text) to authenticated;

alter table public.booking_safety_reports enable row level security;
revoke all on public.booking_safety_reports from public, anon, authenticated, service_role;
grant select on public.booking_safety_reports to authenticated;

create policy booking_safety_reports_select_participant
  on public.booking_safety_reports
  for select
  to authenticated
  using (
    reporter_id = (select auth.uid())
    or public.is_admin()
    or exists (
      select 1
      from public.bookings
      where bookings.id = booking_safety_reports.booking_id
    )
  );

comment on table public.booking_safety_reports is
  'Safety concerns for a booking. Inserts go through report_booking_safety. The booking status is not changed.';
comment on function public.list_available_drivers() is
  'Approved available drivers for booking, referral, and admin assignment. License numbers are not returned.';
comment on function public.decline_referral(uuid) is
  'The proposed driver declines a pending referral. The passenger still confirms only an accepted change.';
comment on function public.mark_booking_notification_read(uuid) is
  'The recipient marks one of their own booking notifications read.';

do $$
declare
  definer_name text;
begin
  select p.proname
  into definer_name
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in (
      'list_available_drivers', 'decline_referral', 'mark_booking_notification_read',
      'mark_all_booking_notifications_read', 'report_booking_safety'
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
    raise exception 'Follow-up function % is missing security definer or search_path', definer_name;
  end if;

  if has_function_privilege('anon', 'public.list_available_drivers()', 'execute')
     or has_function_privilege('anon', 'public.report_booking_safety(uuid, text)', 'execute')
     or has_function_privilege('service_role', 'public.decline_referral(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.list_available_drivers()', 'execute')
     or not has_function_privilege('authenticated', 'public.mark_booking_notification_read(uuid)', 'execute')
     or has_table_privilege('authenticated', 'public.booking_safety_reports', 'insert')
     or has_table_privilege('authenticated', 'public.booking_notifications', 'update')
     or has_table_privilege('anon', 'public.booking_safety_reports', 'select') then
    raise exception 'Follow-up grants do not match the intended roles';
  end if;
end;
$$;

commit;
