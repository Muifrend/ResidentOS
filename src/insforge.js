import { createAdminClient } from "@insforge/sdk";
import { config } from "./config.js";

const sampleState = {
  seller: {
    id: "demo-seller",
    building_label: "Juniper House",
    zelle_recipient_name: "Cristian Rosca",
    zelle_recipient_email: "rosca.cris18@gmail.com",
  },
  tiers: [
    { id: "weekly-5", name: "Demo Bowl", amount_cents: 500, cadence: "weekly" },
    { id: "weekly-9", name: "Double Portion", amount_cents: 900, cadence: "weekly" },
  ],
  subscribers: [
    {
      id: "sub-101",
      name: "Maya Chen",
      unit: "409",
      floor: 4,
      telegram_handle: "@maya_demo",
      tier_id: "weekly-5",
      status: "paid",
      payment_status: "paid",
    },
    {
      id: "sub-102",
      name: "Dev Patel",
      unit: "317",
      floor: 3,
      telegram_handle: "@dev_demo",
      tier_id: "weekly-5",
      status: "flagged",
      payment_status: "flagged",
    },
    {
      id: "sub-103",
      name: "Sara Kim",
      unit: "214",
      floor: 2,
      telegram_handle: "@sara_demo",
      tier_id: "weekly-9",
      status: "paid",
      payment_status: "paid",
    },
  ],
  payments: [
    {
      id: "pay-101",
      subscriber_id: "sub-101",
      amount_cents: 500,
      status: "verified",
      confidence: 0.96,
      confirmation_number: "g2cwdpnn1",
      receipt_artifact_key: "payment-receipts/demo-seller/sub-101/sample.png",
      extracted_fields: {
        recipient_name: "Cristian Rosca",
        recipient_email: "rosca.cris18@gmail.com",
        amount: "$5.00",
        date: "May 31, 2026",
        state: "payment sent",
      },
    },
    {
      id: "pay-102",
      subscriber_id: "sub-102",
      amount_cents: 500,
      status: "flagged",
      confidence: 0.61,
      confirmation_number: "",
      receipt_artifact_key: "payment-receipts/demo-seller/sub-102/sample.png",
      extracted_fields: {
        recipient_name: "Cristian Rosca",
        amount: "$5.00",
        state: "needs review",
      },
      reason_code: "missing_confirmation_number",
    },
  ],
  orders: [
    {
      id: "order-101",
      subscriber_id: "sub-103",
      unit: "214",
      floor: 2,
      status: "queued",
      manifest_date: "2026-05-31",
    },
    {
      id: "order-102",
      subscriber_id: "sub-101",
      unit: "409",
      floor: 4,
      status: "dispatched",
      manifest_date: "2026-05-31",
    },
  ],
  agent_events: [
    {
      id: "evt-4",
      event_type: "delivery_updated",
      message: "Floor 4 marked dispatched from dashboard.",
      created_at: new Date(Date.now() - 1000 * 45).toISOString(),
    },
    {
      id: "evt-3",
      event_type: "manifest_generated",
      message: "IronClaw generated the Juniper House manifest.",
      created_at: new Date(Date.now() - 1000 * 240).toISOString(),
    },
    {
      id: "evt-2",
      event_type: "payment_flagged",
      message: "Receipt for unit 317 needs seller review.",
      created_at: new Date(Date.now() - 1000 * 390).toISOString(),
    },
    {
      id: "evt-1",
      event_type: "subscriber_paid",
      message: "Maya Chen verified for weekly Demo Bowl.",
      created_at: new Date(Date.now() - 1000 * 520).toISOString(),
    },
  ],
};

let adminClient;

function getAdminClient() {
  if (adminClient) {
    return adminClient;
  }

  if (!config.insforge.baseUrl || !config.insforge.apiKey) {
    throw new Error("InsForge admin client is not configured.");
  }

  adminClient = createAdminClient({
    baseUrl: config.insforge.baseUrl,
    apiKey: config.insforge.apiKey,
  });

  return adminClient;
}

function normalizeError(error) {
  if (!error) {
    return null;
  }

  if (typeof error === "string") {
    return error;
  }

  return error.message || error.details || error.hint || "Unknown InsForge error";
}

async function selectRows(table, configure = (query) => query) {
  const query = configure(getAdminClient().database.from(table).select("*"));
  const { data, error } = await query;

  if (error) {
    throw new Error(`${table}: ${normalizeError(error)}`);
  }

  return Array.isArray(data) ? data : data ? [data] : [];
}

async function selectSeller() {
  const { data, error } = await getAdminClient()
    .database.from("sellers")
    .select("*")
    .eq("id", config.sellerId)
    .maybeSingle();

  if (error) {
    throw new Error(`sellers: ${normalizeError(error)}`);
  }

  return data || null;
}

export async function getDashboardState() {
  const errors = [];

  if (!config.insforge.apiKey) {
    return {
      ...sampleState,
      meta: {
        source: "sample",
        sellerId: config.sellerId,
        errors: ["INSFORGE_API_KEY is not configured; showing sample state."],
      },
    };
  }

  const read = async (fallback, fn) => {
    try {
      return await fn();
    } catch (error) {
      errors.push(error.message);
      return fallback;
    }
  };

  const [seller, tiers, subscribers, payments, orders, agentEvents] =
    await Promise.all([
      read(sampleState.seller, selectSeller),
      read(sampleState.tiers, () =>
        selectRows("tiers", (query) => query.eq("seller_id", config.sellerId)),
      ),
      read(sampleState.subscribers, () =>
        selectRows("subscribers", (query) => query.eq("seller_id", config.sellerId)),
      ),
      read(sampleState.payments, () =>
        selectRows("payments", (query) =>
          query.eq("seller_id", config.sellerId).order("created_at", { ascending: false }),
        ),
      ),
      read(sampleState.orders, () =>
        selectRows("orders", (query) =>
          query.eq("seller_id", config.sellerId).order("floor", { ascending: true }),
        ),
      ),
      read(sampleState.agent_events, () =>
        selectRows("agent_events", (query) =>
          query
            .eq("seller_id", config.sellerId)
            .order("created_at", { ascending: false })
            .limit(25),
        ),
      ),
    ]);

  return {
    seller: seller || sampleState.seller,
    tiers,
    subscribers,
    payments,
    orders,
    agent_events: agentEvents,
    meta: {
      source: errors.length ? "partial" : "insforge",
      sellerId: config.sellerId,
      errors,
    },
  };
}

export async function invokeResidentFunction(slug, body = {}) {
  const { data, error } = await getAdminClient().functions.invoke(slug, {
    body: {
      seller_id: config.sellerId,
      ...body,
    },
  });

  if (error) {
    const err = new Error(normalizeError(error));
    err.statusCode = 502;
    throw err;
  }

  return data;
}
