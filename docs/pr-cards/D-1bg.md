# D-1bg — PR #106 P1 corrective security patch

Approved D-1 maintenance, prompted by postmerge security review #103 and #104.

## Drift check
- No operation name, profile, OpenAPI method, owner approval, protected-resource setting or production activation changes.
- Existing source: src/core/util.js and src/tools/project-create.js.
- Shared defensive fixes apply to result shaping and metered Git project import.

## Acceptance
- After exactly eight percent-decodes, a generic alphanumeric high-entropy fake credential is detected and redacted.
- Immediately after the final authenticated project name GET, spending authorization is read from the owner-controlled account setting again before paid Git import POST.
- Adversarial race simulates permission revocation on that last GET; no POST occurs.
- Exact-head CI check, unit, db, emulate, ci required; review threads on #103/#104 resolve only after verification.
- No real provider writes or purchases; D-1 stays in progress.

## Resume
Implementation: PR #106. Remote tests: see PR exact-head GitHub Actions. Owner decisions IN-07 and IN-08 separately queued.
