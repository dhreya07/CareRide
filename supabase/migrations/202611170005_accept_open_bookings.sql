
begin;

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
  is_open_request boolean;
begin
  select *
  into saved
  from public.bookings
  where id = p_booking_id
  for update;

  if not found then
    raise exception 'Booking not found';
  end if;

  perform careride_private.require_role(
    actor,
    'driver',
    'Only an approved driver can accept a booking'
  );

  is_open_request :=
    saved.preferred_driver_id is null
    and saved.driver_id is null
    and saved.status in ('Pending', 'Scheduled')
    and (
      saved.referral_status is null
      or saved.referral_status in (
        'passenger_declined',
        'passenger_confirmed'
      )
    );

  if not is_open_request
     and not careride_private.booking_visible(saved, actor) then
    raise exception 'Booking not found';
  end if;

  if not is_open_request
     and actor is distinct from saved.preferred_driver_id
     and actor is distinct from saved.driver_id then
    raise exception 'This booking is not waiting for you';
  end if;

  if saved.status not in ('Pending', 'Scheduled')
     or saved.referral_status in (
       'pending',
       'accepted_by_replacement'
     ) then
    raise exception 'This booking can no longer be accepted';
  end if;

  perform careride_private.lock_driver(actor);

  blocked := careride_private.schedule_block_reason(
    actor,
    saved.id,
    saved.ride_date,
    saved.ride_time,
    saved.booking_kind
  );

  if blocked is not null then
    raise exception using message = blocked;
  end if;

  select *
  into snap
  from careride_private.driver_snapshot(actor);

  if not found then
    raise exception 'Only an approved driver can accept a booking';
  end if;

  if is_open_request and not exists (
    select 1
    from public.driver_details dd
    where dd.user_id = actor
      and dd.availability = 'available'
  ) then
    raise exception 'You must be available to accept an open booking';
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
    and (
      referral_status is null
      or referral_status in (
        'passenger_declined',
        'passenger_confirmed'
      )
    )
  returning * into saved;

  if not found then
    raise exception 'This booking can no longer be accepted';
  end if;

  perform careride_private.record_booking_event(
    saved.id,
    'booking_accepted',
    previous,
    saved.status,
    null
  );

  perform careride_private.notify_booking(
    saved.passenger_id,
    saved.id,
    'booking_accepted',
    'Driver accepted',
    coalesce(saved.driver_name, 'Your driver')
      || ' accepted the booking.'
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

commit;
