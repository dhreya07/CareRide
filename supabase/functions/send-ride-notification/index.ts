/**
 * CareRide — UniSMS booking acceptance notification
 *
 * On driver accept: SMS the booking emergency contact number.
 *
 * Required secrets:
 * UNISMS_API_KEY
 * SUPABASE_URL
 * SUPABASE_ANON_KEY
 * SUPABASE_SERVICE_ROLE_KEY
 *
 * Optional (duplicate protection): migration 202611180003_secure_booking_sms.sql
 */

import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}

/** UniSMS accepts +639… or 09…. Prefer E.164 with +. */
function normalizePhilippineNumber(value: string): string | null {
  const digits = value.replace(/\D/g, '');

  if (/^09\d{9}$/.test(digits)) {
    return `+63${digits.slice(1)}`;
  }

  if (/^639\d{9}$/.test(digits)) {
    return `+${digits}`;
  }

  if (/^9\d{9}$/.test(digits)) {
    return `+63${digits}`;
  }

  return null;
}

type UniSMSResponse = {
  message?: {
    status?: string;
    reference_id?: string;
    id?: string | number;
    fail_reason?: string | null;
  };
};

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const uniSmsKey = Deno.env.get('UNISMS_API_KEY');

  if (!supabaseUrl || !anonKey || !serviceRoleKey || !uniSmsKey) {
    return json(
      { error: 'Server configuration incomplete', smsSent: false },
      503,
    );
  }

  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) {
    return json({ error: 'Authentication required', smsSent: false }, 401);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const {
    data: { user },
    error: authError,
  } = await userClient.auth.getUser();

  if (authError || !user) {
    return json({ error: 'Invalid authentication', smsSent: false }, 401);
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body', smsSent: false }, 400);
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return json({ error: 'Invalid request body', smsSent: false }, 400);
  }

  const body = payload as Record<string, unknown>;
  if (body['event'] !== 'driver_accepted') {
    return json({ error: 'Unsupported SMS event', smsSent: false }, 400);
  }

  const bookingId = body['rideId'];
  if (
    typeof bookingId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      bookingId,
    )
  ) {
    return json({ error: 'Invalid booking ID', smsSent: false }, 400);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: booking, error: bookingError } = await admin
    .from('bookings')
    .select(
      'id,driver_id,status,emergency_contact_number,pickup_location,destination',
    )
    .eq('id', bookingId)
    .maybeSingle();

  if (bookingError) {
    console.error('Booking lookup failed:', bookingError.message);
    return json({ error: 'Booking verification failed', smsSent: false }, 500);
  }

  if (!booking) {
    return json({ error: 'Booking not found', smsSent: false }, 404);
  }

  if (booking.driver_id !== user.id) {
    return json({ error: 'Not the assigned driver', smsSent: false }, 403);
  }

  if (booking.status !== 'Driver Assigned') {
    return json({ error: 'Booking is not accepted', smsSent: false }, 409);
  }

  const recipient = normalizePhilippineNumber(
    booking.emergency_contact_number ?? '',
  );

  if (!recipient) {
    return json(
      {
        error: 'Invalid emergency contact number',
        smsSent: false,
      },
      422,
    );
  }

  // Optional atomic claim. If the staging migration is not applied, still send.
  let trackingEnabled = false;
  try {
    const { data: claimed, error: claimError } = await admin.rpc(
      'claim_booking_acceptance_sms',
      {
        p_booking_id: bookingId,
        p_driver_id: user.id,
      },
    );

    if (!claimError) {
      trackingEnabled = true;
      if (claimed !== true) {
        return json({
          accepted: true,
          smsSent: false,
          reason: 'SMS already claimed or booking not eligible',
        });
      }
    } else {
      console.warn(
        'SMS claim unavailable, sending without tracking:',
        claimError.message,
      );
    }
  } catch (error) {
    console.warn('SMS claim threw, sending without tracking:', error);
  }

  const smsContent =
    'CareRide: Your booking has been accepted by a driver. ' +
    `Pickup: ${booking.pickup_location}. ` +
    `Destination: ${booking.destination}.`;

  const basicAuth = btoa(`${uniSmsKey}:`);

  let providerStatus = 'unknown';
  let providerMessageId: string | null = null;
  let requestAccepted = false;
  let providerError: string | null = null;

  try {
    const smsResponse = await fetch('https://unismsapi.com/api/sms', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basicAuth}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        recipient,
        sender_id: 'Unisoft',
        content: smsContent,
        metadata: {
          booking_id: bookingId,
          event: 'driver_accepted',
        },
      }),
      signal: AbortSignal.timeout(15000),
    });

    const rawResult: unknown = await smsResponse.json().catch(() => null);
    const result =
      rawResult && typeof rawResult === 'object'
        ? (rawResult as UniSMSResponse)
        : {};

    providerStatus = String(result.message?.status ?? 'unknown').toLowerCase();
    providerMessageId =
      result.message?.reference_id != null
        ? String(result.message.reference_id)
        : result.message?.id != null
          ? String(result.message.id)
          : null;

    // UniSMS create returns 201 with status "pending".
    requestAccepted =
      (smsResponse.ok || smsResponse.status === 201) &&
      ['pending', 'sent', 'delivered', 'retrying'].includes(providerStatus);

    if (!requestAccepted) {
      providerError =
        result.message?.fail_reason ||
        `UniSMS status=${providerStatus} http=${smsResponse.status}`;
      console.error('UniSMS rejected or unexpected SMS response:', providerError);
    }
  } catch (error) {
    // Timeout does not prove the SMS was not sent — do not auto-retry.
    console.error('UniSMS request outcome uncertain:', error);
    providerError = 'UniSMS request timed out or failed';
  }

  if (trackingEnabled) {
    const deliveryStatus = requestAccepted ? 'sent' : 'processing';
    const now = new Date().toISOString();
    const { error: updateError } = await admin
      .from('booking_sms_deliveries')
      .update({
        delivery_status: deliveryStatus,
        provider_message_id: providerMessageId,
        updated_at: now,
        sent_at: requestAccepted ? now : null,
      })
      .eq('booking_id', bookingId)
      .eq('event_type', 'driver_accepted')
      .eq('delivery_status', 'processing');

    if (updateError) {
      console.error('SMS tracking update failed:', updateError.message);
      // Provider may already have accepted the send — do not report as total failure.
    }
  }

  return json({
    accepted: true,
    smsSent: requestAccepted,
    delivered: requestAccepted,
    providerStatus,
    providerMessageId,
    ...(providerError && !requestAccepted ? { error: providerError } : {}),
  });
});
