#!/usr/bin/env node
import fs from "node:fs";
import {
  finish,
  loadEnv,
  normalizeText,
  printCheck,
  requiredEnv,
  safeUrlContext,
} from "./lib/env.mjs";

loadEnv();

const failures = [];
const fixturePath =
  process.env.RESIDENTOS_RECEIPT_FIXTURE_PATH || "/home/andrew/Downloads/IMG_3195.png";

function joinUrl(base, path) {
  return `${String(base).replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function parseJsonContent(content) {
  const text = String(content || "").trim();
  const withoutFence = text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  try {
    return JSON.parse(withoutFence);
  } catch {
    const start = withoutFence.indexOf("{");
    if (start === -1) {
      throw new Error("response did not contain JSON");
    }

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = start; index < withoutFence.length; index += 1) {
      const char = withoutFence[index];

      if (escaped) {
        escaped = false;
        continue;
      }

      if (char === "\\") {
        escaped = inString;
        continue;
      }

      if (char === '"') {
        inString = !inString;
        continue;
      }

      if (inString) {
        continue;
      }

      if (char === "{") {
        depth += 1;
      } else if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          return JSON.parse(withoutFence.slice(start, index + 1));
        }
      }
    }

    throw new Error("response did not contain a complete JSON object");
  }
}

function valueMatches(actual, expected) {
  return normalizeText(actual).includes(normalizeText(expected));
}

function amountMatches(actual) {
  const text = normalizeText(actual).replace(/[$,\s]/g, "");
  return text === "5.00" || text === "5" || text.includes("500");
}

function stateMatches(actual) {
  const text = normalizeText(actual);
  return text.includes("sent") || text.includes("success") || text.includes("completed");
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
  const missing = requiredEnv(["NEAR_AI_BASE_URL", "NEAR_AI_API_KEY"]);
  if (missing.length) {
    for (const name of missing) {
      failures.push(name);
      printCheck(`env ${name}`, false, "missing");
    }
    finish(failures);
    return;
  }

  await check("near ai target", async () => safeUrlContext(process.env.NEAR_AI_BASE_URL));

  let model = process.env.NEAR_AI_MODEL;
  if (!model) {
    await check("near ai model", async () => {
      const response = await fetch(joinUrl(process.env.NEAR_AI_BASE_URL, "models"), {
        headers: {
          Authorization: `Bearer ${process.env.NEAR_AI_API_KEY}`,
        },
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const body = await response.json();
      const models = Array.isArray(body?.data) ? body.data : [];
      const candidate =
        models.find((item) => {
          const id = String(item.id || item.name || "").toLowerCase();
          return id.includes("qwen3-vl") || id.includes("vl-");
        }) ||
        models.find((item) => {
          const text = JSON.stringify(item).toLowerCase();
          return text.includes("vision") || text.includes("image");
        });
      model = candidate?.id;
      if (!model) {
        throw new Error("NEAR_AI_MODEL missing and no vision model was discoverable");
      }
      return "auto-discovered vision model";
    });
  } else {
    await check("near ai model", async () => "configured");
  }

  await check("receipt fixture", async () => {
    if (!fs.existsSync(fixturePath)) {
      throw new Error("fixture image is missing");
    }
    return "fixture image found";
  });

  const image = fs.readFileSync(fixturePath);
  const endpoint = joinUrl(process.env.NEAR_AI_BASE_URL, "chat/completions");

  let extraction;
  await check("receipt extraction", async () => {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.NEAR_AI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "Extract Zelle receipt fields. Return only strict JSON with keys recipient_name, recipient_email, amount, date, confirmation_number, state.",
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text:
                  "Extract the payment receipt fields. Use null for fields that are not visible.",
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:image/png;base64,${image.toString("base64")}`,
                },
              },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const body = await response.json();
    const content = body?.choices?.[0]?.message?.content;
    extraction = parseJsonContent(content);
    return "strict JSON parsed";
  });

  if (extraction) {
    await check("recipient name", async () => {
      if (!valueMatches(extraction.recipient_name, "Cristian Rosca")) {
        throw new Error("unexpected value");
      }
      return "matches fixture";
    });

    await check("recipient email", async () => {
      if (!valueMatches(extraction.recipient_email, "rosca.cris18@gmail.com")) {
        throw new Error("unexpected value");
      }
      return "matches fixture";
    });

    await check("amount", async () => {
      if (!amountMatches(extraction.amount)) {
        throw new Error("unexpected value");
      }
      return "matches $5.00 fixture";
    });

    await check("date", async () => {
      if (!valueMatches(extraction.date, "May 31, 2026")) {
        throw new Error("unexpected value");
      }
      return "matches fixture";
    });

    await check("confirmation number", async () => {
      if (!valueMatches(extraction.confirmation_number, "g2cwdpnn1")) {
        throw new Error("unexpected value");
      }
      return "matches fixture";
    });

    await check("payment state", async () => {
      if (!stateMatches(extraction.state)) {
        throw new Error("unexpected value");
      }
      return "sent/success";
    });
  }

  finish(failures);
}

main().catch((error) => {
  printCheck("smoke-near-ai", false, error.message);
  process.exitCode = 1;
});
