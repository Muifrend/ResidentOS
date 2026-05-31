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

async function rows(query: PromiseLike<{ data: unknown; error: unknown }>, label: string) {
  const { data, error } = await query;
  if (error) throw new Error(`${label}: ${JSON.stringify(error)}`);
  return Array.isArray(data) ? data : data ? [data] : [];
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
    const manifestDate = body.manifest_date || new Date().toISOString().slice(0, 10);
    const manifestArtifactKey = body.manifest_artifact_key || null;
    const db = admin().database;

    const paidSubscribers = await rows(
      db.from("subscribers").select("*").eq("seller_id", sellerId).eq("status", "paid"),
      "paid subscribers",
    ) as Array<Record<string, unknown>>;

    const orders = [];
    for (const subscriber of paidSubscribers.sort((a, b) => {
      const floorDelta = Number(a.floor || 0) - Number(b.floor || 0);
      return floorDelta || String(a.unit || "").localeCompare(String(b.unit || ""));
    })) {
      const existing = await maybeSingle(
        db.from("orders").select("*")
          .eq("seller_id", sellerId)
          .eq("subscriber_id", subscriber.id)
          .eq("manifest_date", manifestDate)
          .maybeSingle(),
        "existing order",
      ) as Record<string, unknown> | null;

      const latestPayment = (await rows(
        db.from("payments").select("*")
          .eq("seller_id", sellerId)
          .eq("subscriber_id", subscriber.id)
          .eq("status", "verified")
          .order("created_at", { ascending: false })
          .limit(1),
        "latest payment",
      ) as Array<Record<string, unknown>>)[0];

      const payload = {
        seller_id: sellerId,
        subscriber_id: subscriber.id,
        tier_id: subscriber.tier_id || null,
        payment_id: latestPayment?.id || null,
        manifest_date: manifestDate,
        manifest_artifact_key: manifestArtifactKey,
        name: subscriber.name,
        unit: subscriber.unit,
        floor: subscriber.floor,
      };

      const order = existing?.id
        ? await maybeSingle(
          db.from("orders").update(payload).eq("id", existing.id).select("*").maybeSingle(),
          "order update",
        )
        : await maybeSingle(
          db.from("orders").insert([payload]).select("*").maybeSingle(),
          "order insert",
        );
      orders.push(order);
    }

    await db.from("agent_events").insert([{
      seller_id: sellerId,
      event_type: "manifest_generated",
      message: `Manifest generated with ${orders.length} paid subscribers.`,
      payload: { manifest_date: manifestDate, manifest_artifact_key: manifestArtifactKey, order_count: orders.length },
    }]);

    return json({ manifest_date: manifestDate, orders });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
}
