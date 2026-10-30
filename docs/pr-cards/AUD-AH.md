# AUD-AH — Write preflight preserves a tool's own refusal reason

**Baseline inspected:** main `b366e170` (AUD-AG, #288). Dossier:
`preflight-reasons-dossier-2026-10-30.md` in the audit goal
workspace — written before code, per the research-first rule: why
the genericization exists, an AST call-graph inventory of every
throw site the preflight classification catch can swallow (452
unique sites across the 41 `defineWrite` families), per-site
classification and migration verdicts, and the mechanism argued
against the in-repo precedents (guard-channel reason passthrough,
errors.js/VMCP-030 screened own-messages, AUD-H failure detail,
AUD-M2/AUD-AG redacted fingerprints).

**The defect.** `writePreflight` runs a write tool's `before()`,
`production()`, `targets()` and `preview()` in one try block whose
catch discards the error and returns the single generic reason
"Could not safely preview or classify the change". The tools' own
refusals at those sites are static, plain-words TypeErrors naming
the exact failed predicate; all of them were swallowed. Live toll
on 2026-10-30: the VMCP-010 create refusal (convicted later as
AUD-AC), the patch/delete refusals (AUD-AF), and the dev seed's
by-design preview-mode guard under a production connection — each
cost a code-level investigation a preserved reason would have made
instant. AUD-AB already routed its enrollment guard through
`guardProtected` for exactly this reason ("only the guard channels
surface their reason verbatim"); one family at a time was routing
around the preflight.

**Why the generic sentence stays.** It is a leak-safety property,
not the bug: arbitrary error text is unvetted — provider errors can
echo messages, identifiers and values — so untyped throws keep it
byte-for-byte, including the AUD-D secret-screening case (a plain
TypeError out of `preview()` still genericizes; its tests are
unchanged). This card is not "surface error.message".

## What ships

- **`src/core/write-preflight.js`** — a typed refusal channel.
  `RefusalError extends TypeError` (exported here, re-exported from
  `src/core/write.js` for the tools' single core import site): a
  tool throws it with a static plain-words reason it constructed
  value-free. The classification catch — and the `spend`/`access`
  catches, whose hooks are equally tool-authored spec code — now
  pass a `RefusalError`'s reason to the caller verbatim through
  `refusalReason()`, after a boundary screen: string, length
  1–300, no control characters, not `credentialLike` (the core
  screen stored previews get), no ID-shaped substrings
  (`(team|prj|dpl|ecfg|store|conn)_…`, mirroring the check-secrets
  ID shapes). Screen failure falls back to the catch's existing
  generic sentence, fail-closed. The guard catch is unchanged
  (context-supplied services are a different trust domain and
  already return reasons as values). Envelope unchanged:
  `{status: 'refused_by_guard', confirmed: false, reason}` — only
  the reason becomes specific. No journal change: preflight
  refusals are not journaled today (dry-runs and landed writes
  are), and guard-channel reasons aren't either — parity; the
  reason lives in the synchronous response, where the caller who
  must act on it reads it.
- **Why `extends TypeError`** — migration is behavior-preserving
  everywhere except the preflight envelope: the only
  `instanceof TypeError` branches in `src` are the errors.js
  own-message path (read/plain handlers keep surfacing the same
  screened messages), the executor's failure detail reads fields
  rather than classes, and pre-dispatch re-checks re-wrap every
  error alike.
- **Migration — 421 sites in `src/tools`.** Every dossier class-(a)
  site (static literal message, value-free by construction; all
  434 inventoried statics pass the boundary screen, max length
  117) plus the two literal-content equivalents
  (`owner-proposals.js`'s `REMOVE_DEFAULT_GUARD` constant;
  `dev-test-webhook.js`'s ternary of two literals) now throws
  `RefusalError`. No message text changes anywhere. The convicted
  families are inside the set: Global Config create/mutate and
  their shared helpers (79 sites), the dev-runs seed path
  including `assertPreviewConnection`.
- **Deliberately not migrated** (dossier verdicts): the 9
  interpolated (b) sites (internal labels/index, one caller-input
  domain name, contract parameter names) and the 7 provider
  rethrow (c) sites keep the generic sentence — for (c) that is
  the safety property working; the 15 static sites in leaf modules
  outside `src/tools` (openapi-validation, pass-requests,
  sandbox-binary, secret-box, dev scenarios) keep their layers'
  own error vocabulary in this card — their messages qualify as
  (a) and the mechanism is available to them under their own
  cards.

## Verification

- New `tests/unit/write-preflight-reasons.test.js` (12 tests): a
  typed refusal from `before()`, `production()`, `targets()`,
  `preview()`, a spend hook and an access hook reaches the caller
  verbatim with status `refused_by_guard`; `RefusalError` is a
  `TypeError`. **Safety proof (negative)**: an untyped throw whose
  message carries an ID-shaped and a credential-shaped string
  (both assembled at runtime, so no real-ID shape is committed)
  returns ONLY the generic sentence, with the poison asserted
  absent from the whole result; a typed refusal poisoned the same
  ways (ID-shaped, credential-shaped, overlong) also falls back
  to the generic sentence; an untyped TypeError with an innocent
  static message still genericizes (opt-in proven).
- Family harnesses assert the convicted refusals in their own
  words: dev seed's "Development runs require full-profile preview
  connection" (dev-runs), create's "Unable to prove unique
  selected-team Global Config slug" (globalconfig-read-create),
  patch's "Global Config owner, connections or revision cannot be
  classified" (globalconfig-mutate). The AUD-D stored-preview
  expectations of the generic sentence stand unchanged.
- No pre-existing test expectation changed: existing harnesses
  assert refusal status, not the generic reason (only the AUD-D
  file asserts the sentence, on untyped throws by design).
- Full local check and CI at the exact head: recorded in the PR.

Rides the nightly promotion. After it, the VMCP-010 closure
runbook's patch/delete legs and any dev-family refusal read their
reasons directly from the refusal envelope; no live operation is
part of this card.
