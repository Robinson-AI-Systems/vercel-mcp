# 05 — Storage and secrets

## Store

- **One Postgres store**, reached only through `src/db.js` (the only
  SQL entry point) over `src/db-transport.js`, which selects the Neon
  HTTP driver or pooled `pg` by URL shape. Schema creation is additive
  (`initSchema`, run opportunistically at entry routes; never drops).
- **Production store today:** the rack's Postgres (the dedicated Neon
  store was retired 2026-11-08 with the hosted deployment). Tests use
  disposable Postgres only, never the real store.

## Tables (`SCHEMA_TABLES` in `src/db.js` — 22)

| Group | Tables |
|---|---|
| Enrolled accounts | `vercel_accounts` (encrypted provider credential + declared/probed scope) |
| OAuth issuer | `oauth_clients`, `oauth_codes`, `oauth_tokens`, `login_attempts`, `signin_flows` |
| RTC | `rtc_passes` |
| Work & results | `change_log`, `result_store`, `pending_inputs`, `purchase_intents` |
| Secrets | `one_time_secrets` |
| Developer | `dev_runs`, `dev_run_objects`, `dev_sandbox_usage` |
| Webhooks / deployments | `deployment_events`, `deployments` |
| Misc | `protected_resources`, `request_replay`, `blob_store_connections`, `known_apps`, `schema_migrations` |

## Secrets

- Stored provider credentials and one-time secrets are encrypted with
  **AES-256-GCM** (`src/core/secret-box.js`) under
  `TOKEN_ENCRYPTION_KEY`; rotating that key without a re-encryption
  plan makes stored values unreadable.
- A secret value a tool needs is never typed into chat or a tool
  argument: it is set in the provider dashboard or generated on the
  server, then delivered as a **one-time secret** — revealed exactly
  once, on the owner's own connection, via
  `vercel_reveal_one_time_secret`; a revealed record cannot be reopened.
- Token hashes, not raw tokens, are what OAuth lookups search
  (`hashToken` in `src/core/oauth.js`).

## Retention (AUD-AO clocks, enforced by `sweepRetention` in `src/db.js`)

- `change_log` and the purchase ledger: **400 days**.
- Authorizations never exercised: out **180 days** after they lapse.
- The sweep is opportunistic and throttled (at most hourly per
  instance); deletes are idempotent across instances.
