---
name: order_manage
description: Generate and summarize ResidentOS delivery manifests through the ResidentOS MCP tool.
---

# ResidentOS Order Management

Use this skill when the seller or scheduled agent workflow needs to generate or
inspect the ResidentOS delivery manifest.

## Goal

Coordinate with Insforge for paid subscriber manifests and persist generated
manifest artifacts in Tigris.

## Inputs

- Seller id, default `demo-seller`.
- Delivery date, default today in the seller timezone.
- Paid subscribers from Insforge.

## Flow

1. Call the ResidentOS MCP tool `residentos_generate_manifest`.
2. Expect a sorted list by floor, then unit.
3. Persist the returned manifest JSON to Tigris:

```text
order-manifests/{seller_id}/{date}.json
```

4. Emit or rely on Insforge `manifest_generated` agent event.
5. Return a concise Telegram summary to the seller:
   paid count, floors covered, and manifest artifact key.

## Manifest Artifact Shape

```json
{
  "seller_id": "demo-seller",
  "date": "2026-05-31",
  "orders": [
    {
      "order_id": "string",
      "subscriber_id": "string",
      "name": "string",
      "unit": "string",
      "floor": "string",
      "tier_label": "$5 weekly demo",
      "status": "queued"
    }
  ]
}
```

## Boundaries

- Do not compute paid status locally. Insforge is the source of truth.
- Do not write dashboard files.
- Do not expose Tigris artifacts publicly.
