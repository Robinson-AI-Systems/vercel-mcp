# AUD-BM2 — BATCH-R completion/reconciliation amendment + R-1/R-2 record refresh

**Baseline inspected:** main `a104d234` (AUD-BH, #377).
**Source text:** the AUD-BM dossier (`r2-write-capable-pass-dossier-2026-10-31.md`,
audit goal workspace, 2026-10-31), which read the tree at this baseline and the
adopted RTC 2 spec in full. The dossier's headline verdict: the write-capable
RTC pass grant the R-1/R-2 records still describe as missing engineering was
built by **R-1W (PR #333)** and re-homed by **AUD-AU (PR #369)**; the
2026-10-30 BATCH-R amendment already adopted the `rtc_passes` model for
writes. What remains is bookkeeping, and this card is the bookkeeping.
**This card is docs + one description string:** no behavior change anywhere.

## The changes

1. **`docs/designs/BATCH-R.md`** — the dossier's drafted completion/reconciliation
   amendment appended verbatim to the Amendments section, dated 2026-10-31:
   §2 superseded as a schema description (operative schema = `rtc_passes` in
   `src/db.js`); the atomic window-column rate mechanics; issuance proof after
   the sign-in cleanup (owner-connection possession, cleanup D2 — the setup
   page the 2026-10-30 entry names is deleted, AUD-AV); the listing truth;
   the lifetime truth, including the recorded decision that the 365-day hub
   pass stays **unbuilt** until a hub consumer exists (RTC 2 §4.2 keeps it a
   MAY; reversible on the owner's word); and R-2's remainder dispositioned to
   acceptance legs. The 2026-10-30 R-1W amendment text is untouched — dated
   history; the new entry reconciles forward.
2. **`vercel_list_connections` description corrected** (`src/tools/observability.js`):
   the tool lists connector (OAuth) connections only (`db.listAccountConnections`
   reads `oauth_tokens`); its description claimed "connector/pass metadata".
   Passes are accounted by `listRtcPasses`, surfaced in the owner export and
   the `vercel_revoke_pass` preview. The registry string now says so, and the
   `docs/TOOL-CATALOG.md` row drops "and passes" in the same commit — the
   catalog note this repo's drift rules require for a tool-surface text change
   (checklist B). Handler, schema and results are byte-unchanged.
3. **Dated reconciliations on `docs/pr-cards/R-1.md` and `docs/pr-cards/R-2.md`**
   plus **dated revisit refreshes for R-1/R-2 in `docs/pr-cards/work-index.json`**
   (AUD-BC's V-1 shape: falsified premises corrected with evidence, `pr`
   records filled): the grant's delivery (R-1W #333, AUD-AU #369) recorded;
   UA-06 closed in source; R-2's bundled VMCP-002 production-enable leg
   recorded as separately resolved (AUD-AT owner tools under IN-09; AUD-BD
   #376 sign-in derivation). What genuinely remains is named: AUD-BM1 (the
   BATCH-B §3 write-contract suite through the HTTPS door) and AUD-BM3 (the
   live write-pass leg in the post-promotion battery). **Index statuses stay
   IN_PROGRESS** — live acceptance is still owed; the refresh corrects the
   premise, not the status.

## Catalog judgment

One tool's **description text only** (`vercel_list_connections`); no tool
added, removed or renamed; registry count unchanged. `docs/TOOL-CATALOG.md`
is updated in the first commit per drift checklist B (the row's prose), and
the corrected registry description stays within the 160-character listing
bound (100 characters).

## Evidence

`BASE_SHA=$(git rev-parse origin/main) npm run check` exit 0 read directly
at the exact head (docs check, index validation, lint, budgets — the
description change is inside the budget-checked registry), plus CI
(`ci` + `release-policy`) green at the same head. No live calls; nothing
deployed; batches with the release train.
