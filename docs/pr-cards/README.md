# Execution cards — just in time

Same system as the Stripe MCP and Appliance Desk. The implementing agent writes a short card for the current unit and,
when useful, its immediate successor. Sol 5.6 at light/medium effort is the intended routine use. Avoid writing distant
cards whose prerequisites are hypothetical; `work-index.json` preserves all later scope. A missing card is work, not a
reason to stop. Designs govern behavior; cards cannot silently override them.

## Minimum card (usually 40–100 lines)

- ID, title, design section, prerequisites, "Baseline inspected" SHA.
- One risk area, migration ownership (if any), realistic budget (≤500 production lines).
- **Read only these:** a bounded list of design headings and files (with line ranges when long).
- Drift check A table (or "first card: no prior code").
- Build contract: files, exported signatures, which tools (by TOOL-CATALOG name) with their safety marks, production /
  spend / access / secret declarations, self-protection and profile notes, summaries used, Vercel operations (method +
  path from `scripts/openapi-find.mjs`).
- Named tests: unit, write-contract per write tool, request-shape per call, `emulate` where it covers the call, db when
  SQL changes.
- Commands to run (with `set -o pipefail` when piping).
- Done when: observable conditions; what the successor inherits.

Validate coverage with `python3 docs/pr-cards/validate-index.py`.

## Execution detail without extra discovery

Use [implementation guidance](../implementation-guidance/README.md) to select only the recipe for this unit.
Record existing paths separately from proposed paths. Include exact exported signatures, argument → API/SQL
mappings, before/read-back invariants, ordered steps, named fixtures with expected outcomes and forbidden side effects,
focused commands, dependency evidence, and what the successor inherits. Copy patterns only after checking the baseline;
the guidance is a locator, not a replacement for approved scope or drift checklist A.
For the next B-8b slice, use the [worked example](../implementation-guidance/B-8b.md) when writing its JIT card.
Do not prewrite distant cards or mark proposed helpers as implemented.

## Effort guide for Sol 5.6

Light: read tools in an area whose pattern already exists; docs cards. Medium: safety layer, guards, production and
spend tools, tokens, login, passes, universal tools, anything touching SQL. A Sonnet/Opus second opinion is optional and
limited to one concrete question; no mandatory model switch.
