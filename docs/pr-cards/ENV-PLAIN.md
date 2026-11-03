# ENV-PLAIN — Plain Config values: explained refusals and tighter credential guards

Source: owner request in chat 2026-11-03 ("Fix my Vercel connector"). An agent setting a plain public web address
(`NATIVE_GIT_WORKER_URL`) with `vercel_env_set` got only `Choose one permitted private environment value source` and
fell back to the official Vercel connector.

## Outcome
An agent can set plain, non-secret configuration (a public web address, a flag, a region) by typing the value, and
every refused value says exactly why and what to do instead. Credential-shaped values and secret-looking names are
refused for typed values more thoroughly than before.

## Root cause
Typed Config values were already supported (`kind: "Config"` + `value`), but `kind` defaults to `Secret`, the listing
description said "private value input", and every refusal shared one opaque sentence. Omitting `kind` therefore looked
like "typed values are impossible".

## Scope
- New `src/tools/env-value-source.js`: one shared check used by `vercel_env_set` and `vercel_env_set_many`, with a
  named plain-English reason for each refusal (each under 240 characters so the write core shows it).
- Typed values (Config only) additionally refuse: any `scheme://user:password@` address (previously only postgres),
  query parameters named like token/key/secret/signature/sig/password/auth/code, control characters (tabs and line
  breaks still allowed), and secret-looking variable names (SECRET, TOKEN, PASSWORD, PASSPHRASE, PRIVATE, KEY,
  CREDENTIAL as whole name words) — except names ending `_URL`, `_ORIGIN`, `_HOST`, `_ID` and browser-public prefixes
  (`NEXT_PUBLIC_`, `VITE_`, `PUBLIC_` …), which are judged by value only.
- Existing token-prefix / key-block / high-entropy detector (`credentialLike`) still applies.
- Listing descriptions and schema field descriptions say "kind Config takes a plain non-secret value; Secret takes
  generate".
- Unchanged: preview / confirm / requestKey / expectedUpdatedAt behavior; values never echoed in previews, results or
  the change log (repository rule: no environment value of any type is returned); 65,536-character bound (Vercel's own
  limit — not lowered, so existing callers keep working).

## Acceptance
- Tests: `tests/unit/env-value-source.test.js` (8): accepted plain values; every credential shape refused with the
  remedy; name rule with exemptions; each other refusal reason; real update through `vercel_env_set` with independent
  readback and no value echo; dry run; refusals through the tool send nothing; `vercel_env_set_many` per-item reason.
- Existing `project-env-write` and `project-env-batch` suites unchanged and green.
- Live: dry run of the owner's `NATIVE_GIT_WORKER_URL` update through the deployed connector after release.

## Drift check
DRIFT-PROTOCOL checklist B: STATUS.md, this card and TOOL-CATALOG.md updated in the same PR; no tool added, removed or
renamed.
