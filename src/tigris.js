import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { config } from "./config.js";

const allowedPrefixes = [
  "payment-receipts/",
  "order-manifests/",
  "delivery-confirmations/",
  "seller-assets/",
];

let client;

function getClient() {
  if (client) {
    return client;
  }

  if (
    !config.tigris.endpoint ||
    !config.tigris.accessKeyId ||
    !config.tigris.secretAccessKey
  ) {
    throw new Error("Tigris credentials are not configured.");
  }

  client = new S3Client({
    endpoint: config.tigris.endpoint,
    region: config.tigris.region,
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.tigris.accessKeyId,
      secretAccessKey: config.tigris.secretAccessKey,
    },
  });

  return client;
}

export function isAllowedArtifactKey(key) {
  return (
    typeof key === "string" &&
    !key.includes("..") &&
    allowedPrefixes.some((prefix) => key.startsWith(prefix))
  );
}

export async function createPresignedArtifactUrl(key, expiresIn = 300) {
  if (!isAllowedArtifactKey(key)) {
    const error = new Error("Artifact key is outside ResidentOS prefixes.");
    error.statusCode = 400;
    throw error;
  }

  return getSignedUrl(
    getClient(),
    new GetObjectCommand({
      Bucket: config.tigris.bucket,
      Key: key,
    }),
    { expiresIn },
  );
}
