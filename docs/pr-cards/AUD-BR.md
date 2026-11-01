# AUD-BR — Record filing for the 2026-11-01 post-promotion pack (docs only)

Filed by the coordinator at the close of the post-promotion pack, executing the
record-filing pass the Production Gate report's FINAL carries. No code, no tool,
no catalog change; registry unchanged (254 rows / 253 registered).

## What this PR files

- **R-1 card**: a dated record-filing note correcting the stale "Preserve
  current 60-unit quota" sentence in its Remaining-acceptance paragraph (the
  per-pass default has been 120/min since R-2, PR #219; 60 survives only on
  passes issued before that change — the fact was already recorded on the same
  card by AUD-BM2 and in R-2's drift table; the old sentence was never updated)
  and recording that R-1's live acceptance was discharged 2026-11-01.
- **Work index (R-1 entry)**: a dated refresh appended to the entry's reason —
  write passes have now been issued live (three, in the pack), superseding the
  2026-10-31 sentence that none had ever been issued on the production server.
  Status stays IN_PROGRESS under the AUD-BC lifecycle ruling.
- **Audit register**: a dated addendum recording the pack's outcomes.

## The pack outcomes recorded (2026-11-01, all live on the promoted build)

- **AUD-BD / AUD-AZ live proof**: the owner's fresh sign-in on the new branded
  origin (AUD-BO) derived production / full / front_door with the read-only
  switch off, exactly as designed.
- **VMCP-028 CLOSED on live evidence**: guarded delete of an unaliased ERROR
  preview deployment (plan text verified verbatim), read-back not_found.
- **VMCP-013 CLOSED on live evidence**: first live `vercel_api_write` calls
  (createFlag + deleteFlag round trip on a scratch project, receipts and
  read-backs through the universal door).
- **R-1 live acceptance discharged**: first live pass issuance (TEST + PREVIEW
  read passes via `vercel_issue_pass`, bearers by one-time reveal); the repo's
  connected-acceptance harness passed its before phase (origin, discovery,
  anonymous denial, test identity/isolation, provider denial, preview scope)
  and its after-revocation phase (dedicated `pass_revoked` refusal proven).
  Expiry refusal is CI-proven (AUD-BG), not live-waited.
- **AUD-BM3 substantially proven; two atoms blocked on AUD-BQ**: write passes
  issued live (identity/attestation with write fields, provider reads, scope
  refusals, revocation all proven through the HTTPS door); the guarded-write
  execution atom — and behind it the zero-ceiling spend refusal — is blocked.
- **AUD-BP (new finding)**: `vercel_dev_preview_branch` fails deterministically
  at the deployed server (outcome_unknown, ERR_INVALID_ARG_TYPE, no provider
  effect, run left object-less and uncleanable by the tool). VMCP-016 branch G
  is blocked on it; the git fixture project is retained as its repro subject.
- **AUD-BQ (new finding)**: guarded writes through the RTC HTTPS door fail at
  plan stage with 503 service_error ("could not complete the read") for a
  full-profile write pass, while the same tool plans/applies via the owner
  OAuth connection and pass reads succeed at the same door. Lead hypothesis on
  the register entry (the writable provider bind's durable replay-store
  requirement vs the door's context) — diagnosis is the card's work, not this
  filing's claim.
- **Debris, named**: run `run_20261101_vmcp016g` (object-less, cleanup refuses
  it — AUD-BP); the leg-(f) static run's project
  `the leg-(f) static run project (id in the pack evidence)` blocked in cleanup with its two READY
  probe deployments inside (guarded deletes admit only CANCELED/ERROR
  subjects); two inert DCR registration records from the AUD-BO diagnosis (no
  deletion surface exists).

## Verification

Docs-only. `npm run check` at the exact head (the repo's validators cover the
work index and register shape); pre-push conflict-marker grep clean.
