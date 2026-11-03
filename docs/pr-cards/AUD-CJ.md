# AUD-CJ — Owner-confirmed deployment deletion

**Commissioned:** 2026-11-03 by the owner, as the first conversion out of
the AUD-CH refusal audit: *"Convert deployment deletion the same way"*
as project deletion. His tools warn and confirm; they do not veto.

## The refusal being converted

`vercel_deploy_delete` (D-3) deletes only a terminal (failed or
canceled), unaliased **preview** deployment. A healthy preview, any
aliased deployment, and **every production deployment** are refused
outright — the owner cannot delete his own stale production deployment
through his own tool at all.

## The conversion (the AUD-CH pattern, applied to deployments)

- The **simple path is unchanged**: a failed or canceled, unaliased
  preview deletes exactly as today — same proofs, same preview text,
  no new ceremony.
- Everything else goes through the **owner-confirmed path**:
  1. **Evaluate.** The tool inspects the deployment and its project
     completely: the deployment's state, target, URL, branch and
     commit; **every alias/address that points at it** (from the
     provider record's alias lists — an unprovable alias list refuses
     the evaluation, it does not guess); and whether it is the
     project's **current production deployment** (the project
     record's production designation; when the record carries none,
     the newest ready production deployment of a complete,
     page-by-page project inventory). Any fact that cannot be proven
     refuses the plan — the evaluation is complete or it does not
     exist.
  2. **Fingerprint.** The evaluation is hashed (`evaluationId`,
     SHA-256 over the canonical evaluation). The plan renders the
     consequences in plain words — the live site goes down if this
     is the current production deployment; these addresses stop
     working; this preview URL dies — and ends with the evaluation
     id and the instruction.
  3. **Confirm bound to the evaluation.** A confirmation must name
     the current `evaluationId`. Missing or stale refuses before
     anything is deleted; any change to the deployment's situation
     (state, target, aliases, current-production status) changes the
     fingerprint and invalidates an earlier confirmation.
  4. **Execute with a final re-check.** At deletion time the tool
     re-reads the deployment on the bound token and re-evaluates;
     drift refuses. The DELETE runs through the guarded-write
     framework (journaled like every write), and verification is
     the existing 404 read-back.
- `expectedState` widens from the terminal pair to the full
  documented state set (QUEUED, BUILDING, READY, ERROR, CANCELED) —
  the caller still binds the expected state on both paths; it is
  an aim check, not a gate.
- A production-affecting deletion (production target, current
  production deployment, or a deployment holding aliases) declares
  `production: true` to the framework, so it runs under the same
  production-mode discipline as every other production write on
  this server — the owner's own mode switch governs it, as ruled
  in the refusal audit.

## Tests

The existing D-3 suite passes unchanged. New tests pin: the plan
for a production deployment renders the full warning with its
evaluation id and deletes nothing; a confirmation with no
evaluation id, and one with a stale id, refuse with nothing
deleted; an exact confirmation deletes a current production
deployment and a healthy aliased preview, each verified gone by
read-back; an alias appearing between plan and confirmation
refuses as stale. New tests fail with the conversion reverted.

Live proof — deleting a real production deployment through the
tool on the owner's confirmation of its evaluation — is owed
after the nightly promotion; no daytime release was ordered.
