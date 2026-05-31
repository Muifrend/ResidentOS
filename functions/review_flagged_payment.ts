import { createAdminClient } from "npm:@insforge/sdk";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function admin() {
  const baseUrl = Deno.env.get("INSFORGE_BASE_URL") || Deno.env.get("INSFORGE_URL");
  const apiKey = Deno.env.get("INSFORGE_API_KEY") || Deno.env.get("API_KEY");
  if (!baseUrl || !apiKey) throw new Error("InsForge admin environment is not configured");
  return createAdminClient({ baseUrl, apiKey });
}

async function maybeSingle(query: PromiseLike<{ data: unknown; error: unknown }>, label: string) {
  const { data, error } = await query;
  if (error) throw new Error(`${label}: ${JSON.stringify(error)}`);
  return Array.isArray(data) ? data[0] || null : data || null;
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const body = await req.json();
    const sellerId = body.seller_id || "demo-seller";
    const paymentId = body.payment_id;
    const decision = String(body.decision || body.status || "").toLowerCase();
    if (!paymentId) return json({ error: "payment_id is required" }, 400);
    if (!["approve", "approved", "reject", "rejected"].includes(decision)) {
      return json({ error: "decision must be approve or reject" }, 400);
    }

    const approved = decision.startsWith("approve");
    const db = admin().database;
    const payment = await maybeSingle(
      db.from("payments").select("*").eq("seller_id", sellerId).eq("id", paymentId).maybeSingle(),
      "payment lookup",
    ) as Record<string, unknown> | null;
    if (!payment) return json({ error: "Payment not found" }, 404);

    const updatedPayment = await maybeSingle(
      db.from("payments").update({
        status: approved ? "verified" : "rejected",
        reason_code: approved ? null : (body.reason_code || "seller_rejected"),
        reviewed_at: new Date().toISOString(),
        reviewer_note: body.reviewer_note || null,
        paid_at: approved ? new Date().toISOString() : payment.paid_at || null,
      }).eq("id", paymentId).select("*").maybeSingle(),
      "payment review update",
    ) as Record<string, unknown>;

    const subscriber = await maybeSingle(
      db.from("subscribers").update({
        status: approved ? "paid" : "flagged",
      }).eq("id", payment.subscriber_id).select("*").maybeSingle(),
      "subscriber status update",
    ) as Record<string, unknown>;

    await db.from("agent_events").insert([{
      seller_id: sellerId,
      event_type: approved ? "subscriber_paid" : "payment_flagged",
      message: approved
        ? `${subscriber.name} in unit ${subscriber.unit} was approved by seller review.`
        : `Payment for unit ${subscriber.unit} was rejected by seller review.`,
      subscriber_id: subscriber.id,
      payment_id: updatedPayment.id,
      payload: { decision: approved ? "approved" : "rejected", reviewer_note: body.reviewer_note || null },
    }]);

    return json({ payment: updatedPayment, subscriber });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
}
