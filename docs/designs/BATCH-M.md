# Design — Batch M: Monitoring, integrations and storage

Status: **APPROVED DESIGN pending IN-00**. Written 2026-10-10. Scope and acceptance: `docs/PLAN.md` → Batch M.
Cards M-1 … M-3. Depends on Batches B, C and D. Tool list: `docs/TOOL-CATALOG.md` sections Logs, observability and
analytics; Drains and webhooks; Integrations and storage.

## 0. Verify before starting

| # | Assumption | How to check |
|---|---|---|
| M1 | Observability: `POST /v2/observability/query`, `GET /v2/observability/schema[/{metricId}]`; web analytics `GET /v1/query/web-analytics/visits/count\|aggregate`; toggles `POST /web/insights/toggle`, `POST /speed-insights/toggle` | `node scripts/openapi-find.mjs "observability"` and `"web analytics"` |
| M2 | Drains `/v1/drains` (list/create/get/update/delete, `POST /v1/drains/test`); webhooks `/v1/webhooks` (list/create/get/delete) with the secret returned once on create; account webhooks need Pro or Enterprise | same tool; research §11 Webhooks |
| M3 | Integrations: `GET /v1/integrations/configurations`, `GET\|DELETE /v1/integrations/configuration/{id}`, products and billing plans, `POST /v1/integrations/installations/{id}/resources/{resourceId}/connections`, `POST /v1/storage/stores/integration/direct`; storage `GET /storage/stores/{id}`, `POST /storage/stores/blob`, `DELETE /storage/stores/blob/{id}` | same tool |

## 1. Decisions

**M1. Queries are bounded.** `vercel_logs_query` takes a metric, filters, group-by and a window (default 1 hour, max 7
days) and returns at most 50 rows summarized; `vercel_logs_errors_summary` groups runtime errors by message.

**M2. Analytics toggles are spend.** Turning Web Analytics or Speed Insights on is `$` (billed beyond included usage on
Pro): the preview links the pricing page; turning off is `P`.

**M3. Data leaving the team needs confirm.** `vercel_drain_create` is `$ C`: the preview shows the destination host,
which data (logs/traces/analytics/audit), which projects, and the per-GB price link. Destinations must be public HTTPS
(private and loopback addresses refused). `vercel_webhook_create` puts the signing secret on the one-time page.

**M4. Integrations: remove is destructive, install is guided.** Removing an installation may delete its resources and
the variables it injected — the preview lists both (`D`, production when it injects production variables). Installing a
new integration (consent screens) is guided. Connecting a resource to a project injects variables for chosen
environments: production when production is among them. Creating a Marketplace store is `$` with the billing plan's
price from `list billing plans`.

**M5. Storage stores belong to apps.** A profile can own Blob stores; `vercel_storage_delete_blob_store` refuses them
without `outsideApp` and its preview always says "every file in the store is deleted; this cannot be undone". Blob
**objects** are not managed here (they use the Blob API with a store token; ROADMAP).

## 4. Work units

### M-1 — Logs, observability, analytics (M)
Tools: the 5 tools of "Logs, observability and analytics". Tests: window capped; summaries under 8 KB; toggles `$` on.
### M-2 — Drains and webhooks (M)
Tools: the 7 tools of "Drains and webhooks". Tests: private destinations refused; webhook secret on the one-time page
only; plan-gated errors explained.
### M-3 — Integrations and storage (M, medium effort)
Tools: the 8 tools of "Integrations and storage". Tests: remove preview lists resources and injected variables;
connect with production target is production; store creation shows the plan price and counts toward the spend limit;
profile-owned store delete refused.

## 5. Stop-and-ask points

1. Any M0 row false: amend before that card.

## 6. Acceptance mapping

| PLAN Batch M line | Evidence |
|---|---|
| Bounded queries and summaries | `tests/unit/logs-query.test.js` |
| Data-leaving and spend guards on drains, analytics, stores | `tests/unit/drains.test.js`, `tests/unit/storage.test.js` |
| Webhook secret only on the one-time page | `tests/unit/webhooks.test.js` + key-scan test |

## Amendments

(Dated entries only.)
