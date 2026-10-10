# Design — Batch U: Universal tools (every other Vercel operation)

Status: **APPROVED** (Chris, 2026-10-10). Written 2026-10-10. Scope and acceptance: `docs/PLAN.md` → Batch U.
Card U-1. Depends on Batches B and C (and A-4's vendored OpenAPI snapshot).

Goal: an agent can do almost anything in Vercel for Chris. Hand-built tools cover the common jobs comfortably; four
universal tools reach every operation in Vercel's REST API (438 on 2026-10-10) — feature flags, KMS, Vercel CI,
container registry, AI Gateway, Connect, microfrontends, Remote Cache, Marketplace provider operations, anything Vercel
adds — with the same safety rules. In compact mode they cost nothing until used.

## 0. Verify before starting

| # | Assumption | How to check |
|---|---|---|
| U1 | `vendor/vercel-openapi/SOURCE.md` names the snapshot the client's `OPENAPI_SNAPSHOT` records | `cat vendor/vercel-openapi/SOURCE.md`; `grep -n OPENAPI_SNAPSHOT src/vercel/client.js` |
| U2 | The client can send an arbitrary documented method + path with query and body through the same timeout, team scoping and request-key path as `OPS` entries | read `makeVercelClient` |

## 1. Decisions

**U1. Tools:** `vercel_api_search(query)` (method, path, one-line summary, and reads / changes / spends / secret),
`vercel_api_describe(op)` (parameters trimmed from the snapshot), `vercel_api_read(op, params)` (GET/HEAD only; Batch C
result rules apply), `vercel_api_write(op, params)` (POST/PUT/PATCH/DELETE; `full` profile only; passes need
`allow_writes`).

**U2. Only what Vercel describes.** Every request is validated against the vendored snapshot: unknown operation or
parameter → refused in words. No guessing; no undocumented paths (research §2.3 is the cautionary list).

**U3. `vercel_api_write` always needs `confirm`** and supports `dryRun`; the preview shows the operation in plain words,
the parameters, and the object as it is now when the path has an ID and a matching GET exists.

**U4. Spend detection** (`src/vercel/spend-operations.js`): a table of operations that buy or raise spend (registrar
buy/renew/transfer-in/auto-renew, `POST /v1/billing/buy`, Marketplace store creation, Blob store creation, team
creation, analytics and Speed Insights toggles, drains create, rolling-release config, sandbox creation, project
`resourceConfig` changes, member invites/role changes to paid roles, Observability Plus project settings) → spend guard.
**Unknown operations whose summary or path mentions buy, purchase, renew, upgrade, credit, billing, plan or invoice are
treated as spend** until added to the table.

**U5. Secret rule.** Operations that return a credential (decrypted env values, project OIDC token, new access tokens,
webhook create, protection bypass, Global Config token create, flag SDK keys, registrar auth code, Marketplace
credential rotation, KMS signing) are **refused** by the universal tools and named;
the hand-built tool (with the one-time page) is offered instead, or `vercel_where_is_setting`. Request bodies are
scanned with the B5 credential pattern; credential-shaped values are refused (use a pending input with a hand-built
tool).

**U6. Production detection.** The B2 rules run on the operation and target; production operations need a production
connection. Unknown write operations on a path containing `{projectId}`/`{idOrName}` of a **live** project are treated as
production.

**U7. Hand-built tools win.** `src/vercel/hand-built-map.js` maps each operation a hand-built tool covers; for those,
`vercel_api_write` (and `vercel_api_read` for decrypt operations) refuses and names the tool, so curated checks (DNS
conflicts, rollback choice, env value handling) are never bypassed.

**U8. Guards apply:** self-protection (targets from path parameters), profile guard, spend limit, change log, request
key, read-back when the response has an `id` and a GET exists (otherwise `confirmed: null`), undo only where the
hand-built map gives an inverse.

## 4. Work units

### U-1 — Universal tools (L, medium effort)
Files: `src/tools/universal.js`, `src/vercel/openapi-index.js`, `src/vercel/spend-operations.js`,
`src/vercel/hand-built-map.js`, `src/vercel/secret-operations.js`.
Tests: unknown operation and unknown parameter refused; no-confirm changes nothing; an env create via `vercel_api_write`
refused naming `vercel_env_set`; a decrypt GET via `vercel_api_read` refused; an unlisted "buy" operation treated as
spend; spend counts toward the limit; production and self-protection guards (write-contract via `vercel_api_write`);
`emulate` accepts 15 random GET operations it supports; `vercel_api_search "feature flag"` and `"kms issuer"` find the
right operations.

## 5. Stop-and-ask points

1. U2 false: stop; amend the client before U-1.

## 6. Acceptance mapping

| PLAN Batch U line | Evidence |
|---|---|
| Every request validated against the snapshot | `tests/unit/universal.test.js` |
| Safe defaults for spend, production and secrets | same |
| Same guards as hand-built tools | write-contract through `vercel_api_write` |

## Amendments

(Dated entries only.)
