/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type RequestBody = {
  tripId?: string;
  expenseId?: string;
  pin?: string;
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
  const expenseId = body.expenseId?.trim();
  const pin = body.pin?.trim();

  if (!tripId || !expenseId || !pin) return json(400, { error: "tripId, expenseId, pin are required" });

  const { data: expenseRow, error: expenseError } = await admin
    .from("expenses")
    .select("id, trip_id, paid_by_member_id")
    .eq("id", expenseId)
    .maybeSingle();
  if (expenseError) return json(500, { error: expenseError.message });
  if (!expenseRow || expenseRow.trip_id !== tripId) return json(404, { error: "Expense not found for this trip" });

  const { data: pinSetting, error: pinError } = await admin
    .from("member_pin_settings")
    .select("pin_sha256")
    .eq("trip_id", tripId)
    .eq("member_id", expenseRow.paid_by_member_id)
    .maybeSingle();
  if (pinError) return json(500, { error: pinError.message });
  if (!pinSetting?.pin_sha256) return json(400, { error: "Payer PIN is not configured" });

  const pinHash = await sha256Hex(pin);
  if (pinHash !== pinSetting.pin_sha256) return json(401, { error: "Invalid payer PIN" });

  const { error: deleteError } = await admin.from("expenses").delete().eq("id", expenseId);
  if (deleteError) return json(500, { error: deleteError.message });

  return json(200, { ok: true });
});
