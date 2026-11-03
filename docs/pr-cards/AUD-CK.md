# AUD-CK — Owner-confirmed deletion of a team with seated enrollments

**Commissioned:** 2026-11-03 by the owner, as part of converting the
rest of the AUD-CH refusal audit: *"the rest of the refusal audit can
be converted — go ahead and do that."* His tools warn and confirm;
they do not veto.

## The refusal being converted

`vercel_team_delete` (AUD-AB) flatly refused to delete any team with
an enrolled account seated on it — including this server's own
hosting seat — until the enrollments were removed first as their own
act. The reasoning was data integrity: the enrollment rows are
derived credentials, and deleting the team strands them. True, and
exactly the kind of consequence the owner is entitled to accept
after being told it plainly.

## The conversion (the AUD-CH pattern, applied to teams)

- The **simple path is unchanged**: a team with no seated
  enrollments deletes exactly as today — same disclosures, same
  default-team handling, same provider-verdict classification.
- A team **with seated enrollments** goes through the
  owner-confirmed path:
  1. **Evaluate.** The tool inspects the target team (identity,
     slug, default-team status, the requested replacement default)
     and lists every enrollment seated on it from this server's own
     account inventory — account row id, label and scope, never a
     credential. An inventory whose seated rows cannot be
     identified refuses the evaluation; it does not guess.
  2. **Fingerprint.** The evaluation is hashed (`evaluationId`,
     SHA-256 over the canonical evaluation). The plan renders the
     consequences in plain words — the team and everything in it
     are permanently destroyed, and these named enrollments are
     stranded: their rows stay on this server pointing at a team
     that no longer exists, removed afterwards as their own
     owner-approved act (`vercel_remove_account`) — and ends with
     the evaluation id and the instruction.
  3. **Confirm bound to the evaluation.** A confirmation must name
     the current `evaluationId`. Missing refuses with the seated
     count, the stranding consequence and the remedy (remove the
     enrollments first, or confirm the exact evaluation); stale
     refuses with the instruction to re-plan. Naming an evaluation
     is checked on the simple path too, so a confirmation can never
     silently bind to seats the owner did not see.
  4. **Execute with a final re-check.** At deletion time the tool
     re-reads the seated set on the same store and re-fingerprints;
     drift refuses before the DELETE. The DELETE runs through the
     guarded-write framework (journaled like every write), and
     verification is the existing 404 read-back.

The enrollment guard no longer rides the guard channel: the
evaluation lives in `before()`, where the plan can render it (the
guard channel refused even the dry-run plan, so the owner could not
even see what he was being refused for). The protected-resource and
app-profile guards are untouched.

## Tests

The AUD-AB suite passes unchanged — including its three
enrollment-guard tests, whose scenarios still refuse (a confirmation
naming no evaluation, and an enrollment seated between preview and
dispatch). Five new tests pin: the plan for a seated team renders
the full warning with the seated enrollment named and its
evaluation id and deletes nothing; a confirmation naming a stale
evaluation refuses with nothing deleted; a confirmation naming the
exact evaluation deletes a seated team, verified by the 404
read-back with the journal written; an enrollment seated between
plan and confirm refuses as stale; an enrollment seated between
preview and dispatch refuses at apply. Each new test fails with
the conversion reverted (negative control: exactly the 5 new tests
fail, the 17 pre-existing pass).

Live proof — deleting a real team with a seated enrollment through
the tool on the owner's confirmation of its evaluation — is owed
only if a suitable occasion exists; no real team will be deleted
to manufacture one. No daytime release was ordered; this rides the
nightly promotion like the rest of the batch.
