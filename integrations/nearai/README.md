# NEAR AI Receipt Extraction

Agent C owns this local OpenAI-compatible client for ResidentOS receipt
extraction.

## Command

```bash
node scripts/agent-c/extract-receipt.js /home/andrew/Downloads/IMG_3195.png
```

The command reads `.env.local` when run through
`integrations/nearai/receipt-extractor.js` directly, or can receive env from the
IronClaw runtime.

Required env:

```text
NEAR_AI_BASE_URL=...
NEAR_AI_API_KEY=...
NEAR_AI_MODEL=Qwen/Qwen3-VL-30B-A3B-Instruct
```

The command prints extraction JSON and validation checks only. It does not print
API keys.

## Output Contract

```json
{
  "model": "Qwen/Qwen3-VL-30B-A3B-Instruct",
  "image_path": "/home/andrew/Downloads/IMG_3195.png",
  "extraction": {
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
  },
  "validation": {
    "checks": {
      "recipient_name": true,
      "recipient_email": true,
      "amount": true,
      "date": true,
      "confirmation_number": true,
      "state": true
    }
  }
}
```
