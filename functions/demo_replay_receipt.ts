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
  if (Deno.env.get("DEMO_MODE") !== "true") return json({ error: "Demo mode is disabled" }, 403);

  try {
    const body = await req.json().catch(() => ({}));
    const sellerId = body.seller_id || "demo-seller";
    const db = admin().database;
    const unit = String(body.unit || "501");
    const confirmationNumber = String(body.confirmation_number || `g2cwdpnn1-${Date.now()}`);

    let subscriber = await maybeSingle(
      db.from("subscribers").select("*").eq("seller_id", sellerId).eq("unit", unit).maybeSingle(),
      "subscriber lookup",
    ) as Record<string, unknown> | null;

    const subscriberPayload = {
      seller_id: sellerId,
      tier_id: "weekly-5",
      telegram_handle: body.telegram_handle || "@judge_demo",
      telegram_chat_id: body.telegram_chat_id || "judge-demo",
      name: body.name || "Judge Demo",
      unit,
      floor: Number(body.floor || unit[0] || 5),
      status: "paid",
      metadata: { demo_replay: true },
    };

    subscriber = subscriber?.id
      ? await maybeSingle(db.from("subscribers").update(subscriberPayload).eq("id", subscriber.id).select("*").maybeSingle(), "subscriber update") as Record<string, unknown>
      : await maybeSingle(db.from("subscribers").insert([subscriberPayload]).select("*").maybeSingle(), "subscriber insert") as Record<string, unknown>;

    const extractedFields = {
      recipient_name: "Cristian Rosca",
      recipient_email: "rosca.cris18@gmail.com",
      amount: "$5.00",
      date: "May 31, 2026",
      confirmation_number: confirmationNumber,
      state: "payment sent",
    };

    const payment = await maybeSingle(
      db.from("payments").insert([{
        seller_id: sellerId,
        subscriber_id: subscriber.id,
        tier_id: "weekly-5",
        amount_cents: 500,
        receipt_artifact_key: body.receipt_artifact_key || `payment-receipts/${sellerId}/${subscriber.id}/demo-replay.png`,
        extracted_fields: extractedFields,
        raw_extraction: { fixture: true, source: "demo_replay_receipt" },
        validation_result: {
          recipient_name_match: true,
          recipient_email_match: true,
          amount_match: true,
          success_state: true,
          confirmation_present: true,
        },
        status: "verified",
        confidence: 0.99,
        confirmation_number: confirmationNumber,
        paid_at: new Date().toISOString(),
      }]).select("*").maybeSingle(),
      "payment insert",
    ) as Record<string, unknown>;

    await db.from("agent_events").insert([{
      seller_id: sellerId,
      event_type: "subscriber_paid",
      message: `${subscriber.name} in unit ${subscriber.unit} verified from replay receipt.`,
      subscriber_id: subscriber.id,
      payment_id: payment.id,
      payload: { source: "demo_replay_receipt" },
    }]);

    return json({ subscriber, payment });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
}
