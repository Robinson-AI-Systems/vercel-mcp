# AUD-CM — Owner-confirmed removal of a domain still in use

**Commissioned:** 2026-11-03 by the owner, as part of converting the
rest of the AUD-CH refusal audit: *"the rest of the refusal audit can
be converted — go ahead and do that."* His tools warn and confirm;
they do not veto.

## The refusal being converted

`vercel_domain_remove_from_team` (N-1) flatly refused to remove a
team domain while any project domain or alias used it: the plan
itself rendered "REFUSED: … is still used by … Detach it from every
project and alias first", and confirmation threw. Sending the owner
to detach everything by hand, one project at a time, before the one
act he asked for is the veto shape AUD-CH abolished.

## The conversion (the AUD-CH pattern, applied to domains)

- The **simple path is unchanged**: a domain nothing uses removes
  exactly as today.
- A domain **still in use** goes through the owner-confirmed path:
  1. **Evaluate.** The usage inventory the tool already builds —
     every team project's domain list plus the domain's alias
     inventory — is the evaluation. It is complete or it refuses:
     `domainUsage` already declines to claim a partial inventory
     (a paginated team inventory refuses rather than understate
     the usage), and that behavior is untouched.
  2. **Fingerprint.** The evaluation ({domain, team, verified
     state, canonical in-use list}) is hashed (`evaluationId`,
     SHA-256). The plan keeps the simple path's honest label —
     refused there, with the detach-first route — and adds the
     owner-confirmed warning in plain words: removing the domain
     anyway permanently removes it from the team, every named
     project domain and alias stops working, the sites they serve
     stop answering on this address, and Vercel may itself refuse
     while the domain is in use (that verdict is reported as
     returned). It ends with the evaluation id and the instruction.
  3. **Confirm bound to the evaluation.** A confirmation must name
     the current `evaluationId`. Missing refuses, keeping the
     original refusal's words ("still used; detach it first") plus
     the confirmed route; stale refuses — any usage change moves
     the fingerprint. A named evaluation is checked on the simple
     path too.
  4. **Execute with a final re-check.** The apply already re-ran
     the inventory inside `requirePreDispatch` and refused on any
     remaining usage; it now refuses on evaluation drift (and on
     an unconfirmed in-use dispatch) instead. Verification is the
     existing absence read-back; the framework journals the write.

## Tests

The N-1 domain suite passes unchanged — including the in-use
refusal test: its scenarios still refuse (the plan keeps the
simple-path REFUSED label with the usage named; a confirmation
naming no evaluation still refuses with no DELETE). Five new tests
pin: the plan renders the confirmed-removal warning with the usage
and its evaluation id and deletes nothing; a confirmation naming a
stale evaluation refuses; a confirmation naming the exact
evaluation removes an in-use domain, verified by the absence
read-back with the journal written; a usage change between plan
and confirm refuses as stale; a usage change between preview and
dispatch refuses at apply. Each new test fails with the conversion
reverted (negative control: exactly the 5 new tests fail, the 20
pre-existing pass).

Live proof — removing a real in-use domain through the tool on the
owner's confirmation — is owed only on a suitable occasion; no real
domain will be removed to manufacture one. No daytime release was
ordered; this rides the nightly promotion.
