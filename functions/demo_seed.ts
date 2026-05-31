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

async function upsertByUnit(db: any, payload: Record<string, unknown>) {
  const existing = await maybeSingle(
    db.from("subscribers").select("*").eq("seller_id", payload.seller_id).eq("unit", payload.unit).maybeSingle(),
    "subscriber lookup",
  ) as Record<string, unknown> | null;
  return existing?.id
    ? await maybeSingle(db.from("subscribers").update(payload).eq("id", existing.id).select("*").maybeSingle(), "subscriber update")
    : await maybeSingle(db.from("subscribers").insert([payload]).select("*").maybeSingle(), "subscriber insert");
}

async function ensurePayment(db: any, payload: Record<string, unknown>) {
  let query = db.from("payments").select("*").eq("seller_id", payload.seller_id).eq("subscriber_id", payload.subscriber_id);
  if (payload.confirmation_number) query = query.eq("confirmation_number", payload.confirmation_number);
  const existing = await maybeSingle(query.limit(1).maybeSingle(), "payment lookup") as Record<string, unknown> | null;
  return existing?.id
    ? await maybeSingle(db.from("payments").update(payload).eq("id", existing.id).select("*").maybeSingle(), "payment update")
    : await maybeSingle(db.from("payments").insert([payload]).select("*").maybeSingle(), "payment insert");
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (Deno.env.get("DEMO_MODE") !== "true") return json({ error: "Demo mode is disabled" }, 403);

  try {
    const body = await req.json().catch(() => ({}));
    const sellerId = body.seller_id || "demo-seller";
    const db = admin().database;

    const sellerPayload = {
      id: sellerId,
      building_label: "Juniper House",
      zelle_recipient_name: "Cristian Rosca",
      zelle_recipient_email: "rosca.cris18@gmail.com",
      demo_mode: true,
      metadata: { telegram_bot_username: "locallebot" },
    };
    const existingSeller = await maybeSingle(db.from("sellers").select("*").eq("id", sellerId).maybeSingle(), "seller lookup");
    if (existingSeller) await db.from("sellers").update(sellerPayload).eq("id", sellerId);
    else await db.from("sellers").insert([sellerPayload]);

    for (const tier of [
      { id: "weekly-5", seller_id: sellerId, name: "Demo Bowl", amount_cents: 500, cadence: "weekly", sort_order: 10, active: true },
      { id: "weekly-9", seller_id: sellerId, name: "Double Portion", amount_cents: 900, cadence: "weekly", sort_order: 20, active: true },
      { id: "weekly-15", seller_id: sellerId, name: "Family Drop", amount_cents: 1500, cadence: "weekly", sort_order: 30, active: true },
    ]) {
      const existing = await maybeSingle(db.from("tiers").select("*").eq("id", tier.id).maybeSingle(), "tier lookup");
      if (existing) await db.from("tiers").update(tier).eq("id", tier.id);
      else await db.from("tiers").insert([tier]);
    }

    const subscribers = [];
    const payments = [];
    for (const subscriber of [
      { name: "Maya Chen", unit: "409", floor: 4, telegram_handle: "@maya_demo", telegram_chat_id: "demo-409", tier_id: "weekly-5", status: "paid" },
      { name: "Dev Patel", unit: "317", floor: 3, telegram_handle: "@dev_demo", telegram_chat_id: "demo-317", tier_id: "weekly-5", status: "flagged" },
      { name: "Sara Kim", unit: "214", floor: 2, telegram_handle: "@sara_demo", telegram_chat_id: "demo-214", tier_id: "weekly-9", status: "paid" },
    ]) {
      const row = await upsertByUnit(db, { seller_id: sellerId, ...subscriber, metadata: { demo: true } }) as Record<string, unknown>;
      subscribers.push(row);

      const verified = subscriber.status === "paid";
      payments.push(await ensurePayment(db, {
        seller_id: sellerId,
        subscriber_id: row.id,
        tier_id: subscriber.tier_id,
        amount_cents: subscriber.tier_id === "weekly-9" ? 900 : 500,
        receipt_artifact_key: `payment-receipts/${sellerId}/${row.id}/demo-seed.png`,
        extracted_fields: verified
          ? {
            recipient_name: "Cristian Rosca",
            recipient_email: "rosca.cris18@gmail.com",
            amount: subscriber.tier_id === "weekly-9" ? "$9.00" : "$5.00",
            state: "payment sent",
          }
          : { recipient_name: "Cristian Rosca", amount: "$5.00", state: "needs review" },
        raw_extraction: { fixture: true, source: "demo_seed" },
        validation_result: verified
          ? {
            recipient_name_match: true,
            recipient_email_match: true,
            amount_match: true,
            success_state: true,
            confirmation_present: true,
          }
          : { confirmation_present: false },
        status: verified ? "verified" : "flagged",
        confidence: verified ? 0.96 : 0.61,
        confirmation_number: verified ? `demo-${subscriber.unit}` : null,
        reason_code: verified ? null : "missing_confirmation_number",
        paid_at: verified ? new Date().toISOString() : null,
      }));
    }

    await db.from("agent_events").insert([{
      seller_id: sellerId,
      event_type: "subscriber_paid",
      message: "Demo seller, tiers, and resident sample rows were seeded.",
      payload: { subscriber_count: subscribers.length, payment_count: payments.length, source: "demo_seed" },
    }]);

    return json({ seller_id: sellerId, subscribers, payments });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
}
