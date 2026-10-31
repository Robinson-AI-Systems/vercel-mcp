# AUD-BA — The 3AM watch runbook section

**Baseline inspected:** main `e914102` (AUD-AS, #365).
Source: owner/coordinator decision 2026-10-31 (the 3AM rule from the
Production Gate package): a scripted watch probes the front door, the
keyless-401 posture and the health endpoint, and wakes an agent on a
confirmed failure — nobody wakes the owner. AUD-AP (#363) built the
health surface the watch reads; the server repo still owed the
recovery half: the runbook the woken agent follows.

**The change.** One new section, `docs/DEPLOY.md` §9 "The 3AM watch —
failure runbook", plus a one-line cross-reference in
`docs/OWNER-GUIDE.md` next to its existing DEPLOY pointer.

**Placement.** DEPLOY.md is the operator document: it already carries
the §7 troubleshooting table and the §8 acceptance procedure, so the
overnight recovery steps sit where an operator at 3am looks. The owner
guide is the product-facing document; it gets only the cross-reference.

**What the section pins.**

- The watch's three legs, exactly as built: the front-door document
  (naming `endpoint`, `oauth`, `health`), `GET /api/health` (200 +
  `status: "ok"` healthy; 503/`degraded` is a triage signal, not an
  outage verdict), and keyless `POST /api/mcp` answering 401 in the
  documented unauthorized shape.
- A triage order that uses only surfaces this repo and its connections
  actually have: re-probe once; read the health document's five
  fields (`version` + `deployed_source_sha` say what is running);
  compare the deployed SHA with the `live` head and the official
  deployment list before blaming the code; then follow the degraded
  leg — store failure points at the database connection, metadata
  inconsistency at configuration — with authenticated depth in
  `vercel_whoami` and `vercel_recent_changes`. No invented commands.
- The escalation rule as decided: owner escalation only for
  owner-only needs (credentials, payment, legal) or a confirmed
  security/data-loss event; everything else is agent-handled and
  reported in the morning summary.
- The two prohibitions: no promotion outside the nightly train except
  the daily-live workflow's documented recovery dispatch
  (`recover_missed_daily`, owner-actor gated — verified in
  `.github/workflows/daily-live.yml`), and no writes against real
  teams while diagnosing a posture failure.

**Catalog judgment (checklist B).** Docs-only: no tool, registry or
code change, so drift checklist B is not triggered and no
`docs/TOOL-CATALOG.md` note is owed; this card + the STATUS bullet are
the docs reconciliation.

**Acceptance.**

- DEPLOY.md §9 present with the three legs, triage order, escalation
  rule and prohibitions above; OWNER-GUIDE cross-reference present.
- Every surface the section cites exists in the tree at this baseline
  (health endpoint AUD-AP, daily-live recovery input, `vercel_whoami`,
  `vercel_recent_changes`).
- `npm run check` green, read directly; CI `ci` + `release-policy`
  green at the exact head before merge. No live call is made by this
  card.
