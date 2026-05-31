#!/usr/bin/env node
import {
  headArtifact,
  loadLocalEnv,
  presignArtifactUrl,
  uploadReceiptFile,
} from "../../integrations/tigris/artifacts.js";

loadLocalEnv();

const filePath = process.argv[2] || "/home/andrew/Downloads/IMG_3195.png";
const sellerId = process.env.RESIDENTOS_SELLER_ID || "demo-seller";
const subscriberId = process.env.RESIDENTOS_DEMO_SUBSCRIBER_ID || "demo-subscriber";

try {
  const uploaded = await uploadReceiptFile({ filePath, sellerId, subscriberId });
  const head = await headArtifact({ key: uploaded.key });
  const presignedUrl = await presignArtifactUrl({ key: uploaded.key, expiresIn: 120 });

  console.log(
    JSON.stringify(
      {
        bucket: uploaded.bucket,
        key: uploaded.key,
        content_length: head.ContentLength,
        presigned_url_created: Boolean(presignedUrl),
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

