# Design — Batch C: Cheap on context (small results, compact listing, budgets)

Status: **APPROVED** (Chris, 2026-10-10). Written 2026-10-10. Scope and acceptance: `docs/PLAN.md` → Batch C.
Cards C-1, C-2. Depends on Batch B. Every later tool is built to these rules, so this batch comes before any area tools.

Why: a 236-tool server listed the ordinary way costs tens of thousands of tokens before an agent does anything, and
Vercel's raw objects are large (a deployment is tens of kilobytes; a build log can be megabytes). Current practice
(October 2026): tool search in the client, progressive disclosure (search → describe → call), small results, workflows,
and MCP tool annotations — the same rules as the Stripe MCP's Batch C and contract §5/§7.

## 0. Verify before starting

| # | Assumption | How to check |
|---|---|---|
| C1 | The MCP SDK version in `package.json` supports tool `annotations`, `outputSchema` and `structuredContent` | `grep -rn "outputSchema\|annotations" node_modules/@modelcontextprotocol/sdk/dist/esm/types.d.ts \| head` |
| C2 | Each tool module exports registry metadata (`area`, `profiles`, `writes`, `audience`) from Batch B | `grep -n "writes:" src/tools/*.js \| head` |

## 1. Decisions

**C1. Two listing modes per connection.** `catalog` (default for claude.ai, whose client does tool search): every tool
in the profile, listing description ≤160 characters starting with the action (`PRODUCTION:` first for `PR` tools,
`SPENDS MONEY:` first for `$` tools); longer guidance lives in property descriptions and `vercel_describe_tool`.
`compact` (default for every other client): only the meta-tools, `vercel_whoami`, `vercel_api_search` (once Batch U
exists) and the `vercel_workflow_*` tools — about 20 tools, under 5,000 tokens, reaching everything.

**C2. Meta-tools.** `vercel_search_tools(query, area?, audience?, limit=10)` → names, one-line descriptions, safety
marks; `vercel_describe_tool(name)` → full schema and guidance; `vercel_call(name, args)` → dispatches into the
**wrapped** handler, so every guard applies; `vercel_batch(calls[≤10])` → reads only; `vercel_get_result(handle, page?,
fields?)`.

**C3. Small results by default.** Every read tool gets `detail: 'summary'|'full'` (default summary) and `fields` (comma
list of dotted paths) from a registry layer, not by hand. One summary mapper per Vercel object type in
`src/tools/summaries.js` (6–12 fields a person reads): project (id, name, framework, productionUrl, lastProductionAt_local,
gitRepo, productionBranch, paused, nodeVersion), deployment (id, url, target, state, branch, commitSha7, commitMessage
first line, createdAt_local, errorSummary), env variable (key, targets, kind, gitBranch, updatedAt_local — never value),
domain, project domain, DNS record, certificate, alias, member, token (name, scope, expiresAt_local, lastUsed — never
value), firewall rule (in words), drain, webhook (host only), charge line. Lists return one page (default 20, max 100)
with `next` explained in words. **Logs** are summarized by default: counts by level, the first error with 10 lines of
context, the last 20 lines; full text behind a handle.

**C4. Size cap and handles.** A result over 8 KB returns the first part, a count, a one-line summary ("37 deployments in
7 days, 3 failed") and a handle `res_…`; the full result is kept 24 hours in `result_store`, readable only by the same
connection or pass.

**C5. Annotations and structured output.** Every tool sets `readOnlyHint`, `destructiveHint`, `idempotentHint`,
`openWorldHint` from its metadata. Workflow tools declare `outputSchema` and return `structuredContent` plus a short
plain-English text line.

**C6. Budgets are tests.** `scripts/check-budgets.mjs` (in `npm run check`) fails when: compact listing ≥5,000 tokens;
`everyday` catalog listing ≥20,000; any listing description >160 characters; any schema ≥1,500 tokens; any read tool's
default response on 100-item fixtures >8 KB without a handle; a log tool's default response >8 KB. Token counts use a
pinned tokenizer package and are printed in CI.

## 2. Schema

```sql
CREATE TABLE IF NOT EXISTS result_store (handle TEXT PRIMARY KEY, connection TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), expires_at TIMESTAMPTZ NOT NULL, summary TEXT, body JSONB NOT NULL);
CREATE INDEX IF NOT EXISTS result_store_expires ON result_store (expires_at);
```

Expired rows are deleted by the same request path (`DELETE … WHERE expires_at < now()` limited to 100 rows), no cron.

## 4. Work units

### C-1 — Summaries, fields, detail, handles, annotations (M)
Files: `src/tools/summaries.js`, `src/core/result-rules.js`, `src/db.js`, `src/tools/server.js` (`vercel_get_result`).
Tests: field projection and unknown-path note; handle isolation between connections; annotation consistency; size cap
on fixtures; env summary never has a `value` key even with `detail: 'full'`.

### C-2 — Listing modes, meta-tools, budgets (M) — may group with C-1
Files: `src/core/meta.js`, `api/mcp.js` (listing per connection, `?listing=` override), `scripts/check-budgets.mjs`.
Tools: `vercel_search_tools`, `vercel_describe_tool`, `vercel_call`, `vercel_batch`.
Tests: `vercel_call` passes the write-contract helper (door #2); refuses tools outside the profile; `vercel_batch`
refuses writes; budget script fails on a planted 161-character description (prove once).

## 5. Stop-and-ask points

1. The SDK lacks annotations or structured output (C1 false): build the rest; record the gap; amend.

## 6. Acceptance mapping

| PLAN Batch C line | Evidence |
|---|---|
| Compact <5k, everyday catalog <20k tokens | CI budget output |
| Every door enforces the same guards | write-contract through `vercel_call` |
| Handles isolated | `tests/db/result-store.test.js` |

## Amendments

(Dated entries only.)

**2026-10-27 — D-C design: the default listing becomes the curated front door (audit VMCP-009; owner ruling OP-1).** OP-1 (`docs/DECISIONS.md`): the front page is "compact plus the most commonly used tools and compound tools", budget 5,000 tokens. Measured at the audit baseline with the repo tokenizer, the listing a new connection gets by default is the catalog (everyday ≈15,347 tokens; full profile 24,878 — past the C6 20,000 line with nothing enforcing it), while the compact listing C1 designed (7 tools) costs ≈1,016 tokens.

- **New default.** A `front_door` listing, registered alongside compact/catalog/custom, becomes the default selection when a connection does not choose one: the compact meta-tool core + the most commonly used task tools + the compound tools (`vercel_batch`, the `vercel_workflow_*` family as built). The catalog listing stays available per connection and via `?listing=`, unchanged; `vercel_search_tools` still enumerates the whole registry.
- **Membership is measured, not guessed.** "Most commonly used" is computed from journaled tool-call counts per profile, reviewed at each audit delta review and each release. The membership list is versioned in ONE in-repo home — the implementing PR chooses `src/data/front-door.json` or a `frontDoor` flag on the registry entries — and changes only by PR, with the measurement quoted in the PR body. Until usage data exists, the first membership is a labelled SEED taken from the everyday-profile core; a seed is never presented as measured.
- **Budgets.** `scripts/check-budgets.mjs` records the 5,000-token cap on the default listing as **owner policy, citing OP-1** — not a builder default. The C6 20,000 cap stays as a catalog sanity bound (an engineering number, not a policy about what a session may see). The description and schema caps are unchanged.
- **Acceptance:** `npm run check` reports the default listing under 5,000 tokens at read_only, everyday and full profiles; adding a planted over-budget tool to the front-door membership makes the check fail (proven once in the implementing PR's tests); the check output names the membership source; compact and catalog listings behave exactly as before.

**2026-10-27 — D-D design: stored-result symmetry for the write branch (audit findings VMCP-008, VMCP-010, VMCP-011).** C4's stored-result machinery already serves oversized READS through the dispatcher's fallback. Three places on the write side can still die by size alone; one mechanism must cover all three:

- **Write results (VMCP-011).** The write branch of the dispatcher's result shaping gains the same stored fallback reads have: an oversized applied write returns a verified receipt (status, request key, confirmed state) plus a `res_…` handle for the full result, under C4's connection-scoped storage rules. Size-based shaping never throws past the dispatcher.
- **Write previews and targets (VMCP-008).** The 8 KB preview ceiling in the write preflight becomes a display bound, not a refusal: an oversized preview or target is stored and referenced by handle in the preview payload and in the change-log row, and the write proceeds to confirmation. The "Could not safely preview this write" refusal is reserved for genuine classification/content failures (the secret-stripping error path stays).
- **Self-shaped families (VMCP-010).** Tool families that shape their own results before the dispatcher (e.g. the globalconfig family's `output()`) route through the same prepare/stored fallback, so a result between the family's own ~8 KB ceiling and the dispatcher's returns a handle instead of a bare error.
- **Acceptance — the register's executed probes become the tests:** a write whose upstream result is ~41 KB / 300 records returns a handle + verified receipt instead of a `RangeError`; a write whose target JSON exceeds 8 KB executes with a stored-preview reference instead of refusing; a globalconfig-family result over the inline ceiling returns a handle readable via `vercel_get_result` by the same connection and refused to any other.
