# Render Deploy Checklist

Deploy ResidentOS as one Render Node Web Service.

## Service

- Runtime: Node
- Build command: `npm install && npm run build`
- Start command: `npm start`
- Health check path: `/api/health`
- Branch: demo branch or main branch used for judging
- The app must bind to `process.env.PORT`

## Required Env Vars

Set these in the Render dashboard. Do not paste secret values into docs, tickets, or logs.

```text
NODE_VERSION=20
DEMO_MODE=true
RESIDENTOS_SELLER_ID=demo-seller
RESIDENTOS_ZELLE_RECIPIENT_NAME=Cristian Rosca
RESIDENTOS_ZELLE_RECIPIENT_EMAIL=rosca.cris18@gmail.com
INSFORGE_URL
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

Optional for deploy-time checks:

```text
INSFORGE_ANON_KEY
RESIDENTOS_DASHBOARD_URL
```

## Pre-Deploy Checks

Run locally:

```bash
npm install
npm run build
node scripts/smoke-local.mjs
node scripts/smoke-insforge.mjs
node scripts/smoke-tigris.mjs
node scripts/smoke-near-ai.mjs
```

All scripts should print only pass/fail and redacted context.

## Post-Deploy Checks

After Render reports a live URL:

```bash
RESIDENTOS_DASHBOARD_URL=https://your-service.onrender.com node scripts/smoke-local.mjs --remote
RESIDENTOS_DASHBOARD_URL=https://your-service.onrender.com node scripts/e2e-rehearsal.mjs --require-live
```

Open the dashboard and verify:

- `/api/health` returns `ok: true` without secret values.
- `/api/dashboard` returns InsForge or partial state.
- Receipt previews are generated through `/api/artifacts/presign`.
- Demo seed/replay controls are visible only when `DEMO_MODE=true`.
- Manifest and delivery controls call Agent B edge functions.

## Rollback

Keep the previous successful Render deploy available. If smoke checks fail after deploy:

1. Roll back to the previous deploy in Render.
2. Capture the failing script name, phase, and status code only.
3. Do not copy env values or signed URLs into the incident notes.
