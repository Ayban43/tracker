/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type RequestBody = {
  tripId?: string;
  pin?: string;
  expenseId?: string;
  debtorMemberId?: string;
  payerMemberId?: string;
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
  if (!supabaseUrl || !serviceRoleKey) {
    return json(500, { error: "Server config missing" });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);

  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const tripId = body.tripId?.trim();
  const pin = body.pin?.trim();
  const expenseId = body.expenseId?.trim();
  const debtorMemberId = body.debtorMemberId?.trim();
  const payerMemberIdInput = body.payerMemberId?.trim();

  if (!tripId || !pin) return json(400, { error: "tripId and pin are required" });
  if (!expenseId && !(debtorMemberId && payerMemberIdInput)) {
    return json(400, { error: "Provide expenseId or debtorMemberId+payerMemberId" });
  }

  let payerMemberId = payerMemberIdInput;
  let targetShareIds: string[] = [];

  if (expenseId) {
    const { data: expense, error: expenseError } = await admin
      .from("expenses")
      .select("id, trip_id, paid_by_member_id")
      .eq("id", expenseId)
      .maybeSingle();

    if (expenseError) return json(500, { error: expenseError.message });
    if (!expense || expense.trip_id !== tripId) {
      return json(404, { error: "Expense not found for this trip" });
    }

    payerMemberId = expense.paid_by_member_id;

    const { data: shares, error: sharesError } = await admin
      .from("expense_shares")
      .select("id")
      .eq("expense_id", expenseId)
      .eq("is_settled", false)
      .gt("owed_cents", 0);

    if (sharesError) return json(500, { error: sharesError.message });
    targetShareIds = (shares ?? []).map((row) => row.id as string);
  } else {
    if (!debtorMemberId || !payerMemberId) {
      return json(400, { error: "debtorMemberId and payerMemberId are required" });
    }

    const { data: rows, error: rowsError } = await admin
      .from("expenses")
      .select("id, paid_by_member_id, shares:expense_shares(id, member_id, is_settled, owed_cents)")
      .eq("trip_id", tripId)
      .eq("paid_by_member_id", payerMemberId);

    if (rowsError) return json(500, { error: rowsError.message });

    for (const expense of rows ?? []) {
      const shares = (expense.shares ?? []) as Array<{
        id: string;
        member_id: string;
        is_settled: boolean;
        owed_cents: number;
      }>;
      for (const share of shares) {
        if (share.member_id !== debtorMemberId) continue;
        if (share.is_settled) continue;
        if (!Number.isFinite(share.owed_cents) || share.owed_cents <= 0) continue;
        targetShareIds.push(share.id);
      }
    }
  }

  if (!payerMemberId) return json(400, { error: "Unable to resolve receiver member" });

  const { data: pinSetting, error: pinError } = await admin
    .from("member_pin_settings")
    .select("pin_sha256")
    .eq("trip_id", tripId)
    .eq("member_id", payerMemberId)
    .maybeSingle();

  if (pinError) return json(500, { error: pinError.message });
  if (!pinSetting?.pin_sha256) return json(400, { error: "Receiver PIN is not configured" });

  const pinHash = await sha256Hex(pin);
  if (pinHash !== pinSetting.pin_sha256) {
    return json(401, { error: "Invalid receiver PIN" });
  }

  if (targetShareIds.length === 0) {
    return json(200, { ok: true, updated: 0 });
  }

  const settledAt = new Date().toISOString();
  const { error: updateError } = await admin
    .from("expense_shares")
    .update({ is_settled: true, settled_at: settledAt })
    .in("id", targetShareIds);

  if (updateError) return json(500, { error: updateError.message });

  return json(200, { ok: true, updated: targetShareIds.length });
});
