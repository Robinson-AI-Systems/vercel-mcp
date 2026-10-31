# Design — Batch R: Hub-ready doors (Robinson Tool Contract, RTC 1)

Status: **APPROVED** (Chris, 2026-10-10). Written 2026-10-10. Scope and acceptance: `docs/PLAN.md` → Batch R.
Cards R-1 … R-3. Depends on Batches B and C.

Each service gets its own solid, hosted server, and **Robinson's Toolkit** (`Robinson-AI-Systems/robinsons-toolkit-hub`,
the hub) combines them into one MCP, CLI and HTTPS API. This server provides only the doors every server provides under
the **Robinson Tool Contract** (RTC 1, authority: the hub's `docs/CONTRACT.md`): passes, the HTTPS tool API and the
contract manifest. The `rtool` CLI, code SDK, local MCP and GitHub relay are built once, in the hub. This server never
depends on the hub (AGENTS hard limit).

## Owner correction — independent RTC completion, October 19, 2026

This service completes after provider-owned RTC 1 conformance, deployed direct MCP/HTTPS manifest, search, describe, call, authorization, independent real direct positive/negative proof, denial and revocation. Live Hub discovery, connecting, optional Hub OAuth onboarding, routing, relay, Sandbox and successful Hub-routed tool execution belong to the Hub's acceptance, **not** this server's. The optional production OAuth transport described by Hub main `3cc7f4ad4332155d639125b23e8a5c4c13804a3d` does not silently replace frozen RTC 1 pass-compatible behavior. No service-owned engineering, CI, direct deployed or security gate is waived.

## 0. Verify before starting

| # | Assumption | How to check |
|---|---|---|
| R1 | `vercel_call` dispatches through wrapped handlers (C-2) | `grep -n "vercel_call" src/core/meta.js src/tools/*.js \| head` |
| R2 | The contract version is still RTC 1 | read the hub's `docs/CONTRACT.md` header; if newer, implement the newest and note it |
| R3 | The hub's conformance package exists (hub card K-2) | look for `packages/conformance` in the hub repo; if not yet, R-3 waits and R-1/R-2 proceed |

## 1. Decisions

**R1. Passes** (RTC §2): `oauth_tokens.kind = 'pass'`; created only by Chris with `vercel_create_pass` (confirm) or the
setup page; shown once on the one-time-secret page, never in chat. Defaults: **preview** mode, `read_only`, 24 hours,
`allow_writes` false, spend limit $0, all areas, no project restriction. Writes, production mode, a spend limit, chosen
areas, a project restriction (`project_ids`, enforced by the self/profile guard layer on every target) and a longer life
(≤30 days; ≤365 days only for a pass marked "for Robinson's Toolkit") are explicit choices; production + writes also
needs the setup-page passphrase. Passes are listed by `vercel_list_connections` and revoked by
`vercel_revoke_connection`.

**R2. HTTPS tool API and manifest** exactly as RTC §1 and §7: `GET /api/contract` (no auth) →
`{ rtc: 1, server: 'vercel-mcp', version, apiVersion: 'openapi-<snapshot date>', areas[], counts: { tools, writes,
money }, profiles[], listingModes: ['catalog','compact'], modes: ['preview','production'], devTools: true }` (`money`
counts `$` tools); `GET /api/whoami`, `GET /api/tools`, `GET /api/tools/{name}`, `POST /api/tools/{name}`,
`POST /api/tools/_batch`, `GET /api/results/{handle}`; pass-only auth; the RTC result envelope and error codes. Rate
limit per pass, **shared across serverless instances**: a Postgres `rate_limits (key, window_start, count)` table
updated with one atomic `INSERT … ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limits.count + 1 RETURNING
count`, one-minute windows; the limit is stored per pass in `oauth_tokens.rate_limit_per_minute` (starting value 120,
allowed 1–600, IN-10), chosen when the pass is created and read from the pass row on every call; over the limit → HTTP
429 with `Retry-After` and code `rate_limited`. Never an in-memory counter. `GET /api/openapi.json` (generated, ≤30
operations: meta tools, whoami, workflows) for HTTP-only agents.

**Amendment 2026-10-30 (docs-accuracy; the code is the standard):** as built, RTC passes are stored in a dedicated
`rtc_passes` table (`src/db.js`), not as `oauth_tokens.kind = 'pass'` rows, and the per-pass limit is the
`rate_limit_per_minute` column on that same table. No `rate_limits` table exists in the schema. R1 and R2 above
describe the original design on these two storage points and are superseded there; pass behavior (issuance, areas,
revocation, limits) is as built in `src/rtc/` and `src/db.js`.

**R3. Conformance in CI, never a blocker.** When the hub's `packages/conformance` exists it runs against a locally
started server (fake Vercel) in this repo's CI, including the two-instance rate-limit check; a failure fails `ci`. Until
then this server's own write-contract tests over MCP, `vercel_call` and HTTPS cover the same behavior.

**R4. External contract, optional internal reuse.** RTC 1 doors remain service-owned and fully usable without
Hub or shared-library adoption. `src/core/` is an organizational boundary, not proof of portability. A separate
card may adopt selected immutable published `robinson-mcp-core` exports only after original-service parity and
reversible rollout. Provider dispatch, credentials, storage, permissions and approvals stay here. No automatic
all-export migration or K-3 dependency for R-series/Hub connectivity. Existing R-series acceptance is unchanged.

## 2. Schema

```sql
ALTER TABLE oauth_tokens ADD COLUMN IF NOT EXISTS allow_writes BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE oauth_tokens ADD COLUMN IF NOT EXISTS spend_limit_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE oauth_tokens ADD COLUMN IF NOT EXISTS areas TEXT[];
ALTER TABLE oauth_tokens ADD COLUMN IF NOT EXISTS project_ids TEXT[];
ALTER TABLE oauth_tokens ADD COLUMN IF NOT EXISTS for_hub BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE oauth_tokens ADD COLUMN IF NOT EXISTS rate_limit_per_minute INTEGER NOT NULL DEFAULT 120;
CREATE TABLE IF NOT EXISTS rate_limits (key TEXT NOT NULL, window_start TIMESTAMPTZ NOT NULL,
  count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (key, window_start));
```

The refresh-copy helper from A-3 copies every new connection-setting column (its test fails otherwise).

## 4. Work units

### R-1 — Passes (M, medium effort)
Tool: `vercel_create_pass`. Tests: shown once; expired → `pass_expired`; revoked → `pass_revoked`; read-only pass cannot
write through `vercel_call` or HTTPS; preview by default; spend limit $0 by default; project restriction refuses other
projects; 365-day life only with `for_hub`.
### R-2 — HTTPS tool API, manifest, OpenAPI (M)
Tests: write-contract helper through HTTPS (door #3); envelope and error codes per RTC §7; manifest counts match the
registry; OpenAPI valid with ≤30 operations; connector tokens and no token refused on `/api/tools`; rate-limit database
test with two independently created handler instances sharing one pass's limit, sending **overlapping** requests (150 at
once split across both): exactly 120 succeed, the rest get 429 — a read-then-update counter fails this test; a pass with
limit 5 gets 429 on its 6th call; old windows cleaned up.
### R-3 — RTC 1 conformance in CI (S)
Done when: the hub's conformance package passes in this repo's CI against a local server with fake Vercel.

## 5. Stop-and-ask points

1. The contract and this design disagree: the contract wins; amend this design in the same PR.

## 6. Acceptance mapping

| PLAN Batch R line | Evidence |
|---|---|
| Passes per RTC §2 | `tests/unit/passes.test.js` |
| HTTPS API per RTC §1/§7, same guards | write-contract through HTTPS |
| Shared rate limit | `tests/db/rate-limit.test.js` |
| RTC 1 conformance | CI job `conformance` |

## Amendments

(Dated entries only.)

**2026-10-26 — schema drift (design vs implemented code, unresolved).** This design's §2 specifies passes in
`oauth_tokens` (`kind='pass'`, `allow_writes`, `spend_limit_cents`, `areas`, `project_ids`, `for_hub`,
`rate_limit_per_minute`) and a separate `rate_limits` table. The implemented code instead stores issued passes in
`rtc_passes` (`src/db.js:40,962`), with per-pass atomic rate limiting via window columns on that table
(`src/db.js:96–107,968–969`), and `src/rtc/door.js:validPassRecord` requires `mode` preview/test and
`profile === 'read_only'` — so a write-capable pass cannot exist in the current schema. `vercel_create_pass` issues
owner-reviewed proposals only, not passes. Before R-1 write-capable passes resume, an amendment must decide whether
the design is updated to the `rtc_passes` model or the code is migrated to the `oauth_tokens` model, and record the
choice per the drift protocol. Do not build write passes on either model until that amendment exists.

**2026-10-27 — schema drift resolved for the as-built pass system (audit S3 refresh, VMCP-014).** The
implemented `rtc_passes` model is the truth for the pass system as built: issued passes live in `rtc_passes`
with per-pass atomic rate limiting via that table's window columns, and the current door serves read-only
passes (preview/test mode, `read_only` profile). §2's `oauth_tokens` pass columns (`allow_writes`,
`spend_limit_cents`, `areas`, `project_ids`, `for_hub`, `rate_limit_per_minute`) and the separate
`rate_limits` table are the pre-implementation design and are superseded as a description of the as-built
system; they are retained above as history. The atomic shared rate-limit requirement itself (never an
in-memory counter, per-pass 1–600 with the IN-10 default of 120) is unchanged and is met by the
`rtc_passes` window columns. R-1 write-capable passes remain future work: they may not be built on either
model until a fresh amendment adopts the `rtc_passes` model for writes — defining allow-writes, spend
(under the OP-2 delegation shape, BATCH-B amendment D-A) and revocation semantics there — or records an
explicit migration decision to the §2 model.

**2026-10-30 — the `rtc_passes` model is adopted for writes (owner ratification, card R-1W).** Chris
ratified doc-follows-code for pass storage on 2026-10-30 (passes live in `rtc_passes`; no `rate_limits`
table), and B-8's §5 resolution is ratified with it. This amendment is the fresh amendment the 2026-10-27
entry requires; it adopts the `rtc_passes` model for write-capable passes with these semantics:

- **Storage.** Additive columns on `rtc_passes`: `allow_writes BOOLEAN NOT NULL DEFAULT FALSE`,
  `spend_limit_cents INTEGER NOT NULL DEFAULT 0`, `project_ids JSONB` (NULL = no project restriction).
  Every existing row keeps exactly its current behavior: `allow_writes` false is today's read-only pass,
  and the read-only predicates in inspect/authorize are preserved verbatim for read passes.
- **Shape of a write pass.** `allow_writes = true`, `profile` ∈ {everyday, full} (the delegated
  connection profile the registry's visibility rule already understands), `mode` ∈ {preview, production}.
  TEST mode never writes. Every issuance path (owner-reviewed proposal and the direct setup form) sits
  behind the setup page's administrator passphrase, which satisfies R-1's rule that production + writes
  also needs the setup-page passphrase.
- **Dispatch.** The RTC door lists, describes and invokes a write tool for a write pass only when the
  tool's registered profiles include the pass profile, the tool's area is in the pass's areas, and the
  tool is a guarded write. Invocation runs the shared registry dispatcher, so the tool's exact
  `defineWrite` lifecycle (preflight, guards, durable replay, audit, independent read-back) is the pass's
  write path — there is no second executor. The batch route stays read-only.
- **Spend (OP-2 / BATCH-B D-A delegation shape).** The pass's `spend_limit_cents` is its standing
  delegation ceiling, chosen by the owner at issuance. Zero means spend-classified writes refuse on the
  pass. A fixed, known price at or under the ceiling executes under the pass delegation and is journaled
  as a pass delegation (never as the owner's own word). Recurring or unquantified spend always refuses on
  a pass: no provider-enforceable ceiling exists, the same rule the purchase-grant path applies.
  Enforcement lives in the write preflight's purchase branch, keyed on the server-minted pass fields of
  the frozen connection object, so caller arguments can never widen it and every door inherits it.
- **Project restriction.** When `project_ids` is set, the write executor refuses unless every declared
  target resolves to a project in the list (the id from `target.projectId`, or `target.id` when
  `kind === 'project'`, or `target.project`); a write whose targets resolve to no project refuses,
  because its scope cannot be proven. Enforced in the executor after targets are computed and before any
  dispatch — one seam, all doors.
- **Revocation and rate limiting.** `revokeRtcPass` already applies to any pass row; the door's per-call
  authorization re-checks revocation and expiry atomically, unchanged. The per-pass atomic rate window
  applies to write calls identically (one call, one unit).
