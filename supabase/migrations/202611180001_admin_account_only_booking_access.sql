-- CareRide staging: account-only Admin access.
-- Do not run against CareRide1 production.
-- This migration allows Admin monitoring only. Passenger/Driver booking RPCs
-- remain unchanged and no Admin booking action is permitted.

begin;

-- An Admin must not be able to assign a Driver to a booking.
revoke execute on function public.assign_booking(uuid, uuid) from authenticated;

-- Keep cancellation with the people in the booking. The prior version also
-- allowed an Admin to cancel directly, which conflicts with account-only
-- Admin access. This preserves the existing passenger and assigned-Driver
-- rules and every existing status guard.
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
    (role = 'passenger' and actor = saved.passenger_id)
    or (role = 'driver' and actor = saved.driver_id and saved.status = 'Driver Assigned')
  ) then
    raise exception 'You cannot cancel this booking';
  end if;
  if role = 'passenger' and saved.status not in ('Pending', 'Scheduled', 'Driver Assigned') then
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
  perform careride_private.notify_booking(saved.passenger_id, saved.id, 'booking_cancelled', 'Booking cancelled', 'The booking was cancelled.');
  perform careride_private.notify_booking(saved.driver_id, saved.id, 'booking_cancelled', 'Booking cancelled', 'The booking was cancelled.');
  if saved.driver_id is null then
    perform careride_private.notify_booking(saved.preferred_driver_id, saved.id, 'booking_cancelled', 'Booking cancelled', 'The booking was cancelled.');
  end if;
  if saved.referral_status = 'pending' then
    perform careride_private.notify_booking(saved.referral_proposed_driver_id, saved.id, 'booking_cancelled', 'Booking cancelled', 'The booking was cancelled.');
  end if;
  return saved;
end;
$$;

-- An Admin can read booking status for monitoring, but cannot write, assign,
-- cancel, accept, decline, or open a rider's live location.
drop policy if exists bookings_select_participant on public.bookings;
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

-- Notifications are private to their intended recipient, including booking
-- notifications. The Admin has no booking-notification inbox.
drop policy if exists booking_notifications_select_own on public.booking_notifications;
create policy booking_notifications_select_own
  on public.booking_notifications
  for select
  to authenticated
  using (recipient_id = (select auth.uid()));

commit;
