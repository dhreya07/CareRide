-- Apply in Supabase SQL editor or through the Supabase CLI.
-- Roles are assigned by a trusted operator; signup metadata never grants driver/admin access.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '', email text not null,
  phone text, role text not null default 'passenger' check (role in ('passenger','driver','admin')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.passengers (
  id uuid primary key default gen_random_uuid(), profile_id uuid not null unique references public.profiles(id) on delete cascade,
  passenger_type text not null default 'other' check (passenger_type in ('elderly','pwd','other')),
  address text, assistance_needs text[] not null default '{}', assistance_notes text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.account_role_requests (
  id uuid primary key default gen_random_uuid(), profile_id uuid not null references public.profiles(id) on delete cascade,
  requested_role text not null check (requested_role in ('driver','admin')),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewed_by uuid references public.profiles(id), created_at timestamptz not null default now(), reviewed_at timestamptz,
  unique(profile_id, requested_role)
);
create table if not exists public.family_passenger_links (
  id uuid primary key default gen_random_uuid(), family_profile_id uuid not null references public.profiles(id) on delete cascade,
  passenger_id uuid not null references public.passengers(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','approved','revoked')),
  approved_by uuid references public.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(family_profile_id, passenger_id)
);
create table if not exists public.drivers (
  id uuid primary key default gen_random_uuid(), profile_id uuid not null unique references public.profiles(id) on delete cascade,
  is_available boolean not null default false, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.vehicles (
  id uuid primary key default gen_random_uuid(), driver_id uuid not null references public.drivers(id) on delete restrict,
  make text not null, model text not null, plate_number text not null unique, accessibility_notes text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.emergency_contacts (
  id uuid primary key default gen_random_uuid(), profile_id uuid not null references public.profiles(id) on delete cascade,
  full_name text not null, phone text not null, relationship text, created_at timestamptz not null default now()
);
create table if not exists public.ride_requests (
  id uuid primary key default gen_random_uuid(), requested_by uuid not null references public.profiles(id), passenger_id uuid not null references public.passengers(id),
  pickup_address text not null, pickup_latitude double precision, pickup_longitude double precision,
  destination_address text not null, destination_latitude double precision, destination_longitude double precision,
  scheduled_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending','assigned','accepted','on_the_way','arrived','picked_up','in_transit','completed','cancelled','rejected','reported')),
  assistance_needs text[] not null default '{}', notes text,
  passenger_name text, passenger_booking_type text check (passenger_booking_type in ('self','family')),
  booking_type text not null default 'now' check (booking_type in ('now','schedule')),
  purpose text,
  emergency_contact_name text, emergency_contact_phone text,
  driver_id uuid references public.drivers(id), vehicle_id uuid references public.vehicles(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.ride_status_history (
  id uuid primary key default gen_random_uuid(), ride_request_id uuid not null references public.ride_requests(id) on delete cascade,
  status text not null, changed_by uuid references public.profiles(id), note text, created_at timestamptz not null default now()
);
create table if not exists public.incidents (
  id uuid primary key default gen_random_uuid(), ride_request_id uuid references public.ride_requests(id), reported_by uuid not null references public.profiles(id),
  category text not null, description text not null, created_at timestamptz not null default now()
);
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(), profile_id uuid not null references public.profiles(id) on delete cascade,
  ride_request_id uuid references public.ride_requests(id), channel text not null check (channel in ('in_app','sms')),
  event text not null, delivery_status text not null default 'queued', created_at timestamptz not null default now()
);

create or replace function public.set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
do $$ declare t text; begin
  foreach t in array array['profiles','passengers','family_passenger_links','drivers','vehicles','ride_requests'] loop
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format('create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

-- New accounts start as passengers. Privileged roles require trusted operator provisioning.
create or replace function public.handle_new_auth_user() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id, full_name, email, phone, role)
  values(new.id, coalesce(new.raw_user_meta_data ->> 'full_name',''), coalesce(new.email,''), new.raw_user_meta_data ->> 'phone', 'passenger');
  insert into public.passengers(profile_id) values(new.id);
  return new;
end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_auth_user();

create or replace function public.is_admin() returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

create or replace function public.is_driver() returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles where id = auth.uid() and role = 'driver');
$$;
revoke all on function public.is_driver() from public;
grant execute on function public.is_driver() to authenticated;

create or replace function public.log_ride_status() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.ride_status_history(ride_request_id,status,changed_by) values(new.id,new.status,auth.uid());
  elsif new.status is distinct from old.status then
    insert into public.ride_status_history(ride_request_id,status,changed_by) values(new.id,new.status,auth.uid());
  end if;
  return new;
end; $$;
drop trigger if exists record_ride_status on public.ride_requests;
create trigger record_ride_status after insert or update of status on public.ride_requests for each row execute function public.log_ride_status();

create or replace function public.assign_ride_driver(p_ride_id uuid, p_driver_id uuid, p_vehicle_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  if not exists(select 1 from public.drivers d where d.id=p_driver_id and d.is_available)
    then raise exception 'Driver is not marked available'; end if;
  if not exists(select 1 from public.vehicles v where v.id=p_vehicle_id and v.driver_id=p_driver_id)
    then raise exception 'Vehicle does not belong to this driver'; end if;
  update public.ride_requests set driver_id=p_driver_id, vehicle_id=p_vehicle_id, status='assigned'
  where id=p_ride_id and status='pending';
  if not found then raise exception 'Ride is not pending or does not exist'; end if;
end; $$;
revoke all on function public.assign_ride_driver(uuid,uuid,uuid) from public;
grant execute on function public.assign_ride_driver(uuid,uuid,uuid) to authenticated;

create or replace function public.transition_ride_status(p_ride_id uuid, p_next_status text, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.ride_requests%rowtype; actor_is_driver boolean; actor_is_owner boolean; valid_transition boolean := false;
begin
  select * into r from public.ride_requests where id=p_ride_id for update;
  if not found then raise exception 'Ride not found'; end if;
  actor_is_driver := exists(select 1 from public.drivers d where d.id=r.driver_id and d.profile_id=auth.uid());
  actor_is_owner := r.requested_by=auth.uid() or exists(select 1 from public.passengers p where p.id=r.passenger_id and p.profile_id=auth.uid())
    or exists(select 1 from public.family_passenger_links l where l.passenger_id=r.passenger_id and l.family_profile_id=auth.uid() and l.status='approved');
  if p_next_status='cancelled' and (actor_is_owner or actor_is_driver) and r.status in ('pending','assigned','accepted') then valid_transition := true; end if;
  if p_next_status='rejected' and public.is_admin() and r.status in ('pending') then valid_transition := true; end if;
  if p_next_status='accepted' and actor_is_driver and r.status='assigned' then valid_transition := true; end if;
  if p_next_status='on_the_way' and actor_is_driver and r.status in ('assigned','accepted') then valid_transition := true; end if;
  if p_next_status='arrived' and actor_is_driver and r.status='on_the_way' then valid_transition := true; end if;
  if p_next_status='picked_up' and actor_is_driver and r.status='arrived' then valid_transition := true; end if;
  if p_next_status='in_transit' and actor_is_driver and r.status='picked_up' then valid_transition := true; end if;
  if p_next_status='completed' and actor_is_driver and r.status='in_transit' then valid_transition := true; end if;
  if p_next_status='reported' and (actor_is_driver or actor_is_owner) and r.status not in ('completed','cancelled') then valid_transition := true; end if;
  if public.is_admin() and p_next_status in ('cancelled','reported') and r.status not in ('completed','cancelled') then valid_transition := true; end if;
  if not valid_transition then raise exception 'This ride status transition is not permitted'; end if;
  update public.ride_requests set status=p_next_status where id=p_ride_id;
  if p_note is not null and length(trim(p_note)) > 0 then
    update public.ride_status_history set note=trim(p_note) where id=(select id from public.ride_status_history where ride_request_id=p_ride_id and status=p_next_status and changed_by=auth.uid() and note is null order by created_at desc limit 1);
  end if;
end; $$;
revoke all on function public.transition_ride_status(uuid,text,text) from public;
grant execute on function public.transition_ride_status(uuid,text,text) to authenticated;

alter table public.profiles enable row level security;
alter table public.passengers enable row level security;
alter table public.account_role_requests enable row level security;
alter table public.family_passenger_links enable row level security;
alter table public.drivers enable row level security;
alter table public.vehicles enable row level security;
alter table public.emergency_contacts enable row level security;
alter table public.ride_requests enable row level security;
alter table public.ride_status_history enable row level security;
alter table public.incidents enable row level security;
alter table public.notifications enable row level security;

create policy "profiles read self or admin" on public.profiles for select to authenticated using (id = auth.uid() or public.is_admin());
create policy "profiles update self or admin" on public.profiles for update to authenticated using (id = auth.uid() or public.is_admin()) with check (id = auth.uid() or public.is_admin());
-- Column grants prevent a user from changing their own role through the profile API.
revoke update on public.profiles from authenticated;
grant update(full_name, phone) on public.profiles to authenticated;
create policy "passengers read self or admin" on public.passengers for select to authenticated using (profile_id = auth.uid() or public.is_admin());
create policy "passenger update self or admin" on public.passengers for update to authenticated using (profile_id = auth.uid() or public.is_admin()) with check (profile_id = auth.uid() or public.is_admin());
create policy "role requests visible to owner or admin" on public.account_role_requests for select to authenticated using (profile_id=auth.uid() or public.is_admin());
create policy "admin reviews role requests" on public.account_role_requests for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "links read participants or admin" on public.family_passenger_links for select to authenticated using (family_profile_id = auth.uid() or public.is_admin() or exists(select 1 from public.passengers p where p.id=passenger_id and p.profile_id=auth.uid()));
create policy "family request link" on public.family_passenger_links for insert to authenticated with check (family_profile_id = auth.uid() and status = 'pending');
create policy "admin manages links" on public.family_passenger_links for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "driver reads own record or admin" on public.drivers for select to authenticated using (profile_id = auth.uid() or public.is_admin());
create policy "admin manages drivers" on public.drivers for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "vehicle driver or admin read" on public.vehicles for select to authenticated using (public.is_admin() or exists(select 1 from public.drivers d where d.id=driver_id and d.profile_id=auth.uid()));
create policy "admin manages vehicles" on public.vehicles for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "contacts owner or admin" on public.emergency_contacts for all to authenticated using (profile_id=auth.uid() or public.is_admin()) with check (profile_id=auth.uid() or public.is_admin());
create policy "rides visible to participants" on public.ride_requests for select to authenticated using (
  public.is_admin()
  or requested_by=auth.uid()
  or exists(select 1 from public.passengers p where p.id=passenger_id and p.profile_id=auth.uid())
  or exists(select 1 from public.family_passenger_links l where l.passenger_id=ride_requests.passenger_id and l.family_profile_id=auth.uid() and l.status='approved')
  or exists(select 1 from public.drivers d where d.id=ride_requests.driver_id and d.profile_id=auth.uid())
);
create policy "passenger or authorized family creates ride" on public.ride_requests for insert to authenticated with check (
  requested_by=auth.uid() and (exists(select 1 from public.passengers p where p.id=passenger_id and p.profile_id=auth.uid())
  or exists(select 1 from public.family_passenger_links l where l.passenger_id=ride_requests.passenger_id and l.family_profile_id=auth.uid() and l.status='approved'))
);
create policy "ride status history visible to participants" on public.ride_status_history for select to authenticated using (exists(select 1 from public.ride_requests r where r.id=ride_request_id));
create policy "incident reporter or admin" on public.incidents for select to authenticated using (reported_by=auth.uid() or public.is_admin());
create policy "user reports incident" on public.incidents for insert to authenticated with check (reported_by=auth.uid());
create policy "notification owner or admin" on public.notifications for select to authenticated using (profile_id=auth.uid() or public.is_admin());

create index if not exists ride_requests_schedule_idx on public.ride_requests(scheduled_at);
create index if not exists ride_requests_status_idx on public.ride_requests(status);
create index if not exists ride_history_ride_created_idx on public.ride_status_history(ride_request_id,created_at);
