# Design — Batch E: Environment variables and configuration

Status: **APPROVED DESIGN pending IN-00**. Written 2026-10-10. Scope and acceptance: `docs/PLAN.md` → Batch E.
Cards E-1 … E-3. Depends on Batches B, C and D-1. Tool list: `docs/TOOL-CATALOG.md` sections Environment variables;
Shared variables and custom environments; Global Config.

## 0. Verify before starting

| # | Assumption | How to check |
|---|---|---|
| E1 | Project env operations: `GET\|POST /v10/projects/{idOrName}/env`, `GET /v1/projects/{idOrName}/env/{id}` (decrypted), `PATCH\|DELETE /v9/projects/{idOrName}/env/{id}`, `DELETE /v1/projects/{idOrName}/env` (batch) | `node scripts/openapi-find.mjs "environment variable"` |
| E2 | Env objects carry `type` (`plain`, `encrypted`, `sensitive`, `secret`, `system`) and, on newer rows, `visibility` (`config`/`secret`); create accepts `visibility` | read the create body and response schema |
| E3 | Shared env: `/v1/env` (list/create/update/delete), `GET /v1/env/{id}`, `PATCH /v1/env/{id}/unlink/{projectId}`; custom environments `/v9/projects/{idOrName}/custom-environments[/{environmentSlugOrId}]` | same tool |
| E4 | Global Config (formerly Edge Config) operations live under `/v1/global-config/*`; the old `/v1/edge-config/*` paths are not in the reference | same tool; research §2.3 |
| E5 | Env create rejects keys with characters other than letters, digits and `_`, keys over 256 characters, values over 65,536 characters | errors page (`env_key_invalid_characters`, `env_key_invalid_length`, `env_value_invalid_length`) |

## 1. Decisions

**E1. No tool returns an environment variable's value, of any type.** Reason: legacy `encrypted` (readable) rows hold
most real secrets in existing projects and `visibility` is missing on them, so "Config is safe to show" cannot be trusted
(research §1.3). Summaries never include `value`; `detail: 'full'` strips it too; the decrypt operations are called only
inside the server (E3, E4) and their values never enter a result, log or change-log row. Chris views a value on the
setup page behind the passphrase (`/api/vercel/setup?reveal=<account>/<project>/<envId>`, logged in the change log as
"value viewed"); Secret-kind values cannot be shown by anyone (Vercel), and the page says so.

**E2. Values come in three ways** (B5): `value` for non-secret configuration (refused when credential-shaped),
`pendingInputId` (Chris pasted it on the setup page), or `generate: { bytes: 32, encoding: 'base64url'|'hex' }`.
The kind defaults to **Secret** (`type: 'sensitive'`, `visibility: 'secret'`) unless the caller asks for `config`;
targets are **required** (never defaulted to production, audit T6).

**E3. Copy and compare happen on the server.** `vercel_env_copy` decrypts the source inside the server and writes it to
each destination; Secret-kind sources cannot be decrypted and are reported "cannot copy: Secret — paste the value on
the setup page". `vercel_env_compare` answers `same | different | cannot compare (Secret)` per key and pair by comparing
SHA-256 digests in memory; digests are never returned (a digest of a short value could be guessed).

**E4. Production rules.** A variable write is production when any target is `production` (or a production custom
environment), or the shared variable is linked to a project with a production target (B2). Deleting is `D`.
A profile may list variables an integration or store manages (e.g. `BLOB_READ_WRITE_TOKEN`, a Neon integration's
`DATABASE_URL`); writing them needs `outsideApp` (Batch P).

**E5. Redeploy hint.** Vercel applies variable changes to new deployments only. Every env write's result says which
targets changed and offers `vercel_deploy_redeploy` for the live deployment (production redeploy is a separate
confirmed step); it never redeploys by itself (W-5's rotate workflow does, with confirm).

**E6. Global Config items are configuration, not secrets**, and are returned (key-shaped strings hidden by shaping).
Writing items of a store connected to a live project is production (apps read it at once). Store read tokens are `1x`.
Restore picks "newest backup before <time>" or a version ID and previews the item diff.

**E7. Custom environments** (e.g. `staging`) are created with a branch rule; copying variables from another environment
uses E3 (server-side). Deleting one is `D` and refused when a profile owns it.

## 4. Work units (each: unit tests, write-contract per write, request-shape tests, `emulate` tests for project env)

### E-1 — Project environment variables (L, medium effort)
Tools: the 9 tools of "Environment variables". Tests: no result, log line, change-log row or handle body contains a
fixture value (planted unique strings, searched after the whole suite); credential-shaped `value` refused; targets
required; kind defaults to Secret; production target on a preview connection refused; copy refuses Secret sources;
compare returns no digest; `vercel_env_export_names` output has no values; the reveal page needs the passphrase and
logs a "value viewed" row.

### E-2 — Shared variables and custom environments (M)
Tools: the 7 tools of "Shared variables and custom environments". Tests: a shared variable linked to a live project's
production target is production; unlink is `D Cp`; custom environment create copies variables server-side.

### E-3 — Global Config (M)
Tools: the 7 tools of "Global Config". Tests: item patch on a store connected to a live project is production; token
goes to the one-time page; restore preview shows the diff; requests use `/v1/global-config/*` only (grep test).

## 5. Stop-and-ask points

1. E2 false (no `visibility` on create): keep `type: 'sensitive'` as the Secret default; record it.
2. Vercel adds a way to read Secret values: nothing changes here (E1 still forbids returning values).

## 6. Acceptance mapping

| PLAN Batch E line | Evidence |
|---|---|
| No env value in any result, log or change-log row | `tests/unit/env-no-values.test.js` + key-scan test |
| Values only from setup page, `generate` or non-secret `value` | `tests/unit/env-set.test.js` |
| Production targets guarded; targets required | write-contract for `vercel_env_set` |
| Global Config on current paths | `tests/unit/globalconfig.test.js` grep case |

## Amendments

(Dated entries only.)
