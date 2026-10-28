# Design — Batch M: Monitoring, integrations and storage

Status: **APPROVED** (Chris, 2026-10-10). Written 2026-10-10. Scope and acceptance: `docs/PLAN.md` → Batch M.
Cards M-1 … M-4. Depends on Batches B, C and D. Tool list: `docs/TOOL-CATALOG.md` sections Logs, observability and
analytics; Drains and webhooks; Integrations and storage; Blob files.

## 0. Verify before starting

| # | Assumption | How to check |
|---|---|---|
| M1 | Observability: `POST /v2/observability/query`, `GET /v2/observability/schema[/{metricId}]`; web analytics `GET /v1/query/web-analytics/visits/count\|aggregate`; toggles `POST /web/insights/toggle`, `POST /speed-insights/toggle` | `node scripts/openapi-find.mjs "observability"` and `"web analytics"` |
| M2 | Drains `/v1/drains` (list/create/get/update/delete, `POST /v1/drains/test`); webhooks `/v1/webhooks` (list/create/get/delete) with the secret returned once on create; account webhooks need Pro or Enterprise | same tool; research §11 Webhooks |
| M3 | Integrations: `GET /v1/integrations/configurations`, `GET\|DELETE /v1/integrations/configuration/{id}`, products and billing plans, `POST /v1/integrations/installations/{id}/resources/{resourceId}/connections`, `POST /v1/storage/stores/integration/direct`; storage `GET /storage/stores/{id}`, `POST /storage/stores/blob`, `DELETE /storage/stores/blob/{id}` | same tool |
| M4 | Blob files use Vercel's **Blob API** (the `@vercel/blob` package: `list`, `head`, `put`, `del`), not the REST reference; it authenticates with a store read-write token or, since 2026-06-01, a short-lived OIDC token issued to functions of a project connected to the store ([changelog](https://vercel.com/changelog/vercel-blob-now-supports-oidc-authentication)). Check how a server that is not the app's project can reach a store: (a) a store read-write token Chris pastes on the setup page, still offered for OIDC-upgraded stores, or (b) only by connecting this server's own project to the store | the Blob docs and `@vercel/blob` README at the pinned version; a test store in the scratch project (IN-06) |

## 1. Decisions

**M1. Queries are bounded.** `vercel_logs_query` takes a metric, filters, group-by and a window (default 1 hour, max 7
days) and returns at most 50 rows summarized; `vercel_logs_errors_summary` groups runtime errors by message.

**M2. Analytics toggles are spend.** Turning Web Analytics or Speed Insights on is `$` (billed beyond included usage on
Pro): the preview links the pricing page; turning off is `P`.

**M3. Data leaving the team needs confirm.** `vercel_drain_create` is `$ C`; `vercel_drain_update` is `P` when it
pauses a drain or narrows it and `C` when it resumes one or widens what leaves (more projects, sources or
environments, higher sampling), with a before/after preview. The create preview shows the destination host,
which data (logs/traces/analytics/audit), which projects, and the per-GB price link. Destinations must be public HTTPS
(private and loopback addresses refused). `vercel_webhook_create` puts the signing secret on the one-time page.

**M4. Integrations: remove is destructive, install is guided.** Removing an installation may delete its resources and
the variables it injected — the preview lists both (`D`, production when it injects production variables). Installing a
new integration (consent screens) is guided. Connecting a resource to a project injects variables for chosen
environments: production when production is among them. Creating a Marketplace store is `$` with the billing plan's
price from `list billing plans`.

**M5. Storage stores belong to apps.** A profile can own Blob stores; `vercel_storage_delete_blob_store` refuses them
without `outsideApp` and its preview always says "every file in the store is deleted; this cannot be undone". Blob
**files** are handled by M6 (amended 2026-10-10; previously ROADMAP).

**M6. Blob files (added 2026-10-10, prior-tools gap check).** Four tools (`vercel_blob_list`, `vercel_blob_head`,
`vercel_blob_put`, `vercel_blob_delete`) reach only stores Chris connected on the setup page (IN-15, answered 2026-10-27: connection is an owner-controlled state, not a server rule — within a connected store, list/read are unrestricted and put/delete are ordinary guarded writes on the owner's instruction). The store
credential is entered there (`pending_inputs`), encrypted like Vercel tokens, never shown or logged; a tool on an
unconnected store answers with the setup steps. This is the one place the server talks to an API outside the REST
reference: it goes through the official `@vercel/blob` package (exact version pinned) wrapped in
`src/vercel/blob.js`, with request-shape tests against a recorded fake, not the OpenAPI snapshot. File **contents are
never returned** (only metadata) — photos and documents in an app's store can be customers' data. `vercel_blob_put`
takes ≤4 MB inline, refuses to overwrite unless `allowOverwrite`, and is production when the store is connected to a
live project's production environment. `vercel_blob_delete` takes exact pathnames or URLs (≤100, no prefixes or
wildcards), previews each file with its size, is `D` (no undo: the file is gone), and is refused on a profiled app's
store without `outsideApp` (Appliance Desk: "never clean up a store by browsing and deleting").

## 4. Work units

### M-1 — Logs, observability, analytics (M)
Tools: the 5 tools of "Logs, observability and analytics". Tests: window capped; summaries under 8 KB; toggles `$` on.
### M-2 — Drains and webhooks (M)
Tools: the 8 tools of "Drains and webhooks". Tests: private destinations refused; webhook secret on the one-time page
only; plan-gated errors explained; `vercel_drain_update` pausing is `P`, resuming or widening needs `confirm`.
### M-3 — Integrations and storage (M, medium effort)
Tools: the 8 tools of "Integrations and storage". Tests: remove preview lists resources and injected variables;
connect with production target is production; store creation shows the plan price and discloses its cost (IN-08: any limit is the owner's own configured policy, never a server-imposed one);
profile-owned store delete refused.
### M-4 — Blob files (M, medium effort)
Tools: the 4 tools of "Blob files" (M6). Starts with M0 row M4. Tests: unconnected store answers with setup steps; no
store credential in any result, log or change-log row (planted value); no file contents returned; put over 4 MB
refused, overwrite refused without `allowOverwrite`; delete refuses prefixes and wildcards, previews every file,
refused on a profiled store without `outsideApp`; production store needs a production connection and `confirm`.

## 5. Stop-and-ask points

1. Any M0 row false: amend before that card.
2. M4 shows a server outside the app's project cannot reach an OIDC-only store: build M-4 for token-reachable stores
   only, say so in the tool descriptions and the setup page, and record it; never connect this server's project to an
   app's store without Chris's OK.

## 6. Acceptance mapping

| PLAN Batch M line | Evidence |
|---|---|
| Bounded queries and summaries | `tests/unit/logs-query.test.js` |
| Data-leaving and spend guards on drains, analytics, stores | `tests/unit/drains.test.js`, `tests/unit/storage.test.js` |
| Webhook secret only on the one-time page | `tests/unit/webhooks.test.js` + key-scan test |
| Blob files: connected stores only, no contents or credentials returned, deletes guarded | `tests/unit/blob.test.js` + key-scan test |

## Amendments

**2026-10-10 — Prior-tools gap check** (`docs/audits/2026-10-10-prior-tools.md`): `vercel_drain_update` added to M-2
(the old toolkit's drain pause/resume; the operation was already in M0 row M2); card M-4 and decision M6 added for
Blob files (the old toolkit's `vercel_blob_*`), replacing the ROADMAP item; owner input IN-15. Approved scope together
with IN-00.
