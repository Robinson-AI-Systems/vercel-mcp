# Owner midnight release schedule

Owner instruction 2026-10-13: schedule these six MCP repositories at 00:01 Denver, then manually release their checked revisions after setup work.

Use one daily cron with native America/Denver timezone; preserve green-CI, atomic Denver-day marker, fast-forward-only release and independent provider/production/spending gates. No new trigger, force update or preview build. Verify actual workflow schedule and existing promotion safety tests; required local/remote checks and review before merge. After explicit manual release, separately verify exact source and READY public alias. The midnight schedule next becomes eligible on the next Denver calendar day; delay/dropped schedule is not a passed release.

Reference: https://github.blog/changelog/2026-03-19-github-actions-late-march-2026-updates/
