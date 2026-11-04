# REL-1 — Owner-ordered release route for the checked promoter

**Commissioned:** 2026-11-04 under the owner's fleet-wide
release-authority rule (AGENTS.md, 2026-11-04): every project gets
exactly one automatic release a day; every additional release requires
the owner's authority — granted in the moment, or in advance as a
standing authorization — and release machinery must encode that
permission scheme, never its own numeric cap on owner-ordered
releases. A fleet sweep of this repo the same morning proved the
defect: `.github/release/promote-live.mjs` stood down on the day's
`live-promotion/<day>` receipt tag on every path, and the only
dispatch input was `recover_missed_daily`, so once the day's promotion
landed, an owner order had no checked way to run.

## The route (mirrors GitHub Unleashed by Robinson AI Systems)

Same script lineage, smallest transplant of the proven shape:

- `daily-live.yml` gains `manual_release` (boolean) and
  `expected_main_sha` (string) dispatch inputs; the promote job admits
  an owner dispatch carrying either flag under the existing
  actor + triggering-actor gate (`christcr2012` both), and passes
  `MANUAL_RELEASE` / `EXPECTED_MAIN_SHA` to the script.
- `promote-live.mjs` admits `MANUAL_RELEASE` inside
  `authorizedReleaseInvocation` only with a 40-hex `EXPECTED_MAIN_SHA`
  under the same owner gate (no Denver-time condition — the owner's
  authority is not time-bound; the elapsed-midnight condition still
  guards missed-schedule recovery only). A manual run judges only its
  own receipt tag, `manual-live-promotion/<expected-sha>`: the day's
  `live-promotion/<day>` tag neither blocks it nor is touched, main
  must still equal the authorized SHA when the run executes, and a
  re-run at the same head is a recorded no-op.
- Every existing check is untouched: exact-head `release-policy` +
  `ci` green, fast-forward ancestry, branch-moved re-checks, one
  atomic push, read-back. The automatic and recovery paths behave
  byte-for-byte as before; a non-owner dispatch, or a missing/short/
  non-hex SHA, refuses closed.

## Tests

`.github/release/promote-live.test.mjs`: the 9 pre-existing tests pass
unmodified; 3 new pins — the owner gate + SHA pin (including refusal
of non-owner actors and malformed SHAs, and no Denver-time condition
on the manual route), the workflow surface, and a real-git end-to-end
proof: a manual release promotes past a consumed day tag, writes its
own receipt, leaves the automatic receipt untouched, refuses a stale
authorization, and leaves the automatic path capped by the day tag.

## Docs

`docs/DEPLOY.md` §9 (the release-procedure runbook) records the route
as the second documented owner dispatch and retires the
delete-the-day-marker rollback procedure; `docs/STATUS.md` carries the
dated entry.

## Acceptance

With the day's `live-promotion/2026-11-04` tag already present, an
owner dispatch (`manual_release: true`, `expected_main_sha` = the
merged head) promotes that head: the promotion job runs (not skipped)
and succeeds, `live` reads back at the head, the
`manual-live-promotion/<sha>` receipt exists at the head, the
automatic receipt still targets the head it named that morning, and
the live front door reports the released head.

**Not changed:** no tool code, no catalog, `docs/CONFORMANCE.md`
(owned by the separate re-census PR), no other repository.
