# Design — Batch N: Domains, DNS, certificates and the registrar

Status: **APPROVED** (Chris, 2026-10-10). Written 2026-10-10. Scope and acceptance: `docs/PLAN.md` → Batch N.
Cards N-1 … N-3. Depends on Batches B, C and D-1. Tool list: `docs/TOOL-CATALOG.md` sections Domains; DNS and
certificates; Domain registrar.

## 0. Verify before starting

| # | Assumption | How to check |
|---|---|---|
| N1 | Team domains: `GET /v5/domains`, `GET /v5/domains/{domain}`, `POST /v7/domains` (add existing / transfer), `PATCH /v3/domains/{domain}`, `DELETE /v6/domains/{domain}`, `GET /v6/domains/{domain}/config`, `GET /v9/domains/{domain}/verification` | `node scripts/openapi-find.mjs "domain"` |
| N2 | Project domains: `GET /v9/projects/{idOrName}/domains[/{domain}]`, `POST /v10/projects/{idOrName}/domains`, `PATCH\|DELETE /v9/projects/{idOrName}/domains/{domain}`, `POST /v9/projects/{idOrName}/domains/{domain}/verify` | same tool |
| N3 | DNS: `GET /v5/domains/{domain}/records`, `POST /v2/domains/{domain}/records`, `PATCH /v1/domains/records/{recordId}`, `DELETE /v2/domains/{domain}/records/{recordId}`, `PUT /domains/{domain}/records` (replace), `GET /domains/records/{recordId}`; certs `GET /v8/certs[/{id}]`, `POST /v8/certs`, `DELETE /v8/certs/{id}` | same tool |
| N4 | Registrar under `/v1/registrar/*`: search, availability, price (domain, TLD, bulk), contact-info schema, buy (single), renew, auto-renew, transfer-in and status, auth code, nameservers, contact verification, orders; buy takes an `expectedPrice` and fails with `price_mismatch` when it differs | same tool; errors page |
| N5 | Which records a profile owns can be recognized by name/type/value (e.g. MX to Google, TXT `v=spf1`, DKIM `*._domainkey`) | Appliance Desk `docs/EMAIL-AND-ALIASES.md` (read only) |

## 1. Decisions

**N1. Every DNS write, nameserver change, team-domain update/removal and certificate change is production** (B2 rule 4):
DNS carries the live site and email. Project-domain writes are production unless the domain is tied to a branch or a
non-production custom environment.

**N2. DNS previews show the whole picture.** Each DNS write reads the zone first and shows: the record before/after,
conflicts (CNAME at a name that has other records; a second MX set; SPF duplicates), records a profile owns (needs
`outsideApp`), and — for `vercel_dns_replace_zone` — every add, change and removal. Inverses are stored (re-create a
deleted record from `before`; restore old values), so Batch X can undo DNS changes.

**N3. Domain attach is guided by config.** After `vercel_domain_attach_to_project`, the result includes
`vercel_domain_check_config` output: exact records needed when DNS is elsewhere, or "Vercel DNS will serve it" when the
domain uses Vercel nameservers; it never edits DNS outside Vercel.

**N4. Buying follows quote → confirm.** `vercel_registrar_buy` first reads the price for the years asked, the contact
schema and auto-renew default; the preview shows price × years, renewal price, auto-renew, contact details (the
registrant contact is stored as an account setting on the setup page, IN-08 note) and today's spend against the limit;
`confirm` sends the buy with `expectedPrice` = the quoted price, so a price change fails (`price_mismatch`) instead of
charging more. The order is read back (`vercel_registrar_get_status`). Renew and transfer-in follow the same pattern.
Auto-renew **on** is `$` (a future charge); **off** is `C` and the preview warns the domain will expire on its date.

**N5. Secrets around domains.** The transfer-**in** auth code is pasted on the setup page (`pending_inputs`, kind
`transfer_auth_code`); the transfer-**out** auth code goes to the one-time page. Certificate upload is not built (it takes
a private key) — guided.

**N6. Removing a domain from the team** reads which projects and aliases use it and refuses with the list unless they
are detached first (Vercel's `conflict_aliases` turned into words before the call).

## 4. Work units

### N-1 — Team and project domains (M)
Tools: the 11 tools of "Domains". Tests: production vs branch domain classification; remove refused while aliases exist;
config result attached after attach; profile-owned domain needs `outsideApp`.
### N-2 — DNS and certificates (M, medium effort)
Tools: the 9 tools of "DNS and certificates". Tests: conflict detection cases; replace-zone preview lists every change;
inverse restores a deleted MX record on fake Vercel; every write refused on a preview connection.
### N-3 — Registrar (M, medium effort)
Tools: the 9 tools of "Domain registrar". Tests (fakes only — implementers never buy): dollar line from the quoted
price; `expectedPrice` sent; `price_mismatch` explained; spend limit $0 refuses; transfer-in code only from a pending
input; auth code only on the one-time page; auto-renew off warns of expiry.

## 5. Stop-and-ask points

1. Any N0 row false: amend before that card.
2. A real purchase, renewal or transfer is ever needed to test something: stop (hard limit).

## 6. Acceptance mapping

| PLAN Batch N line | Evidence |
|---|---|
| DNS writes production-guarded with full previews and inverses | `tests/unit/dns.test.js` |
| Registrar quote → confirm with expected price and spend limit | `tests/unit/registrar.test.js` |
| No auth code or private key through chat | `tests/unit/registrar-secrets.test.js` |

## Amendments

(Dated entries only.)
