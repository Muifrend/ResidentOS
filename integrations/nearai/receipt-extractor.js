import fs from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_RECEIPT_PATH = "/home/andrew/Downloads/IMG_3195.png";
const DEFAULT_MODEL = "Qwen/Qwen3-VL-30B-A3B-Instruct";

const EXPECTED_RECEIPT = {
  recipientName: "Cristian Rosca",
  recipientEmail: "rosca.cris18@gmail.com",
  amount: "$5.00",
  date: "May 31, 2026",
  confirmationNumber: "g2cwdpnn1",
};

let envLoaded = false;

export function loadLocalEnv(filePath = ".env.local") {
  if (envLoaded || !fs.existsSync(filePath)) {
    return;
  }

  envLoaded = true;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      continue;
    }

    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function chatCompletionsUrl(baseUrl) {
  const clean = baseUrl.replace(/\/+$/, "");
  if (clean.endsWith("/chat/completions")) {
    return clean;
  }
  if (clean.endsWith("/v1")) {
    return `${clean}/chat/completions`;
  }
  return `${clean}/v1/chat/completions`;
}

function mimeTypeFor(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  return "image/png";
}

export function extractJsonObject(text) {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    if (start === -1) {
      throw new Error("NEAR AI response did not contain a JSON object.");
    }

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = start; index < trimmed.length; index += 1) {
      const char = trimmed[index];

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
          return JSON.parse(trimmed.slice(start, index + 1));
        }
      }
    }

    throw new Error("NEAR AI response did not contain a complete JSON object.");
  }
}

function normalizeState(value) {
  const text = String(value || "").toLowerCase();
  if (text.includes("sent") || text.includes("success") || text.includes("complete")) {
    return "payment_sent";
  }
  if (text.includes("pending")) return "pending";
  if (text.includes("fail") || text.includes("declin")) return "failed";
  return "unknown";
}

function normalizeAmount(value) {
  const text = String(value || "").trim();
  const match = text.match(/\$?\s*(\d+(?:\.\d{1,2})?)/);
  if (!match) return text;
  return `$${Number(match[1]).toFixed(2)}`;
}

function normalizeExtraction(parsed, rawOutput) {
  return {
    recipient: {
      name: parsed?.recipient?.name ?? parsed?.recipient_name ?? "",
      email: parsed?.recipient?.email ?? parsed?.recipient_email ?? "",
    },
    amount: normalizeAmount(parsed?.amount ?? ""),
    date: parsed?.date ?? "",
    confirmation_number:
      parsed?.confirmation_number ?? parsed?.confirmationNumber ?? "",
    state: normalizeState(parsed?.state ?? parsed?.payment_state ?? ""),
    confidence: Number(parsed?.confidence ?? 0),
    raw_output: rawOutput,
  };
}

function validateFixture(extraction) {
  const amountOk = normalizeAmount(extraction.amount) === EXPECTED_RECEIPT.amount;
  const stateOk = extraction.state === "payment_sent";

  return {
    expected: EXPECTED_RECEIPT,
    checks: {
      recipient_name:
        extraction.recipient.name.toLowerCase() ===
        EXPECTED_RECEIPT.recipientName.toLowerCase(),
      recipient_email:
        extraction.recipient.email.toLowerCase() ===
        EXPECTED_RECEIPT.recipientEmail.toLowerCase(),
      amount: amountOk,
      date: String(extraction.date).toLowerCase() === EXPECTED_RECEIPT.date.toLowerCase(),
      confirmation_number:
        String(extraction.confirmation_number).toLowerCase() ===
        EXPECTED_RECEIPT.confirmationNumber,
      state: stateOk,
    },
  };
}

export async function extractReceiptFromImage({
  imagePath = DEFAULT_RECEIPT_PATH,
  baseUrl = process.env.NEAR_AI_BASE_URL,
  apiKey = process.env.NEAR_AI_API_KEY,
  model = process.env.NEAR_AI_MODEL || DEFAULT_MODEL,
} = {}) {
  if (!baseUrl) {
    throw new Error("NEAR_AI_BASE_URL is required.");
  }
  if (!apiKey) {
    throw new Error("NEAR_AI_API_KEY is required.");
  }

  const bytes = await readFile(imagePath);
  const dataUrl = `data:${mimeTypeFor(imagePath)};base64,${bytes.toString("base64")}`;

  const response = await fetch(chatCompletionsUrl(baseUrl), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Extract Zelle receipt details. Return only one strict JSON object. Do not include markdown.",
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                "Read this payment receipt image and return JSON with exactly: recipient.name, recipient.email, amount, date, confirmation_number, state, confidence. The state must be one of payment_sent, pending, failed, unknown.",
            },
            {
              type: "image_url",
              image_url: { url: dataUrl },
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`NEAR AI receipt extraction failed with HTTP ${response.status}: ${body}`);
  }

  const payload = await response.json();
  const rawOutput = payload?.choices?.[0]?.message?.content;
  if (!rawOutput) {
    throw new Error("NEAR AI response did not include choices[0].message.content.");
  }

  const extraction = normalizeExtraction(extractJsonObject(rawOutput), rawOutput);
  return {
    model,
    image_path: imagePath,
    extraction,
    validation: validateFixture(extraction),
  };
}

async function main() {
  loadLocalEnv();
  const imagePath = process.argv[2] || DEFAULT_RECEIPT_PATH;
  const result = await extractReceiptFromImage({ imagePath });
  console.log(JSON.stringify(result, null, 2));
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;

if (invokedPath && import.meta.url === invokedPath) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
