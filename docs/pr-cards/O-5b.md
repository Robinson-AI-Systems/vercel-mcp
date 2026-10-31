# O-5b — Owner data export (VMCP-021)

Status: implemented in this PR. Follow-on leg of Batch O card O-5 (design verdict: batch-o-dossier-2026-10-30.md §O-5 follow-on; tail dossier §1, 2026-10-30). Closes audit finding VMCP-021's export leg.

## Scope

- A setup-page surface, not a chat tool: the signed-in owner picks one enrolled account, re-enters the administrator passphrase (the same proof tier as pass issuance) and downloads a JSON record of everything the server holds for that account. The registry and catalog count do not change (240 of 241 stands).
- `src/vercel/owner-export.js` — `buildOwnerExport({db, account, now})` composes the export from the db layer's existing safe metadata reads only: subject account metadata, connections (metadata; most recent 20, cap stated), RTC passes (metadata, no hashes), protected resources, settings (purchase policy + production-enable strictness), project profiles (`known_apps`), Blob store connections (label + token last-4 only) and the change log. Every section passes through an explicit allowlist projection — no row is copied wholesale — so token values, ciphertext, token hashes, pass bearers and secret material cannot reach the export even if a future read grows a sensitive column.
- One new db read: `exportChanges({account, limit})` (bound 1..1000, default 500) — `listRecentChanges`' safe projection (summaries pre-truncated to the 160-char display bound) plus an exact total, so the export states `total`, `included` and `truncated` honestly instead of pretending completeness.
- Fault isolation: a failing section read becomes `{unavailable: true, reason: 'read_failed'}` for that section alone; the subject account's own metadata failing fails the export (an export missing its subject is false). The export is journaled (`vercel_owner_export_data`) before the download is served — if journaling fails, nothing downloads.
- Setup integration (`src/vercel/setup.js`): an "Export your data" panel section (account select + confirm checkbox + passphrase) and the `export_owner_data` POST action (session + CSRF + production env + confirm + fresh passphrase proof; locked login → 429). The response is a `Content-Disposition: attachment` JSON download; the filename carries the sanitized account id and the export date.

## Drift check A

| Assumption | Evidence | Resolution |
|---|---|---|
| The export can reuse `listRecentChanges` | `src/db.js` — its limit is bounded 1..20; an export capped at 20 journal rows is a stub | New `exportChanges` read with the identical safe projection and a 1..1000 bound plus an exact COUNT; the export caps at 500 and says so |
| Account-wide `recordChange` needs a connection/mode the setup page lacks | `recordChange` asserts account/tool/summary/dryRun/production and credential-free keys only; setup handlers already receive the same db | The handler journals with `mode: 'production'` (the setup session's own mode) and fails closed if the journal write throws |
| All enrolled accounts belong in one export | `listVercelAccounts` is deployment-wide; every other export section seam is account-scoped | The export is single-account (the selected subject); tenant isolation beats inventory convenience |
| Panel sections need no new CSRF/session handling | `handleSetup` POST requires session + CSRF before any action branch; credential-tier actions re-prove the passphrase via `evaluateLogin` | The export action follows the pass-issuance tier exactly (session + CSRF + confirm + passphrase) |

## Verification

Fake db only; no live call. `tests/unit/owner-export.test.js` (7): full composition through the allowlist projections with planted secret-shaped fields (`token_ciphertext`, `token_hash`, a token value, a pass bearer, a stored `before` image) asserted absent from the serialized export; unknown/malformed account refusals; one failed section marked unavailable with the rest intact; truncation stated when the journal exceeds the cap; panel renders the export section; unauthenticated POST refused (403) and wrong passphrase refused (401) with an empty journal; the happy-path download carries the attachment filename, parses as the export format, and journals exactly one `vercel_owner_export_data` row. Neighboring setup suites (setup-page, protected-setup, purchase-owner-setup, rtc-owner-passes, pass-proposals, blob) pass unmodified.
