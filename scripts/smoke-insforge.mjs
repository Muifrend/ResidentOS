#!/usr/bin/env node
import { createAdminClient } from "@insforge/sdk";
import {
  finish,
  hasAnyEnv,
  loadEnv,
  printCheck,
  safeUrlContext,
} from "./lib/env.mjs";

loadEnv();

const sellerId = process.env.RESIDENTOS_SELLER_ID || "demo-seller";
const insforgeUrl =
  process.env.INSFORGE_URL ||
  process.env.INSFORGE_BASE_URL ||
  process.env.NEXT_PUBLIC_INSFORGE_URL ||
  process.env.VITE_INSFORGE_URL;
const insforgeApiKey = process.env.INSFORGE_API_KEY || process.env.INSFORGE_SERVICE_KEY;
const requiredFunctions = [
  "record_payment_verification",
  "generate_manifest",
  "update_delivery_status",
  "review_flagged_payment",
  "demo_seed",
  "demo_replay_receipt",
];

const failures = [];

function statusCode(error) {
  return error?.statusCode || error?.status || 0;
}

function reachableError(error) {
  const code = statusCode(error);
  return code === 400 || code === 422;
}

function missingFunction(error) {
  const code = statusCode(error);
  const message = String(error?.message || "").toLowerCase();
  return code === 404 || message.includes("not found");
}

async function main() {
  const missing = [
    ...(insforgeUrl ? [] : ["INSFORGE_URL|INSFORGE_BASE_URL"]),
    ...(hasAnyEnv(["INSFORGE_API_KEY", "INSFORGE_SERVICE_KEY"])
      ? []
      : ["INSFORGE_API_KEY|INSFORGE_SERVICE_KEY"]),
  ];
  if (missing.length) {
    for (const name of missing) {
      failures.push(name);
      printCheck(`env ${name}`, false, "missing");
    }
    finish(failures);
    return;
  }

  printCheck("insforge target", true, safeUrlContext(insforgeUrl));

  const admin = createAdminClient({
    baseUrl: insforgeUrl,
    apiKey: insforgeApiKey,
  });

  for (const slug of requiredFunctions) {
    try {
      const { error } = await admin.functions.invoke(slug, {
        body: {
          seller_id: sellerId,
          smoke: true,
          dry_run: true,
        },
      });

      if (error) {
        if (reachableError(error)) {
          printCheck(`function ${slug}`, true, `reachable HTTP ${statusCode(error)}`);
          continue;
        }

        if (missingFunction(error)) {
          throw new Error("missing function");
        }

        throw new Error(`HTTP ${statusCode(error) || "error"}`);
      }

      printCheck(`function ${slug}`, true, "dry-run accepted");
    } catch (error) {
      failures.push(slug);
      printCheck(`function ${slug}`, false, error.message);
    }
  }

  finish(failures);
}

main().catch((error) => {
  printCheck("smoke-insforge", false, error.message);
  process.exitCode = 1;
});
