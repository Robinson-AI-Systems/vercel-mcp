# TEK-1 — Secret box previous-key read support (TOKEN_ENCRYPTION_KEY rotation, inert half)

**Baseline inspected:** main `1e755de` (VER-1, #453).
Source: the 2026-11-10 rack job-log leak exposed this server's
`TOKEN_ENCRYPTION_KEY`; the follow-up rotation programme (fleet record:
`rack-env-leak-2026-11-10.md` §8.3) found the rotation blocked — the
secret box was single-key, so any key change would orphan every stored
tenant token and one-time secret sealed under the old key. Owner ruling
2026-11-10: the code change is ordinary fleet work; the rotation runs
after the change is live.

**The gap.** `src/core/secret-box.js` decoded exactly one key
(`TOKEN_ENCRYPTION_KEY`, 64-hex or 43-char base64url) and decrypted with
it alone. The sibling github-mcp server already carries the proven
answer (`src/core/crypto.js`): a `TOKEN_ENCRYPTION_KEY_PREVIOUS` setting
listing older keys accepted for reading only, used in its own live
dual-key rotation on 2026-11-10.

## Scope

- `readPreviousKeys(env)`: parses `TOKEN_ENCRYPTION_KEY_PREVIOUS` —
  comma-separated, at most two keys, each decoded by the same rules as
  the current key. Exported for direct validation/testing, as in
  github-mcp.
- `decryptSecret`: tries the current key first, then the previous
  key(s). AES-GCM with the unchanged purpose binding authenticates every
  attempt, so a wrong key fails cleanly. A malformed previous-key
  setting is ignored on this path, so it can never weaken or lock out
  the current key.
- `encryptSecret`: unchanged — sealing always uses the current key only.
- Envelope format, purpose binding and error messages unchanged; with
  the setting unset, behaviour is the old behaviour exactly.

## Acceptance

- `tests/unit/secret-box.test.js` gains five cases: values sealed under
  the old key decrypt after a rotation (current=new, PREVIOUS=old); new
  seals are readable by the current key only and refused under an
  old-key-only env; PREVIOUS unset reproduces the old behaviour; two
  previous keys in mixed hex/base64url shapes both read; the setting
  validates (bad shape, more than two) and a malformed setting never
  weakens the current key. All five fail against the pre-change module
  (no PREVIOUS support) by construction.
- `npm run check` and the full unit suite pass at the exact head.
- Live acceptance is deliberately separate: the rotation run itself
  (new key current, old key previous, stored-token read proof inside
  the rack, vault filing) once this change is released. This card is
  the inert half only.

## Drift check

Code (`src/core/secret-box.js`) and tests change together; STATUS,
DECISIONS and ARCHITECTURE updated in the same PR. No tool added,
removed or renamed — TOOL-CATALOG and the registry are untouched. No
new subsection is claimed against the work index; this is a security
fix in its own PR per the repo rule for holes found in production
handling.
