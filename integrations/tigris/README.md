# Tigris Artifact Helpers

Agent C owns these helpers for IronClaw receipt, manifest, delivery, and seller
asset artifacts. They use AWS SDK v3 with `forcePathStyle: true`.

## Prefixes

```text
payment-receipts/{seller_id}/{subscriber_id}/{timestamp}.png
order-manifests/{seller_id}/{date}.json
delivery-confirmations/{seller_id}/{order_id}/{timestamp}.json
seller-assets/{seller_id}/...
```

## Smoke Command

```bash
node scripts/agent-c/tigris-smoke.js /home/andrew/Downloads/IMG_3195.png
```

The command uploads the receipt fixture, reads object metadata, and verifies a
presigned URL can be generated. It prints only bucket, key, object length, and a
boolean for URL creation.

Required env:

```text
AWS_S3_BUCKET=residentos-artifacts
AWS_ENDPOINT_URL_S3=...
AWS_REGION=auto
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
```

