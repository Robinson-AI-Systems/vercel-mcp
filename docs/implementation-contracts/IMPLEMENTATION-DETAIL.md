# Implementation detail — approved remaining work


## Concrete implementation contracts — owner-requested review, October 14, 2026

The owner requested the same implementation detail across all six active MCP
repositories, specifically for Sol 5.6. This section fills routine design details
inside the approved roadmap. It is a design supplement, not another roadmap,
process, new countable subsection or claim that code/acceptance is complete.
Existing cards/public schemas and later owner decisions win over historical
recipes; reconcile mechanical drift with current main before coding. Do not
replace working code simply because a proposed filename below differs.

### Shared input, state and result contract

- Freeze the existing subsection IDs and complete scope first. In the current
  card, list each public tool from TOOL-CATALOG, its exact schema, the existing
  wrapped handler/client export and the corresponding provider operation. A
  future path below is proposed until it exists. Build the complete coherent
  outcome; do not publish one helper as a completed subsection.
- Keep public ABI compatibility. For new compound implementations use an internal
  plan `{operation, account, mode, target, steps}`. Each ordered step has a stable
  `id`, exact wrapped `tool`, validated `args`, before-state requirements,
  intended after predicate and inverse-or-reason. Account/mode come from trusted
  context, never caller-supplied credentials. Translate these internal records
  into the existing public tool schema; do not invent a second external envelope.
- Explicit IDs beat free-text guesses. Resolve friendly names with authorized
  reads; zero matches is missing, multiple matches requires disambiguation.
  Reject unknown fields/enums and conflicting targets before dispatch. Omitted
  means retain; explicit empty/false/null clears only where the provider supports
  that operation. Whitelist path/query/body fields; never forward local safety,
  pagination/presentation or request-key arguments into provider payloads.
- A new workflow's observable details use ordered per-step rows with stable IDs,
  target, outcome, safe reason and provider/audit references when actually known.
  Outcomes distinguish `planned`, `refused`, `confirmed`, `unverified`, `failed`,
  `unknown` and `not_attempted`. Aggregate success requires every required step
  to be confirmed; optional unavailable items remain explicitly unavailable.
  An HTTP 200/202/204 or an outer `done:true` alone is never provider confirmation.
- Preview validates the entire plan and uses child `dryRun:true`; provider writes
  are zero. Existing preview audit logging is allowed. Execution requires the
  original operation-specific confirmation/owner authority; a single workflow
  confirm never creates financial, access or production authority. Recheck
  mutable target/protection/account state before each dependent write.
- Execute dependent steps in order. Persist existing run/replay checkpoints
  before/after ambiguous effects where the approved design requires durability.
  A failed dependent step stops its descendants; untouched rows are
  `not_attempted`. Independent read sections can continue and return partial
  coverage. No blind retry after an uncertain POST, no automatic rollback and
  no new background scheduler merely to finish a synchronous workflow.
- If a request times out after dispatch, mark its outcome unknown and reconcile
  the original target/request key before resuming. Reuse the service's replay
  mechanism; a second generic UUID is not recovery. Explicit undo only follows
  recorded, still-valid inverses through wrapped tools and fresh guards.
- Bound existing time/page/byte budgets, return an explicit continuation where
  supported and use connection-owned result handles. A cursor/handle is bound
  to account, connection/grant and query; expired/revoked/foreign ones refuse.
  Do not silently truncate and label the result complete.

### Build and prove one complete outcome

1. Read the exact provider operation in the pinned SDK/OpenAPI/GraphQL fixture;
   capture argument → path/query/body → response selector and credential type in
   the current card. Research genuinely changed provider behavior in official
   primary documentation. The owner is not the source for API facts or pricing.
2. Implement normalization/planning, then wrapped apply/readback/intent comparison,
   then all callers, registry, profile/area metadata, summary/output schema and
   documentation. Reuse existing shared guards, clients, secrets and run stores.
   Add SQL only when the existing design actually needs durable new state.
3. Arrange stateful realistic fakes and capture the actual outbound request.
   Required cases: normal/empty/two pages; denied scope/profile/account; omitted
   versus explicit clearing; preview and missing confirmation with zero writes;
   mismatch/unreadable readback; ambiguous timeout and same-key retry; partial
   failure plus untouched descendants; foreign run/handle; budget exhaustion.
   Add the domain-specific cases below. Do not weaken fakes to fit a guessed API.
4. Validate the assembled outcome through every existing direct/broker/HTTP door
   with shared write-contract and provider-shape tests; use disposable Postgres
   for persistence, atomic claims, refresh/revocation and concurrent reservations.
   Run focused checks at meaningful seams, then the full mandatory gates once
   the coherent tree is ready. Record real command results, never assumed green.
5. Keep implementation, automated verification, deployed exact revision and real
   custom-service/provider acceptance separate. Update the existing card/status/
   queue with precise remaining proof. These design documents close no feature
   status and authorize no real account writes, spending or release.

Answered decisions do not require another approval. Missing credentials, actual
tenant/resource identity, independent financial consent and production activation
are still real gates. Build configurable/synthetic paths where permitted; keep
only their dependent execution closed and continue eligible roadmap work.


### Vercel: complete remaining-subsection contracts

Inspected baseline: `3938e65` (#203). Existing integration points are
`src/vercel/client.js`, `src/tools/index.js`, `src/core/`, `api/vercel/setup.js`,
the current project/deployment/release/env tools and purchase-intent/owner
approval stores. New area modules below belong in `src/tools/`; provider
adapters in `src/vercel/`. Use the actual exported operation mapping and the
vendored finder, never a remembered URL from the original toolkit.

**Governing cost correction:** OWNER-INPUTS IN-08 and BATCH-B's October 12
amendment override older daily-cap/positive-budget wording everywhere, including
BATCH-D D7, BATCH-M M2/M3/M4, BATCH-N N4, BATCH-O O3 and BATCH-V V8. Zero autonomous spend;
every charged operation needs its own independently authenticated approval.
Fixed-price operations need provider-verified exact price. Metered ones require
a provider-enforceable per-operation ceiling; otherwise fail closed even if
the owner offers a dollar estimate, time budget or `confirm:true`. Existing
projects remain eligible under IN-07, but that does not authorize production
changes or service self-destruction. Never ask the owner to supply an API price.

| Subsection | Concrete contract / implementation sequence | Domain fixture / required refusal |
| --- | --- | --- |
| D-1 | Explicit account/team/project and whitelisted settings → fresh project/Git/member/config reads → normalized before/diff → guarded patch → independent readback. Crons remain observed configuration/steps only. | Rename URL warning, preserved omitted settings, unknown production state, no cron URL invocation/CRON_SECRET read, last-access/self protection. |
| D-2 | Exact deployment ID/URL and bounded log/files/check filters → project ownership + observed target → paginated native reads → summaries/owned handles with coverage. Runtime stream terminates at existing time/byte budget. | 5000-line fixture under default result budget, disconnected stream, malformed frame, untrusted secret-bearing log and incomplete source tree. |
| D-3 | Git source/files or redeploy ID and explicit target → classify real parent target and cost → guarded create/cancel/delete → operation state. Files stay within approved 2MB inline limit. | Redeploy preserves original target; currently-serving deployment delete refuses; metered build without enforceable ceiling refuses; ambiguous create not replayed. |
| D-4 | Exact project/source deployment/action → current serving deployment+alias+routing reads, revision-bound plan and owner/production guards → promote/rollback/alias/rolling operation → bounded authoritative routing readback. | Previous actually-serving production differs from newest READY; wrong project; partial alias move, stale before-state, rollback uses rollback not promote; no forced live release for testing. |
| E-1 | Exact project/key/environment targets plus exactly one value source (safe config/pendingInputId/generate) → classify before → consume secret privately → env write → metadata-only readback. Copy/compare values only in process. | Targets required; legacy encrypted value never returned; no secret/digest in full detail/handle/audit; failed batch row does not imply all destinations updated; no automatic redeploy. |
| E-2 | Shared env ID/project links or explicit custom-environment ID → fresh linked production-target reads → before/after link/config plan → exact patch/unlink/create/delete and metadata readback. | Inaccessible linked project makes production classification unknown, not safe preview; omission retains links; explicit empty clears only supported fields; profile-owned env refusal. |
| E-3 | Exact Global Config store and item patch/backup selection → connected-project classification → item diff → guarded write/restore → exact readback. Creation/token secrets use private one-time flow. | Only current vendor operation paths; newest backup strictly before requested time; partial read cannot create destructive replacement; credentials scrubbed. |
| E-4 | Store/token IDs or typed schema → active connections and current items → explicit revocation/schema validation preview → apply/readback. Removing schema records the precise old schema for inverse. | Token string dropped before any shaping/storage; invalid current items listed, production-linked store guarded; irreversible token revocation has no fake inverse. |
| V-1 | Explicit scratch project/runId/requestKey and resource blueprint → durable owned intent → guarded dev creates with every ID recorded → ordered exact cleanup. | Never cleanup production or unrecorded look-alike; timeout after create reconciles original intent; automatic Preview tracking remains disabled for MCP hosting. |
| V-2 | Owned run/ref, exact preview deployment/env names/alias → preview-only branch build and private server-side env wiring; protected fetch uses approved bypass capability in memory. | Production target refuses, no secret/bypass URL in output; existing alias cannot be silently reassigned; build spending gate still applies. |
| V-3 | Owned preview ID, bounded log/window and typed integration spec → read-only diagnosis/fetch/integration rows. Bounded tail returns continuation, never waits forever. | Redirect/private-address fetch denied, response secret scrub, unknown integration not READY, no production fix hidden in diagnosis. |
| V-4 | Exact sandbox runtime/source/resource/timeout plan → verified provider spend enforcement and independent approval → guarded lifecycle. No enforceable operation cap means mutation stays refused; reads/diagnostics remain useful. | 60-minute daily budget alone is insufficient authority; no automatic paid test, no production secret injected into sandbox. |
| V-5 | Exact owned run/preview HTTPS endpoint, declared documented signature algorithm and protected run secret → bounded synthetic test payload → one signed delivery and safe status receipt. Explicitly label synthetic event, never actual provider delivery. | Signature independently verifies; private/redirect/production URL denied; secret/body never in audit/results; timeout unknown and not automatically retried. |
| N-1 | Exact team/project/domain/branch target → ownership, existing aliases and provider verification/config read → guarded attach/update/remove → domain/config readback and pending DNS instructions. | Production versus branch target; aliases prevent team removal; profiled domain refusal; no DNS write to external nameservers. |
| N-2 | Domain and typed record/certificate intent → complete fresh zone/cert inventory → conflict and full replace diff → exact guarded provider operation → readback and supported inverse. | CNAME coexistence, duplicate SPF/MX, incomplete zone refuses replacement; deleted MX inverse exact; private key never tool input, certificate upload guided. |
| N-3 | Domain/years/action and privately configured registrant data → current exact provider quote/contact schema/renewal terms → independently authenticated transaction approval → expectedPrice-bound purchase/renew/transfer → order readback. | Price changed or unverified refuses; auto-renew future charge independently authorized; transfer codes private one-time input/output; no actual purchase in tests. |
| F-1 | Exact project/protection/bypass change → current access scope and production classification → explicit who-can-access preview → guarded patch and metadata readback. | Password only via pending input; no bypass secret/share link in chat/handle; revoking automation bypass warns of redeploy dependency; self-lockout remains guarded. |
| F-2 | Exact project/firewall rule/version/attack-mode action → active config and intended typed diff → per-rule PATCH actions/versioned guarded activation → version/rule readback and recorded inverse. | Stale version, unknown before-state and blind full-PUT refused; attack mode requires bounded end time; paid managed rules follow IN-08, not a positive budget. |
| F-3 | Project and typed route/redirect draft/version or cache tag/image target → current staged/active state → staged diff or separately production-authorized publish/restore/invalidate → readback. | Staged is not live; restore exact named version; no guessed alias routing; native invalidation never calls dangerously-delete; unrelated routes preserved. |
| M-1 | Metric/window/group/filter typed from schema → bounded query and ≤50-row summary. Analytics on/off is independently classified; read-only reports do not toggle. | Window limits, malformed metric, partial page, analytics-on metered refusal without enforceable ceiling; off is not fabricated positive usage. |
| M-2 | Drain/webhook ID, exact public HTTPS destination, project/source/env/sampling diff → current state → export/access/cost preview → guarded write and readback. | Pause/narrow versus resume/widen classified separately; private/DNS/redirect target denied; webhook secret one-time only; paid drain rule above. |
| M-3 | Exact installation/resource/store/project/target → fresh ownership/billing-plan/injected-env reads → destructive/production/cost preview → supported connect/remove/create action. | Guided install never claimed completed by API; remove lists resource/env losses; plan price verified; app-owned store cannot be silently deleted. |
| M-4 | Only securely connected store + explicit pathname/URL/action; metadata-only list/head, ≤4MB put, at most100 exact delete names; official pinned Blob adapter, not invented REST calls. | Unconnected store disabled with setup steps; prefix/wildcard deletion denied; overwrite explicit; file bytes/credentials never returned; no implicit project-store connection. |
| O-1 | Exact team and safe profile/security diff → trusted current policy → access/production preview → patch requested fields only → readback. | Last/self access, SAML configured precondition, default protection and retention loss; missing before-state cannot loosen controls. |
| O-2 | Team/member/access-group IDs plus exact role/permission → member/owner count and plan/seat price → before/after access and cost preview → invite/update/remove → status readback. | Last Owner/self removal denied; Enterprise-only distinct from permission denial; pending invite not active member; exact purchase approval per paid seat action. |
| O-3 | Exact scope+expiry/name → owner-protected scoped token issuance/revocation and one-time display or encrypted direct enrollment. Metadata listing only. | No full-account default, no expiry beyond approved bounds, own server token deletion refused; no raw token in tool result/log. |
| O-4 | Exact billing period/service/project filters → bounded FOCUS rows → integer cents and coverage per project/service, stored target comparison. | Missing/unknown currency or partial period not a fabricated total; read-only never buys credits or edits Spend Management. |
| O-5 | Compose owner/team/domain/security/cost/resource reads and dated settings map; each row has observed/attention/unreadable with optional registered exact readback. | Account/team deletion steps-only, inaccessible sections survive, no healthy score from a denied check or fabricated dashboard walk. |
| P-1 | Data-only known_apps profile with verified project/live-branch/domain/env/store ownership and rollback caution → existing app/production guards consume it. | Shared live integration or protected env stays guarded; draft cannot weaken controls; Appliance Desk real policy waits actual IN-11 decision. |
| P-2 | Profile/inline spec → exact read-only deployment/Git/domain/env-name/config/resource readiness; suggested fixes reference existing guarded tools. | Missing secret value cannot be inferred from name; no provider write in inspection; partial/inaccessible state not READY. |
| P-3 | Structured new-project requirements/findings → idempotent resource/link/config plan and draft profile; return doc text, never edit another repo. | Creation is not allowed merely because setup is convenient; cost/production/secret gates remain; second run reconciles IDs. |
| W-1 | Project/ref/query → independent health/release/find reads with exact deployment/source/alias state and coverage. | READY is not live, release timestamp not proof aliases moved; two pages and one denied component. |
| W-2 | Deployment/build ID → read-only cause summary; explicit deploy request uses D-3 then bounded D-2 wait, returns pending at deadline. | No blind create retry; existing build reused; metered-cost refusal does not block log diagnosis. |
| W-3 | Exact project/deployment plus profile release policy → D-4 preflight and guarded ship/rollback, each alias independently read back. | Appliance Desk checked main→live release cannot be bypassed by workflow convenience; rollback caution and stale-head scenario. |
| W-4 | Exact project/domain/DNS choices → N primitives and verification observations; purchase is separately approved after verified fixed price, propagation can remain pending. | Never transfer ownership or overwrite unrelated DNS implicitly; unverified domain is not ready. |
| W-5 | Exact source/dest environments or secret reference → E server-side compare/rotation → explicit selected redeploy stage, only with production/cost authority. | Secret-kind nondecryptable source needs private owner input, not fake copy; partial destinations and lost redeploy result; no value/digest output. |
| W-6 | Bounded team/project/time selection → independent billing/security reads → findings and proposed existing tool fixes only. | No automatic spend-cap/plan/security mutation; missing price/permission is unknown. |
| U-1 | Pinned operationId plus exact validated args → full safety metadata, target/protection/secret/cost semantics → existing native handler or equivalent guarded path. | Unknown write/price/production state refuses; universal cannot read env values or bypass metered ceiling policy. |
| R-1 | Existing pass proposals/owner page and OAuth rows → narrowed account/mode/profile/areas/rate/expiry, hashed storage, one-time display, atomic revocation. | Current TEST-only restrictions not widened by historic roadmap; refresh preserves every field; secure approval distinct from caller flag. |
| R-2 | Reconcile current RTC route implementation rather than recreate; same handler/alias/auth/SQL limiter and result-store ownership across all doors. |120 overlapping requests admitted exactly at configured quota, next denied; revoked/foreign handle and connector-as-pass refused. |
| R-3 | Current pinned full service HTTP conformance with fake provider and existing emulate/request-shape evidence. | Local reference pass not actual deployed Vercel/provider/Hub acceptance; no public-only manifest credited as authentication. |
| X-1 | Owned change ID and reversible exact inverse → current state and guard recheck → wrapped apply/readback. | Secrets, deletion/retention loss and irreversible transitions refuse; external new state cannot be overwritten by old inverse. |
| X-2 | Authorized scratch/run IDs and read-only real identity → complete scoped read inventory plus separately authorized scratch lifecycle where allowed. | Missing scratch/credential only blocks that stage; no real build/spend/production workaround or invented fixtures. |

### Vercel owner decisions and concrete data example

Env plan example (synthetic project):
```json
{"project":"fixture-project","key":"PUBLIC_LABEL","targets":["preview"],"value":"demo","dryRun":true}
```
Use the existing public schema's exact field names. The normalized internal
intent includes the exact project ID and targets, but no stored secret values.
For a secret use the existing pendingInputId/generate alternative, never this
plain-value example. Result shows key/targets/changed/confirmed and a separate
redeploy suggestion; it contains neither value nor hash.

IN-07 unrestricted eligibility and IN-08 zero-autonomous-spend are answered;
do not re-request them or revive older limits. IN-06 scratch selection, IN-10
rate choice, IN-11 app release ownership, IN-13 sandbox policy and IN-15 store
selection remain concrete owner/resource gates if not subsequently answered.
Implement their safe configuration paths without inventing their real values.
IN-09 production activation and IN-12 Spend Management changes remain independent.
