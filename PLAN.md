# ResidentOS Hackathon Implementation Plan

## Summary

Build a live sponsor-centered demo where a judge texts the IronClaw Telegram bot, completes onboarding, sends the provided Zelle receipt screenshot, and watches the seller dashboard update in real time.

Verified sponsor fit from current docs:

- **IronClaw**: secure Rust agent framework on NEAR AI Cloud, with Telegram channels and WASM sandboxed tools. Sources: [IronClaw intro](https://docs.ironclaw.com/), [Telegram channel](https://docs.ironclaw.com/channels/telegram), [WASM tools](https://docs.ironclaw.com/capabilities/sandboxed-tools).
- **NEAR AI**: private inference in TEEs, OpenAI-compatible APIs, direct multimodal model endpoint support. Source: [NEAR AI private inference](https://docs.near.ai/cloud/private-inference/).
- **Insforge**: database, auth, storage, realtime, edge functions, CLI/MCP, and TypeScript SDK. Sources: [Insforge overview](https://docs.insforge.dev/), [CLI setup](https://docs.insforge.dev/quickstart), [TypeScript SDK](https://docs.insforge.dev/sdks/typescript/overview), [Realtime SDK](https://docs.insforge.dev/sdks/typescript/realtime).
- **Tigris**: S3-compatible storage via AWS SDK, endpoint `https://t3.storage.dev`, presigned URLs. Sources: [Tigris JS SDK](https://www.tigrisdata.com/docs/sdks/s3/aws-js-sdk/), [S3 compatibility](https://www.tigrisdata.com/docs/api/s3/).
- **everything-dev / Render**: everything-dev gives the host/UI/API shell; Render hosts a web service that binds to `PORT`. Sources: [everything-dev repo](https://github.com/NEARBuilders/everything-dev), [Render web services](https://render.com/docs/web-services), [Render env vars](https://render.com/docs/configure-environment-variables).

Current repo state: `/home/andrew/personal_projects/ResidentOS` only contains `residentos_plan.md`; `.git` exists but is empty/invalid, so implementation should treat this as a greenfield scaffold.

## Key Changes

- Scaffold an **everything-dev** app in the repo root, preserving `residentos_plan.md`.
- Use a thin architecture:
  - everything-dev **UI**: seller dashboard.
  - everything-dev **API**: typed facade for dashboard actions and hidden demo replay.
  - **Insforge**: source of truth for all relational state and realtime updates.
  - **IronClaw**: live operator for Telegram onboarding, payment verification, manifest generation, and notifications.
  - **Tigris**: artifact store for receipt screenshots and manifests.
  - **NEAR AI**: private vision inference for Zelle receipt extraction.
- Use one Tigris bucket for demo simplicity:
  - Bucket: `residentos-artifacts`
  - Prefixes: `payment-receipts/`, `order-manifests/`, `delivery-confirmations/`, `seller-assets/`
- Skip seller auth for v1 demo. Use seeded seller context in env/config.
- Hard-code demo tiers, including a `$5` tier matching `IMG_3195.png`.

## Implementation Plan

### 1. Repo And App Scaffold

- Generate an everything-dev project using the current official CLI.
- Keep the app shape close to the upstream runtime: `host`, `ui`, `api`, `plugins`/config as generated.
- Add `.env.example`, `README.md`, and demo setup docs.
- Add a real `.gitignore`; avoid committing `.env`, receipt copies, build outputs, or secrets.
- Because the current `.git` is invalid, initialize a fresh git repo only after scaffolding unless the user provides a remote clone target.

### 2. Insforge Backend

Create tables:

- `sellers`: seeded seller config, Zelle recipient name/email, building label.
- `tiers`: hard-coded demo tiers; seed `$5`.
- `subscribers`: Telegram handle/chat id, name, unit, floor, tier, status.
- `payments`: receipt artifact key/URL, extracted fields, status, confidence, confirmation number.
- `orders`: generated manifest rows and delivery status.
- `agent_events`: audit log of IronClaw actions for dashboard visibility.

Create edge functions:

- `record_payment_verification`: upserts subscriber/payment, rejects duplicate confirmation numbers, marks paid or flagged.
- `generate_manifest`: builds today/this week’s ordered list from paid subscribers.
- `update_delivery_status`: marks floor/order dispatched or delivered.
- `review_flagged_payment`: seller approve/reject path.
- `demo_seed` and `demo_replay_receipt`: hidden fallback controls.

Realtime:

- Dashboard subscribes to a channel such as `seller:{SELLER_ID}`.
- Edge functions publish `subscriber_paid`, `payment_flagged`, `manifest_generated`, and `delivery_updated`.

### 3. IronClaw Agent

Create local IronClaw workspace assets:

- `agent/skills/residentos_onboarding/SKILL.md`
- `agent/skills/payment_verify/SKILL.md`
- `agent/skills/order_manage/SKILL.md`
- `agent/skills/delivery_notify/SKILL.md`
- `agent/tools/residentos_api/` if WASM/HTTP tool wrapper is needed.

Agent behavior:

- Telegram `/start` begins onboarding.
- Collect: name, room/unit, selected tier.
- Telegram handle/chat id comes from the incoming message metadata.
- Ask user to send the Zelle receipt screenshot.
- Upload original receipt to Tigris.
- Send image to NEAR AI vision model using OpenAI-compatible API.
- Extract JSON:
  - `payment_sent: boolean`
  - `recipient_name`
  - `recipient_email`
  - `amount`
  - `date`
  - `confirmation_number`
  - `sender_label`
  - `confidence`
- Validate against demo seller config:
  - recipient name/email matches fixture seller
  - amount equals selected tier
  - date is within demo payment window
  - confirmation number is present and unused
- Call Insforge `record_payment_verification`.
- Confirm success or flagged state in Telegram.
- On dashboard delivery events, notify the matching floor/subscribers.

### 4. NEAR AI Integration

- Use env-configurable base URL:
  - default: `https://qwen3-vl-30b.completions.near.ai/v1`
  - fallback/override: `https://cloud-api.near.ai/v1`
- Use env `NEAR_AI_MODEL`, defaulting to a vision-capable private inference model.
- Implement one receipt extraction client with strict JSON output parsing.
- Store the raw model output and optional attestation/signature metadata in `payments.extraction_raw`.
- Add a verification utility for `GET /v1/attestation/report` if the chosen endpoint exposes it during demo.

### 5. Tigris Integration

- Use AWS SDK v3 `S3Client`.
- Config:
  - endpoint `https://t3.storage.dev`
  - region `auto`
  - `s3ForcePathStyle: false`
- Upload receipt images to:
  - `payment-receipts/{seller_id}/{subscriber_id}/{timestamp}.png`
- Upload generated manifests to:
  - `order-manifests/{seller_id}/{date}.json`
- Dashboard displays receipt artifacts via presigned GET URLs, not public bucket URLs.

### 6. everything-dev Dashboard

Dashboard views:

- **Ops Home**: live status rail showing latest agent events.
- **Subscribers**: name, unit, floor, Telegram handle, tier, paid/flagged status.
- **Payments**: verified/flagged receipts, extracted fields, Tigris preview URL, approve/reject.
- **Manifest**: sorted by floor/unit, generate manifest button, dispatched/delivered controls.
- **Revenue**: small weekly total and paid subscriber count.

Dashboard rules:

- No business logic in UI.
- UI reads from Insforge and subscribes to realtime.
- Buttons invoke Insforge edge functions via the everything-dev API facade.
- Hidden demo controls are available behind `DEMO_MODE=true`.

### 7. Render Deployment

- Deploy the everything-dev host as a Render web service.
- Bind server to `process.env.PORT`.
- Set Render env vars for Insforge public access, seeded seller id, and demo mode.
- Keep IronClaw running on NEAR AI Cloud, not Render.
- Render is dashboard hosting only.

## Parallel Subagent Plan

Use four CLI agents with disjoint ownership:

- **Agent A: everything-dev/dashboard**
  - Owns UI, routes, dashboard data hooks, visual polish.
- **Agent B: Insforge/backend**
  - Owns schema, migrations, seed data, edge functions, realtime channels.
- **Agent C: IronClaw/sponsors**
  - Owns `agent/skills`, NEAR AI receipt extraction, Tigris upload tool, Telegram workflow docs.
- **Agent D: verification/deploy**
  - Owns `.env.example`, README, smoke scripts, Render deploy checklist, end-to-end QA.

Integration order:

1. Agent B lands schema/functions first.
2. Agent C connects IronClaw to Insforge/Tigris/NEAR AI.
3. Agent A connects dashboard to live Insforge state.
4. Agent D runs end-to-end demo rehearsal and fixes integration gaps.

## Test Plan

- Local build:
  - install dependencies
  - run typecheck/build for everything-dev
- Insforge:
  - create schema
  - seed seller/tier
  - call `record_payment_verification` with fixture extraction
  - verify duplicate confirmation number is rejected
  - verify realtime event reaches dashboard
- NEAR AI:
  - run extraction against `/home/andrew/Downloads/IMG_3195.png`
  - expect recipient `Cristian Rosca`, email `rosca.cris18@gmail.com`, amount `$5.00`, date `May 31, 2026`, confirmation `g2cwdpnm1`
- Tigris:
  - upload fixture image
  - head/get object
  - generate presigned GET URL
- IronClaw + Telegram:
  - text bot
  - complete onboarding
  - send receipt image
  - observe paid subscriber in dashboard
- Demo rehearsal:
  - generate manifest
  - mark floor dispatched
  - receive Telegram notification
  - mark delivered
  - confirm order status updates live

## Things You Need To Provide Now

Prefer putting secrets in a local `.env.local` or secure note rather than pasting them into chat.

Required:

- **Insforge**
  - Project ID
  - Base URL, e.g. `https://<project>.insforge.app`
  - anon/public key
  - admin/service key or CLI-linked project access
- **IronClaw**
  - Confirmation that `ironclaw` CLI is logged in on this machine, or instructions for the active NEAR AI Cloud agent
  - Agent/workspace name
  - Telegram bot username
  - Whether Telegram channel is polling or webhook mode
  - Vault secret names for Insforge, NEAR AI, and Tigris credentials
- **NEAR AI**
  - API key
  - Preferred model/base URL if different from `qwen3-vl-30b.completions.near.ai`
- **Tigris**
  - Access key ID
  - Secret access key
  - Bucket name if already created; otherwise permission to create `residentos-artifacts`
- **Render**
  - Render account/project access
  - GitHub repo/remote to deploy from, or permission to create/init/push one
  - Render API key if you want CLI/API deploys instead of manual dashboard setup
- **Demo constants**
  - Confirm seller recipient is `Cristian Rosca <rosca.cris18@gmail.com>`
  - Confirm `$5` is the demo tier amount
  - Confirm the provided receipt confirmation number `g2cwdpnm1` is okay to use in the live demo

After you provide these, verification should run before implementation:

- Insforge CLI link/health check.
- NEAR AI tiny model call plus receipt extraction call.
- Tigris `HeadBucket`/test upload.
- IronClaw Telegram test message.
- Render access or deploy target check.

## Assumptions

- The live demo path is Telegram-first, not web signup.
- Zelle is receipt proof only; no Zelle API integration.
- Seller auth is out of scope for hackathon v1.
- One Tigris bucket with prefixes is preferred over multiple buckets for speed and reliability.
- Hidden replay controls are acceptable as demo safety, but not the main story.
