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
