# ResidentOS Hackathon Implementation Plan

## Summary

Build a live sponsor-centered demo where a judge texts the IronClaw Telegram bot, completes onboarding, sends the provided Zelle receipt screenshot, and watches the seller dashboard update in real time.

Core demo flow:

```text
Telegram judge message
-> IronClaw onboarding
-> Zelle receipt screenshot
-> Tigris receipt artifact
-> NEAR AI private receipt extraction
-> Insforge subscriber/payment state
-> everything-dev dashboard realtime update
-> manifest + delivery notifications
```

Sponsor roles:

- **IronClaw**: deployed agent runtime on NEAR AI Cloud; owns Telegram and autonomous workflow execution.
- **NEAR AI**: private OpenAI-compatible vision inference for receipt extraction.
- **Insforge**: source of truth for subscribers, payments, manifests, realtime dashboard updates, and edge functions.
- **Tigris**: private S3-compatible artifact store for receipts, manifests, and delivery confirmations.
- **Render**: deployment target for the everything-dev dashboard/API web service.

## Verified Readiness

Local repo and deploy path:

- Git repo is valid and has remote `https://github.com/Muifrend/ResidentOS.git`.
- `.env.local`, `.insforge/`, and `node_modules/` are ignored by git.
- Demo receipt exists at `/home/andrew/Downloads/IMG_3195.png`.
- SSH key exists at `~/Downloads/agent-private-key.pem` with `400` permissions.

Insforge:

- `.insforge/project.json` is linked to project `a47eea92-7b1f-411f-abb5-e01acaaab8f0`.
- App key is `p5twwd93`, region is `us-east`, host is `https://p5twwd93.us-east.insforge.app`.
- `npx --yes @insforge/cli --version` returns `0.1.86`.

NEAR AI:

- `.env.local` contains `NEAR_AI_API_KEY` and `NEAR_AI_BASE_URL`.
- `GET $NEAR_AI_BASE_URL/models` returned HTTP `200`.

Tigris:

- `.env.local` contains `AWS_S3_BUCKET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_ENDPOINT_URL_S3`, `AWS_ENDPOINT_URL_IAM`, and `AWS_REGION`.
- Bucket access to `residentos-artifacts` is verified.
- Object `PutObject`, `HeadObject`, and `DeleteObject` smoke test passed.
- Implementation must use AWS SDK v3 with `forcePathStyle: true`.

Render:

- `.env.local` contains `RENDER_API_KEY`.
- Render API access returned HTTP `200`.
- Render CLI is installed at `/home/andrew/.local/bin/render`, version `2.19.0`.
- Render workspace access is verified for `My Workspace`.

IronClaw:

- SSH access works:

```bash
ssh -i ~/Downloads/agent-private-key.pem -p 21981 agent@baremetal3.agents.near.ai
```

- Remote `ironclaw` binary exists at `/usr/local/bin/ironclaw`.
- Remote IronClaw version is `0.28.2`.
- Agent process is running as `ironclaw run --no-onboard`.
- Telegram channel files exist:
  - `/home/agent/.ironclaw/channels/telegram.capabilities.json`
  - `/home/agent/.ironclaw/channels/telegram.wasm`
- `ironclaw channels list --json` reports Telegram enabled as a WASM channel.
- User confirmed Telegram bot replied.
- Telegram bot username is `locallebot`.

Current IronClaw Telegram config caveat:

- `ironclaw channels list --verbose` reports Telegram using default config.
- Static capability config currently shows:
  - `dm_policy: "pairing"`
  - `polling_enabled: false`
  - `poll_interval_ms: 30000`
  - `bot_username: null`
  - `allow_polling: true`
  - `min_poll_interval_ms: 30000`
- This means Telegram is installed/enabled and responded, but the demo-specific open-DM/polling config is not yet reflected in the static capability file.

## Implementation Plan

### 1. Scaffold everything-dev dashboard/API

- Scaffold an everything-dev app in this repo while preserving `residentos_plan.md`, `PLAN.md`, and `AGENTS.md`.
- Use one Render **Node Web Service** for the hackathon demo.
- Keep the dashboard thin:
  - UI renders operational state.
  - API facade calls Insforge edge functions and generates Tigris presigned URLs.
  - No Telegram bot server runs on Render.
- Add `.env.example`, README setup steps, and smoke scripts.

### 2. Insforge backend

Create schema for:

- `sellers`: seeded seller, building label, Zelle recipient name/email.
- `tiers`: hard-coded demo tiers, including `$5`.
- `subscribers`: Telegram handle/chat id, name, unit, floor, tier, status.
- `payments`: receipt artifact key, extracted fields, status, confidence, confirmation number.
- `orders`: generated manifest rows and delivery status.
- `agent_events`: audit log for the dashboard event stream.

Create edge functions:

- `record_payment_verification`: upsert subscriber/payment, reject duplicate confirmation numbers, mark paid or flagged.
- `generate_manifest`: build sorted manifest from paid subscribers.
- `update_delivery_status`: mark floor/order dispatched or delivered.
- `review_flagged_payment`: seller approve/reject flow.
- `demo_seed` and `demo_replay_receipt`: hidden fallback controls behind `DEMO_MODE=true`.

Realtime:

- Dashboard subscribes to seller-scoped changes.
- Edge functions emit `subscriber_paid`, `payment_flagged`, `manifest_generated`, and `delivery_updated` events.

### 3. Tigris artifact storage

Use AWS SDK v3:

```ts
new S3Client({
  endpoint: process.env.AWS_ENDPOINT_URL_S3,
  region: process.env.AWS_REGION ?? "auto",
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});
```

Use private bucket `residentos-artifacts` with prefixes:

- `payment-receipts/{seller_id}/{subscriber_id}/{timestamp}.png`
- `order-manifests/{seller_id}/{date}.json`
- `delivery-confirmations/{seller_id}/{order_id}/{timestamp}.json`
- `seller-assets/{seller_id}/...`

Dashboard receipt previews must use presigned URLs, not public bucket URLs.

### 4. NEAR AI receipt extraction

- Use `NEAR_AI_BASE_URL` and `NEAR_AI_API_KEY` from env.
- Add `NEAR_AI_MODEL` to `.env.example`; default to a vision-capable model available from the verified NEAR AI account.
- Implement strict JSON extraction from `/home/andrew/Downloads/IMG_3195.png`.
- Expected fixture extraction:
  - recipient name: `Cristian Rosca`
  - recipient email: `rosca.cris18@gmail.com`
  - amount: `$5.00`
  - date: `May 31, 2026`
  - confirmation number: `g2cwdpnm1`
  - state: payment sent / success
- Store raw extraction output and validation result in Insforge.

### 5. IronClaw agent and Telegram workflow

Create local assets for the deployed IronClaw host:

- `agent/skills/residentos_onboarding/SKILL.md`
- `agent/skills/payment_verify/SKILL.md`
- `agent/skills/order_manage/SKILL.md`
- `agent/skills/delivery_notify/SKILL.md`
- Optional `agent/tools/residentos_api/` only if an explicit WASM wrapper is needed.

Agent behavior:

- `/start` begins onboarding.
- Collect name, room/unit, and selected hard-coded tier.
- Capture Telegram handle/chat id from message metadata.
- Ask for Zelle receipt screenshot.
- Store original receipt in Tigris.
- Extract receipt fields with NEAR AI.
- Validate recipient, amount, date, success state, and confirmation number uniqueness.
- Call Insforge `record_payment_verification`.
- Confirm paid or flagged state in Telegram.
- React to dashboard delivery events by notifying matching floor/subscribers.

Telegram config target for demo:

- Keep Telegram as the enabled WASM channel.
- Use bot username `locallebot`.
- Prefer open DMs for judging if IronClaw supports it:
  - `dm_policy: "open"`
- Use polling only if the runtime supports it for this deployed setup:
  - `polling_enabled: true`
  - `poll_interval_ms: 30000`
- If default pairing mode remains required, document a quick pairing workflow and pre-pair demo accounts before judging.

### 6. Dashboard surfaces

Build an operational dashboard, not a marketing page:

- **Ops Home**: live agent event stream and current demo status.
- **Subscribers**: name, unit, floor, Telegram handle, tier, paid/flagged status.
- **Payments**: receipt preview, extracted fields, verification status, approve/reject.
- **Manifest**: sorted floor/unit delivery list, generate button, dispatched/delivered controls.
- **Revenue**: paid count and weekly total.

Dashboard rules:

- Read Insforge state and realtime updates.
- Use API facade for seller decisions and presigned URL generation.
- Keep business logic in Insforge functions and IronClaw skills.
- Hide replay/seed controls behind `DEMO_MODE=true`.

### 7. Render deployment

- Deploy as a Render **Web Service** with **Node** runtime.
- Use one service for the everything-dev host/API.
- Bind to `process.env.PORT`.
- Set envs in Render:
  - Insforge project/base URL/API key/app key.
  - Tigris AWS S3 envs.
  - NEAR AI envs only if dashboard fallback extraction is enabled.
  - `DEMO_MODE=true`.
  - `RESIDENTOS_SELLER_ID=demo-seller`.
  - `RESIDENTOS_ZELLE_RECIPIENT_NAME=Cristian Rosca`.
  - `RESIDENTOS_ZELLE_RECIPIENT_EMAIL=rosca.cris18@gmail.com`.

## Parallel Subagent Plan

Use four implementation agents with disjoint ownership:

- **Agent A: dashboard/everything-dev**
  - Owns UI, routes, dashboard hooks, and Render web service fit.
- **Agent B: Insforge/backend**
  - Owns schema, seed data, edge functions, and realtime events.
- **Agent C: IronClaw/sponsor integrations**
  - Owns skills, NEAR AI extraction client, Tigris upload flow, and Telegram workflow docs.
- **Agent D: verification/deploy**
  - Owns `.env.example`, README, smoke scripts, Render checklist, and end-to-end rehearsal.

Integration order:

1. Agent B lands Insforge schema/functions.
2. Agent C connects IronClaw workflow to Insforge, Tigris, and NEAR AI.
3. Agent A connects dashboard to live Insforge state.
4. Agent D verifies local, deployed, and live Telegram demo flows.

## Test Plan

- **Local build**: install deps, run typecheck/build.
- **Insforge**: seed seller/tier, call edge functions, verify duplicate confirmation rejection and realtime updates.
- **NEAR AI**: extract fields from `IMG_3195.png` and validate expected fixture values.
- **Tigris**: upload receipt, head object, generate presigned URL, render preview.
- **IronClaw**: verify SSH, channel list, skills installation, Telegram onboarding, image receipt handling.
- **Dashboard**: verify subscriber/payment/manifest/revenue views update without refresh.
- **Render**: deploy web service, verify envs, production dashboard, and API facade.
- **Demo rehearsal**: run the full path from Telegram `/start` through delivery status notifications.

## Remaining Decisions / Tasks Before Demo

- Decide whether to modify IronClaw Telegram config to open DMs or keep pairing and pre-pair demo users.
- Set `bot_username=locallebot` in IronClaw config if supported by the CLI/config workflow.
- Configure IronClaw runtime secrets for Insforge, NEAR AI, and Tigris.
- Add `INSFORGE_*` env aliases to `.env.local` and Render envs for app code.
- Choose the exact NEAR AI vision model after testing receipt extraction quality.
- Push scaffolded app to GitHub before creating/connecting the Render service.

## Assumptions

- Zelle remains receipt proof only; no Zelle API integration.
- Seller auth is out of scope for hackathon v1.
- One private Tigris bucket is used: `residentos-artifacts`.
- Hard-coded demo tier includes `$5`.
- Hidden replay controls are allowed for demo safety, but the primary path is live Telegram through IronClaw.
