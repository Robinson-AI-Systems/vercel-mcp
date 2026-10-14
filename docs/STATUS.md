<!-- Current repair also records no-change daily receipts: backups cannot publish later same-day development after a successful no-op. -->
## October 14 owner-requested daily release recovery repair — current

Owner request on October 14: investigate and repair missed daily releases across the MCP repositories and Appliance Desk, including the quoted owner-run checked recovery. This supersedes the prior scheduled-only/no-new-trigger restriction for missed-event recovery only. Primary 00:01 Denver remains; retries are 00:17, 01:17 and 05:37 Denver plus 12:43 UTC. Explicit recovery defaults OFF and requires both the original actor and the triggering actor to be christcr2012, main, true recovery input and elapsed midnight. Every path retains successful exact-main CI, ancestry, atomic once-per-Denver-day receipt and independent readback. No production-provider activation, spending, force push or preview build is authorized.

Local release safety tests pass. Merge requires exact-head application CI and review resolution. Source repair is separate from observed schedule execution and Vercel READY/alias proof; inspect actual daily run and receipt, do not equate main/live drift after a release with failure. These infrastructure PRs do not replace the existing substantive implementation batch.

## October 14, 2026 missed scheduled release — trigger repair candidate
GitHub returned zero schedule-event runs despite the daily-release workflow existing on default main since October 12 and passing policy on push/PR. At inspection live and READY production were at #176 (dc98faef) while green main was #180 (9e0f7ba0). The workflow's Denver timezone syntax is supported by GitHub; the absent event is a scheduler enqueue issue, not a failed promote step.
Repair: preserve 00:01 America/Denver primary; add staggered 00:13, 00:29, 00:47 Denver schedule retries and an explicitly owner-initiated workflow_dispatch recovery. The recovery requires the repository owner, exact main branch, true recovery input, and local time after 00:01. All paths retain required exact-head checks, fast-forward-only atomic push, daily marker, replay suppression and readback. This changes no production environment settings and does not itself dispatch a release. Verify future schedule enqueues; if zero continue, investigate disabled workflow/GitHub scheduler with GitHub Support.

## E-1 bounded batch environment workflows — candidate PR #180

The native guarded create-only set-many operation batches 2–10 Config or privately supplied/generated Secret keys into one Vercel POST, with no upsert and individual readbacks. The guarded delete-many operation verifies 2–10 exact IDs/keys/revisions and uses the published one-request batch DELETE with individual 404 confirmation. Both enforce project identity, protected/app and production policy, replay, confirmation, fresh pre-dispatch state and no values in outputs/audits. Provider partial/ambiguous reports are outcome_unknown, not invented success. No actual provider write or production activation was performed. Branch/custom/cross-project Config copy and live disposable acceptance remain pending.

## E-1 scoped server-side Config copy — candidate PR #179

Provider compatibility: verified current Vercel POST create envelope can contain `created` and per-item `failed`; #179 also repairs the #178 create-result normalization and rejects partial provider successes rather than claiming confirmed writes.

Native `vercel_env_copy` securely promotes one source Config value between ordinary (non-branch, non-custom) preview/development targets of the same exact project; destination production additionally requires the existing production-mode and owner guard. Secret and credential-shaped values, production-linked sources, cross-project selectors, ambiguous identities and changed revisions are refused. Values remain solely server-side; no raw provider fields/values in results, audit or durable replay. Create-only POST avoids silent overwrites; independent readback compares byte equality. Real provider write acceptance awaits approved disposable preview fixture and normal checked release. E-1 bulk operations and expanded branch/cross-project copy are still pending.

## E-1 guarded single-variable lifecycle — candidate PR #178

Native `vercel_env_set` and `vercel_env_delete` add single-resource create/replace/delete with exact project/target/expected revision, fresh pre-dispatch scope/state checks, existing protected-resource/app/production/replay/confirmation safeguards, and independent provider readbacks. Values enter only transiently via noncredential Config input or encrypted owner pending input / strong server generation for Secret; never appear in output, preview, audit or replay. Secret readback proves metadata only (`confirmed:null` for value); Config readback verifies equality; deletion requires independent 404. Production mutations stay disabled, no autonomous spend or real provider writes. Bulk set/delete and copy still pending. Exact-head CI and genuine disposable native custom-service acceptance tracked separately.

## E-1 safe environment drift audit — candidate PR #177

Add `vercel_env_compare`: a read-only, project-verified, explicit-target workflow comparing up to 20 named config keys using in-process SHA-256 equality, returning same/different without raw values or digests. Secret kinds are not decrypted or compared; unavailable values and incomplete/absent inventory are marked unknown rather than misreported as drift. Fake-provider tests cover scoped positive comparisons, changed identities, secret safety and incomplete page evidence. No environment mutation, production activation or spend; native provider comparison acceptance is pending checked release. Remaining E-1 writes and copy operations are still unimplemented and independently gated.

## D-3 terminal preview cleanup — candidate #175

Guarded `vercel_deploy_delete` now handles irreversible cleanup of an independently verified failed or canceled preview, explicitly requested by exact project/deployment/state and outside-app intent. Production, running or ready builds, absent or assigned aliases, malformed/foreign identity, changed state before deletion and protected resources are rejected. A fresh bound pre-dispatch provider read prevents stale confirmations. Only independent GET 404 after accepted DELETE is claimed as confirmed; other outcomes are false/unknown, with durable replay and audit. Regression tests are in the new unit suite; real provider fixture cleanup, genuine connected denial/readback and release remain separately open. No real deletion, production change or spending. Other D-3 metered creation/redeploy paths remain gated, E-1 has six planned operations outstanding.

## E-1 project env metadata — candidate PR #174

Three native read-only operations are implemented: list key metadata, get metadata by exact variable ID, and generate names-only .env.example placeholders. Exact project ownership is independently checked against the stored credential. List forces decrypt=false. Single GET output discards every provider value, comments and untrusted fields, even for legacy encrypted records. Pages are bounded and never claimed complete without provider proof. Fake-provider tests plant sentinel secrets and verify scope, identity and redaction. Six E-1 tools remain pending; no provider environment changes, production changes or spending were made. Real connected acceptance requires checked source release.

## D-3 preview cancellation — PR #173

Guarded cancellation code and negative tests now cover exact preview identity, project isolation, pre-dispatch recheck, immutable target, durable replay and independent canceled-state verification. Other deployment changes remain pending; metered operations remain disabled without provider-enforceable owner pricing approval. No actual provider mutation, production change or spending. D-3 external acceptance requires an authorized disposable preview.

## D-2 streamed runtime logs — candidate PR #172

Custom Vercel runtime log calls to the currently live deployment returned an unclassified error, while a separate standard connector log query found no events for its 30-minute window (not a custom MCP pass). This changes the documented live-stream HTTP Accept header to application/stream+json and treats HTTP 204 as zero rows with unknown completeness. Existing bounded transport, identity, secret protection and malformed-stream refusal remain. Fake HTTP regression and exact-head CI required; a real authenticated custom check must be repeated after a checked release. Production writes off; autonomous spending $0. D-3 remains the next milestone.

## D-2 source-tree availability — candidate PR #171

The optional source-tree API returned HTTP 404 for the verified Git deployment via both custom MCP and independent Vercel API reads. Only this endpoint's 404 now means source tree not exposed, not missing deployment or empty files. Fake-provider regression tests are in CI. Custom runtime-log errors and all write/Hub acceptance remain open. No production changes or spending.

## Review corrections — 2026-10-13

Developer connection retries retain encrypted codes until expiry, concurrent starts use an atomic trusted-IP quota, and backend failures remain retryable. Google consent preserves the requested profile and supports actual native code length. Windows protected credentials fit bounded chunks; cloud refresh locks recover after process exit. Evidence requires every layer and genuine custom-service read/write/denial/readback observations. Production functionality remains intact. Local regression checks passed; exact-head CI, deployed connection, provider, Hub, revocation and cleanup proofs remain separate.

## Reusable developer OAuth and evidence boundary — 2026-10-13

Owner authorized replacing repeated manual pass setup with renewable implementing-agent
connections. Production product capabilities remain unchanged; full developer TEST/preview
profiles retain original server write/financial/resource guards. Native OAuth owner consent
hands authorization back to protected client storage via PKCE plus an encrypted mobile callback.
The rtool developer client reuses/refreshes that connection and invokes the actual custom MCP.
The completion recovery review records catalog/runtime differences, obsolete recipes and
a finite path to finish the intended products without introducing blanket limitations.
Source/automated/deployed/provider/Hub/revocation/cleanup evidence remain separately tracked
in developer-evidence.json. Standard connectors remain development infrastructure aids only.
New handoff/client regressions and mandatory provenance checks are part of this PR; exact-head
CI, reviewed release and real owner consent/provider acceptance remain pending. Managed cloud clients use an explicit private encrypted developer vault; desktops may use
the OS keyring. Never place credentials in a prompt, Git or plaintext credential file. This is an implementation checkpoint, not full real-world acceptance.
See pr-cards/DEVELOPER-CONNECTION.md. No production provider activation or paid resource change.

**Setup checkpoint — 2026-10-13:** Stage-aware setup verified: dedicated hosting/database and encrypted verified no-expiration Vercel credential enrolled; production operations OFF and autonomous spending zero. Real custom OAuth/file-content/runtime/RTC acceptance remains separate from stored-key/provider checks. All six release workflows target 00:01 America/Denver, Vercel tracks live, Basic queued builds and disabled automatic previews verified. No scheduled release event observed yet; owner authorized one manual release after green checks. Saved configuration, deployed exact revision and authentic connected acceptance remain separate.

**Owner release timing update — 2026-10-13:** Daily checked main-to-live release now targets 00:01 America/Denver using GitHub native timezone support, so both daylight and standard time remain 12:01 a.m. All exact-head CI, atomic daily-marker, fast-forward, preview/build-cost and independent live/provider approval gates remain unchanged. Owner separately approved one manual release after this setup work completes; schedule syntax/CI, actual deployment and connected acceptance remain distinct evidence. GitHub scheduling can be delayed; no guaranteed start time is claimed.

# STATUS — current work, blockers and next action

- **U-1 canonical flag identity (candidate #165):** single flag GET now refuses mismatched/absent flag or project ID and contradictory team, stops unnecessary expanded creator metadata and returns an audited safe projection only. Flag settings and revision pages reject conflicting project/team ownership. Fake HTTP regressions cover all paths; connected owner-provider acceptance remains open. #164 merged exact-head green. No provider mutations, production release or spending.

- **U-1 verified team flag capacity (candidate #164):** new audited listTeamFlagSettings read verifies each of up to five provider project owners against the selected team before revealing only enabled status and aggregate flag/segment/byte counts. Project-only accounts and foreign/duplicate/oversized rows fail closed. No private entities or targeting returned. Fake HTTP tests are source verification only; owner-protected HTTPS/provider acceptance still OPEN. #163 merged after all exact-head checks. Production remains on separately checked live, with no manual release or spend.

- **U-1 segment targeting privacy (candidate #163):** `listFlagSegments` and `getFlagSegment` now return only project-verified exact segment identifiers and safe labels, not segment membership, user identities or targeting conditions. Lists fail closed on foreign/duplicate/oversized identities; single GET requires exact segment ID. Fake provider CI only; real provider connected and RTC acceptance remain OPEN. #162 merged after required CI, adding selected-team project proof before deployment flag-status reads. No privilege or production changes.

- **Actual deployed checkpoint, 2026-10-13:** #161 is merged at main and live `f777e457d1445d126e33148f987aeb6416d86fbf`; Vercel production alias READY at that exact Git SHA (deployment ID kept only in protected operational verification), and required merged-main ci/release-policy are green. #161 repairs checked scheduled release races. Stored encrypted key and HTTPS readiness do not establish authenticated custom MCP, provider D-2 reads, independent revocation or Hub routes. No new manual release or production operation permission; $0 autonomous spending. #162 candidate hardens deployment flag team identity readback, with fake provider tests only.

- **Hosted direct connected acceptance verifier (MERGED #160, now live via #161; connected evidence still OPEN):** add a secure Node 24 operator runner for public discovery and denial, owner-protected TEST service identity, preview D-2 read-only runtime and optional verified harmless file SHA-256, write denial, and owner-assisted post-revocation HTTP 401. No access pass, approved disposable deployment or authenticated evidence is supplied in this PR. Fake-fetch unit tests cover safe output/limits/fail-closed scope. Also correct the obsolete public landing 'setup required' and DEPLOY's obsolete main-branch guidance. Source runner is included in the independently verified live #161 revision; no new manual release requested. Next: exact-head CI and owner-issued short-lived passes plus authorized disposable deployment for real evidence, then separately direct OAuth and Hub relay/Sandbox acceptance.

- **Hosted owner setup / connected acceptance — verified 2026-10-13:** dedicated Vercel production hosting and Neon schema initialized; encrypted, team-scoped Robinson AI Systems credential positively verified after #157's bounded pagination repair; secure owner setup available. Live Vercel deployment READY at main/live `f777e457d1445d126e33148f987aeb6416d86fbf` (PR #161), using the public alias `https://vercel-mcp-liard.vercel.app`; public RTC manifest (51 tools) and OAuth discovery independently return HTTP 200. This verifies *public metadata and deployment*, **not** owner-authenticated custom MCP, real D-2 file bytes/log stream, RTC TEST direct/relay/Sandbox authorization or revocation. No approved disposable nonproduction deployment or owner-issued protected short-lived pass has yet been supplied as acceptance evidence. Daily release remains scheduled/checked 00:01 Denver only; no new manual deployment authorized. Production operations OFF; autonomous spending $0. Next: securely obtain an owner-issued narrow pass outside chat and an owner-approved nonproduction deployment ID, verify source/permission/transport end to end, revoke pass and independently observe denied reuse; progress U-1/O-1/R-1 source work meanwhile.

- **U-1 project team-proof repair (MERGED #159):** universal project flag metadata GETs now require a positive exact provider `accountId` match for the encrypted selected team after project ID readback, rejecting omitted or foreign ownership *before* reading flag data. Fake HTTP tests cover project and team connections; real provider payload acceptance still open. The same implementation PR updates owner-assisted blocker recovery, README and stale setup ledger; source/CI/HTTPS/RTC evidence remain separate.

- **U-1 verified flag revision chronology (#156):** document-backed revision history requires independent exact flag/project GET, rejects bad/mixed/duplicate versions, and emits only version identifiers, safe revision numbers, timestamps and opaque cursors. Rules, author information and variants are omitted. Offline fake-provider tests only, no hosted acceptance or write authority.

- **U-1 flag capacity summary (#155):** documented project settings now return only checked flag/segment counts, package byte size and enabled state, after original project identity readback. Rule/environments/entities remain secret-safe and omitted. CI/offline only, no paid capacity change or real Vercel acceptance.

- **U-1 deployment feature-flag status (#154):** a project-key read of documented deployment flags now independently verifies selected deployment/project ownership before returning only counts; raw flag values/rules and malformed identities are refused. Existing tool and connection authority unchanged. Offline fake-provider CI only; connected D-2/RTC evidence still pending.

- **U-1 team-scoped feature flag inventory (PR #153):** adds documented team flag listing for explicit team/full stored connections with a five-row cap, per-project independent GET identity verification, fail-closed foreign project/identity outcomes and safe metadata/cursor projection. Fake-provider CI evidence only; full universal API coverage and owner-hosted provider/HUB acceptance remain outstanding.

- **U-1 bounded feature-flag pagination (PR #152):** preserve safe `pagination.next` from documented flag list responses so subsequent pages can be requested. The existing exact account/project proof, official query validation, bounded response and secret-safe metadata projection run on every page. Missing cursors never imply a complete list; malformed cursors fail closed. CI test coverage added; no authenticated provider evidence, new write authority, deployment or spending. D-2 connected acceptance remains gated by IN-02/03 hosting and owner setup.

- **R-1 owner-reviewed pass requests (#151):** direct full-profile owner tool proposes exact read-only scope in an encrypted expiring receipt. Setup reviews without issuing, then requires session/CSRF/fresh passphrase, consumes once, issues atomic audited pass, independently reads its real scope and encrypts one-time bearer delivery. Failed verification/delivery attempts revocation. Preview defaults remain server-only/24h/$0; TEST permits service identity only. No bearer in MCP output and no full/write/production RTC authority. DB tests run on disposable CI PostgreSQL (no local binaries). Discovery now correctly flags SDK-key reads as secret, matching their existing runtime refusal. Recovery #149 retained. Rechecked the explicitly selected Robinson AI Systems team: 10 projects, no vercel-mcp project or custom origin; IN-02/03 hosting and owner secrets are genuinely external requirements, not a code defect. Five substantive session PRs are #146/#147/#148/#150/#151, excluding that docs repair.

- **U-1 audited universal reads (#150):** seven real project feature-flag metadata GETs, indexed full-schema validation, selected-account project readback, scope override denial, bounded 64-KiB JSON transport and safe field projections. Secret/decrypt/sdk-key operations refused; curated reads redirect to their specific tool and unaudited families fail closed. No arbitrary write, credential, targeting values or provider acceptance. Next independent R-1 owner-reviewed pass proposals.

## Current gateway recovery disposition — 2026-10-12

Owner requested cross-repository architecture/planning correction. Prioritize independently usable provider tools
and existing approved RTC/isolation acceptance; do not wait for K-3 publication or force internal code adoption.
Hub agent owns fixed broker surface, registry, routing, grant mapping, cache, forwarding audit and scale testing.
This service agent owns authenticated RTC/mode/resource isolation, original direct-MCP parity and safe deployed
read/denial/revocation evidence. A public manifest, reference conformance or private-core rehearsal is not proof
of actual hosted acceptance. Full provider roadmap and existing external gates remain; no card is closed here.
Next: reconcile current implementation/concurrency and existing RTC acceptance gaps, obtain exact deployed
revision and authorized short-lived read_only non-production pass securely, and run the supported harmless read
and denials through Hub when available. Never alias preview to TEST without real isolation or expose credentials.

- **U-1 API discovery (#148):** searchable finite pages over all 451 pinned Vercel operations and bounded request-schema descriptions, with explicit omitted fields and nested body inspection. Public metadata only, no provider I/O or authority grant. Tests inspect every operation budget. Next independently scope-verified GET transport; universal writes remain unimplemented.

- **O-1 standard protection defaults (#147):** owner-only new-project preview authentication defaults with access-widening warnings, state fingerprint, immutable team and independent GET verification. Advanced paid protection and password material refused; existing password defaults require separate secret workflow. No real owner change. Next independent U-1 API discovery/schema, then scope-verified reads; O-1 retention/mappings remain subject to destructive/spend/lockout evidence.

- **O-1 security settings (#146):** guarded privacy flags, verified commits, explicit secret-isolation policies and owner-only protection controls; loosening previews identify affected members/visitors. Strict provider PATCH validation, immutable scope/state recheck, durable replay and independent GET confirmation. SAML and email auto-join remain intentionally unsupported until lockout-safe owner evidence. Provider inventory recheck finds no vercel-mcp project; D-2 hosted connected evidence remains unavailable. No provider mutation, paid resource or activation.

Updated 2026-10-12. **A-1 foundation, A-2 schema (PR #6), A-3 OAuth/MCP endpoints (PRs #7/#8), and A-4 official API transport (PR #12) and A-5 owner setup (PRs #13–#15) are implemented, with all five post-merge CI checks green on `main`.** No real Neon database has been created or initialized, no Vercel token has been added, and nothing is deployed or live.

## Next

- **O-1 guarded team profile updates (#145 candidate):** approved owner-controlled name, slug, description and preview suffix PATCH guarded by full production connection, immutable stored team ID, Vercel-pinned schema, protected-resource policy, durable replay, before/after provider GETs and confirmed output. Slug changes explicitly warn of Vercel's weekly quota; secret-bearing text refused. No live owner mutation or provider acceptance; remaining O-1 security/retention/mapping writes separate.

- **O-1 compatibility correction (#144 candidate):** preserve existing account token-probe bound-team `teams_list` requests; route new owner reads through distinct query-free `teams_list_unscoped` GET and avoid scope regression.

- **O-1 read-only team identity and security overview (#144 candidate):** independently provider-verified selected team GET and selected-only list; explicit allowlist of safe profile/plan/security flags with no other team names, SAML certificates or invitation material. Team/project credential scope binding, no caller team override and safe error behavior. Code + fake HTTP tests, not connected provider acceptance. Owner security writes remain separately gated.

- **D-2 finite ten-read code acceptance (#143 candidate):** a new mandatory `npm run check` gate reconciles all approved D-2 catalog rows, registered handlers, read-only metadata, diagnostic area and existing test evidence. Adversarial tests reject missing/added tools, fake read classification and vanished tests. Real provider file-response contract and hosted RTC integration remain EXTERNAL_ACCEPTANCE_PENDING; do not close D-2 from CI alone.

- **D-2 strict source-content transport (#142 candidate):** reject malformed provider JSON without echoing upstream fragments, refuse declared over-budget HTTP file replies and binary control bytes even when UTF-8 decoding succeeds. Existing canonical-base64/tree/project/secret guards remain. Offline fake provider/transport tests only; real JSON field shape is not certified.

- **D-2 runtime log wire reconciliation (#141 candidate):** validate alternate published log field names with strict conflict refusal, fix complete-vs-capped JSON array accounting, and suppress raw parser-error text. Fake HTTP regression coverage; no connected provider acceptance yet.

- **D-1 finite code acceptance (#140):** the 15 approved D-1 project/Git/cron/member handlers are now mapped against their real registry, required guarded-write provenance, documented catalog and existing CI test files by `scripts/check-d1-acceptance.mjs` (mandatory `npm run check`) plus adversarial tests. This is a **code-evidence milestone**, not actual provider certification: keep D-1 IN_PROGRESS with explicit EXTERNAL_ACCEPTANCE_PENDING while nonproduction owner HTTPS/Neon/scoped Vercel token and Hub direct/relay/Sandbox/revocation proof are unavailable. IN-07/IN-08 decisions are answered and not blocking engineering. Next available independent work remains eligible and must be pursued even if live D-1/D-2 provider acceptance is gated.
- **Permanent scoped-blocker workflow correction (#140):** identify and repair technical defects/config/dependency/CI/documentation drift before classifying an external gate. A blocked operation never blocks unrelated approved work. Inspect the roadmap and independent eligibility, attempt authorized remedies, preserve exact missing external evidence, and automatically re-enter the blocked slice when conditions change. Incorporated into authoritative AGENTS.md, SESSION-START.md and DRIFT-PROTOCOL.md without an extra instruction file or docs-only PR.

- **D-2g small bounded file-content read (#139 candidate):** `vercel_deploy_get_file` is implemented against pinned GET /v8/deployments/{id}/files/{fileId}. The server first independently checks deployment/project and file-tree identity, then reads at most 8 KiB of JSON and accepts only canonical base64 mapping to ≤2 KiB UTF-8 content that passes secret checks. Unknown provider response shapes, binary content, unlisted IDs and oversized files fail closed rather than inventing output. Unit/CI fake HTTP evidence does not prove the provider's actual response fields or real custom MCP operation. Next review D-1 finite code acceptance and actual hosted Hub prerequisites without blocking independent progress.

- **D-2f deployment triage filters (#138 candidate):** `vercel_deploy_list` adds pinned GET /v7/deployments state, target (preview/production), branch, commit SHA and earliest timestamp selectors, preserving exact-project scoping, finite pagination and cursor. Agents can find failing builds without reading unrelated deployments. Fake-provider tests and CI remain separate from deployed acceptance. Source-file contents still depend on verifying the actual provider JSON/base64 response and strict bytes guard.

- **D-2e bounded runtime log stream (#137 candidate):** project/deployment readback before pinned GET /v1/projects/{projectId}/deployments/{deploymentId}/runtime-logs. Transport accepts at most 32 KiB/50 JSON log entries within a short timeout; local time-window (default 30m, max 24h), level/status/exact-path filters project only aggregate counts, never raw messages/paths/IDs. The provider's live stream cannot prove the full window, even on EOF. Fake transport tests/CI only; **no connected provider or Hub evidence**. Next: investigate file content JSON/byte limits and correct output completeness before new D-2 tools.

- **D-2d bounded deployment waiting (#136 candidate):** `vercel_deploy_wait` uses the pinned project-verified GET, short per-request timeouts, up to 3 status observations and an 8-second caller wait budget (below the design's 45-second maximum). Terminal READY/ERROR/CANCELED is reported only after provider readback; other states explicitly instruct the agent to call again. Fake HTTP/CI acceptance remains separate from deployed custom-MCP and Hub D-4 proof. Next investigate runtime streaming and bounded file bytes against the pinned provider contract.

- **D-2c Checks V2 diagnostics #135:** three read-only scoped endpoints implemented for project check definitions, deployment run lists and exact run details. Independent project/deployment GET verification prevents cross-resource disclosure; bounded 20-row summaries redact provider output bodies. Fake HTTP/OpenAPI CI evidence does not establish deployed Vercel/custom-MCP acceptance. Next: assess runtime streamed log bounds, file-content response transport and deployment wait budget before implementing safely. Full RTC live direct/relay/Sandbox owner acceptance and D-1 connected provider proof remain separate gates.


- **D-2b #134 — deployment diagnostics:** verified-project build-log event summary and source-file tree via pinned Vercel read-only GETs. Returns bounded event counts and safe first-error step without raw text; bounded file list without contents. Independent deployment/project readback guards against cross-project access. Malformed/overdeep trees and provider identity mismatches fail closed. Unit/CI fake-provider evidence only, no deployed Vercel provider acceptance. Next D-2c: file contents and runtime/check reads after verifying stream/response bounds; no manual deploy or paid changes.


- **Outcome-first permanent workflow update (alongside RTC #133):**
  Agent workflow now selects the highest-priority eligible capability,
  not an arbitrary five-PR volume target; records the exact evidence and
  trigger needed for deferred work, automatically surfaces eligible
  revisits, and distinguishes code/CI/deployed/connected/Hub acceptance
  in every milestone. The compact continuation prompt preserves main
  checkpoint, milestone, remaining criteria, next action and due blocked
  work, referring back to authoritative documentation. Existing
  production, spend, hosting and owner gates remain unchanged.


- **RTC #133 — isolated Hub TEST identity:** Owner setup issues a separate `mode=test` pass, not a renamed preview credential. SQL limits TEST to exact `server` scope; HTTPS catalog, direct and batch dispatch expose only TEST-safe `vercel_whoami`, which never reads account data or real Vercel API resources. Unit/DB/pinned local Hub checks cover allowed and denied modes, scopes, dispatch and revocation. Actual owner-issued hosted pass, deployed HTTPS, Hub direct/relay/Sandbox and provider acceptance remain UNVERIFIED; production and spending restrictions unchanged.


- **D-2a deployment reads #132:** implemented authenticated, project-bounded `vercel_deploy_list` and `vercel_deploy_get` via pinned GET /v7/deployments and /v13/deployments/{idOrUrl}, with provider project identity verification, pagination, ID/URL normalization and safe field projection. Fake HTTP/OpenAPI regression tests; no real Vercel read, deployment or paid resource. Read-only D-2 progression is explicitly permitted by D-1 #66. Next D-2b logs/files/checks. D-1 remains open with the finite acceptance inventory in `docs/pr-cards/D-1-ACCEPTANCE.md`, and no owner input is pending for IN-07 or IN-08.


- **Roadmap return-to-work rule (#131):** Owner decisions IN-07/IN-08 were already answered, but D-1 had no checkpoint requiring agents to return and reconcile its actual remaining work. New mandatory work-index `revisit` record plus CI validator/test require reason, owner, trigger, next action and checkpoint for every unfinished card; stale owner-blocked statuses fail. D-1's finite completion matrix is the next named action, not an excuse for indefinite security hardening. D-2's PR #66 read-only exception is now machine-recorded, without allowing writes or declaring D-1 done. No external Vercel connection, owner pass, deployment, production or spend acceptance was performed.


- **RTC #130 — hostile nested request arguments:** both single and batch HTTPS pass calls now recursively refuse prototype-pollution keys, secret-shaped input (including nested percent encoding) and overly deep objects before read handlers. Existing safe nested filters and result projections remain supported. Offline adversarial test coverage added, with no new owner, provider, spend or production authority. Five-PR batch #126–#130 reaches its boundary after exact-head merge verification. Real hosted D-4, daily live promotion evidence and production remain unverified.


- **RTC #129 — pre-auth database-cost gate:** malformed bearer headers, invalid HTTP methods and unsupported internal RTC routes now fail before database construction or schema initialization, limiting unauthenticated wakeups. Authorization requires a literal header string; arrays/objects are not coerced. Real passes still require database expiry, revocation and shared quota checks. New HTTP and DB-initialization tests; no production, spending or provider authority change.


- **Security/RTC #128 — read-result content boundary:** read-only MCP shaping now screens plaintext even when the handler emits non-JSON text; unsupported non-text, image/resource and malformed parts fail closed before returning or storing any part. Regression tests prove credential-shaped text is hidden and no handler can bypass the RTC/MCP projection through an unrecognized content type. No provider traffic, production or spend change. Continue approved D-1/RTC integrity work.


- **RTC #127 — atomic batch intent and mid-batch pass revocation:** HTTPS batches now execute the exact immutable preflighted call snapshot, not a second mutable request body. Between each provider read, check that the original preview-only pass still exists, is unexpired/unrevoked and has the identical account and area scope. Revocation/expiry/scope changes stop remaining calls without exposing partial results. Adversarial tests only; D-4 hosted acceptance, money and production remain inactive.


- **RTC #126 — byte-bounded discovery:** GET tool lists now paginate to an exact 8 KiB JSON envelope even for many large, authorized schemas. Direct lookup no longer depends on the first catalog page; oversized single descriptors fail closed rather than returning large replies. Offline adversarial tests; no new authority, production, hosting, money or deployed D-4 proof. Next: RTC response and multi-call integrity work.


- **RTC/D-1 cross-door contradictory-metadata hardening #125:** shared OAuth/MCP profile discovery and direct invocation now refuse nominal read declarations with guarded-write contracts, owner administration, secret directions, destructive hints or contradictory read-only annotations. RTC metadata mirrors the same classification and read-only batch/direct dispatch refuses. Adversarial tests cover every profile and HTTPS. No provider activation, live D-4 proof, spending permission or production deployment. Five-PR boundary reached; see handoff on PR #125 after merge.


- **RTC batch aggregate result-store #124:** ten individually safe read responses must not combine into an oversized HTTP envelope. Inline ≤8 KiB; otherwise write a scoped, 24-hour transient result via the existing pass-derived owner and return a valid handle, read using #123 paged results. No production, money or permanent provider mutation; offline fake/Hub acceptance only.


- **RTC read-only handle result paging #123:** bounded 20-record page of an owner-bound stored handle with page/limit/fields/detail validation, explicit count/next metadata, secret stripping and final ≤8 KB HTTP envelope. Oversized individual records refuse with a safe client error instead of exfiltrating huge data. No write, production or spend authority. Hosted D-4 not claimed.


- **PR #122 — owner hosting policy and late review repairs (2026-10-12):** Merge prepared HOSTING-COST-POLICY and reconcile operating instructions with already-merged #121 daily checked main → live policy, requiring `ci` plus `release-policy` at exact PR head. Cost inventory saved; first scheduled promotion, live source commit and production READY not yet proven. No separate Vercel or Neon project exists for this MCP; do not provision without approval. Correct #119 P1 cached provider quote, #116 P2 recurring price display, #117 P2 batch quota predebit validation, #118 P2 malformed limit selector. No real spending or production execution. See HOSTING-COST-POLICY and RTC-HUB-INTEGRATION.


- **RTC fail-closed metadata/pass hardening #120:** RTC read-only catalogs require explicit read classification, valid area and non-contradictory read hints; duplicate names cannot be discovered, described, invoked or batched. DB-derived RTC pass identity, account, scopes and listing must be well formed before any provider read. Adversarial tests; no permissions widened, real D-4 hosted acceptance still pending.

- **IN-08 last-moment pricing #119:** every spend-classified write (including $0) re-reads its server-owned price/recurrence/description after replay claim and before provider dispatch; a changed price or now-recurring cost refuses. For approved fixed one-time charges the check occurs before consumption of the one-use owner purchase grant. No new charge authority or live provider acceptance.

- **RTC discovery pagination #118:** authenticated HTTPS tool listing now accepts bounded `cursor` offset and returns a usable `next`, with scope/write filtering applied before pagination. Reject malformed selectors; OpenAPI names documented filters. Offline fake catalog tests cover all pages and no hidden tools. No new authority or live acceptance.

- **RTC pass batch quota #117:** POST `_batch` reserves its actual read-tool count in one PostgreSQL atomic counter update before any provider calls. Unauthenticated/invalid batches never dispatch; the default 60/minute pass budget cannot be multiplied by batching. Tests cover shared two-connection contention. No live service D-4 proof or production/spending permission.

- **IN-08 policy hardening #116:** the owner approved fixed one-time paid actions only with separately authenticated one-use approvals; recurring amounts (including $0 up front) and unknown usage cannot be dispatched under a single grant without verifiable provider-side total cost enforcement. Legacy daily-limit advice no longer authorizes charges. No actual paid purchase, live provider write or production activation; metered D-1 remains disabled.

- **RTC #115 — pinned Hub conformance/CLI offline integration:** CI's unit gate checks out reviewed public Hub SHA `e76b1f8bc76e4658f404263ee47a9edbcbeda625`, runs the upstream conformance suite and a real localhost wire route through this server's pass-authenticated HTTPS adapter and the hub's `agent-check` CLI. Test-only random read_only preview pass; refuse writes and confirm revoke; DB test proves shared rate limit across two connections. **NOT a hosted/live D-4 certification:** no real custom service URL/pass provisioned, nor GitHub relay or Sandbox verified; no new production or spend authority. D-1 remains IN_PROGRESS; handoff in docs/RTC-HUB-INTEGRATION.md.

- **RTC #114 — read-only pass HTTPS dispatch:** added pass-authenticated `GET /api/whoami`, tool discovery/describe, read-only POST tool and bounded `_batch`, and account/pass-scoped result retrieval. All route executions delegate through the existing MCP dispatcher/secret-shaping pipeline; write/delegation and out-of-area operations are denied before provider reads. Revoked/expired/rate-limited pass statuses use RTC JSON error envelopes. No live test, no production, and no purchase enabled. Next: RTC conformance/CI and genuine D-4 route evidence.

- **RTC #113 — independently owner-issued read-only passes:** authenticated production setup plus session CSRF/fresh passphrase can issue 1–720 hour passes scoped to preview and explicit areas, with SHA-256 bearer hashes in additive `rtc_passes`. Shared atomic database rate counter (60/min), targeted audited revocation and one-time encrypted secret display. No pass can authorize production, money or mutation; HTTPS consumption remains to be added in #114. No actual pass issued/live use.

- **RTC 1 #112 — public contract and metadata:** read-only `GET /api/contract` and `GET /api/openapi.json` advertise correct operation names, safety flags, counts and modes without requiring credentials; metadata derives from actual guarded MCP registry. Delegated `vercel_call` is classified as write-capable. No HTTP pass access is enabled by a manifest alone. Follow-up: owner-issued read-only pass and authenticated HTTPS door. Production inactive; D-1 remains IN_PROGRESS.

- **D-1bh PR #111 — replay payload isolation:** explicit MCP request keys now use the canonical meaningful payload as well as account, mode and tool; a completed write cannot falsely satisfy changed arguments. Replay-claim transport errors fail closed before provider dispatch. Unit regressions for old-result collisions, database outage and consumed owner purchase approval. IN-08 metered operations remain disabled, production inactive.

- **IN-08 PR #110 — charged-write enforcement:** centrally rejects agent-only purchases and old positive daily limits, requires a stable key and one-use separately authenticated owner purchase approval, with replay, payload and price binding. Metered Git imports and build-resource changes remain disabled until a verifiable provider-enforceable ceiling exists. Temporary recovery note removed; permanent connector-interruption procedure added to AGENTS. All five required exact-head CI jobs passed at the current tested implementation checkpoint; exact-head final CI must be reverified after this reconciliation. D-1 remains IN_PROGRESS; production inactive.


- **IN-08 #109 — authenticated per-purchase owner setup:** owner may review the exact account, tool, quote/usage class, and expiring purchase intent, then separately approve a precisely chosen USD ceiling using fresh passphrase, CSRF, session and one-use database read-back. No agent-provided confirm or spend-limit setting substitutes for this owner action. Metered dispatch remains fail-closed pending #110. IN-08 ANSWERED but dispatch still NOT APPLIED; no live Vercel purchases.


- **IN-08 #108 — transaction-bound purchase ledger foundation:** additive owner-approval intent table with exact account, operation, request key, immutable argument fingerprint and immutable provider/published/variable pricing classification. Proposal is not permission; separate owner approval records the specified maximum (without discretionary daily cap), one-use consumption is atomic and independently readable. NOT YET CONNECTED TO PAID DISPATCH; IN-08 ANSWERED, implementation still IN_PROGRESS, no live purchases.


- **IN-07 #107 — all project identities eligible:** authenticated owner setup can clear existing global and account-scoped project exclusions, with fresh passphrase, CSRF, account verification, explicit removal acknowledgment, atomic audit and readback. No hard-coded named project (including this server) is unconditionally forbidden; server token, production, destructive, scope and app-profile protections remain independent. No live execution or authorization to activate production.


- **D-1bg PR #106 — P1 security race corrections:** inspect credentials through the eighth percent-decode including entropy; repeat independently owned spending-policy verification after the final authenticated name GET and before metered Git project creation POST. Adversarial fixture tests; no Vercel production writes or newly authorized paid operations. D-1 remains IN_PROGRESS.


- **D-1bf PR #105 — membership pagination integrity:** complete team/project member inventories now reject contradictory root continuation flags, incomplete next-page signals and declared page counts that differ from observed records. Existing safe role grants/removals refuse before POST/DELETE on contradictory provider inventories. Fake-provider regression coverage; owner-gated admin and nonempty deletion still disabled. D-1 IN_PROGRESS; production inactive.

- **D-1be PR #104 — name-collision race protection:** creation rechecks exact project name availability with the same bound credential that would POST, after any slow Git proof and owner spend checks; a concurrently claimed name or unverified GET refuses all creation. Fake-provider tests cover both empty and paid Git imports. D-1 IN_PROGRESS; no live resources or changed owner gates.

- **D-1bd PR #103 — encoded metadata secrecy:** central credential checks now decode nested percent-encoded text for inspection before projecting project and Git metadata; unknown repeated nesting refuses rather than risking a hidden secret. Read-only fake-provider tests cover nested tokens; no provider write or additional authority. D-1 IN_PROGRESS; production inactive.

- **D-1bc PR #102 — verified user identity for guarded access:** project/team membership inventory and grant/remove checks now require stable `uid` or matching `userId`, and never substitute a membership-record `id` for the user who could receive or lose access. Reject unverified records before POST/DELETE; adversarial identity tests. D-1 IN_PROGRESS; owner-gated admin/deletion disabled and production inactive.

- **D-1bb PR #101 — consistent authenticated Git search:** require the same validated top-level `gitAccount` identity for read discovery and owner-gated metered Git project imports, including preflight and last-moment bound-credential verification. Forged or rotated provider/namespace metadata refuses before POST. Offline fake-provider tests only. D-1 remains IN_PROGRESS; IN-07/08 pending; production disabled.

- **D-1ba PR #100 — canonical Git discovery links:** read-only repository results now expose a provider HTTPS link only when the URL path exactly matches the verified canonical full repository name, and refuse mismatched provider/namespace metadata from both root `gitAccount` and individual repository rows. Fake-provider tests cover same-host link spoofing, encoded paths and cross-namespace rows. Also corrects post-merge #99 P1: percent-encoded cron paths/schedules now redact before MCP output. No live provider write, privileges, production activation or spending changes; D-1 remains IN_PROGRESS.

- **D-1az PR #99 — cron output secrecy:** cron list projection now strips URL parameters while suppressing credential-shaped plain/percent-encoded paths, control-bearing paths, suspicious schedules and provider IDs. No cron invocation or provider write. D-1 still IN_PROGRESS; production remains inactive.

- **D-1ay PR #98 — unambiguous read-only membership identities:** project member reads reject contradictory `uid`/`userId` aliases and duplicate user IDs; membership-record IDs are not misrepresented as user UIDs. Project and member read pages also refuse contradictory root continuation flags. No access grants/removals or elevated authority unlocked. D-1 IN_PROGRESS.

- **D-1ax PR #97 — transfer issuance credential-bound recheck:** a one-time transfer claim now requires an unchanged stored team/account and a fresh immutable project ID/name proof using the exact credential that would POST. Credential rotation or rename aborts before transfer code issuance. No claim is generated in real Vercel; production and owner controls unchanged. D-1 IN_PROGRESS.

- **D-1aw PR #96 — conservative reported resource totals:** irreversible empty-only project deletion requires schema-real pagination counts and rejects any domain, environment or deployment inventory whose declared total contradicts the observed terminal page; totals on preflight and final bound-credential recheck are both enforced. Nonempty deletion, spending and production remain blocked. D-1 IN_PROGRESS.

- **D-1av PR #95 — destructive storage inventory consistency:** empty-only project deletion now inspects both `storageConnections` and legacy `stores` when both are present; a nonempty or malformed secondary inventory refuses DELETE rather than allowing one empty alias to conceal data. D-1 remains IN_PROGRESS; independently owner-gated privileged roles and nonempty deletion remain disabled.

- **D-1au PR #94 — canonical Git import identity:** authenticated repository search now treats `fullName` as authoritative when present; a colliding `slug` cannot override another repository identity before a potentially metered Git project creation. Scope and $0 default preserved; D-1 IN_PROGRESS.

- **D-1at PR #93 — Git repository link authenticity:** read-only Git search only projects canonical HTTPS repository links on the selected Git provider's recognized hostname, excluding external and lookalike hosts. Git identity/spend/creation gates unchanged; D-1 IN_PROGRESS.

- **D-1as PR #92 — truthful project pause status:** project summaries and detail now distinguish unknown, contradictory and confirmed paused/unpaused metadata. Unknown never displays as safely running; provider read only, no traffic change. D-1 IN_PROGRESS.

- **D-1ar PR #91 — verified member identity aliases:** project/team member pagination rejects conflicting provider `uid`/`userId` aliases before any project role grant or revocation. A distinct membership record `id` remains valid. Tested offline; privileged ADMIN/owner changes still disabled; D-1 IN_PROGRESS.

- **D-1aq PR #90 — project member read secrecy:** member ID, display name, email and role now reject credential-shaped provider text as well as control characters and oversized values. Fake-provider tests show secrets cannot escape in read-only MCP results. D-1 remains IN_PROGRESS pending independent owner-gated privileged membership/deletion; D-2 not yet authorized.

- **D-1ap PR #89 — Git discovery output secrecy:** namespace and repository fields reject credential-shaped text, identifiers and repository URLs, including arbitrary provider labels. Fake-provider adversarial tests; no live Vercel actions or widened access. D-1 remains IN_PROGRESS.

- **D-1ao PR #88 — metered resource lost-update defense:** fingerprint selected original build/function settings; final credential-bound GET refuses a concurrent value change before the billed PATCH. Usage-spend and confirmation gates unchanged; no real billable operations or production activation.

- **D-1an PR #87 — reject stale project setting overrides:** project command, directory and framework writes fingerprint their original selected values and recheck them using the PATCH credential. Concurrent edits refuse before mutation, with no raw build-command values in audit/previews. No new production authority; D-1 remains IN_PROGRESS.

- **D-1am PR #86 — last-moment project role collision check:** the guarded grant re-enumerates the complete project membership using the very credential that would POST, refusing any concurrently assigned viewer, developer or administrator role instead of accidentally overwriting it. Race/partial-page tests included. Project ADMIN grant remains gated; D-1 IN_PROGRESS and production inactive.

- **D-1al PR #85 — project traffic execution race hardening:** production pause/unpause now authenticate the current team scope, immutable project identity and original pause state using the same writable credential that would perform POST. Changed state, owner token rotation or project rename abort before traffic impact. D-1 remains IN_PROGRESS pending independently owner-gated operations. D-2 only when roadmap dependency authority permits; production inactive.

- **D-1ak PR #84 — project settings confirmation-time identity and production protection:** rename, framework and grouped build-command/directory updates now validate final project identity and live-status classification through the exact PATCH credential. Project renames, rotated project scope and new live deployments abort before PATCH. D-1 remains IN_PROGRESS; production inactive.

- **D-1aj PR #83 — metered resource execution proof:** guarded build/function resource mutations now recheck immutable project identity, same-bound writable token authority and independently owner-approved daily spending immediately before billable PATCH. Changed limits, scope or project identity abort without write. D-1 still IN_PROGRESS; production inactive.

- **D-1ai PR #82 — destruction credential-race closure:** empty-only deletion now uses the identical write credential and team for complete final inventory and irreversible DELETE. Credential/scope changes cause definite pre-dispatch refusal; conservative project `hasDeployments` remains a hard gate even when the separate page is empty. No new deletion authority or live operations.

- **D-1ah PR #81 — six post-merge review corrections:** canonical metadata sanitization, numeric deployment impact with conservative emptiness, same credential for write-time project access and Git proof, spend policy after Git reads, and retry-safe release for definite pre-dispatch denial. Adversarial unit and database checks; D-1 remains IN_PROGRESS, owner gates and production inactivity unchanged.

- **D-1ag PR #80 — Git-import execution gate:** confirmed Git project imports now recheck stored-account daily spend authorization and independently authenticated namespace/exact repository identity immediately before potentially metered POST. Lost permission or spending headroom aborts without creation. Default $0 spending refusal, no production activation or privileged owner change. D-1 remains IN_PROGRESS.

- **D-1af PR #79 — revocation execution recheck:** before project-role DELETE the bound owner principal, project identity, complete project role inventory, last-member safety and independently verified contributor status are rechecked; any intervening elevated role/identity change aborts. No owner/admin removal enabled. D-1 IN_PROGRESS; production inactive.

- **D-1ae PR #78 — grant-time identity revalidation:** project role grants now re-read immutable project identity and independently re-prove confirmed team contributor eligibility immediately before POST. Changed team role or project identity stops execution; administrative grants remain separately owner-gated, production inactive. D-1 IN_PROGRESS.

- **D-1ad PR #77 — nonempty deletion impact in dry-run only:** authenticated complete inventory counts explain nonempty deletion impact during dry-run without unlocking removal; confirmation remains empty-only and owner-gated. Fake REST verifies no DELETE or sensitive content. D-1 remains IN_PROGRESS.

- **D-1ac PR #76 — safe project metadata projection:** project list and detail whitelists now reject credential-shaped, unbounded or control-bearing scalar fields and suspicious production alias URLs. Project settings/createdAt are bounded; no provider writes or owner gate changes. D-1 remains IN_PROGRESS.

- **D-1ab PR #75 — shared Git import proof:** one fail-closed authenticated namespace verifier now protects both Git discovery and production-classified, potentially metered Git-linked project creation. New exact repository proof rejects duplicate matches, conflicting provider/namespace metadata and restricted/reauth repositories before POST. All previous owner-stored spending, production/full-profile confirmation, immutable read-back, app/protected and replay gates remain unchanged. D-1 remains partial pending separately reviewed privileged membership and nonempty deletion designs. Proceed to D-2 only when dependency authority permits.


- **D-1aa PR #74 — callable, bounded read pagination:** authenticated project and member page tools require explicit valid continuation metadata, reject oversized or inconsistent pages, normalize safe numeric-string cursors to callable integer `until`, and return `complete`/`nextStep` accurately. Member metadata is explicitly bounded. No team scope override or write surface changed.


- **D-1z PR #73 — fail-closed destructive inventory proof:** empty-only deletion now requires explicit Git link state and fully enumerated domains/env collections with terminal pagination, at most 100 entries and no contradictory continuation flags. Missing link, partial or oversized resources refuse before DELETE. No nonempty deletion enabled; full owner and production gates remain intact.


- **D-1y PR #72 — independently verified Git discovery:** authenticated repository search first checks that exactly one matching, accessible Git namespace exists for the selected provider, rejecting restricted/reauth/ambiguous selectors before search. Returned repository links require safe HTTPS with no URL credentials, query or fragment; metadata is whitelisted and bounded. D-1 privileged actions remain gated; production inactive.


- **D-1x PR #71 — richer safe project inspection:** `vercel_project_get` includes whitelisted Git linkage, ignore-build command, deployment presence, pause status, selected compute configuration and bounded production deployment metadata for operational diagnosis. Unknown is null; nested tokens/credentials and arbitrary provider objects excluded. D-1 owner-gated privileged access and nonempty delete remain disabled.


- **D-1w PR #70 — bounded complete membership pagination:** shared authenticated project/team member inventory now follows up to five explicit safe numeric cursors, while refusing duplicate identity, repeated cursor, missing pagination, contradictory flags and excess scope. Large-team viewer/developer grants and removals remain independently owner-safe and production-confirmed; no widened admin rights or real Vercel writes. D-1 still partial; privileged member and nonempty delete require separate approved owner design before D-2 dependency can be declared complete.


- **D-1v PR #69 — independently verified deployment-free deletion:** even when the project GET claims `hasDeployments:false`, empty-project deletion also requires a complete authenticated `/v7/deployments` inventory, exactly scoped to the immutable project ID, before preview and again immediately before DELETE. Unknown/paginated/cross-project/late deployment data fails closed. Nonempty project deletion remains disabled; no live mutation.


- **D-1u PR #68 — provably safe role revocation:** reuse the authenticated team contributor/complete-membership preflight for viewer/developer removals, preventing a misleading project role field from revoking a team owner/member or ambiguous identity. Missing, unconfirmed, paginated or non-contributor team records are denied before DELETE. No new owner role capability or real Vercel write.


- **D-1t PR #67 — independently verified existing team identity:** ordinary project member grants require an independently fetched, complete team page containing exactly one confirmed CONTRIBUTOR matching the supplied UID. The team identifier comes only from the stored account, and no team invitation is issued. Owner/admin project access remains blocked. Fake Vercel and exact-head CI only; no live provider resources.


- **D-1s PR #66 — access-role and pagination safety:** MCP project role grants are restricted to project developer/viewer until an independently authenticated owner design is approved for ADMIN; grant and removal refuse incomplete member inventories (missing terminal cursor, further pages, oversized page). Offline CI only. Remaining D-1 privileged role and nonempty deletion work stays gated; D-2 read tools can proceed independently.


- **D-1r guarded Git-linked creation (#65):** extend existing project creation with exact repository/namespace lookup through the authenticated Vercel Git connection. Unlinked projects retain preview-mode $0 flow. Git imports require full-profile production connection and explicit confirmation, spend policy with owner-set positive limit, pinned POST schema and independent GET identity/Git-link read-back. No repo credentials, user-supplied monetary quote, provider Git tokens or real Vercel writes. Elevated role removal and broad project delete remain independently blocked; IN-07/08 pending.

- **D-1q grouped build/function resources (#64):** full-profile production-confirmed and protected project resource PATCH, with pinned resourceConfig body, authenticated owner limit/spent checks (unpriced usage blocked at $0), no caller-quoted charges, partial-field-only changes and independent resource read-back. No real Vercel spend or production activation. Continue D-1 Git-linked creation and separately approved elevated membership/broad-delete work.

- **D-1p spend boundary preparation (#63):** shared account-bound spend policy reads only owner-approved limit and already-spent cents from the authenticated account; unknown costs cannot bypass $0 default or an exhausted limit, and user confirmation is still required. Paid writes carry integer-cents evidence into the safe change audit (only after actual apply, never on preview). Enables separately reviewed metered project resource settings; no paid writes or live Vercel actions introduced.

- **D-1o guarded project transfer code issuance (#62):** full-profile production-confirmed project transfer request using exact typed project name and protected/app guards. The returned code is stored encrypted for owner-only one-time reveal; only opaque reference enters safe transport replay, audit and MCP. This initiates a claim, never completes a transfer; confirmation of actual ownership is unknown. No connected token or real project used. Remaining D-1: Git-linked creation, build-resource spend controls, privileged membership decisions and broad deletion safety.

- **D-1n correctness repairs (#61):** PATCH project configuration accepts explicit nullable override resets (independent read-back accepts null or omitted defaults); MCP schemas, local validation and pinned request validation enforce 256-character limits for all six fields. Project creation keeps nonnullable configuration. Both unresolved #57 reviewer findings addressed with grouped reset and 256/257 boundary regressions. No production activation. Continue approved D-1 work and independent spend/access/destructive reviews.

- **D-1m guarded empty-only deletion (#60):** separate destructive review, verified scope and resource inventory from project, domains and env GET, explicit typed-name and production confirmation, conservative refuse-on-unknown and independent 404 read-back. Broad delete/transfer/spend remain outstanding. Production inactive; IN-07/08 pending.

- **D-1l grouped project creation (#59):** same six pinned build settings supported on unlinked project creation, shared input validation with project updates and independent full-configuration read-back. Next independently review destructive project deletion; no production activation.

- **D-1k grouped project traffic lifecycle (#58):** production-confirmed pause/unpause with scoped before/after Boolean paused status and no-op replay protection. Full-profile access conservative for resuming metered service. Next independently gated delete/transfer and build-resource spend; IN-07/08 pending, production inactive.

- **D-1j grouped project configuration (#57):** add build/install/dev/ignore commands and root/output directories to the single guarded project PATCH; values never enter previews/audits, existing live-status and read-back checks reused. Next D-1 lifecycle/spend units remain gated; production inactive.

- **PR #56 security/throughput baseline:** resolve unresolved #51 trust-origin, per-mutation transport replay and write-only MCP classification findings with adversarial tests. Group compatible D-1 settings changes in later PRs, preserving approval and risk boundaries. IN-07/IN-08 pending; no production activation.

- **D-1i guarded project member removal (#55):** DELETE /v1/projects/{idOrName}/members/{uid} only for existing viewer/developer roles, explicit production/full connection and confirmation, server principal and admin/owner/final member denial, complete pagination required and independent no-membership read-back. Admin/owner removal intentionally deferred pending verified last-owner protection. Finish remaining D-1 project operations in #56 onward; IN-07/08 still pending, production inactive.

- **D-1h guarded project member grant (#54):** POST /v1/projects/{idOrName}/members for an existing team UID only, no seat invites or paid operations, production/full connection required, access-widening declaration, preflight member existence and bounded page, independent member-role GET read-back, safe audit and replay. Next guarded member removal; production inactive and IN-07/08 outstanding.

- **D-1g guarded project rename/framework (#53):** PATCH /v9/projects/{idOrName} with authenticated scope, true before/after project GET, production classification on live or unknown deployments, protection for old/new project identity, replay, confirmation and safe shaping. Build/install/dev commands and remaining settings are still pending D-1, not claimed complete.

- **D-1f guarded empty-project creation (#52):** signed server-scope stored credential, pre-create existence check, explicit preview confirmation, parent project target self/app guards, double-scope durable replay, real POST /v11/projects, and independent GET read-back. Does not attach Git, env variables, deployments or spend. Next D-1 settings mutation and member roles; no live activation.

- **D-1e guarded-provider transport and mandatory session handoff (#51):** independent logical/transport replay keys, server-selected credentials, fail-closed write binding, explicit routine-write profile metadata and immediate five-merge close-out. The general gateway has no project mutation published yet. Next: independently test and register project creation with `defineWrite`, followed by project and member changes. Production remains inactive.

- **D-1d cron schedule read (#50):** read project `crons.definitions` (not a fabricated array), return only route/schedule/source and UTC schedule with January/July Denver DST examples for simple daily expressions. No job invocation, URL query or secrets, cross-project access blocked. Missing definitions reported unavailable rather than empty. Project alias and cron-count projection corrected. D-1 remains IN_PROGRESS; next guarded project/member/cron/Git mutations, no owner/production changes.

- **D-1c Git discovery (#49):** pinned-schema compatibility normalizer strips invalid untyped nullable annotations and exact duplicate oneOf alternatives without removing allowed-type constraints, with a narrow Git namespaceId union compatibility rule that retains established request coercion;  provider-approved namespace and repository reads, server-stored credentials, per-token exception only for the Vercel Git namespace endpoint (no unsupported teamId), team injection on repo search, sanitized outputs, scope denial and request-shape tests. D-1 IN_PROGRESS; next crons. No owner/production gate changes.

- **D-1b member and cursor reads (#48):** authenticated project member/role list, server-selected team and strict project-only account restriction, safe summaries, bounded pagination inputs and project-list cursor continuation. Fake HTTP, malformed input and scope denial regressions; offline only. D-1 remains IN_PROGRESS; next cron and Git discovery.

- **D-1a project reads (#47):** server-selected encrypted credential binding and two verified read-only project operations (team list/single project), fail-closed project-account isolation, bounded response fields, fake REST tests, and no provider writes. D-1 remains IN_PROGRESS; next project member, cron and Git reads.

- **B-1 through B-7 merged (#17–#23):** guarded write architecture, owner production approval, self-protection, safe errors/output, profiles, and catalog-enforced write-safety CI.
- **B-8a verified merged (#24):** main `fad643a011171fee5766be9d05c0e4aa602e9ba9`, all five post-merge CI checks passed. Three read-only server tools (connections, recent changes, guided dashboard directions), scoped queries and token expiry warnings. All offline/test-only.
- **B-8b owner administration built in #26–#35:** scoped read/recheck and account isolation; local owner-only default selection (#30), exact spend limits (#31), serialized connector revoke (#32); encrypted single-use requests (#33), owner review (#34), and independently authenticated local application (#35). These are server-side, offline-tested capabilities, **not live operations**.
- **B-8 completed (#24, #26–#40):** all named MCP owner-account tools now register safely as production/full-profile guarded **approval requests only** (#37–#40). Confirmed issuance returns an encrypted, tenant/action/target-bound ten-minute reference with `confirmed:false`, durable replay and independent inspection. Actual account changes still require a separately authenticated setup session, CSRF, a fresh passphrase, owner confirmation, atomic SQL safety and verified read-back (#30–#35). Current enabled door is MCP; meta dispatch/HTTPS remain future C-2/R-2 and must inherit the same guarded registry. **Next: C-1** summaries, fields/detail, scoped result handles and annotations, then C-2. IN-07/IN-08 remain open; default spending is $0 and production inactive.
- **C-1a scoped result-storage foundation (#41):** per-bearer opaque owner identity, sanitized bounded result table and scoped SQL read-back with ≤100 expired-row cleanup. No MCP retrieval exposed yet. Next central C-1 projection and display/retrieval before C-1 completion.
- **C-1b view rules (#42):** explicit safe provider summaries, nested fields projection with unknown-path reporting, full/summary views and secret-key omission even for full env results. Next integrate 8 KB handles/metadata into the MCP door.
- **C-1 completed (#41–#43):** per-bearer result ownership, bounded sanitized storage, reusable summaries/fields/detail, read-only paged `vercel_get_result`, and centrally advertised read view/annotations. Next C-2 compact/catalog discovery and wrapped meta dispatch; no production activation.
- **C-2a compact discovery (#44):** profile-authorized catalog/compact listing, `vercel_search_tools` and `vercel_describe_tool` with strict validation and exact schema disclosure only to eligible callers. Next C-2 wrapped `vercel_call`/read-only `vercel_batch` and token budget hardening; C-2 IN_PROGRESS.
- **C-2c budget close-out (#46):** pinned gpt-tokenizer 3.4.0 replaces character-count approximation. The exact MCP-advertised compact and everyday catalog shapes, every registered schema and all description lengths are enforced with planted failing fixtures. C-2 and Batch C complete; next D-1 project/Git/crons provider reads and guarded writes. No live resources or owner gates changed.\n- **C-2b wrapped meta calls (#45):** `vercel_call` delegates only to the existing scoped/guarded dispatcher and `vercel_batch` rejects any mixed/hidden/write input before executing up to ten read calls. C-2 budget enforcement subsequently completed in #46. Production and owner approvals unchanged.
- **Not activated:** no Neon instance initialized, real Vercel token set, or server deployed. Owner inputs IN-07/IN-08 and all live change approvals remain outstanding.

## What works today (A-1)

| Command | What it proves |
|---|---|
| `npm run check` | secret scan of every tracked file, docs reconciliation, work-index validation, lint, catalog consistency (236 tools), write-safety, core-imports, token budgets |
| `npm test` | unit suite: fake Vercel API, registry, every check script against planted violations, db contract on the fake |
| `npm run test:db` | the db contract on throwaway Postgres (CI service; locally a disposable cluster from local binaries) |
| `npm run test:emulate` | Vercel Labs' `emulate` 0.12.1 started on localhost, Vercel-shaped reads answered, stopped afterwards |

CI (`.github/workflows/ci.yml`): jobs `check`, `unit`, `db`, `emulate`; the aggregate job **`ci`** is the single merge
gate and fails unless all four succeeded. Proof it turns red: [run 38077445050](https://github.com/Robinson-AI-Systems/vercel-mcp/actions/runs/38077445050) — a deliberately failing unit
test made `unit` and `ci` red while `check`, `db` and `emulate` passed; the test was then removed. Final green run:
linked in PR #1.

## Environment

- Repo: `Robinson-AI-Systems/vercel-mcp` (public), default branch `main`. Every change goes through an `ai/*` branch and
  a PR; CI must be green at the exact head before merge.
- Vercel project, Neon database and Vercel tokens for this server: not created yet (IN-02, IN-03, IN-04). Not needed
  until A-5 is tried for real.

## Recent merges and implementation checkpoints (newest first)

**2026-10-11 — B-8b local owner default-account setting (#30 merged):** production-server-only owner setup form, signed session + CSRF + fresh passphrase + explicit confirmation. A single SQL statement changes the global default and writes safe audit; read-back required to claim success. Unit tests for owner security and disposable-Postgres tests for missing target, concurrent selections, one default, unchanged credentials/connector settings. No MCP owner write or provider mutation, B-8 remains IN_PROGRESS.


**2026-10-11 — B-8b owner boundary design (#29, pending CI/merge):** reviewed trust boundary for locally authenticated owner-only default selection, future targeted revocation/spend and concurrency/audit requirements. No code/DB mutation, no MCP write exposure or live resources. Next safe slice: implement default selection in the existing owner setup form with offline DB/unit evidence.


**2026-10-11 — B-8 account-list isolation (#28, pending CI/merge):** connector-scoped account lookup replaces global enumeration for `vercel_list_accounts`. Owner web panel retains authenticated global listing. Disposable Postgres test checks safe columns, tenant filtering and missing account; unit tests reject forged selector and verify no cross-account data. No owner operations enabled, B-8 still IN_PROGRESS.


**2026-10-11 — B-8b authenticated owner panel (#27, pending CI/merge):** recheck current stored token by owner-selected account on existing authenticated setup form, after session and CSRF validation; block unknown targets and sanitize provider failures; no credential replacement, approval, money, profile or database writes. Unit tests of forged session/CSRF/account, safe response and errors. B-8 remains IN_PROGRESS.


**2026-10-11 — B-8b token read recheck (#26, pending CI/merge):** encrypted stored credential loaded only inside service; three bounded GETs, stored-team/project binding, fail-closed incomplete pages and wider visibility, no persisted metadata, no write/owner permissions granted. Unit regressions for invalid caller inputs, error cases, tenant isolation, zero mutations. B-8 remains IN_PROGRESS; next mutation requires reviewed owner identity/concurrency policy.


**2026-10-11 — Implementation guidance:** added current-code locators, reusable execution recipes, remaining-work map
and a B-8b worked example; startup/card-writing instructions link only the relevant sections. Proposed paths and
unresolved owner/connection boundaries are explicit; no product behavior, defaults, owner inputs or work-index status
changed. Verified #24 merged; B-8b remains next. See [guidance](implementation-guidance/README.md).

**2026-10-11 — B-8a (PR #24 pending CI/merge):** working bounded read-only account/connection metadata and change-log summaries, guided settings map, near-expiry warnings; disposable Postgres tenant-isolation regression. Remaining B-8b owner mutations explicitly deferred.

**2026-10-11 — B-7 verified merged (#23):** guard declarations proven with all five CI checks; main `1f9767c96bcb2e6524178a83612bdcb23e896ee5`.

**2026-10-11 — B-7 write declarations (PR #23 pending CI/merge):** strict catalog-linked write safety checks and violation regression tests; no external actions.

**2026-10-11 — B-6 verified merged (#22):** strict profile filtering and home-page counts; main `1c925847c2f808282b5689a321e50a22e65c4141`.

**2026-10-11 — B-6 profiles (PR #22 pending CI/merge):** centralized strict profile-based listing and tool invocation, retained exact local owner switch allowlist, added home-page counts and direct-invocation regression tests. No live provider actions.

**2026-10-11 — B-5 verified merged (#21):** safe recursive output and encrypted one-use input handling, aggregate CI green; main `0bc55c5ed23cef009236e20f27a838f0be0f7f97`.

**2026-10-11 — B-5 result shaping (PR #21, pending CI/merge):** added provider-neutral recursive secret redaction, Denver-local millisecond dates, integer-cents display, size/depth checks and Vercel MCP boundary integration; one-use owner-input resolver and encrypted created-secret references. Offline unit tests; no real provider calls.

**2026-10-11 — B-4 verified MERGED (#20):** commit `83bdd0ccb1ed642c773032f68da656aafda2835e` and all five post-merge checks succeeded. No real credentials or production operations.

**2026-10-11 — B-4 error reporting (PR #20 pending CI/merge):** reconciled unfinished branch with merged B-3; maps recognized provider codes to safe actionable explanations, preserves status, safe operation and Denver rate-limit window, and rejects credential-shaped scope labels. Unit and MCP dispatch tests. No live writes or credentials.

**2026-10-11 — B-3 self-protection (PR #19 pending):** global/team protected-project rules and inherited child-resource guards, protected server token and ID, owner-authenticated add-only protection editor, read-only listing and application guard hook; unit and isolated Postgres tests. No live resources modified.


**2026-10-11 — B-2 owner production guard (PR #18 pending):** adds dedicated pending approval from full preview profile, expiring one-time reference, owner password reentry under setup CSRF, production-server-only switch, confirmed disable with bearer revocation, event audit. Unit and disposable Postgres tests validate no direct AI production enablement. No live change.


**2026-10-11 — B-1 trust-layer primitives (PR #17, merge pending):** generic fail-closed write policy, production classification, integer-cents spend checks, durable request replay and sanitized audit logs. Contract tests cover all eight expected behaviors; no public mutations.


**2026-10-11 — A-6 owner deployment instructions (PR #16, merge pending):** added `docs/DEPLOY.md` explaining controlled dedicated Vercel/Neon setup, safe environment variables, owner-only token entry, read-only MCP connector sign-in and troubleshooting. Documentation only; no external services created.


**2026-10-11 — A-5 owner setup (PRs #13/#14 merged, #15 merge pending):** AES-GCM encrypted credentials, atomic one-time values and inputs, passphrase-locked setup with encrypted 15-minute cookie and CSRF, conservative protected-project defaults, and safe read-only account tools. All tested offline, no live secrets.


**2026-10-11 — A-4 official API transport (PR #12, prepared for merge):** added `src/vercel/client.js`, `operations.js`, strict JSON/schema request validation, snapshot-find/diff scripts, bounded retries/rate-limit/pagination, an additive 10-minute atomic `request_replay` claim table, fake/emulator tests and disposable-Postgres replay concurrency checks. No real Vercel call or token used. Merge only after latest CI is green at the exact head and documented self-review.


**2026-10-11 — Branch reconciliation:** no open PRs or drafts at session start; ten prior AI branches had zero commits ahead of `main`, while `ai/gpt6/a-3b-oauth-endpoints` had only one superseded documentation line in `docs/pr-cards/A-3.md`. That line is already corrected by the merged A-3 record; do not merge the divergent old branch. No historical implementation needs recovery.

**2026-10-11 — Official Vercel OpenAPI snapshot (A-4 prerequisite):** imported the original 11,611,860-byte response from `https://vercel.com/openapi.json` without reformatting, at `vendor/vercel-openapi/openapi-2026-10-11.json`. `SOURCE.md` records SHA-256 `af1db6e9c95e446468f0c3974653298afe8079db03ee2872429a65cb60a72544` and 451 HTTP operations. This is **not** completion of A-4; client and validators remain.

**2026-10-11 — A-3b endpoint implementation (PR #8, merge pending):** fixed-origin HTTP helpers, client registration, passphrase-gated authorization, PKCE/resource checks, code/refresh-token exchange, well-known metadata, bearer authentication, default-deny read-only dispatch, and the status page are implemented. CI run [38141774150](https://github.com/Robinson-AI-Systems/vercel-mcp/actions/runs/38141774150) passed all jobs at head `27db3ef4e2e884133be1805fe3221a86450d0dae`; this commit reconciles the final roadmap/card wording and triggers the final CI confirmation before merge. No real Neon database or Vercel token was used.


**2026-10-11 — A-2 database schema (PR #6, merged as `0cd2e1e11154603049e4bb6a514f83df6fc15837`):** nine additive tables and eight indexes; lazy Neon configuration; frozen connection-field contract; fake and throwaway-Postgres schema tests. CI run [38139075567](https://github.com/Robinson-AI-Systems/vercel-mcp/actions/runs/38139075567) passed all four jobs and aggregate `ci` at head `330dda3367e80a26b958faf579051ac88cae4fe3`. No real Neon database was created or initialized.


**2026-10-10 — CI cadence (docs + CI config PR):** never push while a PR's CI run is in progress (SESSION-START §6,
PLAYBOOK Step 5); obsolete PR runs are cancelled, runs on `main` never are. Next action unchanged.

**2026-10-10 — A-1 foundation (PR #1, branch `ai/claude/a-1-foundation`):** Node 24 ESM package with committed lockfile
and exact versions; `scripts/check-secrets.mjs` (tracked files, planted-token test), `check-docs-updated`,
`check-catalog`, `check-writes`, `check-budgets`, `check-core-imports`; empty registry (`mergeNamespaces`);
`test/helpers/fake-vercel.js`; throwaway-Postgres harness; pinned `emulate` runner; four CI jobs plus `ci`.

**2026-10-10 — Gap check against prior toolkits:** every Vercel tool name from Chris's earlier toolkits mapped in
`audits/2026-10-10-prior-tools.md` — 273 unique names: 211 covered, 7 universal, 44 dropped with reasons, 9 tools added
(E-4, M-2, M-4 with IN-15). Catalog 232 hand-built + 4 universal = 236; work index 59 cards (old-toolkit decision note dropped).

**2026-10-10 — Plan written:** research audit, TOOL-CATALOG, 15 batch designs, AGENTS, START-HERE, SESSION-START,
PLAYBOOK, drift protocol, PLAN, MASTER-ROADMAP, owner inputs, go-live checklist, decisions, roadmap, owner guide,
Appliance Desk project profile, work index with validator, card A-1.

## Blocked

- Historical owner-input checklist above is superseded by the dated setup checkpoint and `docs/OWNER-INPUTS.md`: IN-02 through IN-05 were applied on 2026-10-13. Authenticated connected acceptance, owner-approved nonproduction targets, and unrelated policy gates remain separate.
