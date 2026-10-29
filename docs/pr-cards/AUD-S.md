# AUD-S — cleanup's deployment branch names the arm that refuses

- **Finding:** VMCP-023 (the last discharge leg) — legibility packet.
- **Basis:** the AUD-R discharge round of 2026-10-28 and the
  no-raw-reader search that followed it.

## Where the discharge stands

- **VMCP-027 is closed by its own probe:** the stranded run
  (`run_20261028_7fc338074246`) — the run whose cleanup failures
  filed the finding — discharged fully on the AUD-R build:
  `applied, confirmed: true`, every object cleaned, and the project
  independently verified gone (its domain list now returns
  Vercel's 404). Intent deadlock, deletion proof, outcome cap and
  canonical truncation are all discharged on live evidence.
- VMCP-023's seed leg closed at probe #4. Its discharge is down to
  one object: the probe run's promoted deployment, which cleanup's
  deployment branch still refuses with the compound string
  "Deployment is aliased or no longer identified."

## Why this packet is legibility, not a fix

That one string covers five different arms — id mismatch, project
mismatch, meta provenance mismatch, a missing/malformed alias list,
a populated plural `aliases` field — plus the alias-family judgment.
The record that trips it cannot be read from any seat: the custom
get/list/project readers throw `unknown_error` on it (VMCP-030),
the generic documented-read tool does not serve the operation
class (control-tested against a healthy deployment: identical
refusal), and the official connector is behind its team-scope wall.
Building a behavioral fix against a guessed arm would repeat the
release-and-probe cycle the owner stood down. So this packet makes
the branch testify instead:

- each identity arm refuses under its own name — `(id)`, `(project)`,
  `(meta)`, "alias list is missing or malformed", "populated
  aliases field";
- the family refusal names the offending host:
  "Deployment alias outside the project family: <host>" (host
  capped at 100 chars, inside the outcome store's 160-char limit).

No judgment changes. The next discharge attempt records exactly
which arm fires on the real record, and the fix packet (AUD-T) is
built against that testimony.

## Tests

One test drives all six refusal shapes through cleanup and asserts
each recorded string distinctly; the two AUD-P tests that asserted
the old compound string now assert the named family refusal. The
discharge tests (AUD-P/AUD-R shapes) are untouched and green.
