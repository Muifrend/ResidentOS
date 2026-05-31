# ResidentOS

ResidentOS is the hackathon demo dashboard/API for a sponsor-centered apartment meal workflow:

```text
Telegram judge message
-> IronClaw onboarding
-> Zelle receipt screenshot
-> Tigris receipt artifact
-> NEAR AI receipt extraction
-> InsForge subscriber/payment state
-> realtime seller dashboard
-> manifest + delivery notifications
```

This repository is split across agent ownership. Agent D owns setup docs, deployment docs, smoke tests, and verification scripts only.

## Local Setup

1. Install Node 20 or newer.
2. Install dependencies:

   ```bash
   npm install
   ```

3. Create local env from placeholders:

   ```bash
   cp .env.example .env.local
   ```

4. Fill `.env.local` with local values. Keep `.env.local`, `.insforge/`, and service keys out of git.
5. Build-check the app:

   ```bash
   npm run build
   ```

6. Start the dashboard/API:

   ```bash
   npm run dev
   ```

7. Open `http://127.0.0.1:3000`.

The service binds to `PORT` and uses `0.0.0.0` on Render. Locally it defaults to `127.0.0.1`.

## Required Runtime Env

Set these for a live demo:

```text
DEMO_MODE=true
RESIDENTOS_SELLER_ID=demo-seller
RESIDENTOS_ZELLE_RECIPIENT_NAME=Cristian Rosca
RESIDENTOS_ZELLE_RECIPIENT_EMAIL=rosca.cris18@gmail.com
INSFORGE_URL
INSFORGE_BASE_URL        # optional local alias; Render should set INSFORGE_URL
INSFORGE_API_KEY
AWS_S3_BUCKET
AWS_ENDPOINT_URL_S3
AWS_REGION
AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY
NEAR_AI_BASE_URL
NEAR_AI_API_KEY
NEAR_AI_MODEL
```

`INSFORGE_API_KEY`, Tigris keys, NEAR AI keys, and Render keys are server-only secrets.

## Smoke Tests

All scripts redact secrets and print only pass/fail plus safe context.

```bash
node scripts/smoke-local.mjs
node scripts/smoke-insforge.mjs
node scripts/smoke-tigris.mjs
node scripts/smoke-near-ai.mjs
node scripts/e2e-rehearsal.mjs
```

Useful variants:

```bash
RESIDENTOS_DASHBOARD_URL=https://your-render-service.onrender.com node scripts/smoke-local.mjs --remote
node scripts/e2e-rehearsal.mjs --require-live
```

`smoke-insforge.mjs` probes the required function slugs with a dry-run smoke payload. A `400`/`422` response still proves the function is deployed and reachable; `404`, auth errors, and network failures are failures.

## Integration Contract

Agent A dashboard/API surfaces:

```text
GET  /api/health
GET  /api/dashboard
GET  /api/events
GET  /api/artifacts/presign?key=...
POST /api/actions/generate-manifest
POST /api/actions/delivery-status
POST /api/actions/review-payment
POST /api/actions/demo-seed              # DEMO_MODE=true only
POST /api/actions/demo-replay-receipt    # DEMO_MODE=true only
```

Agent B InsForge function slugs:

```text
record_payment_verification
generate_manifest
update_delivery_status
review_flagged_payment
demo_seed
demo_replay_receipt
```

Agent C artifact prefixes:

```text
payment-receipts/{seller_id}/{subscriber_id}/{timestamp}.png
order-manifests/{seller_id}/{date}.json
delivery-confirmations/{seller_id}/{order_id}/{timestamp}.json
seller-assets/{seller_id}/...
```

Dashboard receipt previews must use presigned URLs, never public bucket URLs.

## Render

Deploy as a Render Node Web Service. The blueprint in `render.yaml` documents the expected build/start commands and runtime env names. See [docs/render-deploy.md](docs/render-deploy.md) for the checklist.

## Demo Verification

Use [docs/verification.md](docs/verification.md) before judging. The primary rehearsal path is live Telegram through IronClaw; the demo seed/replay controls are fallback controls behind `DEMO_MODE=true`.
