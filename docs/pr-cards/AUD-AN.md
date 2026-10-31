# AUD-AN — Documentation audit 2026-10-31: living docs re-based to the code

**Baseline inspected:** main `8fb9e83fc7cb36c1fd01eecb5df07f2ea3aaa7f9` (post-promotion head; the
2026-10-31 promotion took this head to `live`).

**Commission.** Owner-ordered 2026-10-31: audit ALL vercel-mcp documentation against the actual
codebase and fix the docs where they disagree. This audit is also Production Gate item 6 (docs
truth) evidence. Method: code is ground truth; docs are corrected to the code, never the reverse.
Where a doc-vs-code contradiction looked like a code bug, neither side was changed — it is filed
in the audit report as a candidate finding.

**Ground truth used (all measured at the baseline head, not quoted from docs):**

- Registry: 241 catalog tools, **240 registered** (`scripts/check-catalog.mjs`); the one unbuilt
  row is `vercel_admin_overview`, closed by owner ruling IN-16 (ratified 2026-10-30).
- Front door: `src/data/front-door.json` v2, 33 tools; listings read_only 3,617 / everyday 4,514 /
  full 4,894 tokens, each under the OP-1 cap of 5,000 (`scripts/check-budgets.mjs`).
- Profile visibility (registry): cumulative read_only 103 / everyday 144 / full 240; lowest-profile
  distribution read_only 103 / everyday 41 / full 96.
- `SCHEMA_TABLES` = 19 tables (incl. `blob_store_connections`, `known_apps`).
- Service identity: `SERVICE_DISPLAY_NAME = 'Vercel by Robinson AI Systems'`
  (`src/service-identity.js`); "Vercel Unleashed by Robinson AI Systems" is front-door page
  presentation only (`src/front-door.js`); branded origin `https://vercel.robinsonaisystems.com`.
- `SECURITY_SEAT_DISCLOSURE` (`src/tools/members.js`) matches the catalog's AUD-AJ note verbatim.
- RTC passes: R-1W shipped write-capable passes (`rtc_passes`); owner export is a setup-page
  action (`export_owner_data`), not an MCP tool.

**PR split (one coherent doc area each; every PR carries its own dated STATUS bullet):**

1. Catalog & counts — TOOL-CATALOG header/totals; implementation-guidance README + REMAINING
   re-base notes; this card.
2. Operator & connection docs — DEPLOY, CLIENT-CONNECTIONS.
3. Front page & guides — README, OWNER-GUIDE, GO-LIVE-CHECKLIST.
4. Architecture, roadmap & register — ARCHITECTURE, START-HERE, RTC-HUB-INTEGRATION, PLAN,
   MASTER-ROADMAP, OWNER-INPUTS dated addenda, the MCP-AUDIT register A-13 addendum, and the
   AGENTS.md Batch M-4 paragraph (stale factual claim: `@vercel/blob` and `src/vercel/blob.js`
   both exist).

**Conventions applied.** Docs-only changes: drift checklist B is not triggered (no `api/`, `src/`
or `scripts/` changes); the AUD card-file convention is followed (card file, no work-index entry —
AUD cards are not indexed, per the AUD-AK precedent and `validate-index.py`'s index-driven
checks). Dated records are history and are not rewritten: STATUS entries, DECISIONS entries, the
audit register's dated findings (one dated addendum only, for A-13's shipped build work),
OWNER-INPUTS rulings (dated addenda only), designs and pr-cards. The sign-in cleanup redesign is
being dossier'd separately — docs describe the CURRENT shipped sign-in; the redesign is not
documented as shipped.

**Candidate findings filed, not fixed (doc/code contradictions that may be code-side):**

- `scripts/check-budgets.mjs` line 99 prints the everyday-catalog label as `/<20000` while the
  enforced constant `LISTING_TOKENS_MAX` is 25500 (line 8) — cosmetic log-label staleness in code.
- `docs/pr-cards/work-index.json` statuses lag the 2026-10-30 build-out (merged cards still
  APPROVED/IN_PROGRESS); index lifecycle semantics belong to the pipeline's session tooling, so
  the audit reconciles reader-facing prose instead of flipping statuses.

**Done when:** the four PRs are merged at green exact heads with self-reviews naming the head
SHA, and the audit report (inventory, every disagreement with citations, PR list, candidate
findings, degraded coverage) is delivered to the coordinator. No promotion, no live calls.
