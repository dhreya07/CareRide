
-- CareRide: secure SMS delivery tracking
-- LOCAL PREPARATION ONLY — DO NOT DEPLOY YET.
--
-- One notification record per booking acceptance.
-- Only the trusted server/service role may access this table.
-- This migration does NOT change bookings or cloudMigration.

create table if not exists public.booking_sms_deliveries (
    id uuid primary key default gen_random_uuid(),

    booking_id uuid not null
        references public.bookings(id)
        on delete cascade,

    event_type text not null
        default 'driver_accepted',

    delivery_status text not null
        default 'pending',

    provider_message_id text,

    attempt_count integer not null default 0,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    sent_at timestamptz,

    constraint booking_sms_event_check
        check (event_type = 'driver_accepted'),

    constraint booking_sms_status_check
        check (
            delivery_status in (
                'pending',
                'processing',
                'sent',
                'failed'
            )
        ),

    constraint booking_sms_attempt_count_check
        check (attempt_count >= 0),

    constraint booking_sms_unique_event
        unique (booking_id, event_type)
);

create index if not exists booking_sms_deliveries_status_idx
    on public.booking_sms_deliveries (delivery_status);

alter table public.booking_sms_deliveries
    enable row level security;

-- No direct access from public or authenticated clients.
revoke all on public.booking_sms_deliveries
    from public, anon, authenticated;

-- Access is reserved for the trusted server.
grant select, insert, update
    on public.booking_sms_deliveries
    to service_role;

comment on table public.booking_sms_deliveries is
    'Server-only SMS delivery tracking for accepted CareRide bookings.';


-- ============================================================
-- CareRide: atomic SMS claim for driver-accepted bookings
-- LOCAL PREPARATION ONLY — DO NOT DEPLOY
-- ============================================================

create or replace function public.claim_booking_acceptance_sms(
    p_booking_id uuid,
    p_driver_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_claimed boolean := false;
begin
    -- Only the trusted service role can claim SMS delivery.
    -- Prefer JWT role (PostgREST), then fall back to current_user.
    if coalesce(
        nullif(current_setting('request.jwt.claim.role', true), ''),
        current_user
    ) <> 'service_role' then
        raise exception 'SMS claim requires service role';
    end if;

    -- Verify that the booking is accepted by this driver.
    if not exists (
        select 1
        from public.bookings b
        where b.id = p_booking_id
          and b.driver_id = p_driver_id
          and b.status = 'Driver Assigned'
    ) then
        return false;
    end if;

    -- The unique constraint permits only one claim per event.
    insert into public.booking_sms_deliveries (
        booking_id,
        event_type,
        delivery_status,
        attempt_count
    )
    values (
        p_booking_id,
        'driver_accepted',
        'processing',
        1
    )
    on conflict (booking_id, event_type)
    do nothing
    returning true into v_claimed;

    return coalesce(v_claimed, false);
end;
$$;

revoke all on function public.claim_booking_acceptance_sms(
    uuid, uuid
) from public, anon, authenticated;

grant execute on function public.claim_booking_acceptance_sms(
    uuid, uuid
) to service_role;

comment on function public.claim_booking_acceptance_sms(
    uuid, uuid
) is
    'Atomically claims one SMS notification for a server-verified driver acceptance.';
