#!/usr/bin/env node
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { fetchJson } from "./lib/http.mjs";
import {
  finish,
  loadEnv,
  printCheck,
  printSkip,
  requiredEnv,
  safeUrlContext,
} from "./lib/env.mjs";

loadEnv();

const failures = [];
const sellerId = process.env.RESIDENTOS_SELLER_ID || "demo-seller";
const bucket = process.env.AWS_S3_BUCKET || "residentos-artifacts";
const key = `delivery-confirmations/${sellerId}/agent-d-smoke/${Date.now()}.json`;

function client() {
  return new S3Client({
    endpoint: process.env.AWS_ENDPOINT_URL_S3,
    region: process.env.AWS_REGION || "auto",
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
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
  const missing = requiredEnv([
    "AWS_ENDPOINT_URL_S3",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
  ]);

  if (missing.length) {
    for (const name of missing) {
      failures.push(name);
      printCheck(`env ${name}`, false, "missing");
    }
    finish(failures);
    return;
  }

  const s3 = client();
  let uploaded = false;
  let presignedUrl = "";

  try {
    await check("tigris target", async () => safeUrlContext(process.env.AWS_ENDPOINT_URL_S3));

    await check("artifact put", async () => {
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: JSON.stringify({
            smoke: true,
            seller_id: sellerId,
            created_at: new Date().toISOString(),
          }),
          ContentType: "application/json",
        }),
      );
      uploaded = true;
      return "temporary object uploaded";
    });

    await check("artifact head", async () => {
      await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      return "temporary object exists";
    });

    await check("artifact presign", async () => {
      presignedUrl = await getSignedUrl(
        s3,
        new GetObjectCommand({ Bucket: bucket, Key: key }),
        { expiresIn: 120 },
      );
      if (!presignedUrl.startsWith("http")) {
        throw new Error("presigned URL was not generated");
      }
      return "signed URL generated";
    });

    await check("presigned fetch", async () => {
      const result = await fetch(presignedUrl);
      if (!result.ok) {
        throw new Error(`HTTP ${result.status}`);
      }
      return "temporary object readable through signed URL";
    });

    if (process.env.RESIDENTOS_DASHBOARD_URL) {
      await check("dashboard presign facade", async () => {
        const result = await fetchJson(
          `${process.env.RESIDENTOS_DASHBOARD_URL}/api/artifacts/presign?key=${encodeURIComponent(key)}`,
        );
        if (!result.ok || !result.body?.url) {
          throw new Error(`HTTP ${result.status}`);
        }
        return "facade returned signed URL";
      });
    } else {
      printSkip("dashboard presign facade", "RESIDENTOS_DASHBOARD_URL not set");
    }
  } finally {
    if (uploaded) {
      try {
        await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
        printCheck("artifact cleanup", true, "temporary object deleted");
      } catch {
        failures.push("artifact cleanup");
        printCheck("artifact cleanup", false, "temporary object delete failed");
      }
    }
  }

  finish(failures);
}

main().catch((error) => {
  printCheck("smoke-tigris", false, error.message);
  process.exitCode = 1;
});
