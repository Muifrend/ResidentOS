# ResidentOS IronClaw Telegram Workflow

This is the local Agent C asset bundle for deploying ResidentOS behavior to the
IronClaw host that serves Telegram bot `locallebot`.

## Installed Runtime Facts

- Remote host: `agent@baremetal3.agents.near.ai`
- SSH key path: `~/Downloads/agent-private-key.pem`
- SSH port: `21981`
- IronClaw binary: `/usr/local/bin/ironclaw`
- Telegram channel: enabled WASM channel
- Bot username: `locallebot`

Do not copy secrets into these files. Runtime secrets belong in the IronClaw
host environment or secret store.

## Skill Assets To Install

Copy or sync these folders to the IronClaw skills location used by the deployed
runtime:

```text
agent/skills/residentos_onboarding/
agent/skills/payment_verify/
agent/skills/order_manage/
agent/skills/delivery_notify/
```

The skills assume the local integration helpers are also available to the agent:

```text
integrations/nearai/receipt-extractor.js
integrations/tigris/artifacts.js
```

## Environment Required On The IronClaw Host

```text
RESIDENTOS_SELLER_ID=demo-seller
RESIDENTOS_ZELLE_RECIPIENT_NAME=Cristian Rosca
RESIDENTOS_ZELLE_RECIPIENT_EMAIL=rosca.cris18@gmail.com
INSFORGE_URL=https://p5twwd93.us-east.insforge.app
INSFORGE_API_KEY=...
NEAR_AI_BASE_URL=...
NEAR_AI_API_KEY=...
NEAR_AI_MODEL=Qwen/Qwen3-VL-30B-A3B-Instruct
AWS_S3_BUCKET=residentos-artifacts
AWS_ENDPOINT_URL_S3=...
AWS_REGION=auto
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
```

## Demo Conversation

1. Judge opens Telegram and messages `locallebot`.
2. Judge sends `/start`.
3. `residentos_onboarding` collects name, unit, floor, and `$5` tier.
4. Bot asks for Zelle payment to `Cristian Rosca <rosca.cris18@gmail.com>`.
5. Judge sends the Zelle screenshot.
6. `payment_verify` uploads the screenshot to Tigris under
   `payment-receipts/`.
7. `payment_verify` extracts receipt fields with NEAR AI and calls the
   ResidentOS MCP tool `residentos_record_demo_payment` to write Insforge rows.
8. Bot confirms paid or flagged status.
9. Seller generates the manifest from the dashboard or agent flow.
10. `delivery_notify` sends delivery progress to the resident chat.

## Open DM Target

For judging, prefer open DMs if IronClaw supports it:

```json
{
  "dm_policy": "open",
  "polling_enabled": true,
  "poll_interval_ms": 30000,
  "bot_username": "locallebot"
}
```

## Pairing Fallback

The current static capability file may still show `dm_policy: "pairing"` and
`polling_enabled: false` even though Telegram is installed and has replied.

If open DM config is not supported by the deployed runtime:

1. Keep the Telegram WASM channel enabled.
2. Pre-pair demo judge accounts before judging.
3. Confirm the paired chat can send `/start` and receive a reply.
4. Continue the same onboarding flow in the paired chat.

## Runtime Verification Commands

Run these from the local machine when checking the deployed host. These commands
must not print secrets.

```bash
ssh -i ~/Downloads/agent-private-key.pem -p 21981 agent@baremetal3.agents.near.ai 'ironclaw --version'
ssh -i ~/Downloads/agent-private-key.pem -p 21981 agent@baremetal3.agents.near.ai 'ironclaw channels list --json'
ssh -i ~/Downloads/agent-private-key.pem -p 21981 agent@baremetal3.agents.near.ai 'ironclaw channels list --verbose'
```

The deployed IronClaw runtime must also have the ResidentOS MCP server
registered:

```bash
ironclaw mcp add residentos https://residentos.onrender.com/mcp --description "ResidentOS dashboard write tools"
ironclaw mcp test residentos
```
