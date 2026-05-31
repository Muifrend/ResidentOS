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

export default async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const body = await req.json();
    const sellerId = body.seller_id || "demo-seller";
    const status = String(body.status || "").trim();
    if (!["queued", "dispatched", "delivered", "skipped"].includes(status)) {
      return json({ error: "status must be queued, dispatched, delivered, or skipped" }, 400);
    }

    const db = admin().database;
    const now = new Date().toISOString();
    const patch: Record<string, unknown> = {
      status,
      delivery_note: body.delivery_note || null,
    };
    if (status === "dispatched") patch.dispatched_at = now;
    if (status === "delivered") patch.delivered_at = now;

    let query = db.from("orders").update(patch).eq("seller_id", sellerId);
    if (body.order_id) query = query.eq("id", body.order_id);
    if (body.floor !== undefined && body.floor !== null) query = query.eq("floor", Number(body.floor));
    if (body.manifest_date) query = query.eq("manifest_date", body.manifest_date);

    const updated = await rows(query.select("*"), "orders update") as Array<Record<string, unknown>>;
    if (!updated.length) return json({ error: "No matching orders" }, 404);

    await db.from("agent_events").insert([{
      seller_id: sellerId,
      event_type: "delivery_updated",
      message: body.floor !== undefined && body.floor !== null
        ? `Floor ${body.floor} marked ${status}.`
        : `${updated.length} order${updated.length === 1 ? "" : "s"} marked ${status}.`,
      order_id: updated.length === 1 ? updated[0].id : null,
      payload: { status, floor: body.floor ?? null, order_ids: updated.map((order) => order.id) },
    }]);

    return json({ orders: updated });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
}
