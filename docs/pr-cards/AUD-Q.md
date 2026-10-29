# AUD-Q — AUD-O's enriched cleanup refusal exceeds the outcome store's cap and kills the pass

- **Finding:** VMCP-027 (the rtc deletion half) — the layer beneath
  AUD-O, convicted from the server code plus the journal witness
  after the stranded run's cleanup died mid-flight twice more.
- **Basis:** owner directive 2026-10-28 — diagnose from the contract
  and the code, not from repeated probes.

## The evidence

After AUD-O went live, the stranded run's cleanup confirm returned
`outcome_unknown` twice (19:46 and 19:56 MDT), each time with **no
state change, no journal entry, and no failure detail** — while a
fresh replay claim was provably taken (the second attempt's scoped
key was new, and the attempt in between had correctly refused on
the first attempt's still-pending claim inside its 10-minute TTL).

The journal witness (`vercel_recent_changes`) placed the deaths
exactly: both confirms are absent from the journal while their
plans and every earlier confirm are present — the executions died
after the replay claim and before the audit write, i.e. inside
`apply()`. Inside cleanup's apply, every per-object failure is
caught and recorded — except the outcome recording itself:

- `db.setDevRunObjectOutcome` **rejects an outcome error longer
  than 160 characters** (`error.length > 160` → `TypeError`), and
  it is called *outside* the per-object try/catch.
- AUD-O's enriched project refusal — the one that names the
  inventory — measures **172 characters** at the stranded project's
  counts. Recording it threw; the executor's catch-all produced the
  bare `outcome_unknown` (a `TypeError` carries no provider code,
  so AUD-H's failure detail is empty and omitted); the claim stayed
  pending until its TTL; nothing recorded; no journal.

The same signature explains why the pass at 19:41 completed: it ran
on the AUD-N build, whose refusal was the 65-character bare form.
The stranded run is simply the first cleanup ever to reach the
enriched refusal on the AUD-O build. (What makes its inventory
nonempty at all — the raw `hasDeployments` signal against a
zero-count deployment list, or a non-canonical domain entry — is
exactly what the compacted message will now record on the next
pass; this packet does not prejudge it.)

## The change

1. **dev-runs.js:** the project refusal is compacted to
   "Project not empty (deployments: N; git: N; crons: N; domains: N
   total, N attached; env: N; hasDeployments: B)" — worst case 123
   characters at three-digit counts — still naming every count, so
   a block remains its own discriminator.
2. **Test fixture fidelity:** the dev-runs fake outcome store now
   enforces the real store's 160-character validation, so this
   class of defect is testable at all (it was invisible to every
   fake before).
3. **Regression test:** the stranded shape — pre-cleaned intents, a
   blocked project whose inspect returns the full inventory —
   records `blocked` with the compact, count-naming error and the
   pass completes (`applied`, `confirmed: false`), where the AUD-O
   form died. A sweep of every other outcome error string in the
   cleanup surface confirms all are well under the cap.

## Scope boundaries

- The 160-character cap itself is unchanged: it is a sane store
  contract; the defect was producing an error that broke it.
- Release posture: merges under the audit pipeline rule and rides
  the pending AUD-P release — one owner word moves live to main
  carrying AUD-P + AUD-Q, then the discharge probes run.
