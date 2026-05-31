# ResidentOS — Hackathon Build Plan

## The Product

A platform that lets any person run a micro-business inside a residential building — a dorm, apartment complex, co-living space. The seller lists what they offer, sets a schedule and pricing, and the platform handles everything else: onboarding subscribers, verifying payments, routing orders, coordinating delivery, and notifying customers — all autonomously.

User acquisition is the seller's problem. The platform starts the moment someone taps the signup link. Everything from that point is automated.

The seller's only job is fulfillment.

---

## Theme Fit: "Agents That Act"

ResidentOS is not a chatbot. The IronClaw agent is the operator. Every workflow is a chain of real actions — no human in the loop unless something is explicitly flagged.

- **Takes action based on context** — payment screenshot arrives → agent verifies inside TEE → writes subscriber record to Insforge → updates order manifest → confirms to customer via Telegram. One event, five real actions, zero human input.
- **Chains reasoning and tools together** — order cutoff reached → IronClaw queries Insforge for paid subscribers → generates sorted delivery manifest → archives to Tigris → pushes live update to seller dashboard → fires confirmation messages to all paid subscribers.
- **Solves problems end to end** — from a new person tapping a signup link, to becoming a confirmed subscriber on the delivery list, the entire flow is autonomous. The seller sees a new name appear on their dashboard.

---

## Demo Implementation Decisions

These decisions are locked for the hackathon demo:

- The subscriber interface is **live Telegram through IronClaw**. There is no separate demo-only web signup flow. A judge texts the bot, IronClaw captures the Telegram handle, collects name/unit/tier, and asks for the payment receipt.
- Zelle is handled as a **receipt-based payment proof**, not as a Zelle API integration. The user sends a Zelle receipt screenshot to the Telegram bot. IronClaw stores the image, sends it to NEAR AI private inference, validates the extracted fields, and updates Insforge.
- The demo receipt fixture is `/home/andrew/Downloads/IMG_3195.png`. It is a Zelle success receipt showing recipient, sender account label, amount, date, and confirmation number. The verification prompt should extract at least:
  - recipient display name
  - recipient email or handle if visible
  - amount
  - transaction date
  - confirmation number
  - success/payment-sent status
- Tiers are hard-coded for the demo. Seller-configurable pricing remains part of the product direction, but should not block the hackathon build.
- The dashboard is built on **everything-dev** because sponsor/ecosystem alignment matters. It should stay thin: dashboard UI, API facade, Insforge realtime reads, and action endpoints for seller decisions.
- Seller auth is not required for the demo unless it becomes necessary for an active sponsor story. For now, the dashboard can use a seeded seller context.
- The four core product sponsors are load-bearing: IronClaw, NEAR AI, Insforge, and Tigris. Render is deployment infrastructure for the seller dashboard, but the product story should center the four sponsor integrations.
- Some sponsor-adjacent capabilities can be thin or partial. The important part is that each core sponsor has a real integration point in the live flow.

Primary demo path:

```
Judge texts IronClaw Telegram bot
→ IronClaw collects name, room/unit, and selected hard-coded tier
→ Judge sends the Zelle receipt screenshot
→ IronClaw stores the original receipt in Tigris
→ IronClaw sends the image to NEAR AI private inference
→ Parsed fields are compared to expected seller/tier/payment window
→ IronClaw calls Insforge to create/update subscriber and payment status
→ everything-dev dashboard updates from Insforge state
→ Seller generates manifest and marks delivery progress
→ IronClaw sends Telegram delivery notifications
```

Fallbacks are allowed only to protect the demo, not to replace the story. The dashboard may include hidden or admin-only controls to replay an agent event, regenerate a manifest, or seed sample data if the live Telegram path is temporarily unavailable.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                        IronClaw Agent                         │
│   Runs in TEE on NEAR AI Cloud — credentials in vault        │
│   Telegram is a native channel — no separate bot infra       │
│                                                               │
│   Custom Skills (SKILL.md + WASM tools):                     │
│   ├── payment_verify    → NEAR AI private inference (TEE)    │
│   ├── order_manage      → Insforge DB + edge functions       │
│   ├── artifact_store    → Tigris S3 buckets                  │
│   └── delivery_notify   → Telegram channel (native)          │
└──────────┬──────────────────┬──────────────────┬─────────────┘
           │                  │                  │
       NEAR AI             Insforge           Tigris
   Private Inference       Backend         Artifact Store
  (payment verify, TEE)  (all state)      (receipts, manifests,
                                           confirmations)
                              │
                           Render
                 (everything-dev seller dashboard)
```

---

## Sponsor Integrations

### IronClaw — The Agent Runtime

IronClaw is the entire agent layer. It runs in a Trusted Execution Environment on NEAR AI Cloud, with an encrypted credential vault, WASM-sandboxed tools, and Telegram as a native built-in channel. This means:

- No separate bot server. IronClaw handles Telegram natively — it listens on the seller's bot token and handles all inbound messages.
- All credentials (Insforge API key, Tigris access keys, NEAR AI key) live in IronClaw's encrypted vault. They are injected at the host boundary only for allowlisted endpoints — the LLM never sees raw secrets.
- Every custom workflow is a **Skill** — a `SKILL.md` file with instructions and an optional WASM tool — installed and allowlisted on the agent instance.
- The agent runs persistently on NEAR AI Cloud, event-driven, always listening.

**Custom skills built for ResidentOS:**

`payment_verify` — activates when a subscriber sends a payment screenshot. Routes the image to NEAR AI private inference, receives structured result, validates against the subscriber record in Insforge, marks paid or flags for human review.

`order_manage` — activates at the nightly order cutoff. Queries Insforge for paid/active subscribers, generates the delivery manifest sorted by floor and unit, archives it to Tigris, pushes a live update to the seller dashboard, and fires confirmation messages to all paid subscribers.

`artifact_store` — called by other skills to write binary artifacts (screenshots, delivery confirmations, manifests) to the correct Tigris bucket. Handles key construction and upload.

`delivery_notify` — activates when the seller marks a floor dispatched in the dashboard. Fires Telegram pings to that floor's subscribers in sequence. Stores a delivery timestamp to Insforge.

---

### NEAR AI Private Inference — Payment Verification

Every payment verification in the platform processes real financial data: sender names, amounts, payment app identifiers. This data should not be logged by a cloud API provider.

NEAR AI's private inference runs on NVIDIA H200 GPUs inside Intel TDX Trusted Execution Environments. TLS terminates inside the TEE — neither the cloud provider nor NEAR itself can read the request contents. Every inference is cryptographically signed with a key that never leaves the secure hardware, and the proof is independently verifiable.

**Integration:** NEAR AI's API is fully OpenAI-compatible. The `payment_verify` skill points its inference call to `cloud-api.near.ai` instead of a standard provider — a one-line endpoint swap. IronClaw's vault holds the NEAR AI API key.

**What the agent does with it:**

```
Subscriber sends Zelle receipt screenshot via Telegram
→ IronClaw payment_verify skill fires
→ Image sent to NEAR AI TEE inference
→ Original screenshot is archived to Tigris payment-receipts/
→ Returns: { verified: true, recipient: "Cristian Rosca", amount: 5, date: "2026-05-31", confirmation_number: "g2cwdpnm1" }
→ Agent checks: success state present? recipient matches seller? amount matches tier? date inside payment window? confirmation number present and not reused?
  ✓ All pass → mark_paid → add to manifest → confirm to subscriber
  ✗ Any fail → store screenshot in Tigris (flagged bucket)
             → ping seller dashboard with approve/reject
             → await seller decision
```

**Why this matters for the demo:** The platform handles real financial data at every transaction. TEE inference means the verification is not just private by policy — it is private by cryptographic proof. The agent can surface the attestation report per verification as a seller-facing audit trail.

---

### Insforge — Agent-Native Backend

Insforge is the entire backend for ResidentOS. Built as a Supabase alternative designed specifically for AI agents as operators — every primitive (Postgres, auth, storage, edge functions, realtime pub/sub) is accessible via MCP and CLI with structured outputs agents can act on directly.

**Schema:**

- `sellers` — seller account, building config, hard-coded demo tier pricing, Zelle recipient name/email, Telegram bot token reference
- `subscribers` — name, room number, floor, selected tier, Telegram handle/chat id, payment status, skip balance
- `payments` — receipt artifact URL, extracted Zelle fields, verification status, confidence, reason code, confirmation number
- `orders` — daily order state per subscriber (active, skipped, delivered)
- `flagged_payments` — screenshots awaiting seller review, with reason code

**Why Insforge over a standard Postgres setup:** The IronClaw agent connects to Insforge via MCP. Every primitive returns structured, agent-readable outputs. Edge functions let the agent trigger server-side logic (e.g. `generate_manifest`, `close_payment_window`) as a single tool call rather than multiple DB reads/writes. Realtime pub/sub pushes every state change the agent makes directly to the seller dashboard without polling.

**Agent → Insforge flow (payment verification, happy path):**
1. NEAR AI inference returns verified result
2. Agent calls Insforge edge function `record_payment_verification(subscriber_id, receipt_url, extracted_fields)`
3. Insforge checks duplicate confirmation number, writes payment row, marks subscriber paid, and fires realtime event
4. Seller dashboard updates live — subscriber appears on delivery list
5. Agent fires Telegram confirmation to subscriber

Steps 1–5 run in under 10 seconds, zero seller input.

---

### Tigris — Artifact Storage

Tigris is globally distributed S3-compatible object storage with zero egress fees. The `artifact_store` IronClaw skill calls the Tigris S3 endpoint (`t3.storage.dev`) using the AWS SDK, with credentials in IronClaw's vault.

**Buckets:**

`payment-receipts/` — all original Zelle receipt screenshots, including successful and flagged payments. Keyed `{seller_id}/{subscriber_id}/{timestamp}`. The seller dashboard's review queue fetches directly from this bucket when a payment needs human review.

`order-manifests/` — archived daily delivery lists. Keyed `{seller_id}/{date}`. Enables delivery history, dispute resolution, and analytics.

`delivery-confirmations/` — optional timestamped photos taken at drop. Proof of delivery per order.

`seller-assets/` — product or menu images uploaded during seller onboarding.

**Why not store in Insforge:** Binary blobs belong in object storage. Tigris's `@tigrisdata/agent-kit` is purpose-built for AI agent workflows — checkpointing, artifact coordination, workspace state — making it the natural companion to IronClaw for anything that isn't structured relational data.

---

### Render — everything-dev Seller Dashboard

The seller dashboard is an everything-dev app deployed on Render. It is the seller's operational surface — a real-time view of everything the IronClaw agent is doing, plus the human-in-the-loop review queue for flagged payments.

Use everything-dev only for the dashboard/API shell:

- Host serves the app and loads the dashboard module.
- UI module renders the seller workflow.
- API module exposes thin endpoints for seller decisions and demo-safe replays.
- Insforge remains the backend source of truth.
- IronClaw remains the operator. The dashboard never becomes the agent.

**Dashboard surfaces:**

- Live delivery manifest for the current day — sorted by floor and unit, color-coded by status (active, skipped, delivered)
- Subscriber roster — tier, payment status, skip balance
- Flagged payment review queue — screenshot (from Tigris) + fields extracted by NEAR AI inference, approve/reject buttons
- Weekly revenue summary

**Render setup:**
- Web service → everything-dev host, UI, and API modules
- IronClaw agent → already running on NEAR AI Cloud, talks to Insforge/Tigris/NEAR AI directly

The dashboard contains no business logic. All logic lives in the IronClaw agent. The dashboard only reads Insforge state (via realtime) and writes seller decisions (approve/reject) back via Insforge edge functions.

---

## The Autonomous Loops

### Weekly Reset (Sunday)

```
3:00pm   IronClaw queries Insforge for active subscribers
         → Fires personalized renewal reminder per subscriber via Telegram
           (includes their tier and current skip balance)

9:00pm   IronClaw closes payment window
         → Marks unpaid subscribers inactive for the week in Insforge
         → order_manage skill fires:
             queries paid + active subscribers
             generates delivery manifest (sorted by floor, unit)
             archives manifest to Tigris
             writes orders to Insforge
             pushes realtime update → seller dashboard refreshes live
         → Fires confirmation to each paid subscriber via Telegram
```

### Daily Delivery

```
[Night before]   Subscribers skip, change order, or place one-time orders via Telegram
                 → IronClaw updates Insforge records, adjusts manifest live

10:45am          IronClaw fires reminder to active subscribers: "put your container out"

11:00am          Seller begins fulfillment

[Seller taps "floor dispatched" in dashboard]
                 → Insforge realtime event → delivery_notify skill fires
                 → Pings that floor's subscribers: "on the way"
                 → Timestamps to Insforge

[Seller taps "floor delivered"]
                 → Optional photo → artifact_store writes to Tigris delivery-confirmations/
                 → Fires "at your door" pings
                 → Marks orders complete in Insforge

12:00pm          IronClaw marks delivery cycle complete
                 → Updates weekly stats in Insforge
```

### New Subscriber Onboarding

```
Prospect receives seller's signup link → Telegram conversation opens with IronClaw

Agent: "What's your name and room number?"
Agent: "Pick a tier:" [hard-coded demo options, including a $5 tier that matches the receipt fixture]
Agent: "Here's how it works:" [rules summary]
Agent: "Send payment to [seller handle] — drop a screenshot here when done"

Subscriber sends screenshot
→ payment_verify skill fires
→ NEAR AI TEE inference: { verified: true, recipient: "Cristian Rosca", amount: 5, confirmation_number: "g2cwdpnm1", ... }
→ Insforge: subscriber record created, marked paid
→ artifact_store: receipt written to Tigris payment-receipts/
→ Telegram: "You're confirmed for [tier]. First delivery [date]."

Seller dashboard: new subscriber appears live on roster via Insforge realtime

Time from signup link to confirmed subscriber: < 3 minutes, zero seller input.
```

---

## What Judges See

A live, walkable demo of the full agent chain:

1. **Onboarding:** Judge texts the IronClaw Telegram bot, provides name/unit, picks a hard-coded tier, and sends the provided Zelle receipt screenshot.
2. **Verification:** IronClaw routes the screenshot to NEAR AI private inference inside a TEE. Structured result returns. Agent writes to Insforge.
3. **Artifact storage:** IronClaw stores the original receipt screenshot in Tigris and links the payment row to the artifact.
4. **Dashboard update:** The everything-dev seller dashboard on Render reflects the new subscriber live — Insforge realtime, no refresh.
5. **Order cutoff:** Tapping "generate this week's list" triggers `order_manage` — manifest appears on dashboard, archived to Tigris.
6. **Delivery loop:** Seller taps "floor dispatched" → agent fires Telegram pings to that floor → seller taps "delivered" → agent stores confirmation to Tigris → subscribers notified.

The only human actions in the demo: texting the bot, sending the receipt screenshot, and tapping dashboard buttons. Everything else is the agent.

---

## Sponsor Stack Summary

| Sponsor | Role | Integration point |
|---|---|---|
| IronClaw | Agent runtime + Telegram channel | NEAR AI Cloud, TEE, custom SKILL.md + WASM tools |
| NEAR AI | Private inference for payment verification | `cloud-api.near.ai`, OpenAI-compatible, TEE-verified |
| Insforge | All backend state + realtime + edge functions | MCP server, `@insforge/sdk`, Postgres + realtime |
| Tigris | Artifact storage (receipts, manifests, confirmations) | `@tigrisdata/agent-kit`, S3 endpoint `t3.storage.dev` |
| Render | Dashboard deployment | everything-dev web service |

The four core product sponsors are IronClaw, NEAR AI, Insforge, and Tigris. Each must be integrated in the live flow. Render supports the deployed dashboard demo.

---

## Hackathon Track

**AI & Tech / Finance** — autonomous agent operating a real financial workflow with cryptographically verifiable privacy, on production infrastructure.

---

## Extensions (post-hackathon)

- **NEAR Intents** — replace screenshot-based payment verification with on-chain settlement. IronClaw already holds the payment skill; add a NEAR Intents confirmation step.
- **Multi-seller** — Insforge supports isolated Postgres branches per seller. One platform instance, any number of buildings.
- **Rtrvr.ai** — if future acquisition features require authenticated browser sessions, Rtrvr.ai integrates as an IronClaw skill for DOM-native browser automation.
