-- Apply after 202610120001 if that migration already ran. Safe to skip on a fresh database
-- that used the updated 202610120001 file.

update public.profiles set role = 'passenger' where role = 'family';

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('passenger','driver','admin'));

alter table public.account_role_requests drop constraint if exists account_role_requests_requested_role_check;
alter table public.account_role_requests add constraint account_role_requests_requested_role_check check (requested_role in ('driver','admin'));
delete from public.account_role_requests where requested_role = 'family';

alter table public.ride_requests drop constraint if exists ride_requests_status_check;
alter table public.ride_requests add constraint ride_requests_status_check check (status in (
  'pending','assigned','accepted','on_the_way','arrived','picked_up','in_transit','completed','cancelled','rejected','reported'
));

alter table public.ride_requests add column if not exists passenger_name text;
alter table public.ride_requests add column if not exists passenger_booking_type text;
alter table public.ride_requests add column if not exists booking_type text not null default 'now';
alter table public.ride_requests add column if not exists purpose text;
alter table public.ride_requests add column if not exists emergency_contact_name text;
alter table public.ride_requests add column if not exists emergency_contact_phone text;

do $$ begin
  alter table public.ride_requests add constraint ride_requests_passenger_booking_type_check
    check (passenger_booking_type in ('self','family'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.ride_requests add constraint ride_requests_booking_type_check
    check (booking_type in ('now','schedule'));
exception when duplicate_object then null; end $$;

create or replace function public.handle_new_auth_user() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id, full_name, email, phone, role)
  values(new.id, coalesce(new.raw_user_meta_data ->> 'full_name',''), coalesce(new.email,''), new.raw_user_meta_data ->> 'phone', 'passenger');
  insert into public.passengers(profile_id) values(new.id);
  return new;
end; $$;

create or replace function public.is_driver() returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles where id = auth.uid() and role = 'driver');
$$;
revoke all on function public.is_driver() from public;
grant execute on function public.is_driver() to authenticated;

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
  if p_next_status='reported' and (actor_is_driver or actor_is_owner) and r.status not in ('completed','cancelled','rejected') then valid_transition := true; end if;
  if public.is_admin() and p_next_status in ('cancelled','reported','rejected') and r.status not in ('completed','cancelled','rejected') then valid_transition := true; end if;
  if not valid_transition then raise exception 'This ride status transition is not permitted'; end if;
  update public.ride_requests set status=p_next_status where id=p_ride_id;
  if p_note is not null and length(trim(p_note)) > 0 then
    update public.ride_status_history set note=trim(p_note) where id=(select id from public.ride_status_history where ride_request_id=p_ride_id and status=p_next_status and changed_by=auth.uid() and note is null order by created_at desc limit 1);
  end if;
end; $$;

drop policy if exists "rides visible to participants" on public.ride_requests;
create policy "rides visible to participants" on public.ride_requests for select to authenticated using (
  public.is_admin()
  or requested_by=auth.uid()
  or exists(select 1 from public.passengers p where p.id=passenger_id and p.profile_id=auth.uid())
  or exists(select 1 from public.family_passenger_links l where l.passenger_id=ride_requests.passenger_id and l.family_profile_id=auth.uid() and l.status='approved')
  or exists(select 1 from public.drivers d where d.id=ride_requests.driver_id and d.profile_id=auth.uid())
);
