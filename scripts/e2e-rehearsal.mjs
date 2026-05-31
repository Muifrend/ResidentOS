#!/usr/bin/env node
import { spawn } from "node:child_process";
import {
  finish,
  loadEnv,
  printCheck,
  printSkip,
  requiredEnvGroups,
  safeUrlContext,
} from "./lib/env.mjs";
import { fetchJson } from "./lib/http.mjs";

loadEnv();

const failures = [];
const requireLive = process.argv.includes("--require-live");

function runScript(script) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script], {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    child.stdout.on("data", (chunk) => process.stdout.write(chunk));
    child.stderr.on("data", (chunk) => process.stderr.write(chunk));
    child.on("close", (code) => resolve(code));
  });
}

async function runPhase(name, script, envGroups = []) {
  const missing = requiredEnvGroups(envGroups);
  if (missing.length) {
    if (requireLive) {
      failures.push(name);
      printCheck(name, false, `missing env: ${missing.join(", ")}`);
    } else {
      printSkip(name, `missing env: ${missing.join(", ")}`);
    }
    return;
  }

  const code = await runScript(script);
  if (code === 0) {
    printCheck(name, true);
  } else {
    failures.push(name);
    printCheck(name, false, `script exited ${code}`);
  }
}

async function checkRemoteDashboard() {
  if (!process.env.RESIDENTOS_DASHBOARD_URL) {
    if (requireLive) {
      failures.push("remote dashboard");
      printCheck("remote dashboard", false, "RESIDENTOS_DASHBOARD_URL missing");
    } else {
      printSkip("remote dashboard", "RESIDENTOS_DASHBOARD_URL not set");
    }
    return;
  }

  try {
    const result = await fetchJson(`${process.env.RESIDENTOS_DASHBOARD_URL}/api/health`);
    if (!result.ok || !result.body?.ok) {
      throw new Error(`HTTP ${result.status}`);
    }
    printCheck(
      "remote dashboard",
      true,
      `target ${safeUrlContext(process.env.RESIDENTOS_DASHBOARD_URL)}`,
    );
  } catch (error) {
    failures.push("remote dashboard");
    printCheck("remote dashboard", false, error.message);
  }
}

async function main() {
  await runPhase("local dashboard/API", "scripts/smoke-local.mjs");
  await runPhase("insforge functions", "scripts/smoke-insforge.mjs", [
    ["INSFORGE_URL", "INSFORGE_BASE_URL", "NEXT_PUBLIC_INSFORGE_URL", "VITE_INSFORGE_URL"],
    ["INSFORGE_API_KEY", "INSFORGE_SERVICE_KEY"],
  ]);
  await runPhase("tigris artifacts", "scripts/smoke-tigris.mjs", [
    ["AWS_ENDPOINT_URL_S3"],
    ["AWS_ACCESS_KEY_ID"],
    ["AWS_SECRET_ACCESS_KEY"],
  ]);
  await runPhase("near ai extraction", "scripts/smoke-near-ai.mjs", [
    ["NEAR_AI_BASE_URL"],
    ["NEAR_AI_API_KEY"],
  ]);
  await checkRemoteDashboard();

  console.log("MANUAL Telegram/IronClaw rehearsal remains required for final demo.");
  console.log("MANUAL Verify /start -> onboarding -> receipt -> dashboard update -> manifest -> delivery notification.");

  finish(failures);
}

main().catch((error) => {
  printCheck("e2e-rehearsal", false, error.message);
  process.exitCode = 1;
});
