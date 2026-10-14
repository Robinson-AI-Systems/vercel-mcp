<!-- Current repair also records no-change daily receipts: backups cannot publish later same-day development after a successful no-op. -->
## October 14 owner-requested daily release recovery repair — current

Owner request on October 14: investigate and repair missed daily releases across the MCP repositories and Appliance Desk, including the quoted owner-run checked recovery. This supersedes the prior scheduled-only/no-new-trigger restriction for missed-event recovery only. Primary 00:01 Denver remains; retries are 00:17, 01:17 and 05:37 Denver plus 12:43 UTC. Explicit recovery defaults OFF and requires both the original actor and the triggering actor to be christcr2012, main, true recovery input and elapsed midnight. Every path retains successful exact-main CI, ancestry, atomic once-per-Denver-day receipt and independent readback. No production-provider activation, spending, force push or preview build is authorized.

Local release safety tests pass. Merge requires exact-head application CI and review resolution. Source repair is separate from observed schedule execution and Vercel READY/alias proof; inspect actual daily run and receipt, do not equate main/live drift after a release with failure. These infrastructure PRs do not replace the existing substantive implementation batch.

# Owner midnight release schedule

Owner instruction 2026-10-13: schedule these six MCP repositories at 00:01 Denver, then manually release their checked revisions after setup work.

Use one daily cron with native America/Denver timezone; preserve green-CI, atomic Denver-day marker, fast-forward-only release and independent provider/production/spending gates. No new trigger, force update or preview build. Verify actual workflow schedule and existing promotion safety tests; required local/remote checks and review before merge. After explicit manual release, separately verify exact source and READY public alias. The midnight schedule next becomes eligible on the next Denver calendar day; delay/dropped schedule is not a passed release.

Reference: https://github.blog/changelog/2026-03-19-github-actions-late-march-2026-updates/
