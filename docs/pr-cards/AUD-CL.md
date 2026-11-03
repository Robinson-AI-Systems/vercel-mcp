# AUD-CL — Owner-confirmed removal or demotion of a team's last Owner

**Commissioned:** 2026-11-03 by the owner, as part of converting the
rest of the AUD-CH refusal audit: *"the rest of the refusal audit can
be converted — go ahead and do that."* His tools warn and confirm;
they do not veto.

## The refusals being converted

`vercel_member_remove` and `vercel_member_update_role` (O-2) flatly
refused to remove the team's last Owner, or to demote the last Owner
to any lesser role: "Refusing to remove the team's last Owner" /
"Refusing to demote the team's last Owner". The consequence the
guards priced in is real — a team with no Owner has nobody who can
manage members, billing or ownership — and it is exactly the kind
of consequence the owner is entitled to accept after being told it
plainly. Vercel may itself refuse the act; that verdict is Vercel's
and is reported as returned, not pre-judged here.

## The conversion (the AUD-CH pattern, applied to the roster)

Both tools already fingerprint the complete roster (the `etag`:
team id + every member's uid and role). The conversion binds that
fingerprint to the tool and the target as the **evaluation**:

1. **Evaluate.** The full roster is read and proven complete (an
   oversized, unverifiable roster still refuses — the evaluation
   must be complete or it does not exist). Whether the target is
   the last Owner is computed from that roster.
2. **Fingerprint.** `evaluationId` = SHA-256 over {tool, teamId,
   target uid, target role, roster fingerprint}. The plan for a
   last-Owner removal or demotion renders the warning in plain
   words — the team is left with no Owner: nobody can manage
   members, billing or ownership, and Vercel may itself refuse —
   and ends with the evaluation id and the instruction.
3. **Confirm bound to the evaluation.** A confirmation must name
   the current `evaluationId`. Missing refuses, keeping the
   original refusal's words, plus the route (plan, then confirm the
   evaluation it shows); stale refuses — any roster change moves
   the fingerprint, so a second Owner appearing, or the target's
   role changing, invalidates an earlier confirmation. Naming an
   evaluation is checked for every target, not only last Owners.
4. **Execute with a final re-check.** Both applies already re-read
   the roster inside `requirePreDispatch` and refuse on fingerprint
   drift; a defense-in-depth check now also refuses a last-Owner
   dispatch that was not owner-confirmed. Verification is the
   existing roster read-back; the framework journals the write.

**Deliberately NOT converted:** the self-target guards in the same
tools ("Refusing to remove the token's own user" / "Refusing to
change the role of the token's own user"). Those do not judge what
the target *is*; they protect the acting credential's own principal
— the owner's own access path — the same class the refusal audit
left standing for the server's own credential protection. They
remain refusals, in both tools, unchanged.

## Tests

The O-2 suite passes unchanged (its lockout scenarios confirm with
no evaluation named, and still refuse). Five new tests pin: the
plan to remove the last Owner renders the full warning with its
evaluation id and deletes nothing; a confirmation naming a stale
evaluation refuses; a confirmation naming the exact evaluation
removes the last Owner, verified by roster read-back with the
journal written; a roster change between plan and confirm refuses
as stale; demoting the last Owner on the exact evaluation applies
and verifies. Each new test fails with the conversion reverted
(negative control: exactly the 5 new tests fail, the 10
pre-existing pass).

Live proof — removing or demoting a real team's last Owner through
the tool — is owed only if a suitable occasion exists; no real
team's ownership will be disturbed to manufacture one. No daytime
release was ordered; this rides the nightly promotion.
