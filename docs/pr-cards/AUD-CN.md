# AUD-CN — Owner-confirmed deletion of a custom environment with links

**Commissioned:** 2026-11-03 by the owner, as part of converting the
rest of the AUD-CH refusal audit: *"the rest of the refusal audit can
be converted — go ahead and do that."* His tools warn and confirm;
they do not veto.

## The refusal being converted

`vercel_environment_delete` (E-2) could only delete a provably EMPTY
custom environment: the exact-identity proof refused any environment
carrying a linked domain or an active deployment alias ("Custom
environment revision, branch or emptiness changed"). An environment
the owner actually used — one with a domain attached — could never
be deleted through the tool at all.

## The conversion (the AUD-CH pattern, applied to environments)

- The **simple path is unchanged**: an environment with no linked
  domains and no active aliases deletes exactly as today, on the
  exact identity + revision confirmation alone.
- An environment **with links** goes through the owner-confirmed
  path:
  1. **Evaluate.** The delete path's identity proof now COLLECTS the
     link lists (linked domain names; active deployment aliases)
     instead of refusing on them. Every aim proof is untouched —
     identity, slug, branch, revision, preview type, and the
     production-branch bar all still refuse exactly as before, and
     a link list that is not an array, or an entry whose name
     cannot be proven, refuses the evaluation: the warning must be
     complete or it does not exist.
  2. **Fingerprint.** The evaluation ({project, environment id,
     slug, branch, revision, domains, aliases}) is hashed
     (`evaluationId`, SHA-256). The plan names the links and states
     the consequences in plain words — removing the environment
     breaks those links, the previews they serve stop answering,
     Vercel may itself refuse while links exist (that verdict is
     reported as returned), and unassigned project variables are
     never deleted — and ends with the evaluation id.
  3. **Confirm bound to the evaluation.** A confirmation must name
     the current `evaluationId`. Missing refuses with the links
     named in the remedy; stale refuses. A named evaluation is
     checked on the simple path too.
  4. **Execute with a final re-check.** The apply's existing
     pre-dispatch re-proof now also compares the evaluation: link
     drift, or a linked deletion that was never confirmed on its
     evaluation, refuses before the DELETE. Verification is the
     existing 404 read-back; the framework journals the write.

**Deliberately NOT converted:** `vercel_environment_update` shares
the emptiness proof and keeps it. Update is not a destructive
action, and renaming or re-branching an environment under live
links silently retargets those links — a different design question
the owner has not commissioned. It is recorded here so the
distinction is deliberate, not an oversight.

## Tests

The E-2 lifecycle suite passes unchanged — including its
refusals test: a linked environment confirmed with no evaluation
named still refuses, and an unprovable (undefined) alias list
still refuses on every path. Five new tests pin: the plan for a
linked environment renders the full warning with the links and its
evaluation id and deletes nothing; a confirmation naming a stale
evaluation refuses; a confirmation naming the exact evaluation
deletes a linked environment, verified by the 404 read-back with
the journal written; a link change between plan and confirm
refuses as stale; a link change between preview and dispatch
refuses at apply. Each new test fails with the conversion reverted
(negative control: exactly the 5 new tests fail, the 10
pre-existing pass).

Live proof — deleting a real linked custom environment through the
tool on the owner's confirmation — is owed only on a suitable
occasion. No daytime release was ordered; this rides the nightly
promotion.
