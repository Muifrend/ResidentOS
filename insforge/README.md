# ResidentOS InsForge Backend

Agent B owns these backend artifacts:

- `migrations/20260531000100_residentos-backend.sql`
- `functions/record_payment_verification.ts`
- `functions/generate_manifest.ts`
- `functions/update_delivery_status.ts`
- `functions/review_flagged_payment.ts`
- `functions/demo_seed.ts`
- `functions/demo_replay_receipt.ts`

Apply the migration from the project root:

```bash
npx @insforge/cli db migrations up 20260531000100
```

Deploy functions:

```bash
npx @insforge/cli functions deploy record_payment_verification --file functions/record_payment_verification.ts
npx @insforge/cli functions deploy generate_manifest --file functions/generate_manifest.ts
npx @insforge/cli functions deploy update_delivery_status --file functions/update_delivery_status.ts
npx @insforge/cli functions deploy review_flagged_payment --file functions/review_flagged_payment.ts
npx @insforge/cli functions deploy demo_seed --file functions/demo_seed.ts
npx @insforge/cli functions deploy demo_replay_receipt --file functions/demo_replay_receipt.ts
```

Required function runtime env/secrets:

- `INSFORGE_BASE_URL` or `INSFORGE_URL`
- `INSFORGE_API_KEY` or `API_KEY`
- `DEMO_MODE=true` for `demo_seed` and `demo_replay_receipt`

Realtime events are emitted by inserting rows into `agent_events`. The migration
adds a `seller:%` channel pattern and publishes each audit row to
`seller:{seller_id}` with the row `event_type`.
