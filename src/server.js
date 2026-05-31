import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config, publicConfig } from "./config.js";
import { getDashboardState, invokeResidentFunction } from "./insforge.js";
import { createPresignedArtifactUrl } from "./tigris.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "..", "public");
const dashboardCache = {
  ttlMs: 15000,
  data: null,
  expiresAt: 0,
  pending: null,
};

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

function sendMcp(res, id, result) {
  sendJson(res, 200, {
    jsonrpc: "2.0",
    id,
    result,
  });
}

function notFound(res) {
  sendJson(res, 404, { error: "Not found" });
}

function sendError(res, error) {
  const statusCode = error.statusCode || 500;
  sendJson(res, statusCode, {
    error: statusCode === 500 ? "Internal server error" : error.message,
  });
}

async function readBody(req) {
  const chunks = [];

  for await (const chunk of req) {
    chunks.push(chunk);
  }

  if (!chunks.length) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function serveStatic(req, res, pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const absolutePath = path.normalize(path.join(publicDir, requested));

  if (!absolutePath.startsWith(publicDir)) {
    notFound(res);
    return;
  }

  try {
    const contents = await fs.readFile(absolutePath);
    const contentType =
      contentTypes[path.extname(absolutePath)] || "application/octet-stream";

    res.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": "no-store",
    });
    res.end(contents);
  } catch (error) {
    if (error.code === "ENOENT") {
      notFound(res);
      return;
    }

    throw error;
  }
}

async function getCachedDashboardState() {
  const now = Date.now();

  if (dashboardCache.data && dashboardCache.expiresAt > now) {
    return dashboardCache.data;
  }

  if (!dashboardCache.pending) {
    dashboardCache.pending = getDashboardState()
      .then((state) => {
        dashboardCache.data = state;
        dashboardCache.expiresAt = Date.now() + dashboardCache.ttlMs;
        return state;
      })
      .finally(() => {
        dashboardCache.pending = null;
      });
  }

  return dashboardCache.pending;
}

function invalidateDashboardCache() {
  dashboardCache.expiresAt = 0;
}

function textToolResult(payload) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload),
      },
    ],
  };
}

function normalizeTierId(value) {
  const text = String(value || "weekly-5").trim().toLowerCase();

  if (text === "demo-bowl" || text === "$5" || text === "5" || text.includes("demo")) {
    return "weekly-5";
  }

  return text;
}

function normalizePaymentState(value) {
  const text = String(value || "").trim().toLowerCase();

  if (text === "verified" || text === "paid" || text.includes("sent")) {
    return "payment_sent";
  }

  return text || "payment_sent";
}

function normalizeRecordPaymentArgs(args = {}) {
  const subscriber = args.subscriber || {};
  const payment = args.payment || {};
  const confirmationNumber =
    payment.confirmation_number ||
    payment.confirmationNumber ||
    args.confirmation_number ||
    args.confirmationNumber;

  if (!confirmationNumber) {
    const error = new Error(
      "confirmation_number is required. Ask the resident for the Zelle confirmation number before calling this tool.",
    );
    error.statusCode = 400;
    throw error;
  }

  const tierId = normalizeTierId(
    subscriber.tier_id || subscriber.tierid || args.tier_id || args.tierid,
  );

  return {
    seller_id: args.seller_id || args.sellerid || config.sellerId,
    subscriber: {
      telegram_chat_id: subscriber.telegram_chat_id || subscriber.telegramChatId || "",
      telegram_handle: subscriber.telegram_handle || subscriber.telegramHandle || "",
      name: subscriber.name || "Resident",
      unit: subscriber.unit || subscriber.room || "",
      floor: subscriber.floor || "",
      tier_id: tierId,
    },
    amount: payment.amount || args.amount || "$5.00",
    confidence: payment.confidence || args.confidence || 0.95,
    confirmation_number: String(confirmationNumber).trim(),
    receipt_artifact_key:
      payment.receipt_artifact_key ||
      payment.receiptArtifactKey ||
      args.receipt_artifact_key ||
      null,
    extracted_fields: {
      recipient_name: payment.recipient_name || payment.recipientName || config.zelleRecipientName,
      recipient_email:
        payment.recipient_email || payment.recipientEmail || config.zelleRecipientEmail,
      amount: payment.amount || args.amount || "$5.00",
      date: payment.date || args.date || new Date().toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      }),
      confirmation_number: String(confirmationNumber).trim(),
      state: normalizePaymentState(payment.state || args.state),
      confidence: payment.confidence || args.confidence || 0.95,
    },
    raw_extraction: {
      source: "residentos_mcp",
      provided_by_agent: true,
    },
  };
}

const mcpTools = [
  {
    name: "residentos_dashboard_state",
    description: "Read the current ResidentOS seller dashboard state.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "residentos_demo_seed",
    description:
      "Seed the ResidentOS demo seller, tiers, sample subscribers, and sample payments.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: true,
    },
  },
  {
    name: "residentos_record_demo_payment",
    description:
      "Record a ResidentOS demo subscriber/payment after Telegram onboarding. Requires the Zelle confirmation number.",
    inputSchema: {
      type: "object",
      properties: {
        seller_id: { type: "string" },
        subscriber: {
          type: "object",
          properties: {
            telegram_chat_id: { type: "string" },
            telegram_handle: { type: "string" },
            name: { type: "string" },
            unit: { type: "string" },
            floor: { type: "string" },
            tier_id: { type: "string" },
          },
          required: ["name", "unit", "floor"],
          additionalProperties: true,
        },
        payment: {
          type: "object",
          properties: {
            amount: { type: "string" },
            confirmation_number: { type: "string" },
            state: { type: "string" },
            confidence: { type: "number" },
            receipt_artifact_key: { type: "string" },
          },
          required: ["confirmation_number"],
          additionalProperties: true,
        },
      },
      required: ["subscriber", "payment"],
      additionalProperties: true,
    },
  },
  {
    name: "residentos_generate_manifest",
    description: "Generate the ResidentOS delivery manifest from paid subscribers.",
    inputSchema: {
      type: "object",
      properties: {
        seller_id: { type: "string" },
        manifest_date: { type: "string" },
      },
      additionalProperties: true,
    },
  },
];

async function callMcpTool(name, args = {}) {
  switch (name) {
    case "residentos_dashboard_state":
      return textToolResult(await getCachedDashboardState());
    case "residentos_demo_seed": {
      const payload = await invokeResidentFunction("demo_seed", args);
      invalidateDashboardCache();
      return textToolResult(payload);
    }
    case "residentos_record_demo_payment": {
      const payload = await invokeResidentFunction(
        "record_payment_verification",
        normalizeRecordPaymentArgs(args),
      );
      invalidateDashboardCache();
      return textToolResult(payload);
    }
    case "residentos_generate_manifest": {
      const payload = await invokeResidentFunction("generate_manifest", args);
      invalidateDashboardCache();
      return textToolResult(payload);
    }
    default:
      throw new Error(`Unknown ResidentOS MCP tool: ${name}`);
  }
}

async function handleMcp(req, res) {
  const message = await readBody(req);
  const method = message?.method;
  const params = message?.params || {};

  if (method === "initialize") {
    sendMcp(res, message.id, {
      protocolVersion: "2024-11-05",
      capabilities: {
        tools: {},
      },
      serverInfo: {
        name: "residentos",
        version: "0.1.0",
      },
    });
    return;
  }

  if (method === "notifications/initialized") {
    sendJson(res, 202, {});
    return;
  }

  if (method === "tools/list") {
    sendMcp(res, message.id, { tools: mcpTools });
    return;
  }

  if (method === "tools/call") {
    sendMcp(res, message.id, await callMcpTool(params.name, params.arguments));
    return;
  }

  sendJson(res, 400, {
    jsonrpc: "2.0",
    id: message?.id ?? null,
    error: {
      code: -32601,
      message: `Unsupported MCP method: ${method}`,
    },
  });
}

async function handleAction(req, res, action) {
  const body = await readBody(req);
  let payload;

  switch (action) {
    case "generate-manifest":
      payload = await invokeResidentFunction("generate_manifest", body);
      invalidateDashboardCache();
      sendJson(res, 200, payload);
      return;
    case "delivery-status":
      payload = await invokeResidentFunction("update_delivery_status", body);
      invalidateDashboardCache();
      sendJson(res, 200, payload);
      return;
    case "review-payment":
      payload = await invokeResidentFunction("review_flagged_payment", body);
      invalidateDashboardCache();
      sendJson(res, 200, payload);
      return;
    case "demo-seed":
      if (!config.demoMode) {
        notFound(res);
        return;
      }
      payload = await invokeResidentFunction("demo_seed", body);
      invalidateDashboardCache();
      sendJson(res, 200, payload);
      return;
    case "demo-replay-receipt":
      if (!config.demoMode) {
        notFound(res);
        return;
      }
      payload = await invokeResidentFunction("demo_replay_receipt", body);
      invalidateDashboardCache();
      sendJson(res, 200, payload);
      return;
    default:
      notFound(res);
  }
}

async function handleEvents(req, res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });

  const push = async () => {
    try {
      const state = await getCachedDashboardState();
      res.write("event: dashboard\n");
      res.write(`data: ${JSON.stringify(state)}\n\n`);
    } catch (error) {
      res.write("event: error\n");
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    }
  };

  await push();
  const interval = setInterval(push, dashboardCache.ttlMs);

  req.on("close", () => {
    clearInterval(interval);
  });
}

async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = url.pathname;

  if (req.method === "GET" && pathname === "/api/health") {
    sendJson(res, 200, {
      ok: true,
      service: "residentos-dashboard",
      config: publicConfig(),
    });
    return;
  }

  if (req.method === "GET" && pathname === "/api/dashboard") {
    sendJson(res, 200, await getCachedDashboardState());
    return;
  }

  if (req.method === "GET" && pathname === "/api/events") {
    await handleEvents(req, res);
    return;
  }

  if (req.method === "POST" && pathname === "/mcp") {
    await handleMcp(req, res);
    return;
  }

  if (req.method === "GET" && pathname === "/api/artifacts/presign") {
    const key = url.searchParams.get("key");
    sendJson(res, 200, { url: await createPresignedArtifactUrl(key) });
    return;
  }

  if (req.method === "POST" && pathname.startsWith("/api/actions/")) {
    await handleAction(req, res, pathname.replace("/api/actions/", ""));
    return;
  }

  if (req.method === "GET") {
    await serveStatic(req, res, pathname);
    return;
  }

  notFound(res);
}

const server = http.createServer((req, res) => {
  route(req, res).catch((error) => sendError(res, error));
});

server.on("error", (error) => {
  console.error(`ResidentOS dashboard failed to start: ${error.message}`);
  process.exitCode = 1;
});

server.listen(config.port, config.host, () => {
  console.log(
    `ResidentOS dashboard listening on http://${config.host}:${config.port}`,
  );
});
