import fs from "node:fs";

const envLoaded = new Set();

export function loadLocalEnv(filePath = ".env.local") {
  if (envLoaded.has(filePath) || !fs.existsSync(filePath)) {
    return;
  }

  envLoaded.add(filePath);
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

loadLocalEnv();

export const config = {
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || (process.env.RENDER ? "0.0.0.0" : "127.0.0.1"),
  demoMode: process.env.DEMO_MODE === "true",
  sellerId: process.env.RESIDENTOS_SELLER_ID || "demo-seller",
  zelleRecipientName:
    process.env.RESIDENTOS_ZELLE_RECIPIENT_NAME || "Cristian Rosca",
  zelleRecipientEmail:
    process.env.RESIDENTOS_ZELLE_RECIPIENT_EMAIL || "rosca.cris18@gmail.com",
  insforge: {
    baseUrl:
      process.env.INSFORGE_URL ||
      process.env.NEXT_PUBLIC_INSFORGE_URL ||
      process.env.VITE_INSFORGE_URL ||
      "https://p5twwd93.us-east.insforge.app",
    apiKey: process.env.INSFORGE_API_KEY || process.env.INSFORGE_SERVICE_KEY || "",
    anonKey:
      process.env.INSFORGE_ANON_KEY ||
      process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY ||
      process.env.VITE_INSFORGE_ANON_KEY ||
      "",
  },
  tigris: {
    bucket: process.env.AWS_S3_BUCKET || "residentos-artifacts",
    endpoint: process.env.AWS_ENDPOINT_URL_S3 || "",
    region: process.env.AWS_REGION || "auto",
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
  },
};

export function publicConfig() {
  return {
    demoMode: config.demoMode,
    sellerId: config.sellerId,
    zelleRecipientName: config.zelleRecipientName,
    zelleRecipientEmail: config.zelleRecipientEmail,
    insforgeBaseUrl: config.insforge.baseUrl,
    missingServerEnv: missingServerEnv(),
  };
}

export function missingServerEnv() {
  const missing = [];

  if (!config.insforge.baseUrl) missing.push("INSFORGE_URL");
  if (!config.insforge.apiKey) missing.push("INSFORGE_API_KEY");
  if (!config.tigris.endpoint) missing.push("AWS_ENDPOINT_URL_S3");
  if (!config.tigris.accessKeyId) missing.push("AWS_ACCESS_KEY_ID");
  if (!config.tigris.secretAccessKey) missing.push("AWS_SECRET_ACCESS_KEY");

  return missing;
}
