-- CareRide1 — authentication and profiles only.
-- Not applied. Do not run the older migrations in this folder.
-- Do not use `supabase db push` while those older files remain in this directory.
-- Paste this file alone into the Supabase SQL editor.
-- This script is one transaction. A failed check rolls every change back.
--
-- This file does not copy localStorage users or passwords.
-- Do not put the service_role key in the Angular app.

begin;

do $$
begin
  if to_regclass('public.ride_requests') is not null
     or to_regclass('public.passengers') is not null
     or to_regclass('public.account_role_requests') is not null then
    raise exception 'Old CareRide tables are present. Do not combine this file with the old migrations';
  end if;
end;
$$;

create schema if not exists careride_private;

revoke all on schema careride_private from public, anon, authenticated, service_role;
grant usage on schema careride_private to supabase_auth_admin;

create or replace function careride_private.touch_profile_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = pg_catalog.now();
  return new;
end;
$$;

create or replace function careride_private.guard_profile_privileges()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  app_role boolean := current_user in ('anon', 'authenticated', 'authenticator', 'service_role');
begin
  if tg_op = 'INSERT' then
    if new.role not in ('passenger', 'driver') or new.account_status <> 'pending' then
      raise exception 'New accounts must be pending passengers or drivers';
    end if;
    return new;
  end if;

  if new.id is distinct from old.id then
    raise exception 'Profile id cannot be changed';
  end if;

  if new.role is distinct from old.role or new.account_status is distinct from old.account_status then
    if app_role then
      raise exception 'Role and approval status cannot be changed from the app';
    end if;
  end if;

  if new.role = 'admin' and old.role is distinct from 'admin' then
    perform pg_catalog.pg_advisory_xact_lock(874213);
    if exists (
      select 1
      from public.profiles
      where role = 'admin'
        and id is distinct from new.id
    ) then
      raise exception 'An admin profile already exists';
    end if;
  end if;

  return new;
end;
$$;

create or replace function careride_private.guard_driver_availability()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  approved_driver boolean;
begin
  if new.user_id is distinct from old.user_id then
    raise exception 'Driver details cannot be moved to another account';
  end if;

  if new.availability is not distinct from old.availability then
    return new;
  end if;

  if new.availability not in ('available', 'busy', 'offline') then
    raise exception 'Availability must be available, busy, or offline';
  end if;

  select exists (
    select 1
    from public.profiles
    where id = new.user_id
      and role = 'driver'
      and account_status = 'approved'
  )
  into approved_driver;

  if not approved_driver then
    raise exception 'Availability can change only after the driver account is approved';
  end if;

  return new;
end;
$$;

create or replace function careride_private.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  requested_role text := lower(btrim(coalesce(meta ->> 'role', '')));
  intent text := lower(btrim(coalesce(meta ->> 'booking_intent', 'self')));
  passenger_kind text := lower(btrim(coalesce(meta ->> 'passenger_type', 'other')));
  license_number text := btrim(coalesce(meta ->> 'license_number', ''));
  vehicle_type text := btrim(coalesce(meta ->> 'vehicle_type', ''));
  plate_number text := upper(btrim(coalesce(meta ->> 'plate_number', '')));
  phone text := regexp_replace(btrim(coalesce(meta ->> 'phone', '')), '[\s()-]', '', 'g');
  assistance text[] := '{}'::text[];
begin
  if requested_role = '' then
    requested_role := 'passenger';
  end if;

  if requested_role = 'admin' then
    raise exception 'Registration cannot create an admin account';
  end if;

  if requested_role not in ('passenger', 'driver') then
    raise exception 'Registration role must be passenger or driver';
  end if;

  if requested_role = 'driver'
     and (license_number = '' or vehicle_type = '' or plate_number = '') then
    raise exception 'Driver registration requires a license number, vehicle type, and plate number';
  end if;

  if intent <> 'family' then
    intent := 'self';
  end if;

  if passenger_kind in ('elderly', 'elder') then
    passenger_kind := 'elderly';
  elsif passenger_kind in ('pwd', 'person with a disability') then
    passenger_kind := 'pwd';
  else
    passenger_kind := 'other';
  end if;

  if jsonb_typeof(meta -> 'assistance') = 'array' then
    select coalesce(array_agg(items.value), '{}'::text[])
    into assistance
    from jsonb_array_elements_text(meta -> 'assistance') as items(value)
    where items.value is not null;
  end if;

  if requested_role = 'driver' then
    insert into public.profiles (
      id, role, full_name, email, phone, address, account_status
    ) values (
      new.id,
      'driver',
      btrim(coalesce(meta ->> 'full_name', '')),
      lower(btrim(coalesce(new.email, ''))),
      phone,
      btrim(coalesce(meta ->> 'address', '')),
      'pending'
    );

    insert into public.driver_details (
      user_id,
      license_number,
      vehicle_type,
      plate_number,
      wheelchair_accessible,
      senior_assistance,
      availability
    ) values (
      new.id,
      license_number,
      vehicle_type,
      plate_number,
      coalesce(meta ->> 'wheelchair_accessible', '') in ('true', 't', '1'),
      coalesce(meta ->> 'senior_assistance', '') in ('true', 't', '1'),
      'offline'
    );
  else
    insert into public.profiles (
      id, role, full_name, email, phone, address, account_status
    ) values (
      new.id,
      'passenger',
      btrim(coalesce(meta ->> 'full_name', '')),
      lower(btrim(coalesce(new.email, ''))),
      phone,
      btrim(coalesce(meta ->> 'address', '')),
      'pending'
    );

    insert into public.passenger_details (
      user_id,
      booking_intent,
      passenger_type,
      assistance,
      other_needs,
      emergency_name,
      emergency_phone
    ) values (
      new.id,
      intent,
      passenger_kind,
      coalesce(assistance, '{}'::text[]),
      btrim(coalesce(meta ->> 'other_needs', '')),
      btrim(coalesce(meta ->> 'emergency_name', '')),
      btrim(coalesce(meta ->> 'emergency_phone', ''))
    );
  end if;

  return new;
end;
$$;

create or replace function careride_private.sync_profile_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles
  set email = lower(btrim(coalesce(new.email, '')))
  where id = new.id;
  return new;
end;
$$;

revoke all on function careride_private.touch_profile_updated_at() from public, anon, authenticated, service_role, supabase_auth_admin;
revoke all on function careride_private.guard_profile_privileges() from public, anon, authenticated, service_role, supabase_auth_admin;
revoke all on function careride_private.guard_driver_availability() from public, anon, authenticated, service_role, supabase_auth_admin;
revoke all on function careride_private.create_profile_for_new_user() from public, anon, authenticated, service_role, supabase_auth_admin;
revoke all on function careride_private.sync_profile_email() from public, anon, authenticated, service_role, supabase_auth_admin;

-- Trigger execution does not need these grants. The auth role keeps the two
-- auth.users helpers only; anon, authenticated, and service_role do not.
grant execute on function careride_private.create_profile_for_new_user() to supabase_auth_admin;
grant execute on function careride_private.sync_profile_email() to supabase_auth_admin;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role text not null default 'passenger',
  full_name text not null default '',
  email text not null default '',
  phone text not null default '',
  address text not null default '',
  account_status text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_role_check check (role in ('passenger', 'driver', 'admin')),
  constraint profiles_account_status_check check (account_status in ('pending', 'approved', 'rejected'))
);

create table if not exists public.passenger_details (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  booking_intent text not null default 'self',
  passenger_type text not null default 'other',
  assistance text[] not null default '{}',
  other_needs text not null default '',
  emergency_name text not null default '',
  emergency_phone text not null default '',
  constraint passenger_details_booking_intent_check check (booking_intent in ('self', 'family')),
  constraint passenger_details_passenger_type_check check (passenger_type in ('elderly', 'pwd', 'other'))
);

create table if not exists public.driver_details (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  license_number text not null,
  vehicle_type text not null,
  plate_number text not null,
  wheelchair_accessible boolean not null default false,
  senior_assistance boolean not null default false,
  availability text not null default 'offline',
  constraint driver_details_availability_check check (availability in ('available', 'busy', 'offline'))
);

create index if not exists profiles_pending_review_idx
  on public.profiles (created_at)
  where account_status = 'pending' and role in ('passenger', 'driver');

create index if not exists profiles_role_status_idx
  on public.profiles (role, account_status);

create unique index if not exists profiles_email_key
  on public.profiles (lower(email))
  where email <> '';

create unique index if not exists profiles_phone_key
  on public.profiles (phone)
  where phone <> '';

create unique index if not exists driver_details_plate_number_key
  on public.driver_details (lower(plate_number))
  where plate_number <> '';

drop trigger if exists guard_profile_privileges on public.profiles;
create trigger guard_profile_privileges
  before insert or update on public.profiles
  for each row execute function careride_private.guard_profile_privileges();

drop trigger if exists touch_profile_updated_at on public.profiles;
create trigger touch_profile_updated_at
  before update on public.profiles
  for each row execute function careride_private.touch_profile_updated_at();

drop trigger if exists guard_driver_availability on public.driver_details;
create trigger guard_driver_availability
  before update on public.driver_details
  for each row execute function careride_private.guard_driver_availability();

drop trigger if exists careride_create_profile on auth.users;
create trigger careride_create_profile
  after insert on auth.users
  for each row execute function careride_private.create_profile_for_new_user();

drop trigger if exists careride_sync_profile_email on auth.users;
create trigger careride_sync_profile_email
  after update of email on auth.users
  for each row
  when (new.email is distinct from old.email)
  execute function careride_private.sync_profile_email();

drop function if exists public.touch_profile_updated_at();
drop function if exists public.guard_profile_privileges();
drop function if exists public.guard_driver_availability();
drop function if exists public.create_profile_for_new_user();
drop function if exists public.sync_profile_email();

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'admin'
      and account_status = 'approved'
  );
$$;

create or replace function public.is_approved_driver()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'driver'
      and account_status = 'approved'
  );
$$;

create or replace function public.review_account(p_user_id uuid, p_decision text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.profiles%rowtype;
begin
  if not public.is_admin() then
    raise exception 'Only an approved admin can review accounts';
  end if;

  if p_user_id = auth.uid() then
    raise exception 'An admin cannot review their own account';
  end if;

  if p_decision not in ('approved', 'rejected') then
    raise exception 'Decision must be approved or rejected';
  end if;

  select *
  into target
  from public.profiles
  where id = p_user_id
  for update;

  if not found then
    raise exception 'Account not found';
  end if;

  if target.role not in ('passenger', 'driver') then
    raise exception 'That account cannot be reviewed';
  end if;

  if target.account_status <> 'pending' then
    raise exception 'This account has already been approved or rejected';
  end if;

  update public.profiles
  set account_status = p_decision
  where id = p_user_id
    and role = target.role
    and account_status = 'pending';

  if not found then
    raise exception 'This account could not be reviewed';
  end if;
end;
$$;

create or replace function public.set_driver_availability(p_user_id uuid, p_availability text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_approved boolean;
begin
  if auth.uid() is null then
    raise exception 'Sign in before changing availability';
  end if;

  if p_availability not in ('available', 'busy', 'offline') then
    raise exception 'Availability must be available, busy, or offline';
  end if;

  if auth.uid() is distinct from p_user_id and not public.is_admin() then
    raise exception 'You cannot change this driver availability';
  end if;

  if auth.uid() = p_user_id and not public.is_approved_driver() then
    raise exception 'Only an approved driver can change availability';
  end if;

  select exists (
    select 1
    from public.profiles
    where id = p_user_id
      and role = 'driver'
      and account_status = 'approved'
  )
  into target_approved;

  if not target_approved then
    raise exception 'Availability can change only for an approved driver';
  end if;

  update public.driver_details
  set availability = p_availability
  where user_id = p_user_id;

  if not found then
    raise exception 'Driver details were not found';
  end if;
end;
$$;

-- Dashboard SQL editor only. App roles cannot execute this.
create or replace function public.bootstrap_admin(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if session_user not in ('postgres', 'supabase_admin') then
    raise exception 'Run bootstrap_admin from the Supabase SQL editor as the database owner';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(874213);

  if exists (select 1 from public.profiles where role = 'admin') then
    raise exception 'An admin profile already exists. Bootstrap can only run once';
  end if;

  if not exists (
    select 1
    from public.profiles
    where id = p_user_id
      and role in ('passenger', 'driver')
      and account_status = 'pending'
  ) then
    raise exception 'Create a pending passenger or driver Auth user first, then bootstrap that user id';
  end if;

  update public.profiles
  set role = 'admin',
      account_status = 'approved'
  where id = p_user_id
    and role in ('passenger', 'driver')
    and account_status = 'pending';

  if not found then
    raise exception 'That profile cannot be promoted';
  end if;

  delete from public.passenger_details where user_id = p_user_id;
  delete from public.driver_details where user_id = p_user_id;
end;
$$;

alter table public.profiles enable row level security;
alter table public.passenger_details enable row level security;
alter table public.driver_details enable row level security;

revoke all on public.profiles from public, anon, authenticated;
revoke all on public.passenger_details from public, anon, authenticated;
revoke all on public.driver_details from public, anon, authenticated;

grant select on public.profiles to authenticated;
grant update (full_name, phone, address) on public.profiles to authenticated;

grant select on public.passenger_details to authenticated;
grant update (
  booking_intent,
  passenger_type,
  assistance,
  other_needs,
  emergency_name,
  emergency_phone
) on public.passenger_details to authenticated;

grant select on public.driver_details to authenticated;
grant update (availability) on public.driver_details to authenticated;

drop policy if exists profiles_select_own_or_admin on public.profiles;
create policy profiles_select_own_or_admin
  on public.profiles
  for select
  to authenticated
  using (id = auth.uid() or public.is_admin());

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own
  on public.profiles
  for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

drop policy if exists passenger_details_select_own_or_admin on public.passenger_details;
create policy passenger_details_select_own_or_admin
  on public.passenger_details
  for select
  to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists passenger_details_update_own on public.passenger_details;
create policy passenger_details_update_own
  on public.passenger_details
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists driver_details_select_own_or_admin on public.driver_details;
create policy driver_details_select_own_or_admin
  on public.driver_details
  for select
  to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists driver_details_update_availability on public.driver_details;
create policy driver_details_update_availability
  on public.driver_details
  for update
  to authenticated
  using (public.is_admin() or (user_id = auth.uid() and public.is_approved_driver()))
  with check (public.is_admin() or (user_id = auth.uid() and public.is_approved_driver()));

revoke all on function public.is_admin() from public, anon, service_role;
revoke all on function public.is_approved_driver() from public, anon, service_role;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_approved_driver() to authenticated;

revoke all on function public.review_account(uuid, text) from public, anon, service_role;
grant execute on function public.review_account(uuid, text) to authenticated;

revoke all on function public.set_driver_availability(uuid, text) from public, anon, service_role;
grant execute on function public.set_driver_availability(uuid, text) to authenticated;

revoke all on function public.bootstrap_admin(uuid) from public, anon, authenticated, authenticator, service_role;

comment on schema careride_private is
  'Trigger helpers. This schema is not exposed to the CareRide API.';
comment on table public.profiles is
  'One CareRide account per auth user. Role and approval are not self-service.';
comment on table public.passenger_details is
  'Passenger profile fields. One row for a passenger account.';
comment on table public.driver_details is
  'Driver registration and availability. License numbers are visible to the driver and admins.';
comment on function public.bootstrap_admin(uuid) is
  'One-time admin promotion. Run from the Supabase SQL editor, never from the app.';

do $$
begin
  if not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'profiles'
      and c.relrowsecurity
  ) or not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'passenger_details'
      and c.relrowsecurity
  ) or not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'driver_details'
      and c.relrowsecurity
  ) then
    raise exception 'A profile table is missing row level security';
  end if;

  if exists (select 1 from pg_roles where rolname = 'anon')
     and (
       has_table_privilege('anon', 'public.profiles', 'select')
       or has_table_privilege('anon', 'public.passenger_details', 'select')
       or has_table_privilege('anon', 'public.driver_details', 'select')
       or has_schema_privilege('anon', 'careride_private', 'usage')
       or has_function_privilege('anon', 'public.bootstrap_admin(uuid)', 'execute')
       or has_function_privilege('anon', 'careride_private.touch_profile_updated_at()', 'execute')
       or has_function_privilege('anon', 'careride_private.guard_profile_privileges()', 'execute')
       or has_function_privilege('anon', 'careride_private.guard_driver_availability()', 'execute')
       or has_function_privilege('anon', 'careride_private.create_profile_for_new_user()', 'execute')
       or has_function_privilege('anon', 'careride_private.sync_profile_email()', 'execute')
     ) then
    raise exception 'anon must not read account tables or call private helpers';
  end if;

  if exists (select 1 from pg_roles where rolname = 'authenticated')
     and (
       has_column_privilege('authenticated', 'public.profiles', 'role', 'update')
       or has_column_privilege('authenticated', 'public.profiles', 'account_status', 'update')
       or has_table_privilege('authenticated', 'public.profiles', 'insert')
       or has_table_privilege('authenticated', 'public.profiles', 'delete')
       or has_column_privilege('authenticated', 'public.driver_details', 'license_number', 'update')
       or has_schema_privilege('authenticated', 'careride_private', 'usage')
       or has_function_privilege('authenticated', 'public.bootstrap_admin(uuid)', 'execute')
       or has_function_privilege('authenticated', 'careride_private.touch_profile_updated_at()', 'execute')
       or has_function_privilege('authenticated', 'careride_private.guard_profile_privileges()', 'execute')
       or has_function_privilege('authenticated', 'careride_private.guard_driver_availability()', 'execute')
       or has_function_privilege('authenticated', 'careride_private.create_profile_for_new_user()', 'execute')
       or has_function_privilege('authenticated', 'careride_private.sync_profile_email()', 'execute')
     ) then
    raise exception 'authenticated grants allow privilege changes or signup control';
  end if;

  if exists (select 1 from pg_roles where rolname = 'authenticator')
     and has_function_privilege('authenticator', 'public.bootstrap_admin(uuid)', 'execute') then
    raise exception 'authenticator must not execute bootstrap_admin';
  end if;

  if exists (select 1 from pg_roles where rolname = 'service_role')
     and (
       has_function_privilege('service_role', 'public.bootstrap_admin(uuid)', 'execute')
       or has_schema_privilege('service_role', 'careride_private', 'usage')
       or has_function_privilege('service_role', 'careride_private.create_profile_for_new_user()', 'execute')
       or has_function_privilege('service_role', 'careride_private.sync_profile_email()', 'execute')
       or has_function_privilege('service_role', 'careride_private.touch_profile_updated_at()', 'execute')
       or has_function_privilege('service_role', 'careride_private.guard_profile_privileges()', 'execute')
       or has_function_privilege('service_role', 'careride_private.guard_driver_availability()', 'execute')
     ) then
    raise exception 'service_role must not execute bootstrap_admin or private trigger helpers';
  end if;

  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin')
     and (
       not has_function_privilege('supabase_auth_admin', 'careride_private.create_profile_for_new_user()', 'execute')
       or not has_function_privilege('supabase_auth_admin', 'careride_private.sync_profile_email()', 'execute')
       or has_function_privilege('supabase_auth_admin', 'careride_private.touch_profile_updated_at()', 'execute')
       or has_function_privilege('supabase_auth_admin', 'careride_private.guard_profile_privileges()', 'execute')
       or has_function_privilege('supabase_auth_admin', 'careride_private.guard_driver_availability()', 'execute')
     ) then
    raise exception 'auth role privileges do not match the signup triggers';
  end if;

  if not exists (
    select 1
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_proc p on p.oid = t.tgfoid
    join pg_namespace pn on pn.oid = p.pronamespace
    where not t.tgisinternal
      and n.nspname = 'auth'
      and c.relname = 'users'
      and t.tgname = 'careride_create_profile'
      and pn.nspname = 'careride_private'
      and p.proname = 'create_profile_for_new_user'
      and p.prosecdef
  ) or not exists (
    select 1
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_proc p on p.oid = t.tgfoid
    join pg_namespace pn on pn.oid = p.pronamespace
    where not t.tgisinternal
      and n.nspname = 'auth'
      and c.relname = 'users'
      and t.tgname = 'careride_sync_profile_email'
      and pn.nspname = 'careride_private'
      and p.proname = 'sync_profile_email'
      and p.prosecdef
  ) then
    raise exception 'auth signup and email sync triggers are not installed';
  end if;

  if exists (select 1 from pg_roles where rolname = 'authenticated')
     and (
       not has_function_privilege('authenticated', 'public.review_account(uuid, text)', 'execute')
       or not has_function_privilege('authenticated', 'public.set_driver_availability(uuid, text)', 'execute')
     ) then
    raise exception 'signed-in users need the review and availability functions';
  end if;

  if (
    select count(*)
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where not t.tgisinternal
      and n.nspname = 'public'
      and (
        (c.relname = 'profiles' and t.tgname in ('guard_profile_privileges', 'touch_profile_updated_at'))
        or (c.relname = 'driver_details' and t.tgname = 'guard_driver_availability')
      )
  ) <> 3 then
    raise exception 'profile triggers are missing';
  end if;
end;
$$;

commit;

-- Run these in the SQL editor after the migration. They are read-only.
-- select c.relname, c.relrowsecurity
-- from pg_class c
-- join pg_namespace n on n.oid = c.relnamespace
-- where n.nspname = 'public'
--   and c.relname in ('profiles', 'passenger_details', 'driver_details');
--
-- select tablename, policyname, cmd, roles
-- from pg_policies
-- where schemaname = 'public'
-- order by tablename, policyname;
--
-- select grantee, table_name, privilege_type
-- from information_schema.role_table_grants
-- where table_schema = 'public'
--   and table_name in ('profiles', 'passenger_details', 'driver_details')
--   and grantee in ('anon', 'authenticated', 'service_role')
-- order by table_name, grantee;
--
-- select grantee, column_name, privilege_type
-- from information_schema.column_privileges
-- where table_schema = 'public'
--   and table_name = 'profiles'
--   and grantee = 'authenticated'
-- order by column_name, privilege_type;
