# AUD-CO — Owner-confirmed deletion of a shared variable with project links

**Commissioned:** 2026-11-03 by the owner, as part of converting the
rest of the AUD-CH refusal audit: *"the rest of the refusal audit can
be converted — go ahead and do that."* His tools warn and confirm;
they do not veto.

## The refusal being converted

`vercel_shared_env_delete` (E-2) could delete a shared variable only
when it was linked to NO projects ("deletion still has project
links"). A variable in actual use could never be deleted through
the tool; the owner had to unlink every project by hand first —
the veto shape AUD-CH abolished.

## The conversion (the AUD-CH pattern, applied to shared variables)

- The **simple paths are unchanged**: an unlinked variable deletes
  as today on the exact ID/kind/revision confirmation, and the
  one-project-at-a-time unlink mode is untouched (it never had a
  veto).
- A **linked deletion** goes through the owner-confirmed path:
  1. **Evaluate.** The removal proof's inventory read already knows
     the variable's exact linked projects (canonical-sorted), its
     key, kind and revision. Those become the evaluation. Every aim
     proof is untouched — identity, key, kind, revision, the
     preview-only target bar, and the no-custom-environments bar
     all still refuse exactly as before.
  2. **Fingerprint.** The evaluation is hashed (`evaluationId`,
     SHA-256). The plan names every linked project and warns in
     plain words: deleting first unlinks the variable from those
     projects, then deletes it; the variable and its value are
     permanently destroyed and every linked project loses it at its
     next deployment. The plan ends with the evaluation id.
  3. **Confirm bound to the evaluation.** A confirmation must name
     the current `evaluationId`. Missing keeps the original
     refusal's words with the confirmed route spelled out; stale
     refuses.
  4. **Execute with a final re-check.** The apply re-runs the
     removal proof through the existing `providerFor` re-check
     (which re-gates the evaluation and compares identity, kind,
     revision and the link set) before dispatch. Under the
     confirmed evaluation it unlinks each named project — each
     unlink its own proven provider write under the same guarded
     call — and then deletes the variable with the existing
     exact-ID delete proof. Verification is the existing team-
     inventory absence read-back; the framework journals the write.

## Tests

The shared-variable suite passes unchanged — including its denials
test: a linked variable confirmed with no evaluation named still
refuses, and production-target/custom-linked/unprovable rows still
refuse on every path. Five new tests pin: the plan for a linked
variable renders the full warning naming the linked project with
its evaluation id and deletes nothing; a confirmation naming a
stale evaluation refuses; a confirmation naming the exact
evaluation unlinks then deletes, verified by inventory absence
with the journal written; a link change between plan and confirm
refuses as stale; a link change between preview and dispatch
refuses at apply. Each new test fails with the conversion reverted
(negative control: exactly the 5 new tests fail, the 10
pre-existing pass).

Live proof — deleting a real linked shared variable through the
tool on the owner's confirmation — is owed only on a suitable
occasion. No daytime release was ordered; this rides the nightly
promotion.
