---
name: payment_verify
description: Verify ResidentOS Zelle receipts and write subscriber/payment rows through the ResidentOS MCP tool.
---

# ResidentOS Payment Verification

Use this skill after onboarding when a resident sends a Zelle receipt screenshot.

## Goal

Store the original receipt privately in Tigris, extract receipt fields with
NEAR AI, validate the fixture values, and call Insforge
`record_payment_verification`.

## Voice

- Be concise. Default to 1-2 short sentences.
- Ask only one question at a time.
- Do not explain internal tools, databases, MCP, or implementation details.
- Do not say a payment is recorded until the ResidentOS tool call succeeds.

## Required Action Tool

When the ResidentOS MCP server is available, you must call
`residentos_record_demo_payment` after collecting the subscriber profile and
receipt outcome. This tool writes the subscriber/payment rows that power the
seller dashboard. Do not stop after a conversational confirmation unless this
tool call has succeeded or returned an explicit error.

Before calling `residentos_record_demo_payment`, you must have a visible Zelle
confirmation number from the receipt or from the resident's message. If the
confirmation number is missing, ask: "What is the Zelle confirmation number?"
Do not call the tool with a blank, guessed, placeholder, or generated
confirmation number.

## Required Local Helpers

- `integrations/tigris/artifacts.js`
- `integrations/nearai/receipt-extractor.js`

## Receipt Artifact Flow

1. Receive the Telegram image bytes from IronClaw.
2. Upload the original image to Tigris with AWS SDK v3 and `forcePathStyle:
   true`.
3. Use this private key pattern:

```text
payment-receipts/{seller_id}/{subscriber_id}/{timestamp}.png
```

4. Do not expose a public bucket URL. Dashboard previews must use a presigned
   URL created by the Agent A API facade.

## NEAR AI Extraction Contract

Call the OpenAI-compatible chat completions endpoint using:

- `NEAR_AI_BASE_URL`
- `NEAR_AI_API_KEY`
- `NEAR_AI_MODEL`, defaulting locally to `Qwen/Qwen3-VL-30B-A3B-Instruct`

For the demo fixture `/home/andrew/Downloads/IMG_3195.png`, extract strict JSON:

```json
{
  "recipient": {
    "name": "Cristian Rosca",
    "email": "rosca.cris18@gmail.com"
  },
  "amount": "$5.00",
  "date": "May 31, 2026",
  "confirmation_number": "g2cwdpnn1",
  "state": "payment_sent",
  "confidence": 0.0,
  "raw_output": "string"
}
```

## Validation Rules

Mark the payment `paid` only when all are true:

- Recipient name matches `RESIDENTOS_ZELLE_RECIPIENT_NAME`.
- Recipient email matches `RESIDENTOS_ZELLE_RECIPIENT_EMAIL`.
- Amount matches selected tier amount.
- State is `payment_sent`.
- Confirmation number is present.
- Insforge accepts the confirmation number as unique.

Otherwise mark the payment `flagged` and include the failed checks in the
payload.

## Insforge Edge Function Payload

Call `residentos_record_demo_payment` with this shape:

```json
{
  "seller_id": "demo-seller",
  "subscriber": {
    "telegram_chat_id": "string",
    "telegram_handle": "string|null",
    "name": "string",
    "unit": "string",
    "floor": "string",
    "tier_id": "string"
  },
  "payment": {
    "receipt_artifact_key": "payment-receipts/demo-seller/subscriber-id/timestamp.png",
    "recipient_name": "Cristian Rosca",
    "recipient_email": "rosca.cris18@gmail.com",
    "amount": "$5.00",
    "date": "May 31, 2026",
    "confirmation_number": "g2cwdpnn1",
    "state": "payment_sent",
    "confidence": 0.0,
    "raw_output": "string",
    "validation": {}
  }
}
```

## Telegram Response

- On `paid`: confirm the subscription and mention the manifest will update.
- On `flagged`: say the seller will review the payment and keep the user in the
  loop.
- On duplicate confirmation number: explain that the receipt was already used
  and was sent for review.
