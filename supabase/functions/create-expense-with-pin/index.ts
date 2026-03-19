/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type ShareInput = {
  member_id: string;
  owed_cents: number;
  is_settled: boolean;
  settled_at: string | null;
};

type RequestBody = {
  tripId?: string;
  pin?: string;
  expense?: {
    title: string;
    category: "car" | "food" | "gas" | "activity" | "other";
    splitMode: "equal" | "custom";
    amountCents: number;
    receiptUrl: string | null;
    paidByMemberId: string;
    occurredOn: string;
    notes: string | null;
  };
  shares?: ShareInput[];
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
  const pin = body.pin?.trim();
  const expense = body.expense;
  const shares = body.shares ?? [];

  if (!tripId || !pin || !expense) return json(400, { error: "tripId, pin, expense are required" });
  if (!expense.paidByMemberId) return json(400, { error: "paidByMemberId is required" });
  if (!Array.isArray(shares) || shares.length === 0) return json(400, { error: "shares are required" });

  const { data: memberRow, error: memberError } = await admin
    .from("members")
    .select("id")
    .eq("id", expense.paidByMemberId)
    .eq("trip_id", tripId)
    .maybeSingle();
  if (memberError) return json(500, { error: memberError.message });
  if (!memberRow) return json(404, { error: "Payer not found in this trip" });

  const { data: pinSetting, error: pinError } = await admin
    .from("member_pin_settings")
    .select("pin_sha256")
    .eq("trip_id", tripId)
    .eq("member_id", expense.paidByMemberId)
    .maybeSingle();
  if (pinError) return json(500, { error: pinError.message });
  if (!pinSetting?.pin_sha256) return json(400, { error: "Payer PIN is not configured" });

  const pinHash = await sha256Hex(pin);
  if (pinHash !== pinSetting.pin_sha256) return json(401, { error: "Invalid payer PIN" });

  const { data: createdExpense, error: expenseError } = await admin
    .from("expenses")
    .insert({
      trip_id: tripId,
      title: expense.title,
      category: expense.category,
      split_mode: expense.splitMode,
      amount_cents: expense.amountCents,
      receipt_url: expense.receiptUrl,
      paid_by_member_id: expense.paidByMemberId,
      occurred_on: expense.occurredOn,
      notes: expense.notes,
    })
    .select("id")
    .single();

  if (expenseError) return json(500, { error: expenseError.message });

  const rows = shares.map((share) => ({
    expense_id: createdExpense.id,
    member_id: share.member_id,
    owed_cents: share.owed_cents,
    is_settled: share.is_settled,
    settled_at: share.settled_at,
  }));

  const { error: sharesError } = await admin.from("expense_shares").insert(rows);
  if (sharesError) return json(500, { error: sharesError.message });

  return json(200, { ok: true, expenseId: createdExpense.id });
});
