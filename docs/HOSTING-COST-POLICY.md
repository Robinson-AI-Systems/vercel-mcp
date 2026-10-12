# Hosting cost and protected-main operating policy

Owner-directed checkpoint: October 12, 2026, America/Denver. This records settings saved and independently read back in GitHub, Vercel and Neon; it is not production activation or provider acceptance.

## Development and required checks

- Development PRs target `main`. GitHub's saved rule requires a pull request and successful **`ci` and `release-policy` checks from GitHub Actions**, including for administrators. Force pushes and branch deletions are disabled.
- Keep every existing local/Actions test, exact-head validation and repository self-review/review-resolution rule. `ci` remains the application verification gate; `release-policy` is an additional required main-target/release-policy gate. Do not skip either or use a bypass.
- Authorized agents may merge reviewed implementation PRs once the exact current head passes both gates. No approval-review count, merge queue, signed-commit, linear-history, deployment-success or up-to-date-rebase requirement was added. This does not waive existing review or conflict-resolution rules.
- Do not require or wait for disabled Vercel preview checks. Reconcile an older active branch with latest main so the existing target-policy workflow is included, then rerun its exact-head CI; do not reset another session's branch.

## Daily release and builds

Only the existing scheduled, checked workflow automatically advances `main` to `live`, at most once per America/Denver calendar day. The new protection matches exact `main` only and does not obstruct the scheduled `live` writer. Vercel Production tracks `live`; automatic Preview branch tracking is Disabled. Retain the live-only Git deployment configuration.

Do not merge development PRs into `live`, force-update it, delete promotion markers, manually trigger production builds, promote previews or release at a development-batch boundary. Record the scheduled promotion and actual source commit/READY separately after they happen; a passing main CI or historical main deployment is not proof of a live release. The first scheduled promotion and Basic-build performance remain future observations, not completed acceptance.

This repository has no separate linked Vercel project in the verified account inventory. Do not create hosting or a database merely to match the other servers. When deployment becomes approved, re-inventory and use the idle-cost settings below.

All six non-Cortiware existing linked projects were verified Basic/queued. Vercel's team default for future projects remains Elastic and was not changed. Do not buy additions or assume new projects inherit Basic. Recheck actual project settings when hosting is separately authorized; do not trigger a paid test deployment merely to verify this document.

## Database and spending

No separate Neon project for this repository appeared in the verified inventory. Do not provision resources as a documentation task.

All seven existing Neon project defaults and eleven computes retain 0.25 CU caps and five-minute autosuspend. All six non-Cortiware primary branches are protected; Cortiware's primary branch is unprotected and deliberately deferred. This is an idle-development profile, not proof of production capacity.

Preserve data, recovery branches, backups, retention, roles, credentials and pooled/direct connection choices. No consolidation or SQL keepalive/health polling was authorized. Raising capacity, changing always-on behavior, adding paid resources or enabling automatic spending-budget pausing requires a separate owner decision. Metadata inspection avoids waking computes.

Stripe LIVE remains disabled. Existing independently authenticated owner approvals for production access, real money-out and other gated actions remain mandatory. Cortiware stays back-burnered. No plan upgrade, paid addon, production activation or spending authorization follows from these settings.

## Integration and handoff

Include this record and its operating-instruction pointer in the next substantive implementation PR; do not open a documentation-only PR or count this prepared branch as an implementation PR. Add a short checkpoint to `docs/STATUS.md` distinguishing saved infrastructure settings from unverified scheduled/runtime acceptance. Reconcile older statements such as “single ci merge gate”, “main deploys automatically” and “wait for preview” with this newer owner policy, without rewriting unrelated history.

At session start and before merge, inspect live GitHub state because other agents are active. At session end retain the existing five-substantial-PR / next-multiple-of-five cadence and concise continuation prompt. No implementation PR was created for this documentation handoff.
