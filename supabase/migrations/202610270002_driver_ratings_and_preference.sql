-- Preferred driver on booking plus ratings. Apply after 202610270001.
-- Passenger can read available drivers; enforcement of assignment stays with admin RPC.

alter table public.drivers
  add column if not exists rating_avg numeric(3,2) not null default 5.00,
  add column if not exists rating_count integer not null default 0;

alter table public.ride_requests
  add column if not exists preferred_driver_id uuid references public.drivers(id);

drop policy if exists "available drivers visible when booking" on public.drivers;
create policy "available drivers visible when booking" on public.drivers
  for select to authenticated
  using (is_available = true or profile_id = auth.uid() or public.is_admin());

drop policy if exists "driver profiles readable when booking" on public.profiles;
create policy "driver profiles readable when booking" on public.profiles
  for select to authenticated
  using (role = 'driver' or id = auth.uid() or public.is_admin());

drop policy if exists "available vehicles visible when booking" on public.vehicles;
create policy "available vehicles visible when booking" on public.vehicles
  for select to authenticated
  using (
    public.is_admin()
    or exists (select 1 from public.drivers d where d.id = driver_id and (d.profile_id = auth.uid() or d.is_available = true))
  );
