import fs from "node:fs";
import { createReadStream } from "node:fs";
import { HeadObjectCommand, PutObjectCommand, S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export const ARTIFACT_PREFIXES = Object.freeze({
  paymentReceipts: "payment-receipts/",
  orderManifests: "order-manifests/",
  deliveryConfirmations: "delivery-confirmations/",
  sellerAssets: "seller-assets/",
});

let envLoaded = false;
let client;

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

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

export function createTigrisClient() {
  if (client) {
    return client;
  }

  client = new S3Client({
    endpoint: requiredEnv("AWS_ENDPOINT_URL_S3"),
    region: process.env.AWS_REGION || "auto",
    forcePathStyle: true,
    credentials: {
      accessKeyId: requiredEnv("AWS_ACCESS_KEY_ID"),
      secretAccessKey: requiredEnv("AWS_SECRET_ACCESS_KEY"),
    },
  });

  return client;
}

function sanitizeSegment(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function timestampSegment(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

export function assertAllowedArtifactKey(key) {
  const allowed = Object.values(ARTIFACT_PREFIXES).some((prefix) => key.startsWith(prefix));
  if (
    typeof key !== "string" ||
    !allowed ||
    key.includes("..") ||
    key.startsWith("/") ||
    key.includes("//")
  ) {
    throw new Error(`Artifact key is outside ResidentOS prefixes: ${key}`);
  }
}

export function paymentReceiptKey({
  sellerId,
  subscriberId,
  timestamp = new Date(),
  extension = "png",
}) {
  const ext = sanitizeSegment(extension).replace(/^\./, "") || "png";
  return `${ARTIFACT_PREFIXES.paymentReceipts}${sanitizeSegment(sellerId)}/${sanitizeSegment(
    subscriberId,
  )}/${timestampSegment(timestamp)}.${ext}`;
}

export function orderManifestKey({ sellerId, date = new Date() }) {
  const day = date instanceof Date ? date.toISOString().slice(0, 10) : sanitizeSegment(date);
  return `${ARTIFACT_PREFIXES.orderManifests}${sanitizeSegment(sellerId)}/${day}.json`;
}

export function deliveryConfirmationKey({
  sellerId,
  orderId,
  timestamp = new Date(),
}) {
  return `${ARTIFACT_PREFIXES.deliveryConfirmations}${sanitizeSegment(sellerId)}/${sanitizeSegment(
    orderId,
  )}/${timestampSegment(timestamp)}.json`;
}

export function sellerAssetKey({ sellerId, name }) {
  return `${ARTIFACT_PREFIXES.sellerAssets}${sanitizeSegment(sellerId)}/${sanitizeSegment(name)}`;
}

export async function uploadArtifact({
  key,
  body,
  contentType = "application/octet-stream",
  bucket = process.env.AWS_S3_BUCKET || "residentos-artifacts",
}) {
  assertAllowedArtifactKey(key);
  await createTigrisClient().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      Metadata: {
        app: "residentos",
      },
    }),
  );
  return { bucket, key };
}

export async function uploadReceiptFile({
  filePath,
  sellerId,
  subscriberId,
  timestamp = new Date(),
  bucket,
}) {
  const key = paymentReceiptKey({
    sellerId,
    subscriberId,
    timestamp,
    extension: filePath.endsWith(".jpg") || filePath.endsWith(".jpeg") ? "jpg" : "png",
  });
  return uploadArtifact({
    key,
    bucket,
    body: createReadStream(filePath),
    contentType: key.endsWith(".jpg") ? "image/jpeg" : "image/png",
  });
}

export async function uploadJsonArtifact({ key, value, bucket }) {
  return uploadArtifact({
    key,
    bucket,
    body: JSON.stringify(value, null, 2),
    contentType: "application/json",
  });
}

export async function headArtifact({
  key,
  bucket = process.env.AWS_S3_BUCKET || "residentos-artifacts",
}) {
  assertAllowedArtifactKey(key);
  return createTigrisClient().send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
}

export async function presignArtifactUrl({
  key,
  bucket = process.env.AWS_S3_BUCKET || "residentos-artifacts",
  expiresIn = 300,
}) {
  assertAllowedArtifactKey(key);
  return getSignedUrl(
    createTigrisClient(),
    new GetObjectCommand({ Bucket: bucket, Key: key }),
    { expiresIn },
  );
}

