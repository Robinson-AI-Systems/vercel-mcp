# Drift and reconciliation — start of every PR, end of every PR, end of every batch

Code moves while plans sit still. This is how the implementing model keeps plan, cards and code in agreement without
stopping for a planning session. Copied in shape from the Stripe MCP's protocol (2026-10-10). Three checklists:
**A** before coding each PR, **B** inside each PR (written as if merged), **C** when a batch finishes.

This repo has two extra sources of drift: **Vercel itself** (per-operation path versions, the vendored OpenAPI snapshot,
products being renamed — Edge Config became Global Config on 2026-07-29) and **the code copied from the core package,
the Stripe MCP or the Google Workspace MCP** (A-1 records the source commit).

| Kind | Example | Do this |
|---|---|---|
| Mechanical | file moved, helper renamed, fixture changed | adapt in this PR, correct the card, run the regression |
| Already delivered | the card's tool exists with a passing write-contract test | remove it from the card, cite the PR/test |
| Compatible extension | Vercel added an optional parameter or enum value | include it in schema, summaries and tests |
| Vercel semantic | an operation the design relies on is missing from the snapshot, moved to a new path version, is plan-gated, or behaves differently against `emulate`/the real team | don't guess. Record Vercel's actual answer, propose a dated amendment to the design, continue other work |
| Snapshot move | a newer OpenAPI snapshot is needed | its own card: `scripts/openapi-diff.mjs` old new, review every changed operation the server uses, update `operations.js` and tests |
| Semantic (ours) | different production rule, spend rule, secret handling, token handling, pass permissions | dated amendment, reviewed in the current PR before coding that slice |
| Owner-only | production enabling, buying, a default that changes spend limits or protected resources | keep the gate and its `IN-xx`; never pretend it is done |
| Resolved blocker, unfinished code | IN-07/IN-08 answered while D-1 remains IN_PROGRESS | retain the card, record the resolution and the next actionable checkpoint in work-index; do not silently leave it blocked or equate approval with acceptance |

## Outcome and acceptance rules across every PR/batch

Before choosing work, reconcile newly answered IN-xx owner decisions and
changes to dependency merge state, CI, hosting, provider or credentials.
Use `node scripts/validate-work-queue.mjs --eligible` and reconcile due
work rather than letting postponed cards disappear. Every deferred card's
`revisit` must name its exact missing evidence/decision, dependencies,
eligibility condition, responsible owner, next action and checkpoint.
A resolved trigger enters the eligible queue without re-asking the owner;
the implementing agent still verifies the remaining actual acceptance.

For each active milestone, keep a compact acceptance matrix separating
implementation, meaningful local/CI proof, deployed HTTPS behavior,
authenticated custom MCP, Hub real routes/revocation and intentionally
unsupported operations. A PR merges only after its own code/review gates;
a milestone closes only when the distinct required criteria are met.
Five substantive PRs is the normal planning batch size, not a quality
metric or a license to pad. Incorporate this process into substantive
implementation PRs, not dedicated docs-only PRs. At handoff summarize
capability advanced, what was genuinely proven, remaining blockers and
the next eligible step.

## A. Start of every PR (one bounded pass, ~10 minutes)

1. Record: current `main` SHA, the predecessor's merged SHA, the card's "Baseline inspected" SHA.
2. Read the predecessor PR's description (dispositions, carried findings) and the resume note if present.
   **Revisit sweep:** compare non-merged `work-index.json` revisit entries
   to OWNER-INPUTS and dependency/CI state; perform due actions before unrelated
   features. If still gated, update exact reason, evidence, owner and next checkpoint.
   A completed owner answer may still leave code or real acceptance unfinished.
3. `git diff --name-status <card-baseline>..origin/main -- <card's paths> | head -50`; read each changed function the
   card relies on (≤150 lines).
4. For each Vercel operation the card uses: confirm it exists in the vendored snapshot
   (`node scripts/openapi-find.mjs "<operation>"`) with the parameters the card names, at the path version in
   `src/vercel/operations.js`.
5. Write the table in the PR description, then fix the card before coding:

| Card assumption | Actual at `main` / in the snapshot | Kind | Card correction / test |
|---|---|---|---|

## B. End of every PR (inside the same PR, written as if it had already merged)

CI enforces the minimum (`scripts/check-docs-updated.mjs`): a PR that changes `api/`, `src/` or `scripts/` must also
change `docs/STATUS.md` and its card or `work-index.json`, and `docs/TOOL-CATALOG.md` when it adds or changes a tool —
unless the PR description says "Docs-update: not needed — <reason>".

1. The card says `MERGED (#n)`; anything split off names its new owner card.
2. Successor card updated (baseline, changed paths/signatures, carried low-risk findings). If it is JIT, put the same
   facts in `docs/designs/CHANGES-SINCE-DESIGN.md`.
3. Living docs: TOOL-CATALOG (Card column gains `built #n`), ARCHITECTURE (tables, env vars, endpoints, snapshot),
   GO-LIVE-CHECKLIST (new switch), OWNER-INPUTS (new question or applied answer), OWNER-GUIDE (something Chris can now
   ask for), APP-NEEDS-APPLIANCE-DESK (a row now covered).
4. Queue: STATUS says this merged and names the next card; `work-index.json`
   status updated; delete the resume note. For every unfinished/blocked successor
   keep a validated revisit trigger/checkpoint; distinguish answered decision from
   implementation, external acceptance and intentionally unsupported operations.

## C. End of every batch (reconcile in the last substantive PR)

1. Every PLAN acceptance item for the batch checked with evidence; anything unproved stays open with an owner card.
2. Living docs match the code.
3. Retire what no longer instructs anyone (`git mv` to `docs/archive/<folder>/`, RETIRED banner at the top, update
   references, one row in `docs/archive/README.md`, one DECISIONS entry).
4. Run the next batch design's "0. Verify before starting" table against today's code and the snapshot; amend or record
   "no drift" in STATUS; write the next batch's first card.
5. MASTER-ROADMAP, `work-index.json`, STATUS, one DECISIONS entry; tell Chris in plain English.
   At every batch boundary revisit all still-open cards, reconcile any newly
   answered owner inputs, and enforce permitted read-only dependency exceptions.
   Never drop a postponed card from the queue.

## Planning while a card is being built

A planning or docs PR that lands while a card is in progress does not edit that card's file, status lines or
`work-index.json` entry; it adds its own sections and says which in-flight card it affects. The implementer reconciles
once, at the PR boundary, by merging `main`.
