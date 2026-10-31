# AUD-BJ — Production Gate hygiene: LICENSE, the rollback move, the budgets label

**Baseline inspected:** main `a104d234` (AUD-BH, #377).
Source: the Production Gate report filed 2026-10-31 (goal record:
`production-gate-report-2026-10-31.md`). Three of its items are small,
source-only and owe no live evidence, so they are bundled into one PR
under the owner's cost rule and the 2026-10-31 finish directive
("finish building Vercel according to both its repo and any
outstanding plans"): gate item 3.5 is a **FAIL** (the public repo has
no LICENSE file), gap **O-7.2** (DEPLOY.md §9 — the 3AM runbook
AUD-BA added — names no rollback move), and the check-budgets stale
label, the candidate finding both documentation passes carried
(AUD-AN, AUD-AY).

**The changes.**

1. **`LICENSE`** (new, repo root). Robinson AI Systems' established
   proprietary product text, mirrored byte-for-byte from
   `Robinson-AI-Systems/penpal` `LICENSE` — verified identical by git
   blob hash (`9f0194ea…`) and byte count (1,035). Holder line:
   "Copyright (c) 2026 Robinson AI Systems. All rights reserved." No
   novel legal language is drafted. The other sibling,
   glimmer-operator-package's LICENSE, is project-specific (named
   collaborators, one project) and was not used. This closes the
   missing-file FAIL only — it is not the legal review: the gate's
   attorney flag stands, and counsel confirms this text at the
   pre-pricing attorney review the attorney packet is prepared for.
2. **`docs/DEPLOY.md` §9** gains the rollback move, written from the
   release mechanism exactly as it exists — see "What the rollback
   section pins" below.
3. **`scripts/check-budgets.mjs`.** The summary line printed
   `everyday catalog …/<20000` while the enforced bound is
   `LISTING_TOKENS_MAX = 25500` (stepped in W-6; the header comment
   carries the full raise history). The label now interpolates the
   constant, so it cannot silently go stale again. The bound itself
   does not change; OP-1's 5,000-token front-door cap is untouched;
   the compact (`<5000`) and schema (`<1500`) labels already matched
   their constants.

**What the rollback section pins** — every claim grounded in
`.github/release/promote-live.mjs`, `.github/workflows/daily-live.yml`
and `.github/release/policy.json` at this baseline:

- **No backward move exists in the mechanism.** `promote-live.mjs`
  only ever fast-forwards `live` to `main`'s current head, after the
  required checks (`ci` + `release-policy`, per policy.json) pass at
  that head and `live` proves an ancestor of `main`; the workflow's
  recovery dispatch promotes that same head. Neither takes a target
  commit. The runbook says so rather than inventing one.
- **Fix forward is the supported rollback.** The correction (fix or
  revert) lands on `main` through the normal PR gates; the checked
  path then moves `live` — the day's scheduled promotion, or, when
  the day's `live-promotion/<date>` marker already consumed the day,
  the owner deletes that marker tag and runs the recovery dispatch
  (`recover_missed_daily`, owner-actor gated). The script no-ops
  while the marker stands; after deletion it re-runs the full check
  gate at the new head before moving `live`. Nothing in this path
  skips a check. (The marker-deletion override is the path proven
  live on 2026-10-30.)
- **The emergency ref move, with its limits stated.** An operator
  with write access points `live` directly at the last known-good
  commit (`git push origin <good-sha>:refs/heads/live`; the `live`
  branch carries no branch protection — read back 2026-10-31). The
  target comes from the promotion tags: each `live-promotion/<date>`
  tag names the exact `main` commit promoted that day, so the most
  recent tag before the bad promotion names the previous live head.
  The move is safe for the mechanism only because every promoted
  commit is an ancestor of `main` — a target outside `main`'s history
  makes every later promotion refuse ("live has diverged"). Two
  limits, stated in the runbook: it bypasses the check gate (the
  target was check-green when promoted; the move itself is
  unchecked), and it consumes no day marker, so the next scheduled
  promotion fast-forwards `live` back to `main`'s head — the
  fix-forward must land immediately or the rollback undoes itself.
  It is a bridge, not a destination.
- **Verification.** Vercel builds only `live`, so: a READY production
  deployment built from the target commit in the official deployment
  list, `GET /api/health` reporting `deployed_source_sha` equal to
  that commit with `status: "ok"`, then the watch's three legs
  re-run.

**Catalog judgment (checklist B).** No tool is added, removed or
renamed; the registry is unchanged; the only code change is a printed
label in a check script, and no enforced bound moves. No
`docs/TOOL-CATALOG.md` note is owed; this card + the STATUS bullet are
the docs reconciliation.

**Acceptance.**

- `LICENSE` present at the root, byte-identical to the penpal sibling
  (blob hash equal).
- DEPLOY.md §9 names the rollback move as above; every mechanism
  claim in it traceable to the three release files named.
- `check-budgets` output prints the everyday catalog bound as
  `<25500`; `npm run check` green, read directly; CI `ci` +
  `release-policy` green at the exact head before merge. No live call
  is made by this card; the changes ride the nightly train.
