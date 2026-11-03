// Deploy with: supabase functions deploy send-ride-notification
// Set secrets in the Supabase dashboard. Never put provider credentials in the Ionic app.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { event, rideId } = await request.json();
    if (!event || !rideId) {
      return json({ error: 'event and rideId are required' }, 400);
    }

    const accountSid = Deno.env.get('TWILIO_ACCOUNT_SID');
    const authToken = Deno.env.get('TWILIO_AUTH_TOKEN');
    const fromNumber = Deno.env.get('TWILIO_FROM_NUMBER');
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!accountSid || !authToken || !fromNumber || !supabaseUrl || !serviceRoleKey) {
      return json({
        delivered: false,
        error: 'SMS secrets are not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM_NUMBER in Supabase Edge Function secrets.',
      }, 501);
    }

    const rideResponse = await fetch(`${supabaseUrl}/rest/v1/ride_requests?id=eq.${rideId}&select=*`, {
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
    });
    const rides = await rideResponse.json();
    const ride = Array.isArray(rides) ? rides[0] : null;
    if (!ride) {
      return json({ delivered: false, error: 'Ride not found' }, 404);
    }

    const profileResponse = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${ride.requested_by}&select=phone,full_name`, {
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
    });
    const profiles = await profileResponse.json();
    const profile = Array.isArray(profiles) ? profiles[0] : null;
    const toNumber = profile?.phone;
    if (!toNumber) {
      return json({ delivered: false, error: 'No recipient phone number is stored for this rider.' }, 422);
    }

    const body = `CareRide update: ${String(event).replaceAll('_', ' ')} for ride ${String(rideId).slice(0, 8)}.`;
    const twilioResponse = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ To: toNumber, From: fromNumber, Body: body }),
      },
    );

    const twilioPayload = await twilioResponse.json();
    const deliveryStatus = twilioResponse.ok ? 'sent' : 'failed';

    await fetch(`${supabaseUrl}/rest/v1/notifications`, {
      method: 'POST',
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        profile_id: ride.requested_by,
        ride_request_id: rideId,
        channel: 'sms',
        event,
        delivery_status: deliveryStatus,
      }),
    });

    if (!twilioResponse.ok) {
      return json({ delivered: false, error: twilioPayload?.message || 'SMS provider rejected the message.' }, 502);
    }

    return json({ delivered: true, providerSid: twilioPayload.sid });
  } catch (error) {
    return json({
      delivered: false,
      error: error instanceof Error ? error.message : 'Unexpected SMS function error',
    }, 500);
  }
});

function json(payload: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

declare const Deno: {
  env: { get(key: string): string | undefined };
  serve(handler: (request: Request) => Promise<Response> | Response): void;
};
