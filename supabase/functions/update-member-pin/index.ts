/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type RequestBody = {
  tripId?: string;
  memberId?: string;
  currentPin?: string;
  newPin?: string;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

async function sha256Hex(input: string) {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  const bytes = Array.from(new Uint8Array(hash));
  return bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return json(500, { error: "Server config missing" });

  const admin = createClient(supabaseUrl, serviceRoleKey);

  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const tripId = body.tripId?.trim();
  const memberId = body.memberId?.trim();
  const currentPin = body.currentPin?.trim();
  const newPin = body.newPin?.trim();

  if (!tripId || !memberId || !currentPin || !newPin) {
    return json(400, { error: "tripId, memberId, currentPin, newPin are required" });
  }
  if (!/^\d{4,8}$/.test(newPin)) {
    return json(400, { error: "New PIN must be 4 to 8 digits" });
  }

  const { data: memberRow, error: memberError } = await admin
    .from("members")
    .select("id")
    .eq("id", memberId)
    .eq("trip_id", tripId)
    .maybeSingle();

  if (memberError) return json(500, { error: memberError.message });
  if (!memberRow) return json(404, { error: "Member not found in this trip" });

  const { data: pinSetting, error: pinError } = await admin
    .from("member_pin_settings")
    .select("pin_sha256")
    .eq("trip_id", tripId)
    .eq("member_id", memberId)
    .maybeSingle();

  if (pinError) return json(500, { error: pinError.message });
  if (!pinSetting?.pin_sha256) return json(400, { error: "Member PIN is not configured" });

  const currentHash = await sha256Hex(currentPin);
  if (currentHash !== pinSetting.pin_sha256) return json(401, { error: "Current PIN is incorrect" });

  const newHash = await sha256Hex(newPin);
  const { error: updateError } = await admin
    .from("member_pin_settings")
    .update({ pin_sha256: newHash, updated_at: new Date().toISOString() })
    .eq("trip_id", tripId)
    .eq("member_id", memberId);

  if (updateError) return json(500, { error: updateError.message });

  return json(200, { ok: true });
});
