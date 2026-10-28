# AUD-C — Front door: curated default listing under the OP-1 budget (D-C)

Status: APPROVED — audit pipeline S5 packet (filed 2026-10-27). Design: `docs/designs/BATCH-C.md`, 2026-10-27 amendment **D-C**. Audit: VMCP-009 in `docs/MCP-AUDIT-2026-10-27.md`; ruling **OP-1** in `docs/DECISIONS.md`. Registered as the implementation vehicle in card C-2's revisit.
Baseline inspected: main `1f7859ce0dc3dda35f6298106c7e4d6635c8465b`. Prerequisites: C-1, C-2 MERGED. Migration: none (listing values on new issuances change; stored rows keep their values). Subsection mapping: behavior change inside the predefined C-2 subsection under the D-C amendment — not a new batch subsection, no new acceptance unit. Workload: medium (core dispatch + budget script).

## Read only these
- `docs/designs/BATCH-C.md`: the D-C amendment in full; C6, C9, C10 as filed.
- `docs/DECISIONS.md` OP-1 entry; `docs/pr-cards/C-2.md` (listing/meta as built).
- `src/core/mcp-server.js`: `listMcpTools` (today: anything not `compact` gets the full profile catalog).
- `src/db.js`: listing defaults — `createAuthCode` parameter default `'catalog'` (~line 642); `oauth_codes` / `oauth_tokens` columns `DEFAULT 'catalog'` (~lines 955, 959); RTC pass rows default `'compact'` (~line 965).
- `scripts/check-budgets.mjs`: `COMPACT_TOKENS_MAX = 5000`, `LISTING_TOKENS_MAX = 20000`, the per-profile catalog measurements.
- `src/core/meta.js`: confirm search/describe enumerates the whole registry regardless of listing (the escape hatch — expect no change; verify).
- `src/data/` (today only `dashboard-map.js`).
- Tests: `tests/unit/budgets.test.js`, `tests/unit/meta-discovery.test.js`, `tests/unit/meta-dispatch.test.js`.

## Drift check A
| Expected (design) | Actual at baseline | Consequence |
|---|---|---|
| Default listing = compact meta + measured most-used + compounds | `'catalog'` is the default in the auth-code path and both oauth tables; only RTC passes default to `compact`; no `front_door` listing value exists | Register the listing; move the *default* (not stored rows) to it |
| 5,000-token cap recorded as owner policy citing OP-1 | `check-budgets.mjs` enforces 20,000 as an engineering line; the 5,000 constant exists only for compact | Script gains a front-door measurement + a policy comment citing OP-1; the 20,000 catalog bound stays |
| Membership measured from real calls, versioned in-repo | No membership file exists; no call-count source has been mined | First membership ships as an explicitly labelled **SEED**; the measurement method is named in the PR and becomes the refresh procedure |

## Scope
**In:** the `front_door` listing in `listMcpTools` and everywhere a listing value is accepted/validated; default selection for new connections that do not choose; the versioned membership artifact; the budgets-script policy measurement; tests.
**Out (non-goals):** removing or shrinking `catalog` or `compact`; re-ranking by profile (front door is profile-independent in membership; profile gating still applies per tool); a usage-telemetry feature (membership refresh is a maintenance procedure over existing journal/change-log data, not new instrumentation); X-1's undo tool membership (it joins the front door when built, inside the same budget — BATCH-X note).

## Build contract
- Membership home (implementer's choice, recorded in the PR and in the budgets output): `src/data/front-door.json` — `{ version, basis: 'seed-2026-10-27', tools: [...] }` — or a `frontDoor: true` flag on registry entries in `src/core/registry.js`. One home, versioned, diff-able.
- Seed membership = the 5 compact meta-tools (`vercel_search_tools`, `vercel_describe_tool`, `vercel_call`, `vercel_recent_changes`, `vercel_get_result`) + the most-used tools by the best available evidence at build time (journal/change-log call counts where queryable; otherwise the C-2 card's core set), labelled SEED in the artifact and the PR. The PR states the source and date of the counts used, or states plainly that the seed is judgement-based pending the first measurement refresh.
- `src/core/mcp-server.js`: `listing === 'front_door'` returns the membership ∩ the connection's profile-permitted tools; unknown/future listing values keep today's fall-through (catalog) — do not change that failure shape.
- Defaults: new issuances that do not explicitly choose a listing get `front_door` (auth-code parameter default and the two oauth table defaults move from `'catalog'` to `'front_door'`); explicit `catalog`/`compact` choices are honored exactly as today; existing stored rows are **not** rewritten.
- `scripts/check-budgets.mjs`: measure the front-door listing at `read_only`, `everyday` and `full`; fail above 5,000 with a comment in the script recording the cap as **owner policy (OP-1, 2026-10-27)**, distinct from the C6 20,000 catalog sanity bound, which stays.

## Ordered steps
1. Membership artifact (seed) + registry/listing wiring in `listMcpTools`.
2. Issuance defaults; a disposable-DB check that a fresh token row defaults to `front_door` and an explicit `catalog` choice still stores `catalog`.
3. Budgets script: front-door measurement + policy comment.
4. Tests (below), then full gates.

## Acceptance (design D-C, verbatim — the audit's measurement probe as tests)
- `scripts/check-budgets.mjs` reports the default listing under 5,000 tokens at all three profiles, measured with the repo tokenizer.
- The check is proven live once in the implementing PR: a deliberately over-budget membership entry makes it fail; the proof is recorded in the PR and reverted.
- The budgets output names the membership source (file + version) it measured.
- `compact` and `catalog` listings are byte-identical to baseline in tool membership; `vercel_search_tools` under the front door still enumerates the full registry.
- A new connection with no listing choice lands on `front_door`; an existing stored `catalog` connection is untouched.

## Builder guardrails (binding, restated)
- Builders spend $0; tests/fixtures only; no live connection changes — never rewrite a real user's stored listing.
- Measurement claims come from the script's own output in the PR, never from estimates; if the tokenizer and a second estimator disagree materially, report both (audit S1 method).
- Fake secrets only; no real token use outside the X-2 scratch rules (IN-06).
- If code contradicts this packet or D-C, stop and file a dated design amendment; do not improvise a new rule.

## Stop and ask
- Measured membership cannot fit 5,000 tokens with the meta five included: stop — that is an owner-policy tension for Chris, not a builder decision; file the numbers, do not silently exceed or silently drop meta tools.
- Any door (connector setup, RTC issuance) that cannot express “no choice” vs an explicit `catalog` choice: stop for that door and record it; ship the doors that can.

## Done when
- Acceptance above is green with `npm run check`, `npm test`, and exact-head `ci` + `release-policy`.
- STATUS, this card and the C-2 index revisit are reconciled in the implementing PR. Successor packets inherit: the front door is the default context for every later compound tool (VMCP-012's undo joins it under the same budget). VMCP-009 closes only at S7.
