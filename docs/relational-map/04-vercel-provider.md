# 04 — The wrapped Vercel provider

## Shape

- `src/vercel/client.js` — the HTTP client to the Vercel API; every
  call carries the enrolled account's decrypted team token (see 05)
  and is scoped to that account's team/project box.
- `src/vercel/provider.js` + `src/vercel/operations.js` — operation
  implementations behind the tools; `src/vercel/hand-built-map.js`
  and `src/vercel/openapi-index.js` map operations to Vercel's OpenAPI
  surface, validated by `src/vercel/openapi-validation.js`.
- **Policy split:** `api-read-policy.js` governs reads;
  `api-write-policy.js` governs writes — a tool cannot call the
  provider outside its policy class.
- Response shaping lives in `src/vercel/shape.js` (bounded JSON via
  `bounded-json.js`); tokens/expiry in `tokens.js` / `token-expiry.js`
  (the server warns 14 days before a recorded credential expiry).

## Wrapped surface (tool families in `src/tools/`)

| Vercel area | Tool families (examples) |
|---|---|
| Teams & members | `teams.js`, `members.js`, team lifecycle / profile / security / retention / directory-mapping writes |
| Projects | `projects.js`, project create / settings / members / resources / transfer / delete, project traffic |
| Deployments & releases | `deployments.js`, release reads/writes, rolling releases, alias writes, deployment cancel/delete/redeploy, git/file deployment creation |
| Environment variables | project env reads/writes/copy/batch, shared env, custom environments, Global Config (`globalconfig-*`) |
| Domains, DNS, registrar | `domains.js`, `dns.js`, `registrar.js` (a purchase charges real money on confirm) |
| Git | `git.js`, `git-identity.js` |
| Observability | `observability.js`, `logs-analytics.js`, runtime log streaming (`src/vercel/runtime-log-stream.js`) |
| Firewall & protection | `firewall.js`, `protection.js`, deployment protection defaults |
| Storage & integrations | `integrations-storage.js`, Blob (`blob.js`, `src/vercel/blob.js`) |
| Billing & spend | `billing.js`, spend operations (`src/vercel/spend*.js`) under the spend rules in 03 |
| Checks & crons | `checks.js`, `crons.js` |
| Developer / sandbox | `dev-runs.js`, `dev-sandbox.js`, preview branch/env/alias/bypass/fetch, test webhooks |
| Server / owner / meta | `server.js`, `owner*.js`, `pass-*.js`, `tokens.js`, `oauth-clients.js`, `meta.js`, `universal.js` |

## Known-app profiles

`known_apps` rows are **data, not code**: seeded project profiles
(e.g. the Appliance Desk profile in `src/db.js`, sourced from
`docs/APP-NEEDS-APPLIANCE-DESK.md`) tell release/env/domain tools what
a given app expects — production branch, managed env names, owned
domains/DNS, expected crons — without hard-coding app facts into tools.
