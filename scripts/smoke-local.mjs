#!/usr/bin/env node
import { spawn } from "node:child_process";
import net from "node:net";
import { fetchJson, waitForJson } from "./lib/http.mjs";
import { finish, loadEnv, printCheck, safeUrlContext } from "./lib/env.mjs";

loadEnv();

const failures = [];
const remoteMode = process.argv.includes("--remote");

function run(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      ...options,
    });

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("close", (code) => {
      resolve({ code, stderr });
    });
  });
}

function getOpenPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

async function check(name, fn) {
  try {
    const detail = await fn();
    printCheck(name, true, detail);
  } catch (error) {
    failures.push(name);
    printCheck(name, false, error.message);
  }
}

async function main() {
  if (!remoteMode) {
    await check("local build", async () => {
      const result = await run("npm", ["run", "build"]);
      if (result.code !== 0) {
        throw new Error("npm run build failed");
      }
      return "syntax checks passed";
    });
  }

  let server;
  let baseUrl = process.env.RESIDENTOS_DASHBOARD_URL;

  if (!remoteMode) {
    const port = await getOpenPort();
    baseUrl = `http://127.0.0.1:${port}`;
    server = spawn(process.execPath, ["src/server.js"], {
      env: {
        ...process.env,
        PORT: String(port),
        HOST: "127.0.0.1",
      },
      stdio: ["ignore", "ignore", "pipe"],
    });
  }

  if (!baseUrl) {
    failures.push("dashboard url");
    printCheck("dashboard url", false, "RESIDENTOS_DASHBOARD_URL is missing");
    finish(failures);
    return;
  }

  try {
    await check("dashboard health", async () => {
      const result = await waitForJson(`${baseUrl}/api/health`, {
        timeoutMs: 15000,
      });
      if (!result.body?.ok) {
        throw new Error(`health returned HTTP ${result.status}`);
      }
      return `target ${safeUrlContext(baseUrl)}`;
    });

    await check("dashboard state", async () => {
      const result = await fetchJson(`${baseUrl}/api/dashboard`);
      if (!result.ok || !result.body || typeof result.body !== "object") {
        throw new Error(`dashboard returned HTTP ${result.status}`);
      }
      return `source ${result.body.meta?.source || "unknown"}`;
    });

    await check("artifact key guard", async () => {
      const result = await fetchJson(
        `${baseUrl}/api/artifacts/presign?key=../../.env.local`,
      );
      if (result.status !== 400) {
        throw new Error(`expected HTTP 400, got HTTP ${result.status}`);
      }
      return "invalid key rejected";
    });
  } finally {
    if (server) {
      server.kill("SIGTERM");
    }
  }

  finish(failures);
}

main().catch((error) => {
  printCheck("smoke-local", false, error.message);
  process.exitCode = 1;
});
