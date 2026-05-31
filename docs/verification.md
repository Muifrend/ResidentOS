# ResidentOS Verification

Use this checklist for local, deployed, and live-demo verification. Do not print or paste secrets, signed URLs, receipt images, or raw model responses into shared logs.

## Local

```bash
node scripts/smoke-local.mjs
```

Expected:

- `npm run build` passes.
- `/api/health` returns `ok: true`.
- `/api/dashboard` returns JSON.
- Invalid artifact keys are rejected.

## InsForge

```bash
node scripts/smoke-insforge.mjs
```

Expected function slugs:

- `record_payment_verification`
- `generate_manifest`
- `update_delivery_status`
- `review_flagged_payment`
- `demo_seed`
- `demo_replay_receipt`

The script treats validation errors on a dry-run smoke payload as reachable. Auth failures, missing functions, and network errors fail.

## Tigris

```bash
node scripts/smoke-tigris.mjs
```

Expected:

- Put a temporary private artifact under `delivery-confirmations/{seller}/agent-d-smoke/...`.
- Head the object.
- Generate a presigned URL.
- Fetch the presigned URL.
- Delete the temporary object.

## NEAR AI

```bash
node scripts/smoke-near-ai.mjs
```

Expected fixture values from the Zelle receipt:

```text
recipient name: Cristian Rosca
recipient email: rosca.cris18@gmail.com
amount: $5.00
date: May 31, 2026
confirmation number: g2cwdpnn1
state: payment sent / success
```

The script validates normalized fields and does not print the raw response.

## End-To-End Rehearsal

```bash
node scripts/e2e-rehearsal.mjs --require-live
```

Then perform the live manual path:

1. Send `/start` to the IronClaw Telegram bot.
2. Complete onboarding with name, unit, and the `$5` tier.
3. Send the Zelle receipt screenshot.
4. Confirm the receipt lands in Tigris under `payment-receipts/`.
5. Confirm NEAR AI extraction matches the fixture.
6. Confirm InsForge records subscriber/payment state.
7. Watch the dashboard update without refresh.
8. Generate a manifest.
9. Mark delivery dispatched/delivered.
10. Confirm Telegram delivery notification behavior.

If Telegram remains in pairing mode, pre-pair demo accounts before judging and document the pairing step in the runbook for the demo operator.
