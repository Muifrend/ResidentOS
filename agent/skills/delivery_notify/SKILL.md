---
name: delivery_notify
description: Send concise ResidentOS delivery progress updates to residents.
---

# ResidentOS Delivery Notify

Use this skill when Insforge or the dashboard reports delivery progress.

## Goal

Notify residents in Telegram when their floor or order is dispatched or
delivered.

## Event Inputs

Listen for Insforge `agent_events` or direct workflow calls with:

```json
{
  "type": "delivery_updated",
  "seller_id": "demo-seller",
  "order_id": "string|null",
  "floor": "string|null",
  "status": "dispatched|delivered",
  "telegram_chat_ids": ["string"]
}
```

## Flow

1. Match the event to subscriber chat ids.
2. Send a short status update through Telegram.
3. If a confirmation artifact is produced, store it in Tigris:

```text
delivery-confirmations/{seller_id}/{order_id}/{timestamp}.json
```

4. Never include private presigned URLs in Telegram unless the seller explicitly
   requests them for a short-lived admin review.

## Message Templates

Dispatched:

```text
Your ResidentOS order is out for delivery on floor {floor}.
```

Delivered:

```text
Your ResidentOS order was marked delivered. Reply here if anything looks off.
```

## Pairing Caveat

If `locallebot` remains in IronClaw pairing mode, notifications only work for
paired demo chats. Pre-pair judge accounts before the live demo or switch the
Telegram channel to open DM mode if the deployed IronClaw runtime supports it.

