-- CareRide staging only: make the completed-ride notification a rating prompt.
-- Do not run against CareRide1 production.

begin;

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
    saved.passenger_id,
    saved.id,
    'ride_completed',
    'Rate your driver',
    'Your ride is complete. Open this trip to leave a 1 to 5 star rating; feedback is optional.'
  );
  return saved;
end;
$$;

commit;
