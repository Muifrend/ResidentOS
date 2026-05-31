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

function normalizeEmail(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

function normalizeConfirmation(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

function centsFromAmount(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value * 100);
  }
  const match = String(value || "").replace(/,/g, "").match(/\$?\s*(\d+(?:\.\d{1,2})?)/);
  return match ? Math.round(Number(match[1]) * 100) : null;
}

function successState(value: unknown): boolean {
  return /sent|success|successful|complete|completed|paid/i.test(String(value || ""));
}

function floorFromUnit(unit: string, fallback: unknown): number {
  if (typeof fallback === "number" && Number.isFinite(fallback)) return Math.trunc(fallback);
  const match = unit.match(/\d+/);
  return match ? Number(match[0][0]) : 0;
}

async function maybeSingle(query: PromiseLike<{ data: unknown; error: unknown }>, label: string) {
  const { data, error } = await query;
  if (error) throw new Error(`${label}: ${JSON.stringify(error)}`);
  return Array.isArray(data) ? data[0] || null : data || null;
}

async function rows(query: PromiseLike<{ data: unknown; error: unknown }>, label: string) {
  const { data, error } = await query;
  if (error) throw new Error(`${label}: ${JSON.stringify(error)}`);
  return Array.isArray(data) ? data : data ? [data] : [];
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const body = await req.json();
    const sellerId = body.seller_id || "demo-seller";
    const db = admin().database;

    const seller = await maybeSingle(
      db.from("sellers").select("*").eq("id", sellerId).maybeSingle(),
      "seller",
    ) as Record<string, unknown> | null;
    if (!seller) return json({ error: "Unknown seller" }, 404);

    const inputSubscriber = body.subscriber || body;
    const unit = String(inputSubscriber.unit || inputSubscriber.room || "").trim();
    const name = String(inputSubscriber.name || "Resident").trim();
    if (!unit) return json({ error: "unit is required" }, 400);

    const tierId = String(inputSubscriber.tier_id || body.tier_id || "weekly-5");
    const tier = await maybeSingle(
      db.from("tiers").select("*").eq("seller_id", sellerId).eq("id", tierId).maybeSingle(),
      "tier",
    ) as Record<string, unknown> | null;
    if (!tier) return json({ error: "Unknown tier" }, 400);

    const extracted = body.extracted_fields || {};
    const confirmationNumber = String(
      body.confirmation_number || extracted.confirmation_number || extracted.confirmation || "",
    ).trim();
    const normalizedConfirmation = normalizeConfirmation(confirmationNumber);

    if (normalizedConfirmation) {
      const duplicates = await rows(
        db.from("payments").select("*").eq("seller_id", sellerId).eq("confirmation_number", confirmationNumber),
        "duplicate payment lookup",
      ) as Array<Record<string, unknown>>;
      if (duplicates.length > 0) {
        await db.from("agent_events").insert([{
          seller_id: sellerId,
          event_type: "payment_flagged",
          message: `Duplicate Zelle confirmation ${confirmationNumber} was rejected.`,
          payment_id: duplicates[0].id,
          payload: { reason_code: "duplicate_confirmation_number", confirmation_number: confirmationNumber },
        }]);
        return json({
          status: "duplicate",
          reason_code: "duplicate_confirmation_number",
          existing_payment_id: duplicates[0].id,
        }, 409);
      }
    }

    const expectedCents = Number(tier.amount_cents);
    const extractedCents = centsFromAmount(body.amount || extracted.amount || extracted.amount_paid);
    const validation = {
      recipient_name_match: String(extracted.recipient_name || "").trim().toLowerCase() ===
        String(seller.zelle_recipient_name || "").trim().toLowerCase(),
      recipient_email_match: normalizeEmail(extracted.recipient_email) === normalizeEmail(seller.zelle_recipient_email),
      amount_match: extractedCents === expectedCents,
      success_state: successState(extracted.state || extracted.status),
      confirmation_present: Boolean(normalizedConfirmation),
    };
    const valid = Object.values(validation).every(Boolean);
    const paymentStatus = valid ? "verified" : "flagged";
    const reasonCode = valid ? null : Object.entries(validation).find(([, ok]) => !ok)?.[0] || "validation_failed";

    let subscriber = await maybeSingle(
      db.from("subscribers").select("*").eq("seller_id", sellerId).eq("unit", unit).maybeSingle(),
      "subscriber lookup",
    ) as Record<string, unknown> | null;

    const subscriberPayload = {
      seller_id: sellerId,
      tier_id: tierId,
      telegram_handle: inputSubscriber.telegram_handle || inputSubscriber.handle || null,
      telegram_chat_id: inputSubscriber.telegram_chat_id || inputSubscriber.chat_id || null,
      name,
      unit,
      floor: floorFromUnit(unit, inputSubscriber.floor),
      status: valid ? "paid" : "flagged",
      metadata: inputSubscriber.metadata || {},
    };

    if (subscriber?.id) {
      subscriber = await maybeSingle(
        db.from("subscribers").update(subscriberPayload).eq("id", subscriber.id).select("*").maybeSingle(),
        "subscriber update",
      ) as Record<string, unknown>;
    } else {
      subscriber = await maybeSingle(
        db.from("subscribers").insert([subscriberPayload]).select("*").maybeSingle(),
        "subscriber insert",
      ) as Record<string, unknown>;
    }

    const payment = await maybeSingle(
      db.from("payments").insert([{
        seller_id: sellerId,
        subscriber_id: subscriber.id,
        tier_id: tierId,
        amount_cents: expectedCents,
        receipt_artifact_key: body.receipt_artifact_key || body.artifact_key || null,
        extracted_fields: extracted,
        raw_extraction: body.raw_extraction || {},
        validation_result: validation,
        status: paymentStatus,
        confidence: body.confidence ?? extracted.confidence ?? null,
        confirmation_number: confirmationNumber || null,
        reason_code: reasonCode,
        paid_at: valid ? new Date().toISOString() : null,
      }]).select("*").maybeSingle(),
      "payment insert",
    ) as Record<string, unknown>;

    await db.from("agent_events").insert([{
      seller_id: sellerId,
      event_type: valid ? "subscriber_paid" : "payment_flagged",
      message: valid
        ? `${name} in unit ${unit} verified for ${tier.name}.`
        : `Receipt for unit ${unit} needs seller review.`,
      subscriber_id: subscriber.id,
      payment_id: payment.id,
      payload: { validation, reason_code: reasonCode },
    }]);

    return json({ subscriber, payment, validation, status: paymentStatus });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
}
