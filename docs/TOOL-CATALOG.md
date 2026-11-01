# Tool catalog

**2026-10-19 R-2 transport and pass settings (merged in PR #219, 2026-10-21; PRs #220–#222 also merged):** The independently operated service display name is **Vercel by Robinson AI Systems**; stable `vercel_*` tool IDs do not change. `vercel_create_pass` proposals now accept optional `rateLimitPerMinute` (integer 1–600, default 120); independently authenticated owner setup reviews and issues this scope. Existing issued RTC passes retain the legacy 60/min on additive migration; new pass limits are atomically enforced across serverless instances. The original proposal shape was **read-only**; since R-1W (2026-10-30) a proposal may also request write scope (`allowWrites`), issued and dispatched under the same owner review — see the R-1W amendment in `docs/designs/BATCH-R.md`. The customer-authority verdicts are recorded in `docs/PRODUCT-AUTHORITY-AUDIT.md` (2026-10-30 verdict pass); live acceptance status lives in `docs/STATUS.md`, not here (updated 2026-10-31, AUD-AN).


Every tool this server will have, by area — the product scope. The implementing model builds exactly these; anything else
goes in `docs/ROADMAP.md` and the PR report. When a tool merges, its Card cell gains `built #<PR>`.

**Built vs planned (2026-10-31 documentation audit AUD-AN, main `8fb9e83`; consolidated by the AUD-AY shadow pass the same day): 253 of the 254 tools below are implemented** in `src/tools/` and registered in `src/tools/index.js` (the registry is the reliable source; `tests/unit/registry.test.js` pins the list; `scripts/check-catalog.mjs` verifies 254 catalog tools, 253 registered). The build-out completed 2026-10-30 (batches O-5, P-3, W and X and `vercel_undo_change` all shipped); the sign-in cleanup program (AUD-AZ…AUD-AY, 2026-10-31) then added thirteen owner-connection tools — `vercel_set_read_only` (AUD-AQ), `vercel_apply_owner_approval` (AUD-AS), the eight account tools (AUD-AT) and the three pass/reveal tools (AUD-AU) — and deleted the owner setup page (AUD-AV). The one unbuilt row is `vercel_admin_overview`, **closed by owner ruling IN-16 (ratified 2026-10-30) — it will not be built**; its row below records the closure. A Card cell saying `candidate #NNN` is the historical delivery-PR label from that tool's build era, not a build state; built state is the registry's, per the counts above. Do not read a catalog count as an implementation count. Where a dated note below describes owner review, apply, reveal, enrollment or pass issuance happening on the setup page, it describes the state at its date — the AUD-AV and AUD-AY notes at the end of the owner family close them: those actions now happen on the owner's own connection, and no setup page exists. Area tools are `vercel_<area>_<verb>[_<object>]`; the contract's meta-tools keep

are `vercel_dev_<job>` (contract §10).

**Safety** (combine as listed; the guards are defined in `docs/designs/BATCH-B.md`):

| Mark | Meaning |
|---|---|
| `—` | Reads only |
| `P` | Changes something; `dryRun` preview available; no `confirm` needed |
| `Cp` | Needs a production connection and `confirm` **when it touches production** (B2 definition: a production target, a live project's production domain or variable, …); otherwise behaves as `P` |
| `PR` | Always production-affecting: needs a production connection and `confirm` |
| `C` | Always needs `confirm` (owner actions, data leaving the team, irreversible-but-not-production steps) |
| `D` | Destructive or irreversible: always `confirm`, read-back, change log; no inverse |
| `# Tool catalog

Every tool this server will have, by area — the product scope. The implementing model builds exactly these; anything else
goes in `docs/ROADMAP.md` and the PR report. When a tool merges, its Card cell gains `built #<PR>`.

**Naming.** Every tool name starts with `vercel_` (DECISIONS 2026-10-10 "Every tool name starts with `vercel_`"):
Vercel, Neon and GitHub share nouns such as *project* and *branch*, and two connectors attached to one Claude chat must
never offer two tools with the same name. Area tools are `vercel_<area>_<verb>[_<object>]`; the contract's meta-tools keep
their contract names (`vercel_search_tools`, `vercel_call`, …); workflows are `vercel_workflow_<job>`; developer tools
are `vercel_dev_<job>` (contract §10).

**Safety** (combine as listed; the guards are defined in `docs/designs/BATCH-B.md`):

| Mark | Meaning |
|---|---|
| `—` | Reads only |
| `P` | Changes something; `dryRun` preview available; no `confirm` needed |
| `Cp` | Needs a production connection and `confirm` **when it touches production** (B2 definition: a production target, a live project's production domain or variable, …); otherwise behaves as `P` |
| `PR` | Always production-affecting: needs a production connection and `confirm` |
| `C` | Always needs `confirm` (owner actions, data leaving the team, irreversible-but-not-production steps) |
| `D` | Destructive or irreversible: always `confirm`, read-back, change log; no inverse |
 | Spends or raises spend: on the account owner's own connection the owner's confirmed word executes under their standing purchase policy (an optional agent budget frames the disclosure; a per-purchase grant applies only if the owner opted into `purchase_grant_required`) — AUD-A2/D-A; delegated and builder connections still require `confirm` plus an owner transaction grant. |
| `A` | Widens someone's access: always `confirm` |
| `1x` | Creates a secret, shown **once** through `vercel_reveal_one_time_secret`, never in a result |
| `G` | Guided: returns structured steps and checks the result by read-back; changes nothing itself |

Every write also passes **self-protection** (B-3): it is refused on a protected resource (this server's own Vercel
project, the other Robinson servers' projects, the token this server runs on) unless Chris edits the protected list with
the owner tools (`vercel_add_protected_resource` / `vercel_clear_protected_resources`).

**Aud.** (audience, contract §3): `B` builder · `O` owner · `Op` operator. **Prof.** lowest profile that has the tool:
`R` read_only · `E` everyday · `F` full (every read tool is in `R`). **App:** `y` = the project-profile guard (Batch P)
checks this tool against resources a profiled app owns; `—` = not applicable.

## Server about itself (`vercel_*`) — 34

| Tool | What it does | Safety | Aud. | Prof. | App | Card |
|---|---|---|---|---|---|---|
| `vercel_whoami` | Preview/production: current scoped Vercel account, token metadata, spend, standing purchase policy (agent budget and grant opt-in), token expiry posture (expiresAt/daysLeft, incl. attested no-expiry and not-recorded) and profile. New isolated RTC TEST passes: service identity ONLY, no account record/provider requests or Vercel resource access. AUD-BI (2026-10-31): enrollment now records bearer tokens' real expiries, and the posture also reports `expirySource` — 'recorded', 'attestation' (the owner's own no-expiry attestation) or 'provider' (Vercel's token record affirmatively carries no expiry: its own no-expiry state, distinct from the attestation). | — | B O Op | R | — | A-5 built #15; B-8a #24; TEST identity #133; purchase policy AUD-A1; expiry posture AUD-E; recorded expiry + expirySource AUD-BI |
| `vercel_list_accounts` | Show only the current authenticated connection's account and safe settings; global account management stays on the owner's own connection (the owner tools) | — | O | R | — | A-5 built #15; B-8 account isolation #28 |
| `vercel_set_default_account` | Propose changing the global default; exact target requires separate signed-in owner approval | P | O | F | — | B-8b built #38 |
| `vercel_check_token` | Re-probe the stored token with bounded GETs; report selected team/project read access, not expiry or write permissions | — | O | R | — | B-8b read-only built #26 |
| `vercel_set_working_box` | Flip this connection's own working mode (preview/production) inside its granted ceiling, effective the next call (A-10); a localAdmin self-write keyed by the caller's own connection id, credential untouched. Production asks refuse by naming the rung (owner production switch off → vercel_enable_production; preview deployment → production deployment) | P | O | F | — | AUD-I S4 |
| `vercel_set_read_only` | Flip this connection's own read-only switch on or off, effective the next call; while on, every write through this connection refuses at listing, dispatch and preflight, and whoami reports the switch with its remedy. A localAdmin self-write keyed by the caller's own connection id (the end user's own switch, IN-09 — never a sign-in class; passes keep `read_only` as a pass scope, untouched) | P | O | F | — | AUD-AQ |
| `vercel_list_connections` | Claude connections: account, mode, profile, listing, last used, expiry | — | O | R | — | B-8 |
| `vercel_revoke_connection` | Propose revoking an exact current OAuth connector; independently authenticated owner must approve | C | O | F | — | B-8b built #40 |
| `vercel_remove_account` | Propose removing an exact enrolled account row — its stored credential, connections, passes and account-scoped settings are removed with it; the default account refuses while other accounts remain; independently authenticated owner must approve | C | O | F | — | AUD-AA |
| `vercel_apply_owner_approval` | Inspect (dryRun) or apply (confirm) one pending owner approval by its single-use reference — an owner account change, an exact purchase intent, an RTC pass request or a production-enable receipt; the apply step runs only on the owner's own connector connection (a delegated pass can never apply one) and consumes the envelope exactly once through the family's own apply function | C | O | F | — | AUD-AS |
| `vercel_export_owner_data` | Export everything this server holds for the account — account metadata (never token values), connections, passes, protected resources, settings, project profiles, Blob store connections and the change log — to a stored result read back with `vercel_get_result`; the change_log row lands before the export is stored (an unjournaled export never leaves), and the tool runs only on the owner's own connector connection | C | O | F | — | AUD-AT |
| `vercel_set_purchase_policy` | Propose the account purchase policy (optional agent budget in cents; per-purchase grant flag) as an owner-approval envelope carrying the setup form's validations verbatim; the owner applies it with `vercel_apply_owner_approval` | P | O | F | — | AUD-AT |
| `vercel_set_token_no_expiry` | Propose the owner's no-expiry attestation for the enrolled token (IN-04) as an owner-approval envelope bound to the token version it is made for — a rotation before application refuses unverified; the owner applies it with `vercel_apply_owner_approval` | C | O | F | — | AUD-AT |
| `vercel_set_production_strictness` | Propose the production-enable strictness (word or passphrase) as an owner-approval envelope; the owner applies it with `vercel_apply_owner_approval`; no production access is enabled by the change | C | O | F | — | AUD-AT |
| `vercel_add_protected_resource` | Protect one project on the account — writes targeting it refuse until the owner clears the exclusion; direct on the owner's own connector connection with confirm (a delegated pass can never add one), journaled like the setup form | P | O | F | — | AUD-AT |
| `vercel_clear_protected_resources` | Propose removing the old global defaults and all account project exclusions as an owner-approval envelope whose plan text is the form's remove-all acknowledgment; the owner applies it with `vercel_apply_owner_approval` | C | O | F | — | AUD-AT |
| `vercel_recheck_token` | Recheck the stored Vercel token's read access for the account — the owner-surface twin of the recheck action the setup page carried until AUD-AV (same probe as `vercel_check_token`, full profile only); write permissions and expiry remain unverified | — | O | F | — | AUD-AT |
| `vercel_disconnect_blob_store` | Disconnect one Blob store from the account and delete its stored token; files in the store are not touched; direct on the owner's own connector connection with confirm (AUD-AR's enrollment is its pair) | C | O | F | — | AUD-AT |
| `vercel_issue_pass` | Issue an RTC pass directly on the owner's own connector connection — read-only (preview/TEST) or write-capable (delegated profile, preview/production, spend ceiling in cents, optional project restriction) — with the setup forms' validations verbatim (areas from the full registry vocabulary, lifetime ≤ 720 h, rate 1–600/min, TEST = server area only). The scope is verified by the db's own read-back before delivery; the bearer is stored as a one-time secret and delivered only through `vercel_reveal_one_time_secret`, never in this result; any verification or delivery failure revokes the pass first. | C A 1x | O | F | — | AUD-AU |
| `vercel_revoke_pass` | Revoke one RTC pass by its exact `pass_…` reference on the owner's own connector connection. Effective immediately — a revoked pass refuses at the door — and journaled by the same db write the setup form used. Unknown, already-revoked and foreign references share the form's one refusal. | C D | O | F | — | AUD-AU |
| `vercel_reveal_one_time_secret` | Reveal a one-time secret exactly once on the owner's own connector connection (never visible to a pass): the row is consumed atomically, and the value returns in this result only — the one deliberate exception to result redaction (dossier D8) — with no stored result created. The journal records the reveal event and reference, never the value. An omitted account addresses the server / global scope, as the reveal form's default did. | C 1x | O | F | — | AUD-AU |
| `vercel_enable_production` | Enable team production access on the owner's confirmed word; teams whose owner chose passphrase strictness on setup keep the ten-minute passphrase reentry step instead | C | O | F | — | B-2; AUD-B |
| `vercel_disable_production` | Disable team production access and revoke existing production-mode connector tokens | C | O | F | — | B-2 |
| `vercel_set_spend_limit` | Propose a tenant-scoped exact-cent daily limit for separate owner approval; no spending or default change | C | O | F | — | B-8b built #39 |
| `vercel_list_protected_resources` | Projects, domains and tokens this server refuses to change, edited through `vercel_add_protected_resource` and `vercel_clear_protected_resources` | — | O | R | — | B-3 | 
Protected-resource listings now include both global and team-scoped rules; the editor is the owner's own connection (`vercel_add_protected_resource` / `vercel_clear_protected_resources`).

**B-8 close-out (#40):** All three B-8b MCP tools are guarded owner-approval proposals, not instant mutations. Default-account (#38), spend-limit (#39) and exact connector revoke (#40) require a separate owner setup session, CSRF, fresh passphrase and confirmation for any SQL change; no AI-supplied `confirm` authorizes applying the change. IN-07/IN-08 and production activation are unchanged.

**B-8b owner-request write-contract foundation (#37):** An MCP request is only an encrypted owner-approval proposal, never an account mutation. Account/connector targets use production and self-protection checks, durable replay and independently inspected envelopes; a verified proposal returns `awaiting_owner_approval` with `confirmed:false`. No named owner account mutation is registered in this foundation slice. The owner must separately review, confirm and reenter the passphrase on setup before any change. IN-07/IN-08 remain pending.

**B-8a account observability (built #24):** `vercel_list_connections` and `vercel_recent_changes` show only scoped, bounded metadata/safe audit summaries; `vercel_where_is_setting` gives guided dashboard navigation and clearly distinguishes manual vs future API verification. `vercel_whoami` warns of token expiry within fourteen days. Account changes remain B-8b.

**B-7 static safety gate (built #23):** The check-writes CI step cross-checks this catalog's Safety marks against every registered tool's read/write classification and write-contract flags, including production, targets, spend, access and one-time secrets. Adding an incompletely declared write now fails CI before merge.

**B-6 connection profiles (built #22):** The same fail-closed eligibility rules drive both MCP discovery and direct invocation, and the home page shows available tools by read-only, everyday and full profiles. The read-only profile has no write tools, including when an agent calls one by name. This is shared authorization infrastructure.

**B-5 output and secret handling (built #21):** Every MCP result passes recursive secret masking, bounding and Denver-local/money presentation; production mode receives a visible banner. Secrets are accepted only from owner one-use inputs or server-generated values; any created secret is stored encrypted and revealed only through setup. This is shared infrastructure, not a new published tool.

**B-4 error presentation (built #20):** Recognized provider failures return plain-language next actions. MCP results never echo raw upstream messages or credential-shaped labels; technical codes are allowlisted and rate-limit windows display in Denver time. This is shared error handling, not a new published tool.
| `vercel_recent_changes` | What was changed through this server (filter by tool, project, mode, date; previews hidden unless asked) | — | B O Op | R | — | B-8 |
| `vercel_undo_change` | Undo one change-log entry when it has a clean opposite; says plainly when it does not | C | Op | E | y | X-1 |

**Batch X note (X-1, 2026-10-30): BUILT.** `vercel_undo_change` loads the caller's own change-log row (new account-scoped read `getChangeForUndo`; the `inverse` column already existed) and dispatches its stored inverse through the owning tool's own guarded pipeline — preview + confirm, the step's own guards and classification apply. Dispatch form is `{tool, ...args}` (the firewall/routes convention) with one documented adapter: stored DNS images use `recordValue` (the storage shaper hides fields named `value`), expanded to real arguments at dispatch. Card verdicts X1-C1..C4: workflow rows refuse naming their step rows; descriptive inverses refuse carrying their sentence; deletions/purchases refuse naming the opposite action; an undo's own inverse points at its step's change row, so undo-of-an-undo re-dispatches the original opposite. X-1 also added the missing inverse capture: pause↔unpause, promote/rollback → rollback to the previously-serving deployment, alias assign-back, env create/copy → delete of the created row (update stores the design's descriptive sentence — a changed value cannot be restored), protection auth/trusted-IP re-apply (password descriptive), bypass create → revoke, member role restore, Global Config patch value restore, and dispatch forms for the DNS/registrar/cert inverses. Registry 239 → 240 of 241; the 241st row (`vercel_admin_overview`) is closed by the IN-16 ruling and will not be built.
| `vercel_search_tools` | Search only the profile-eligible tools, with one-line safety classification | — | B O Op | R | — | C-2a built #44 |
| `vercel_describe_tool` | Describe one profile-eligible tool's arguments and safety rules | — | B O Op | R | — | C-2a built #44 |
| `vercel_call` | Call a profile-eligible tool through the same guarded MCP dispatcher | as the tool | B O Op | R | — | C-2b built #45 |
| `vercel_batch` | Preflight and dispatch up to 10 authorized reads; refuse mixed writes | — | B O Op | R | — | C-2b built #45 |
| `vercel_get_result` | Retrieve a 20-row page of the caller's scoped 24-hour sanitized result handle | — | B O Op | R | — | C-1 built #43 |
| `vercel_create_pass` | Propose an RTC pass: read-only, or write-capable (delegated profile, preview/production, spend ceiling, optional project restriction); the owner reviews the sealed scope in plain words and applies it with `vercel_apply_owner_approval` before one-time issuance | C | O | F | — | R-1 + R-1W (approval-only tool #151; the bearer is delivered as a one-time secret on the owner's connection) |
| `vercel_where_is_setting` | Structured steps (link, numbered actions, expected result, read-back check) for any dashboard-only setting | — G | O Op | R | — | B-8, O-5 |

**D-1 execution safety review (#81):** Project/member execution proofs and paid Git imports use one final write-capable token binding; owner spending is rechecked after Git lookups. Definite pre-dispatch denial releases only its owned logical replay reservation for retry, while provider-write uncertainty remains pending. Project scalar and hostname safety use canonical credential detection. Deletion previews report complete deployment counts without disregarding the conservative `hasDeployments` signal. No new owner-granted operations or production activation.

**D-1 destructive execution binding (#82):** The final empty-project proof uses the same write-capable stored credential as its DELETE; rotated project-only credentials refuse before the mutation, and provider deployment metadata retains its conservative nonempty veto. No nonempty deletion permitted.

**D-1 metered resource execution recheck (#83):** Billable resource PATCH checks final project identity and independently approved remaining account spending under one writable credential immediately before dispatch. Rotated/narrowed scope and owner limit reductions refuse without PATCH. Unknown usage still denied by default $0.

**D-1 settings execution revalidation (#84):** Before applying project rename/framework/build-command changes, the exact writable credential re-reads immutable project identity and production deployment classification. A newly-live or renamed project or narrowed credential refuses rather than crossing the original approval boundary.

**D-1 traffic execution safety (#85):** Project pause/unpause revalidate team credential, exact immutable project identity and current paused state using the same binding as POST. Changed identity/state or narrowed credential refuses before traffic disruption; existing production confirmation still mandatory.

## Projects, crons and Git (`vercel_project_*`, `vercel_cron_*`, `vercel_git_*`) — 15

| Tool | What it does | Safety | Aud. | Prof. | App | Card |
|---|---|---|---|---|---|---|
| `vercel_project_list` | Projects in the team: name, framework, safe production hostname, last production deploy, paused or not (strict metadata projection #76) | — | B O Op | R | — | D-1 (built #47; pagination #74) |
| `vercel_project_get` | One project: bounded safe framework/commands, root directory, Node version, Git repo and branch, production state, domains and crons (metadata hardening #76) | — | B O Op | R | y | D-1 (built #47; diagnostics #71) |
| `vercel_project_create` | Create empty unlinked projects at $0, or Git-linked imports after exact Vercel integration lookup, purchase-policy authority (owner word or owner grant) and production confirmation | $ Cp P | B O | E F | — | D-1 (built #65; shared Git identity #75; execution-time spend/Git recheck #80) |
| `vercel_project_update_settings` | Rename/framework plus grouped build/directory overrides (max 256 chars, null resets to defaults), guarded and independently verified; paid resources separate | Cp | B O | E | y | D-1 (partial #53; execution-time selected-config recheck #87) |
| `vercel_project_set_build_resources` | Build machine, concurrency and function compute options (billable); guarded resourceConfig PATCH under the account purchase policy (owner word or owner grant), production confirmation and independent read-back | $ Cp | O | F | y | D-1 (built #64; selected metered config collision check #88) |
| `vercel_project_delete` | Strict empty-project-only deletion: require full profile, production confirmation, typed name, complete scoped inventory and reread before DELETE; nonempty impact shown dry-run only (#77), execution blocked | D PR | O | F | y | D-1 (partial #60; deployments #69; strict inventory #73) |
| `vercel_project_pause` | Guarded pause of project production traffic; authenticated project state before and after, confirmation, production connection | PR | O Op | F | y | D-1 (built #58) |
| `vercel_project_unpause` | Guarded production resumption; authenticated state, full-profile production confirmation, metered usage warning | PR | O Op | F | y | D-1 (built #58) |
| `vercel_project_transfer` | Issue an owner-only encrypted one-time transfer claim code; never auto-completes ownership transfer | A D PR 1x | O | F | y | D-1 (partial #62) |
| `vercel_project_list_members` | Project-level members and their project roles | — | O | R | — | D-1 (built #48; pagination #74; member metadata redaction #90) |
| `vercel_project_add_member` | Give an existing team user a project role by UID (no new seat or team invite) | A | O | F | — | D-1 (built #54; ADMIN gated #66; contributor #67; paged #70; apply-time recheck #78; concurrent-role defense #86) |
| `vercel_project_remove_member` | Remove viewer/developer project role by UID; admin/owner/final member removal remains blocked | C | O | F | — | D-1 (partial #55; team identity #68; paged #70; immediate execution recheck #79) |
| `vercel_cron_list` | Cron jobs as deployed to production: path, schedule (UTC and Denver time), enabled, from the production deployment's configuration | — | Op | R | y | D-1 (built #50) |
| `vercel_git_list_namespaces` | Git accounts/orgs the team's Git connection can see (GitHub, GitLab, Bitbucket) | — | B | R | — | D-1 (built #49; credential-safe metadata #89) |
| `vercel_git_search_repos` | Repositories in a Git namespace, for creating a project from one | — | B | R | — | D-1 (built #49; namespace proof #72; credential-safe metadata #89) |

## Deployments: reads, logs and checks (`vercel_deploy_*`, `vercel_check_*`) — 10

D-2 ten-read registry/handler/test evidence is enforced by `scripts/check-d2-acceptance.mjs` (#143); it does not establish genuine provider response compatibility, deployed HTTPS, or Hub TEST acceptance.

| Tool | What it does | Safety | Aud. | Prof. | App | Card |
|---|---|---|---|---|---|---|
| `vercel_deploy_list` | Authenticated project-only deployments, bounded first page with honest cursor, state, target, Git commit/branch and safe metadata; state/environment/branch/commit and time filters built #138 | — | B Op | R | — | D-2 (read built #132) |
| `vercel_deploy_get` | Scoped deployment ID/HTTPS URL detail: verified project, state, target, commit, branch and safe aliases (full diagnostics follow) | — | B Op | R | — | D-2 (read built #132) |
| `vercel_deploy_get_build_logs` | Project-verified deployment build events: bounded type/warning/error/step summary, no raw secret-bearing log text; full raw logs intentionally unavailable pending safe scoped storage | — | B Op | R | — | D-2 (safe summary #134; full text unverified) |
| `vercel_deploy_get_runtime_logs` | Project-verified runtime stream sample (≤32 KiB/50 entries, 10 s provider-start bound — AUD-BN), local window/level/status/path counts with verified wire aliases; unreadable successful streams and unanswered requests fail with redacted classified errors (timeout/network named in plain words), never an empty-events success or an unclassified unknown_error; no raw messages | — | B Op | R | — | D-2 (bounded read #137; full text unverified) |
| `vercel_deploy_list_files` | Project-verified bounded deployment source-file tree: safe file paths, no source content, honest optional-source-tree 404 availability and partial status | — | B | R | — | D-2 (source tree #134; output-file completeness unverified) |
| `vercel_deploy_get_file` | Verified tree-bound file ID; bounded 8 KiB JSON base64 body and ≤2 KiB UTF-8, refuses control-byte binaries, secret text, malformed JSON and unknown response | — | B | R | — | D-2 (guarded read #139; real provider shape unverified) |
| `vercel_deploy_wait` | Project-verified short-poll terminal-state check (0–8s wait budget, max three reads), returns state and how to call again if unfinished; no 45s serverless claim | — | B Op | R | — | D-2 (bounded read #136) |
| `vercel_check_list_runs` | Scoped Checks V2 run summaries (first 20), safe status/conclusion/task counts; provider completeness unknown, no raw output | — | B Op | R | — | D-2 (read #135) |
| `vercel_check_get_run` | One project-verified deployment check run: safe state/conclusion only; raw outputs withheld pending separately authorized sanitizer | — | B Op | R | — | D-2 (read #135; raw output unsupported) |
| `vercel_check_list_project_checks` | Project-bound configured Checks V2 inventory, first 20 projected names/types, counts not assumed complete | — | B O | R | — | D-2 (read #135) |

## Deployments: changes (`vercel_deploy_*`) — 5

| Tool | What it does | Safety | Aud. | Prof. | App | Card |
|---|---|---|---|---|---|---|
| `vercel_deploy_create_from_git` | Guarded linked-GitHub project commit/ref and exact project/team/target proof; metered build dispatch follows the account purchase policy (owner word or owner grant) | $ Cp | B Op | F | y | D-3 (guarded Git create #192 candidate; external cost/fixture acceptance gated) |
| `vercel_deploy_create_from_files` | Up to 2 MiB in ≤4 safe UTF-8 text files; SHA-1/byte-count checked before pinned binary POST /v2/files, durable per-file replay and reference-based POST /v13/deployments; metered build dispatch follows the account purchase policy (owner word or owner grant) | $ Cp | B Op | F | y | D-3 (bounded files code #193 candidate; provider cost/fixture acceptance gated) |
| `vercel_deploy_redeploy` | Guarded exact source redeploy retaining original preview/production target; metered builds follow the account purchase policy (owner word or owner grant) | $ P | B Op | F | y | D-3 (guarded code #191 candidate; provider use gated) |
| `vercel_deploy_cancel` | Cancel only an independently project-verified, unfinished PREVIEW deployment; guarded confirmation, scope/state recheck, durable replay and independent CANCELED readback | Cp | B Op | E | y | D-3 (candidate #173) |
| `vercel_deploy_delete` | Guarded irreversible cleanup of exact failed/canceled unaliased preview only; no production, READY or missing alias proof; fresh pre-delete check and independent 404 readback | D Cp | Op | F | y | D-3 (candidate #175, terminal preview only) |

## Releases: promote, rollback, aliases, rolling releases — 12

| Tool | What it does | Safety | Aud. | Prof. | App | Card |
|---|---|---|---|---|---|---|
| `vercel_deploy_promote` | Point production traffic at a ready deployment; preview shows what is live now and what will be | PR | Op | F | y | D-4 (partial source candidate; native TEST pending) |
| `vercel_deploy_rollback` | Point production back at an earlier production deployment (instant rollback), with a reason note | PR | Op | F | y | D-4 (partial source candidate; native TEST pending) |
| `vercel_deploy_list_promote_aliases` | Which production aliases moved (or are still moving) during the last promote or rollback | — | Op | R | — | D-4 (partial source candidate; native TEST pending) |
| `vercel_alias_list` | Aliases (custom URLs) by project or deployment | — | B Op | R | — | D-4 (partial source candidate; native TEST pending) |
| `vercel_alias_get` | One alias and the deployment it points to | — | B Op | R | — | D-4 (partial source candidate; native TEST pending) |
| `vercel_alias_assign` | Point an alias at a deployment (production when the alias is a production domain) | Cp | B Op | F | y | D-4 (partial source candidate; native TEST pending) |
| `vercel_alias_delete` | Remove an alias | D Cp | Op | F | y | D-4 (partial source candidate; native TEST pending) |
| `vercel_rolling_get` | Rolling-release settings, the active release and its stage, and billing status | — | Op | R | — | D-4 (candidate PR #205, CI/native TEST pending) |
| `vercel_rolling_update_config` | Turn rolling releases on/off for a project and set stages (may be billed) | PR $ | O | F | y | D-4 (candidate PR #205, CI/native TEST pending) |
| `vercel_rolling_start` | Start a rolling release of a deployment | PR $ | Op | F | y | D-4 (candidate PR #205, CI/native TEST pending) |
| `vercel_rolling_approve_stage` | Move the active rolling release to its next stage | PR | Op | F | y | D-4 (candidate PR #205, CI/native TEST pending) |
| `vercel_rolling_complete` | Finish the rolling release (100% of traffic) | PR | Op | F | y | D-4 (candidate PR #205, CI/native TEST pending) |

## Environment variables (`vercel_env_*`) — 9

No tool ever returns an environment variable's value, whatever its type (`docs/designs/BATCH-E.md` E1). Values go in;
names, targets, kind (Config/Secret), branch and dates come out.

| Tool | What it does | Safety | Aud. | Prof. | App | Card |
|---|---|---|---|---|---|---|
| `vercel_env_list` | Project-verified bounded environment metadata, explicit decrypt=false; keys, targets, kind and dates only, no values, honest unverified provider page | — | B O Op | R | y | E-1 (candidate #174) |
| `vercel_env_get` | Independently scoped single-variable metadata; discards decrypted/legacy values and untrusted comments | — | B Op | R | y | E-1 (candidate #174) |
| `vercel_env_set` | Guarded create/replace by exact project, key, target and revision; Config noncredential literal, Secret only generate (a chosen Secret value is set in the Vercel dashboard; the pending-input path was removed by AUD-AV); no value output; verified Config readback | Cp | B Op | E | y | E-1 (#178 candidate) |
| `vercel_env_set_many` | Guarded create-only 2–10 new project keys in one POST; Config literal or generated Secret, detect partial provider results, independent per-key readback | Cp | B Op | E | y | E-1 (#180 candidate) |
| `vercel_env_delete` | Guarded irreversible deletion from all targets by exact ID/key/revision with scope, protected/app, production and state-race checks, independently verified 404 | D Cp | Op | F | y | E-1 (#178 candidate) |
| `vercel_env_delete_many` | Guarded delete 2–10 exact ID/key/revision variables from all targets in one DELETE batch, with independent 404 readback | D Cp | Op | F | y | E-1 (#180 candidate) |
| `vercel_env_copy` | Create-only, value-hidden Config copy across exact ordinary/preview Git branches or two independently verified same-team projects; cross-project requires team scope, explicit outsideApp intent and both protection guards, plus independent destination readback; Secret and unsafe inputs refused | Cp | Op | E | y | E-1 (#179, #184, #185 candidate) |
| `vercel_env_compare` | Verify explicit project/targets and compare up to 20 named Config keys using in-memory digests (never output); Secret/unknown-page results remain unknown | — | B Op | R | y | E-1 (#177 candidate) |
| `vercel_env_export_names` | Verified project/target .env.example key placeholders with no value material and incomplete-page disclosure | — | B | R | — | E-1 (candidate #174) |

## Shared variables and custom environments (`vercel_shared_env_*`, `vercel_environment_*`) — 7

| Tool | What it does | Safety | Aud. | Prof. | App | Card |
|---|---|---|---|---|---|---|
| `vercel_shared_env_list` | Selected team bounded shared-variable names, kinds, links and targets, with provider cursor; never values/digests or falsely complete inventory | — | O Op | R | — | E-2 (source merged #194; native provider pending) |
| `vercel_shared_env_set` | Create or change a shared variable and its project links | Cp | O | E | y | E-2 (guarded source candidate; native provider pending) |
| `vercel_shared_env_delete` | Delete a shared variable, or unlink it from one project | D Cp | O | F | y | E-2 (guarded source candidate; native provider pending) |
| `vercel_environment_list` | Project-verified bounded custom environment slugs, branch rules, timestamps and domain count; no secrets or domain proofs | — | B O | R | — | E-2 (source merged #194; native provider pending) |
| `vercel_environment_create` | Add a custom environment (branch rule, copy variables from another environment) | P | B O | E | — | E-2 (guarded code candidate; live acceptance pending) |
| `vercel_environment_update` | Change a custom environment's name, branch rule or description | P | B O | E | — | E-2 (guarded code candidate; live acceptance pending) |
| `vercel_environment_delete` | Remove a custom environment | D | O | F | y | E-2 (guarded code candidate; live acceptance pending) |

## Global Config (formerly Edge Config) (`vercel_globalconfig_*`) — 11

| Tool | What it does | Safety | Aud. | Prof. | App | Card |
|---|---|---|---|---|---|---|
| `vercel_globalconfig_list` | Stores, their size, item count, connected projects, backups available | — | B Op | R | — | E-3 (source candidate; native provider pending) |
| `vercel_globalconfig_create` | New store (AUD-AF: readback verification no longer demands a project-links array the documented record never carries; reported links must still be empty) | P | B | E | — | E-3 (source candidate; native provider pending) |
| `vercel_globalconfig_delete` | Delete a store (refused while connected to a live project unless confirmed as production) (AUD-AF: classification rebuilt on the documented record, as for patch_items — unreported project linkage is treated as live-connected rather than unprovable) | D Cp | O | F | y | E-3 (guarded source candidate; provider pending) |
| `vercel_globalconfig_list_items` | Items in a store (keys and values; values are configuration, key-shaped strings hidden) | — | B Op | R | — | E-3 (source candidate; native provider pending) |
| `vercel_globalconfig_patch_items` | Create, update or delete items in one batch (live projects read them immediately); the published item schema states the `value` contract — required for create/update/upsert, forbidden for delete, plain-JSON limits (AUD-AC); classification rebuilt on the documented record (AUD-AF): the provider reports no project links for a store, so unreported linkage classifies the store live-connected (production connection + confirm) instead of refusing every real store, and the documented bare-array items shape is accepted alongside the legacy key maps | Cp | B Op | E | y | E-3 (guarded source candidate; provider pending) |
| `vercel_globalconfig_create_token` | Read token for a store, shown once through vercel_reveal_one_time_secret | C A 1x | B | F | — | E-3 (guarded source candidate; native TEST pending) |
| `vercel_globalconfig_restore_backup` | Restore a store to a backup version (newest before a time, or by version) | Cp | Op | E | y | E-3 (guarded source candidate; native TEST pending) |
| `vercel_globalconfig_list_tokens` | Read tokens of a store: label, ID, created — never the token itself | — | B O | R | — | E-4 (source candidate; native TEST pending) |
| `vercel_globalconfig_revoke_tokens` | Revoke one or more read tokens (apps still using them stop reading the store; preview names the connected projects) | D Cp | O | F | y | E-4 (source candidate; native TEST pending) |
| `vercel_globalconfig_get_schema` | The JSON schema a store's items must match (or "none") | — | B Op | R | — | E-4 (source candidate; native TEST pending) |
| `vercel_globalconfig_set_schema` | Set, replace or remove a store's JSON schema; preview checks the current items against it and lists any that would no longer match | Cp D | B O | E | y | E-4 (source candidate; native TEST pending) |

## Developer tools (`vercel_dev_*`) — 17 (preview only; `docs/designs/BATCH-V.md`)

Building with Vercel on any project. Every tool refuses production targets before reading anything (contract §10), and
everything it creates is recorded in a run and tagged where Vercel allows (`rtc_run` in deployment meta, Sandbox tags and env comments). Developer-agent spending remains zero unless separately approved for a specific action. End users can separately delegate provider actions through authenticated product controls; no arbitrary MCP-imposed daily Sandbox quota exists after the October 17 owner correction; usage tracking does not authorize purchases. V-4 adds exact Sandbox stop and V-5 wipes encrypted per-run synthetic signing keys as part of guarded run cleanup; do not claim either operationally accepted until its provider readback and tests pass.

| Tool | What it does | Safety | Aud. | Prof. | App | Card |
|---|---|---|---|---|---|---|
| `vercel_dev_seed` | Guarded synthetic scratch project plus preview; metered build follows the account purchase policy (owner word or owner grant); builder identities spend $0 | P $ | B | F | — | V-1 built #206 |
| `vercel_dev_list_runs` | Bound account-owned run records and exact resource lifecycle state; no cross-account visibility | — | B | R | — | V-1 candidate #206 |
| `vercel_dev_cleanup` | Exact recorded preview deployment and provably empty scratch project cleanup; later resource families fail closed until native delete wiring | C | B | F | y | V-1 candidate #206 |
| `vercel_dev_preview_branch` | Guarded exact GitHub commit preview, tracked per run; metered build follows the account purchase policy (owner word or owner grant); builder identities spend $0 | P $ | B | F | y | V-2 candidate |
| `vercel_dev_wire_preview_env` | Bounded encrypted preview-only variables (optionally Git branch), one supplied/generated source each; exact IDs tracked and revocable | P | B | F | y | V-2 candidate |
| `vercel_dev_alias_preview` | New run-namespaced .vercel.app alias to verified active READY preview only; refuses all reassignments and production traffic | P A | B | F | y | V-2 candidate |
| `vercel_dev_create_bypass` | Project-wide protection bypass restricted to isolated run-owned scratch project; secret encrypted and revealed only via authenticated one-time owner page | C A 1x | B | F | y | V-2 candidate |
| `vercel_dev_tail_logs` | Signed account/run/deployment-bound continuation over bounded build/runtime preview events; no full-history claim | — | B | R | — | V-3 candidate |
| `vercel_dev_diagnose_build` | Classify ten approved first-error rules from bounded preview build events with safe cause/fix, never raw secrets | — | B | R | — | V-3 candidate |
| `vercel_dev_fetch_preview` | Up to 10 exact owned preview paths, public-only DNS, no redirects, optional encrypted server-private bypass, 4 KB bounded snippets | — | B | R | — | V-3 candidate |
| `vercel_dev_check_integration` | Metadata-only preview requirements; names, preview domains, framework/runtime, cron-not-applicable, protection and unverified integrations | — | B | R | y | V-3 candidate |
| `vercel_dev_sandbox_create` | Record requested minutes atomically without a daily threshold (10-minute default; up to provider Pro 24-hour session duration); create run-owned ephemeral session with caller-chosen size (`vcpus` 1/2/4/6/8, memory derived at 2 GB per vCPU) and network (`deny-all` default, `allow-all`, or `custom` with up to 20 allowed domain patterns) (V-6/UA-08); optional exact public Git SHA; metered cost follows the user-selected delegation policy (AUD-A2: the owner's word on owner connections; separately authenticated metered consent where a grant is required) | P $ | B | E | — | V-4 candidate #216; sizing/network V-6 |
| `vercel_dev_sandbox_run` | Dispatch one ≤45-second async command or inspect its exact ID for bounded redacted log preview, ten-minute private vercel_get_result handle, explicit completeness | P | B | E | — | V-4 candidate #216 |
| `vercel_dev_sandbox_write_files` | Upload up to five safe relative files ≤4 KB each via bounded gzip tar; read-back SHA-256 proof, never echo file values | P | B | E | — | V-4 candidate #216 |
| `vercel_dev_sandbox_read_file` | Bounded ≤4 KB safe relative file read from attested run-owned session, secrets redacted | — | B | R | — | V-4 candidate #216 |
| `vercel_dev_sandbox_stop` | Stop exact session, verify stopped state, mark cleaned only after provider readback | P | B | E | — | V-4 candidate #216 |
| `vercel_dev_send_test_webhook` | Prepare one private run signing key or send HMAC-SHA1 synthetic event to exact READY preview host; HTTPS DNS pinned, no redirect/retry, response only | P 1x | B | E | — | V-5 candidate #216 |

## Domains (`vercel_domain_*`) — 11

| Tool | What it does | Safety | Aud. | Prof. | App | Card |
|---|---|---|---|---|---|---|
| `vercel_domain_list` | Team domains: registrar (Vercel or other), nameservers, expiry, auto-renew, verified | — | O Op | R | — | N-1 |
| `vercel_domain_get` | One domain with its verification record and which projects use it | — | O Op | R | — | N-1 |
| `vercel_domain_check_config` | Is the domain pointed correctly: misconfigured or not, the exact records it needs | — | B Op | R | — | N-1 |
| `vercel_domain_add_to_team` | Add a domain you already own elsewhere to the team (no purchase) | P | O | F | — | N-1 |
| `vercel_domain_update` | Move a domain to another team, or change its zone/custom nameserver setting | PR | O | F | y | N-1 |
| `vercel_domain_remove_from_team` | Remove a domain from the team (its aliases first; the site stops answering on it) | D PR | O | F | y | N-1 |
| `vercel_domain_list_project_domains` | Domains on a project: production or branch, redirect, verified | — | B Op | R | y | N-1 |
| `vercel_domain_attach_to_project` | Add a domain to a project (production unless a branch or custom environment is given) | Cp | B Op | E | y | N-1 |
| `vercel_domain_update_project_domain` | Change a project domain's redirect, status code, branch or custom environment | Cp | Op | E | y | N-1 |
| `vercel_domain_detach_from_project` | Remove a domain from a project | D Cp | Op | F | y | N-1 |
| `vercel_domain_verify_project_domain` | Ask Vercel to re-check a project domain's verification | P | B Op | E | — | N-1 |

## DNS and certificates (`vercel_dns_*`, `vercel_cert_*`) — 9

Every DNS write is production: DNS carries the live site **and email** (B2).

| Tool | What it does | Safety | Aud. | Prof. | App | Card |
|---|---|---|---|---|---|---|
| `vercel_dns_list` | Records for a domain on Vercel DNS (type, name, value, TTL, which app owns it) | — | O Op | R | y | N-2 |
| `vercel_dns_get_record` | One record | — | O Op | R | — | N-2 |
| `vercel_dns_create_record` | Add a record (A, AAAA, CNAME, MX, TXT, SRV, CAA, NS); preview checks for conflicts | PR | O Op | E | y | N-2 |
| `vercel_dns_update_record` | Change a record | PR | O Op | E | y | N-2 |
| `vercel_dns_delete_record` | Delete a record | D PR | O Op | F | y | N-2 |
| `vercel_dns_replace_zone` | Replace a domain's records with a given set (preview lists every add, change and removal) | D PR | O | F | y | N-2 |
| `vercel_cert_list` | Certificates: domains covered, expiry, auto-renewing (the provider contract carries no issuer field — N-2 dossier §4.3) | — | O Op | R | — | N-2 |
| `vercel_cert_issue` | Ask Vercel to issue (or re-issue) a certificate for domains | PR | O Op | E | — | N-2 |
| `vercel_cert_remove` | Remove a certificate | D PR | O | F | y | N-2 |

Not built: certificate **upload** (the API takes a private key; a private key never passes through chat) — guided.

Build notes (N-2, dossier-first): `vercel_dns_replace_zone` replaces the set in one tool call composed over the documented create/update/delete endpoints — the documented PUT for whole-zone replacement carries no request-body contract in the pinned snapshot or the live reference, so no door calls it (dossier §4.2). The snapshot's SRV and TXT create branches require `name` but omit it from their properties (additionalProperties:false), so no documented body can validate; a scoped exemption in the request validator covers those two record types only, with bodies pinned byte-exact in tests (dossier §4.1).

## Domain registrar (`vercel_registrar_*`) — 9

| Tool | What it does | Safety | Aud. | Prof. | App | Card |
|---|---|---|---|---|---|---|
| `vercel_registrar_search` | Is a name available, and its price (checks the exact names given; the contract generates no suggestions — dossier §4.3) | — | O | R | — | N-3 |
| `vercel_registrar_get_price` | Purchase, renewal and transfer price for a domain or TLD, for N years | — | O | R | — | N-3 |
| `vercel_registrar_buy` | Domain purchase completes in the Vercel dashboard — the registrant-contact input path was removed (AUD-AV); this tool refuses with that remedy | $ | O | F | — | N-3 |
| `vercel_registrar_renew` | Renew a domain for N years at the stated price | $ | O | F | — | N-3 |
| `vercel_registrar_set_auto_renew` | Turn auto-renew on (future charge: `$`) or off (risk of losing the domain: `C`) | $ / C | O | F | — | N-3 |
| `vercel_registrar_transfer_in` | Domain transfer-in completes in the Vercel dashboard — the contact and auth-code input paths were removed (AUD-AV); this tool refuses with that remedy | $ | O | F | — | N-3 |
| `vercel_registrar_get_status` | An order's, a transfer's or contact verification's status | — | O | R | — | N-3 |
| `vercel_registrar_get_auth_code` | The code to transfer a domain away, shown once through vercel_reveal_one_time_secret | C PR 1x | O | F | y | N-3 |
| `vercel_registrar_update_nameservers` | Point a Vercel-registered domain at other nameservers (moves DNS and email away from Vercel) | D PR | O | F | y | N-3 |

Build notes (N-3, dossier-first): every purchase is quote → confirm — the preview prices from a fresh quote, apply re-quotes inside its pre-dispatch check and refuses drift before dispatch, and the buy/renew/transfer call sends `expectedPrice` in dollars so the provider independently refuses a changed price (`expected_price_mismatch`; a provider-side rejection surfaces its code in the result's failure detail — dossier §4.1 as corrected at build). Registrant contact is never a tool argument: at build time it was pasted once on the setup page as a `registrar_contact` pending input and consumed inside apply (dossier §4.2). **Superseded 2026-10-31 (AUD-AV, decided default D9): the pending-input channel is removed — buy and transfer-in refuse with the Vercel-dashboard remedy, renew refuses only when a contact input is supplied, and the transfer-out code is delivered only as a one-time secret through `vercel_reveal_one_time_secret`.** Auto-renew's single tool declares its spend per invocation: ON is a recurring future charge, OFF is a $0 confirm-only change whose preview warns of the expiry date (dossier §4.4).

## Deployment protection (`vercel_protection_*`) — 8

| Tool | What it does | Safety | Aud. | Prof. | App | Card |
|---|---|---|---|---|---|---|
| `vercel_protection_get` | Vercel Authentication, password protection, trusted IPs, options allowlist and their scope; bypass secrets (notes only) | — | O Op | R | — | F-1 |
| `vercel_protection_set_vercel_auth` | Turn Vercel Authentication on/off and set its scope (previews only, all except custom domains, all) | PR A | O | F | y | F-1 |
| `vercel_protection_set_password` | Password protection scope and off; the password itself is set in the Vercel dashboard, never in chat (turning protection on refuses with that remedy — AUD-AV) | PR A | O | F | y | F-1 |
| `vercel_protection_set_trusted_ips` | Allowed IP ranges and scope | PR A | O | F | y | F-1 |
| `vercel_protection_list_bypass` | Protection-bypass secrets: note, created, which one is `VERCEL_AUTOMATION_BYPASS_SECRET` (never the secret) | — | B O | R | — | F-1 |
| `vercel_protection_create_bypass` | New bypass secret for automation (shown once through vercel_reveal_one_time_secret) | PR A 1x | O | F | y | F-1 |
| `vercel_protection_revoke_bypass` | Revoke a bypass secret (deployments built with it stop bypassing) | PR | O | F | y | F-1 |
| `vercel_alias_set_shareable_link` | Make or revoke a shareable link for one protected URL (the link is shown once through vercel_reveal_one_time_secret) | A 1x | O Op | E | y | F-1 |

**F-2 note (2026-10-30):** the eleven firewall rows below are implemented. Three snapshot defects were proven against the repo's own validator during the build and handled with narrow, commented exemptions in `validateRequest` (the `sandbox_command_run` precedent): the config GET and the activate POST omit the `projectId` the live reference requires; the config PATCH body oneOf double-matches its documented branches (bodies are built per the live reference and pinned byte-exact in tests); the attack-mode enabling body double-matches its oneOf. The design's §5.2 spend mark for managed rule sets was NOT carried: the rows below carry no `$`, no per-call price exists in the provider contract, and plan-gated refusals surface as classified errors. Every config write journals `vercel_firewall_restore_version` to the previously active version as its undo. Attack mode requires an end time when turning on, capped at 24 hours (design F4).

## Firewall (`vercel_firewall_*`) — 11

| Tool | What it does | Safety | Aud. | Prof. | App | Card |
|---|---|---|---|---|---|---|
| `vercel_firewall_get` | Active firewall: custom rules in words, managed rule sets, IP blocks, version history | — | O Op | R | — | F-2 |
| `vercel_firewall_add_rule` | Add a custom rule (conditions → deny, challenge, log, rate limit, redirect); preview shows it in words | PR | O Op | F | y | F-2 |
| `vercel_firewall_update_rule` | Change or switch off one custom rule | PR | O Op | F | y | F-2 |
| `vercel_firewall_remove_rule` | Remove one custom rule | PR | O Op | F | y | F-2 |
| `vercel_firewall_set_managed_rules` | Turn managed rule sets on/off (e.g. OWASP core set, bot protection) and their action | PR | O | F | y | F-2 |
| `vercel_firewall_block_ip` | Block (or challenge) an IP address or range | PR | Op | E | y | F-2 |
| `vercel_firewall_unblock_ip` | Remove an IP block | PR | Op | E | y | F-2 |
| `vercel_firewall_restore_version` | Make an earlier firewall configuration version active again | PR | O Op | F | y | F-2 |
| `vercel_firewall_attack_status` | Is the project under attack now, and what Vercel is doing | — | Op | R | — | F-2 |
| `vercel_firewall_set_attack_mode` | Attack Challenge Mode on (with an end time) or off | PR | Op | E | y | F-2 |
| `vercel_firewall_list_events` | What the firewall blocked or challenged, by rule, IP, path and time | — | Op | R | — | F-2 |

**F-3 note (2026-10-30):** the eight rows below are implemented, completing Batch F. Staging tools are `P` (they apply on a preview connection; visitors see no change until publish); publish/restore/cache are production-class. Two contract facts proven during the build: redirect remove/restore-items bodies carry source **strings**, not item objects; and a numeric `statusCode` can never pass the repo validator (its `oneOf [number, string]` double-matches under `coerceTypes`), so `validateRequest` skips body validation for the two redirect write operations only when an item carries a numeric statusCode — the F-2 exemption pattern, bodies otherwise validated fully. The bulk-redirects PUT body carries the account's team id injected by the tool. The `dangerously-delete-*` cache operations are never registered or called (design F5; a grep test pins their absence). Cache invalidation has no read-back, so its verify reports `confirmed: null` honestly.

## Routes, redirects and cache (`vercel_route_*`, `vercel_redirect_*`, `vercel_cache_*`) — 8

| Tool | What it does | Safety | Aud. | Prof. | App | Card |
|---|---|---|---|---|---|---|
| `vercel_route_list` | Project routing rules (live and staged) and versions | — | B Op | R | — | F-3 |
| `vercel_route_stage` | Stage route additions, edits and removals (nothing changes for visitors until published) | P | B Op | E | y | F-3 |
| `vercel_route_publish` | Publish a staged routes version to production | PR | Op | E | y | F-3 |
| `vercel_redirect_list` | Bulk redirects (live and staged) and versions | — | Op | R | — | F-3 |
| `vercel_redirect_stage` | Stage redirect additions, edits and removals | P | Op | E | y | F-3 |
| `vercel_redirect_publish` | Publish a staged redirects version | PR | Op | E | y | F-3 |
| `vercel_redirect_restore` | Make an earlier redirects version live again | PR | Op | E | y | F-3 |
| `vercel_cache_invalidate` | Mark CDN cache stale by tag or source image (content refetched on next visit); hard delete is universal-only | PR | Op | E | y | F-3 |

## Logs, observability and analytics (`vercel_logs_*`, `vercel_analytics_*`) — 5

| Tool | What it does | Safety | Aud. | Prof. | App | Card |
|---|---|---|---|---|---|---|
| `vercel_logs_query` | Ask the observability data: requests, errors, durations, cache, by path/status/time (bounded window, summarized) | — | B Op | R | — | M-1 |
| `vercel_logs_errors_summary` | Top runtime errors for a project over a window: message, count, first/last seen, example request ID | — | B Op | R | — | M-1 |
| `vercel_analytics_pageviews` | Page views and visitors by path, referrer, country, device for a window (Web Analytics) | — | Op | R | — | M-1 |
| `vercel_analytics_set_web_analytics` | Turn Web Analytics on/off for a project (on may be billed beyond included events) | $ | O | F | — | M-1 |
| `vercel_analytics_set_speed_insights` | Turn Speed Insights on/off for a project (on may be billed) | $ | O | F | — | M-1 |

## Drains and webhooks (`vercel_drain_*`, `vercel_webhook_*`) — 8

| Tool | What it does | Safety | Aud. | Prof. | App | Card |
|---|---|---|---|---|---|---|
| `vercel_drain_list` | Drains: type (logs, traces, analytics, audit), destination host, projects, status, last delivery | — | O Op | R | — | M-2 |
| `vercel_drain_create` | Send logs/traces/analytics to an external HTTPS endpoint (data leaves the team; billed per GB) | $ C | O | F | — | M-2 |
| `vercel_drain_delete` | Delete a drain | C | O | F | — | M-2 |
| `vercel_drain_update` | Pause or resume a drain, or change its projects, sources, environments or sampling (widening what leaves the team needs confirm) | P (C when widening) | O Op | F | — | M-2 |
| `vercel_drain_test` | Validate a drain destination with a test delivery | P | O | E | — | M-2 |
| `vercel_webhook_list` | Account webhooks: URL host, events, projects | — | O Op | R | — | M-2 |
| `vercel_webhook_create` | New webhook (Pro/Enterprise); its signing secret shown once through vercel_reveal_one_time_secret | C 1x | O B | F | — | M-2 |
| `vercel_webhook_delete` | Delete a webhook | C | O | F | — | M-2 |

## Integrations and storage (`vercel_integration_*`, `vercel_storage_*`) — 8

| Tool | What it does | Safety | Aud. | Prof. | App | Card |
|---|---|---|---|---|---|---|
| `vercel_integration_list` | Installed integrations (e.g. Neon, Sentry, GitHub), their scope, projects and products | — | O Op | R | — | M-3 |
| `vercel_integration_get` | One installation: permissions, connected projects, billing plan, resources | — | O | R | — | M-3 |
| `vercel_integration_remove` | Uninstall an integration (may remove its resources and the variables it injected) | D Cp | O | F | y | M-3 |
| `vercel_integration_connect_resource` | Connect an integration resource (e.g. a database) to a project for chosen environments (injects variables) | Cp | B O | F | y | M-3 |
| `vercel_integration_create_store` | Create a Marketplace store (e.g. a database) on a chosen billing plan; preview shows the plan's price | $ | O B | F | — | M-3 |
| `vercel_storage_get_store` | One storage store (Blob, Global Config, Marketplace): size, region, connected projects | — | O Op | R | y | M-3 |
| `vercel_storage_create_blob_store` | New Blob store (storage and operations are billed beyond included usage) | $ | B O | F | — | M-3 |
| `vercel_storage_delete_blob_store` | Delete a Blob store and every file in it (refused for profiled apps' stores) | D | O | F | y | M-3 |

## Blob files (`vercel_blob_*`) — 4

Files inside a Blob store, through Vercel's Blob API (not the REST reference; `docs/designs/BATCH-M.md` M6). The server
reaches only the stores Chris connected through Blob enrollment in the sign-in flow (IN-15); file contents are never returned, only metadata.

| Tool | What it does | Safety | Aud. | Prof. | App | Card |
|---|---|---|---|---|---|---|
| `vercel_blob_list` | Files in a connected store: pathname, size, content type, uploaded; prefix filter and pages; folder summary by default | — | B O Op | R | y | M-4 |
| `vercel_blob_head` | One file's metadata (size, type, uploaded, cache settings) without downloading it | — | B Op | R | — | M-4 |
| `vercel_blob_put` | Upload one small file (≤4 MB, sent inline) to a connected store; refuses to overwrite unless asked; a store connected to a live project counts as production | Cp | B | E | y | M-4 |
| `vercel_blob_delete` | Delete named files (≤100 per call; no wildcards); preview lists each file and size; refused on a profiled app's store without `outsideApp` | D Cp | O Op | F | y | M-4 |

## Owner: team and security settings (`vercel_team_*`) — 10

| Tool | What it does | Safety | Aud. | Prof. | App | Card |
|---|---|---|---|---|---|---|
| `vercel_team_list` | One strictly stored-account selected team from the provider list, with projected metadata; never other teams or credentials | — | O | R | — | O-1 (read built #144) |
| `vercel_team_get` | Selected team ID verified with provider; allowlisted profile/plan/security flags, no secret values. Optional teamId reads one other team from an account-wide seat only | — | O | R | — | O-1 (read built #144); AUD-AB |
| `vercel_account_teams` | Every team an account-wide credential can see from the bounded provider page, each safely projected, with the selected team marked; narrower seats refuse | — | O | R | — | AUD-AB |
| `vercel_team_update_profile` | Guarded full-profile production update for name, slug, description and preview suffix; strict team preflight, race check and GET readback | C | O | F | — | O-1 (guarded write #145) |
| `vercel_team_create` | Guarded account-layer team creation (slug, optional name); plan terms disclosed in the preview, provider refusals classified with remedies, GET readback verification | C | O | F | — | AUD-AB |
| `vercel_team_delete` | Guarded account-layer team deletion, permanent; enrolled seats on the target refuse until removed as their own act; default-team change disclosed; provider verdicts classified | C D | O | F | — | AUD-AB |
| `vercel_team_update_security` | SAML enforced, IP addresses hidden in logs, verified commits required, separate production secret values, strict protection settings, email-domain auto-join | C A | O | F | — | O-1 (guarded privacy/secret/strict controls #146); O-1R (SAML + auto-join under the lockout guard) |
| `vercel_team_set_default_protection` | Default deployment protection for new projects | C A | O | F | — | O-1 (guarded standard authentication #147) |
| `vercel_team_set_deployment_retention` | How long deployments are kept, per target (shortening deletes old deployments) | C D | O | F | y | O-1R |
| `vercel_team_set_directory_role_mappings` | Directory-sync (SAML) group → role mappings (Enterprise) | C A | O | F | — | O-1R |

**O-1R note (2026-10-30):** the three rows above complete Batch O's O-1 scope. Contract facts proven from the pinned snapshot during the build (dossier: batch-o-dossier-2026-10-30.md): the team record reads retention back as DAYS (`expirationDays*` + `deploymentsToKeep`) while the write model uses duration enums, so retention verify converts through the duration table and never rounds an unknown read-back into success; `saml.connection` on the team record is the enforcement lockout guard's evidence; directory mappings have NO read-back endpoint, so that tool's verify reports `confirmed: null` on the documented `{ok:true}` acceptance. Retention shortening counts the deployments it would remove from real `deployments_list` pages before asking, and refuses when the count cannot be read.

## Owner: members and access groups (`vercel_member_*`, `vercel_access_group_*`) — 10

| Tool | What it does | Safety | Aud. | Prof. | App | Card |
|---|---|---|---|---|---|---|
| `vercel_member_list` | Members, roles, joined, two-step login if Vercel reports it, pending invites | — | O Op | R | — | O-2 |
| `vercel_member_invite` | Invite someone by email with a role (a message to a person; paid roles add a seat — dollar preview) | A $ | O | F | — | O-2 |

**AUD-AJ note (2026-10-30):** the SECURITY role's seat has no published price (Enterprise-only, per-contract — no figure is stored). `vercel_member_invite` and `vercel_member_update_role` disclose exactly "Security role — seat price not published by Vercel. This role is Enterprise-only; any charge is set by your team's Enterprise agreement." for SECURITY, and a confirmed invite or role change INTO SECURITY requires `acknowledgeUnpricedSeat: true`; other roles' priced flow is unchanged. `vercel_admin_cost_review` labels its seat total "known costs only — excludes the Security seat" whenever the roster includes a SECURITY seat.
| `vercel_member_update_role` | Change a member's role (widening: `A`; to a paid role: `$`) | C A $ | O | F | — | O-2 |
| `vercel_member_remove` | Remove a member from the team (refused for the token owner and the last Owner) | D C | O | F | — | O-2 |
| `vercel_member_revoke_invite` | Cancel a pending invite code | C | O | F | — | O-2 |
| `vercel_access_group_list` | Access groups (Enterprise) with member and project counts | — | O | R | — | O-2 |
| `vercel_access_group_get` | One access group: members, projects and project roles | — | O | R | — | O-2 |
| `vercel_access_group_create` | New access group with members and project roles | A | O | F | — | O-2 |
| `vercel_access_group_update` | Change an access group's name, members or project roles | A | O | F | — | O-2 |
| `vercel_access_group_delete` | Delete an access group | D C | O | F | — | O-2 |

**O-2 note (2026-10-30):** the ten rows above are implemented. Contract facts proven from the pinned snapshot during the build (dossier: batch-o-dossier-2026-10-30.md): the invite body is a top-level ARRAY; the role-change response carries only the team id, so verification is a roster read-back; the member record carries NO two-step field, so `vercel_member_list` reports `twoStepLogin: null` rather than guessing; the access-group summary read carries counts only, so `vercel_access_group_get` composes the members and projects sub-reads. Seat pricing recorded from Vercel's published Pro pricing: deploying roles (OWNER/MEMBER/DEVELOPER) are $20/seat/month (the stored seat-price default), VIEWER/VIEWER_FOR_PLUS/BILLING/CONTRIBUTOR are free, and SECURITY has no published seat price — it stays `$` with "price unknown" in the preview, the one role routed to the owner under the design's stop-and-ask point. Lockout guards refuse changing or removing the token's own user and demoting or removing the last Owner, with identity from the `user_get` read of the bound credential.

## Owner: access tokens (`vercel_token_*`) — 3

| Tool | What it does | Safety | Aud. | Prof. | App | Card |
|---|---|---|---|---|---|---|
| `vercel_token_list` | Access tokens of the token's user: name, scope (team/project), created, expires, last used — never values | — | O | R | — | O-3 |
| `vercel_token_create` | New team- or project-scoped token; expiry is the creator's choice, including none (IN-04); shown once through vercel_reveal_one_time_secret or stored directly as a server account | C A 1x | O | F | — | O-3 |
| `vercel_token_delete` | Revoke a token (refused for the token this server runs on) | D C | O | F | — | O-3 |

**O-3 note (2026-10-30):** the three rows above are implemented. The bearer value never enters a tool result or the replay log (the client's replay screen forbids it): creation delivers either a one-time owner reveal on the setup page or stores the token directly as another account of this server through the existing probed enrollment (`storeToken`, `allowFull:false` — the design's never-full-account rule enforced by the probe itself). `storeToken` gained an additive optional `expiresAt` so tool-created tokens record their expiry at enrollment (the tool-created leg of VMCP-003's recording gap; enrollment flows that pass nothing are unchanged). Deletion protects the credential this connection runs on twice over: an exact provider-id match from the account probe for server-created tokens, and the documented suffix against the stored account's last-4 for enrolled ones.

## Owner: billing, usage and activity (`vercel_billing_*`, `vercel_activity_*`) — 4

| Tool | What it does | Safety | Aud. | Prof. | App | Card |
|---|---|---|---|---|---|---|
| `vercel_billing_list_charges` | Billing charge lines (FOCUS format) for a period, by service, project and resource, in dollars and cents | — | O | R | — | O-4 |
| `vercel_billing_list_commitments` | Contract commitments (Enterprise) and their draw-down | — | O | R | — | O-4 |
| `vercel_billing_summary` | This billing period so far: total, by service and project, against the Pro monthly credit; top cost drivers | — | O | R | — | O-4 |
| `vercel_activity_list` | Team activity log (who did what, when): deployments, settings, members, env changes | — | O Op | R | — | O-4 |

**O-4 note (2026-10-30):** the four rows above are implemented. The charges and commitments endpoints answer FOCUS v1.3 JSON Lines (`application/jsonl`), which the client's normal read path cannot parse; the client therefore gained a `{jsonl: true}` read mode gated to exactly those two operations, decoding through a bounded line reader (2 MiB cap, no provider payload in errors). Amounts arrive as decimal dollars and are reported as integer cents plus a display string. `vercel_billing_summary` compares the window against the stored defaults (Pro monthly credit $20, monthly target $20 — named constants until an owner-settings surface exists). IN-12 stands: nothing here sets a budget, an alert, a pause, a plan or a payment method; alerts and controls belong to Vercel's Spend Management and are only reported.

## Owner: administration (`vercel_admin_*`, guided settings) — 5 tools + guided settings

For the account owner, not only developers. Settings with an API are real tools (here and in every area above); every
dashboard-only setting is a **guided setting** — structured steps a person or a browser-capable agent follows while Chris
watches, then checked by read-back where Vercel exposes the value (contract §11).

| Tool | What it does | Safety | Aud. | Prof. | App | Card |
|---|---|---|---|---|---|---|
| `vercel_admin_overview` | The whole team in one view: plan, members and roles, tokens and expiry, security settings, default protection, domains and renewals, certificates, spend so far, integrations, webhooks and drains, plus every guided setting's state (ok / needs attention / can't read) — **NOT BUILT: closed by owner ruling IN-16 (ratified 2026-10-30); the token-expiry warning's settled home is `vercel_whoami`, and no separate overview tool is to exist.** | — | O | R | — | O-5 |
| `vercel_admin_review_security` | Security review: members and roles, SAML, tokens (age, scope, expiry), protection and bypass secrets per project, firewall, secret-kind variables, verified commits — each with a plain fix | — | O | R | — | O-5 |
| `vercel_admin_cost_review` | Where the money goes: charges by service and project, build counts by branch, build machines, analytics add-ons, drains, sandboxes, rolling releases — with savings suggestions | — | O | R | — | O-5 |
| `vercel_admin_list_guided_settings` | Every dashboard-only setting the map covers, by section | — | O | R | — | O-5 |
| `vercel_admin_check_setting` | Read back a guided setting's value where Vercel exposes it (e.g. after Chris changes it) | — | O | R | — | O-5 |

**Guided settings covered** (dashboard-only; full list in `src/data/dashboard-map.js`, every settings page of the team,
project and account): plan upgrade/downgrade and payment method; invoices; **Spend Management** (on-demand budget,
notifications, pause production deployments, spend webhook); add-ons and credits; notification preferences; two-step
login and passkeys; login connections; SAML connection to the identity provider; directory sync setup; audit log
(Enterprise, via Audit Log Drains); **production branch tracking**; connecting or disconnecting a Git repository; deploy
hooks; cron jobs enable/disable and "run now"; certificate upload; deleting the team; deleting the account (never
automated — steps only); viewing an environment variable's value (Vercel dashboard).

## Project profiles (`vercel_profile_*`, readiness and setup) — 5

| Tool | What it does | Safety | Aud. | Prof. | App | Card |
|---|---|---|---|---|---|---|
| `vercel_profile_list` | Project profiles: which apps manage their own Vercel resources and what each owns | — | B O | R | — | P-1 |
| `vercel_profile_get` | One profile in full (owned variables, domains/DNS, stores, release rule, crons, no-preview branches) | — | B O | R | — | P-1 |
| `vercel_profile_draft` | Turn codebase findings (`vercel.json`, env names, crons, scripts) into a draft profile and `APP-NEEDS-<APP>.md` text; never fetches code | — | B | R | — | P-3 |
| `vercel_workflow_app_readiness` | Every row of a profile (or an inline spec) checked: done / fixed with confirm / needs you (steps) / needs a decision (`IN-xx`) | — (fixes: as the tool used) | B O | R | y | P-2 |
| `vercel_workflow_project_setup` | Set up Vercel for a new project from a short description: project, framework, variable names, domains, protection, preview rules; previewed first; idempotent | P (C for production parts) | B O | F | — | P-3 |

**P-3 note (2026-10-30):** `vercel_profile_draft` and `vercel_workflow_project_setup` are implemented, completing Batch P. The draft tool maps a closed findings vocabulary onto a profile validated by the app-guard's own `validateProfile`; unknown findings keys — top-level or nested — are reported in `unmapped`, never guessed into the profile, and package.json script names reach only the APP-NEEDS text (no profile field holds them). The setup workflow is itself a guarded write that composes the area tools through the registry (verdicts C-1..C-8 on the card): step dry-runs build one combined preview, confirmed steps dispatch in order with derived request keys and stop at the first refusal, and planning reads live state first so a second run creates nothing. Value-less variable names are never dispatched — tools consume pending inputs, they do not create them — so they return as pending-input requests with the exact follow-up call; generated names dispatch to `vercel_env_set`. Node version and production-branch tracking stay guided (R-2 and the readiness precedent), recorded in the draft profile the workflow stores (status `draft`, source `draft`) and in the APP-NEEDS text it returns — returned, never committed elsewhere. A stopped workflow ends `applied` with `confirmed: false`; its partial report (steps done, stop point with the named reason, per-step undo pointers) is journaled on its own change-log row (C-8).

**P-2 note (2026-10-30):** `vercel_workflow_app_readiness` is implemented as a read-only composition over the registry: each profile row returns done / fixable / needs_you / needs_decision, and a fixable row carries the exact area-tool call — the caller runs it through that tool's own preview and confirm, which is what this row's "— (fixes: as the tool used)" safety cell means in practice (dossier R-1: the composition seam dispatches reads only and the guarded-write machinery is sealed). Two design-fixture corrections from the contract: no area tool changes a project's Node version, so that row is guided needs_you, not a fix (R-2); and preview database isolation reports `vercel_env_compare` verdicts verbatim — secrets cannot be proven same or different without reading them, so only a proven difference earns done (R-3).

**P-1 note (2026-10-30):** `vercel_profile_list` and `vercel_profile_get` are implemented, with the storage and the guard they feed: profiles live in the `known_apps` table (schema 18 → 19 tables) scoped per account like `protected_resources`, seeded with the Appliance Desk profile from `docs/APP-NEEDS-APPLIANCE-DESK.md` — verified item by item against the live app on 2026-10-30 (its `vercel.json` now declares nineteen crons, not the ten the 2026-10-10 audit counted, and `git.deploymentEnabled` is default-deny except `live`/`testing`; the profile keeps its three explicit never-preview branch globs because the field governs MCP-initiated previews account-wide). The B-7 `checkApp` stub is now the real guard: managed-variable writes, owned-DNS changes, destructive writes to owned stores, branch-rule promotes and protected sandboxes refuse without the caller's `outsideApp` marker, and rollback is never blocked. The dev family's preview-branch refusal is profile-driven with the same built-in default when an account has no profiles. Read tools mark profile-owned projects as P-2/P-3's composed reads land; `vercel_project_list`/`vercel_project_get` carry the mark now. Dossier: `batch-p-dossier-2026-10-30.md` in the audit goal workspace.

## Workflows (`vercel_workflow_*`) — 12

Each does a whole job server-side and answers in plain English with `structuredContent` for agents (Batch C).

| Tool | What it does | Safety | Aud. | Prof. | App | Card |
|---|---|---|---|---|---|---|
| `vercel_workflow_project_health` | One project's health: live deployment and commit, failed builds lately, top errors, domains and certificates, variables missing per target, crons, protection | — | Op | R | — | W-1 |
| `vercel_workflow_release_status` | What is live, what is waiting (commits on the production branch not yet live, previews ready), active rolling release | — | Op | R | — | W-1 |
| `vercel_workflow_find` | One search box: a URL, deployment ID, domain, commit, branch, env key or project name → what it is and where | — | B O Op | R | — | W-1 |
| `vercel_workflow_why_did_build_fail` | Any deployment (production included): first error, likely cause, exact fix, and whether a redeploy would help | — | B Op | R | — | W-2 |
| `vercel_workflow_deploy_and_wait` | Deploy a branch (preview unless production asked) and report when ready, with URL and checks | Cp | B Op | E | y | W-2 |
| `vercel_workflow_ship_to_production` | Promote a ready preview after checks (build ok, checks passed, smoke test); records the previous live deployment for rollback | PR | Op | E | y | W-3 |
| `vercel_workflow_emergency_rollback` | "The site is broken": roll production back to the last good deployment, then report what changed | PR | Op | E | y | W-3 |
| `vercel_workflow_setup_custom_domain` | Attach a domain, create or list the DNS records needed, wait for verification and certificate | PR | O Op | F | y | W-4 |
| `vercel_workflow_env_sync` | Make variable names/targets consistent between targets or projects (values copied server-side; one preview of all) | Cp | Op | E | y | W-5 |
| `vercel_workflow_rotate_secret` | Rotate a secret variable with a fresh random value generated on the server, then redeploy; value never shown | PR | Op | F | y | W-5 |
| `vercel_workflow_cost_check` | Month so far vs the target Chris sets, builds per day and branch, what drove cost, and the settings that would lower it | — | O | R | — | W-6 |
| `vercel_workflow_security_audit` | One project's security: protection, bypass secrets, firewall, secret-kind variables, public variable names that look secret, members with access | — | O | R | — | W-6 |

W-1 (2026-10-30) ships the first three Batch W reads: `vercel_workflow_project_health`,
`vercel_workflow_release_status` and `vercel_workflow_find`. They compose the area tools through
the registry's dispatch seam (`ctx.dispatchTool`) — the same seam `vercel_call` uses — and add no
provider call of their own. Health judges missing variables only against a covering stored
profile's `expected_env`; with no profile it reports inventory and says so. Find searches
projects, deployments, domains, commit SHAs, branches and variable names under a shared time
budget and reports `searched.complete: false` when it stops early, with the exact next call.
Batch W completing the Workflows section also triggered OP-1's front-door composition review:
the door's v2 membership (basis `batch-w-delta-2026-10-30`) rebalances ten most-used seats to the
twelve workflow tools across W-1..W-6 so the full-profile front door stays strictly under the
5,000-token owner cap; every retired tool remains one search/call away on the catalog listing.

W-2 (2026-10-30) adds `vercel_workflow_why_did_build_fail` and `vercel_workflow_deploy_and_wait`.
The diagnosis composes the deployment, build-log and check-run reads: the area tools never return
raw log text (the no-secrets rule), so the workflow renders the first error's build step and
position, a likely cause and exact fix keyed to that step, failed check runs as evidence, and a
redeploy-would-help verdict that is only ever "yes" when the build log carries no error events.
Deploy-and-wait is a guarded write whose single step dispatches `vercel_deploy_create_from_git`
through that tool's own pipeline — its full-profile gate and purchase policy apply there — after
resolving the exact commit (the caller's full SHA, or the newest deployment on the branch). It
polls with `vercel_deploy_wait` under a 45-second budget; a stop returns the deployment id and
the exact `vercel_deploy_wait` continuation, never a suggestion to re-run the workflow. Its
catalog Safety mark is Cp with no $: the workflow declares no spend of its own (card verdict
W2-C1); the metered build spend is the create step's.

W-3 (2026-10-30) adds `vercel_workflow_ship_to_production` and
`vercel_workflow_emergency_rollback`. Both are guarded writes whose single step dispatches the
owning release tool (`vercel_deploy_promote` / `vercel_deploy_rollback`) through its own
pipeline. Ship proves the design's W4 gates in `before()` — candidate READY, every reported
check concluded success (literal per card verdict W3-C4; zero reported checks is disclosed in
the receipt, never dressed as a pass), and a smoke fetch of the candidate's own URL (from
provider read-back, never a caller-supplied host) over the given paths returning 2xx/3xx — and
records the previous live deployment for rollback. Rollback picks the last good deployment by
proposing candidates to the rollback tool's own dry-run (the read tools expose no served
history), shows the covering profile's `rollback_caution` in the preview, verifies by alias
read-back, and reports whether errors are still occurring (error rows last seen after the
rollback moment), with `null` when the summary cannot be read.

W-6 (2026-10-30) adds `vercel_workflow_cost_check` and `vercel_workflow_security_audit`
(both reads, all profiles), completing Batch W. Cost check composes `vercel_billing_summary`
and `vercel_billing_list_charges` for the window, counts builds by day and branch from
`vercel_deploy_list` paged under a 45-second budget, and compares the effective total with
the covering profile's `cost_target_cents` when a project is named and profiled, otherwise
the billing summary's own stored target. Every cost driver and every suggestion is tied to a
charge actually present in the window's FOCUS rows (verdict W6-C1) — drains, sandbox,
analytics and rolling-release suggestions exist only when those charges do. Security audit
reports five sections — protection, bypass secrets, firewall, variables, access — each
`ok` / `needs_attention` (reasons) / `not_readable` (reason), and never lets one unreadable
area fail the whole audit: bypass secrets older than 90 days are flagged with their age,
`NEXT_PUBLIC_*` names matching KEY/SECRET/TOKEN/PASSWORD/PASSWD/PRIVATE/CREDENTIAL are
flagged as secrets shipped to the browser, and the protection judgement uses only the
fields `vercel_protection_get` actually returns (W6-C2). Batch W closes at 239 registered
tools; the C6 everyday-listing engineering line steps 25000 → 25500 (the 239-tool registry
measures ~25,023).

W-5 (2026-10-30) adds `vercel_workflow_env_sync` (everyday+full) and
`vercel_workflow_rotate_secret` (full only). Sync plans from `vercel_env_list` on both sides —
values are never read by the workflow — and dispatches one `vercel_env_copy` step per name the
destination lacks on the destination target, carrying the source row's exact identity the copy
tool's contract demands. Secret-kind sources are listed in the preview and the report, never
stepped; Config rows the copy contract cannot move (their targets include production) are
reported not-syncable with the reason; a capped inventory refuses rather than planning from
partial data (card verdicts W5-C1/C2). Rotate refuses Config variables, `VERCEL_*` names and
profile `managed_env` keys itself (W5-C3), then dispatches `vercel_env_set` in update mode
with a server-side `generate` block — the fresh value exists only inside that step's pipeline
and appears in no argument the workflow builds, no result and no journal — and, when the
variable targets production and a live deployment exists, `vercel_deploy_redeploy` of that
deployment with its read-back expectations. Its receipt says which other systems must learn
the new value in the honest general form (W5-C4): no profile field names secret consumers
today, and the generated value is never shown, by design.

W-4 (2026-10-30) adds `vercel_workflow_setup_custom_domain` (full only). It dispatches
`vercel_domain_attach_to_project` (skipped when the domain is already attached), reads the
configuration back, and — when misconfigured — creates exactly the records the config read
recommends (A records at the apex, a CNAME for a subdomain) via `vercel_dns_create_record`
when Vercel hosts the zone, skipping records already present. When Vercel does not host the
DNS it stops after attach and returns the exact recommended records as needs-you steps with
`confirmed: false` (card verdict W4-C2) and no certificate step. The DNS steps' values exist
only in the post-attach config read, so they are derived in `apply()` from that read-back,
each through its own guarded pipeline (W4-C1). When the domain verifies and no certificate
covers it, the final step dispatches `vercel_cert_issue`. Running it twice changes nothing.

## Everything else in Vercel: the universal tools (`vercel_api_*`) — 4

The hand-built tools are the comfortable, plain-English way to do the common jobs. These four reach **every operation in
Vercel's REST API** (438 on 2026-10-10: feature flags, KMS, Vercel CI, container registry, AI Gateway, Connect,
microfrontends, Remote Cache, Marketplace provider operations, and whatever Vercel adds), validated against the vendored
OpenAPI snapshot. The server never guesses an operation or a parameter.

| Tool | What it does | Safety | Aud. | Prof. | App | Card |
|---|---|---|---|---|---|---|
| `vercel_api_search` | Find Vercel operations by plain words: method, path, one-line summary, and whether it reads, changes, spends or returns a secret | — | B O Op | R | — | U-1 (metadata built #148) |
| `vercel_api_describe` | Parameters for one operation, trimmed to what matters, from the OpenAPI snapshot | — | B O Op | R | — | U-1 (metadata built #148) |
| `vercel_api_read` | Audited pinned flags only: canonical exact-ID single flags, team/project inventories, bounded verified capacity, deployment counts, segment and revision identities; foreign ownership, raw targeting and secrets refused | — | B O Op | R | — | U-1 (#150–#165; real provider/RTC proof pending) |
| `vercel_api_write` | Any POST/PUT/PATCH/DELETE operation through the full safety layer: always `confirm`; spend table; production detection; hand-built tools win | C (always) $ A | B O Op | F | y | U-1 (built — this PR) |

How `vercel_api_write` stays safe (details `docs/designs/BATCH-U.md`): always `confirm`, supports `dryRun`; spend
detection from a table (`src/vercel/spend-operations.js`) with a safe default (unknown operations whose summary says buy,
purchase, renew, upgrade, credits or billing are treated as spend); production detection from the target (B2); secret
rule (operations that return or take credentials are refused and named); hand-built tools win (refused, naming the
tool); self-protection and profile guards apply; read-back when the response has an ID; change log; `full` profile only;
passes need `allow_writes`.

## Things Vercel has no API for

Handled by `vercel_where_is_setting`, never faked: see "Guided settings covered" above. For each it returns the exact


**O-5 note (2026-10-30):** four of the five admin rows above are implemented; `vercel_admin_overview` is the exception — closed by owner ruling IN-16 (ratified 2026-10-30, mid-batch) and removed from this PR before merge, and the guided map (`src/data/dashboard-map.js`) now carries 25 entries in the contract §11 structured form (numbered steps with targets, stable URL, expected state, and a `verifyWith` read-back pointer where a real tool can verify). `vercel_admin_check_setting` executes that read-back; deletion entries are steps-only with no verifyWith. The overview and reviews compose existing reads only and mark every section ok / needs_attention (reason) / not_readable (reason) — a failed read is never dressed as ok, and member two-step status is honestly not_readable (the member contract carries no such field).dashboard link and numbered clicks as structured steps, so an agent with a browser can carry them out with Chris
watching, and the server checks the result where Vercel lets it read the value back (for example production branch
tracking is readable as the project's `link.productionBranch`; Spend Management is not readable — Chris says when done).

## Totals

Counted by `python3` over this file's tables (one row = one tool; rows naming two tools do not exist in this catalog):

| Section | Tools | Batch |
|---|---|---|
| Server about itself | 34 | A, B, C, R, X, O |
| Projects, crons and Git | 15 | D |
| Deployments: reads, logs and checks | 10 | D |
| Deployments: changes | 5 | D |
| Releases | 12 | D |
| Environment variables | 9 | E |
| Shared variables and custom environments | 7 | E |
| Global Config | 11 | E |
| Developer tools | 17 | V |
| Domains | 11 | N |
| DNS and certificates | 9 | N |
| Domain registrar | 9 | N |
| Deployment protection | 8 | F |
| Firewall | 11 | F |
| Routes, redirects and cache | 8 | F |
| Logs, observability and analytics | 5 | M |
| Drains and webhooks | 8 | M |
| Integrations and storage | 8 | M |
| Blob files | 4 | M |
| Owner: team and security settings | 10 | O |
| Owner: members and access groups | 10 | O |
| Owner: access tokens | 3 | O |
| Owner: billing, usage and activity | 4 | O |
| Owner: administration | 5 | O |
| Project profiles | 5 | P |
| Workflows | 12 | W |
| **Hand-built total** | **250** | |
| Universal tools | 4 | U |
| **All tools** | **254** | |

Per batch, by the card that first builds each tool: A 2 · B 10 · C 5 · D 42 · E 27 · V 17 · N 29 · F 27 · M 25 ·
O 29 · P 5 · W 12 · U 4 · R 1 · X 1 · AUD 18 (= 254). By lowest profile, of the 253 **registered** tools (registry truth, re-measured by the AUD-AY shadow pass, 2026-10-31): `read_only` 103, `everyday` 41, `full` 109 — cumulative visibility `read_only` 103, `everyday` 144, `full` 253; the 254th catalog row (`vercel_admin_overview`, `full`) is unbuilt by the IN-16 ruling
(B-6 prints the exact counts from the registry). In compact mode (`docs/designs/BATCH-C.md`) an agent loads about 20
tools up front and reaches the rest through `vercel_search_tools` / `vercel_call`.

**AUD-AQ note (2026-10-31):** `vercel_set_read_only` is the sixth AUD tool. Registry 240 → 241; all 241 registered tools are built. The catalog lists 242 rows: the 241 built tools plus `vercel_admin_overview`, closed by the IN-16 ruling and never to be built. `scripts/check-catalog.mjs` verifies the totals against the rows and that every registered tool is listed (the closed row is listed but, by the ruling, never registered).

**AUD-AB account-layer team lifecycle (2026-10-30, VMCP-026 A-13):** the team family gains its account layer. `vercel_account_teams` lists every team an account-wide (Full Account) credential can see — each row through the O-1 safe projector with the connection's selected team marked — and `vercel_team_get` accepts an optional `teamId` for one other team from that same seat; `vercel_team_list` keeps its seat-bound O-1 contract for narrower seats untouched. `vercel_team_create` and `vercel_team_delete` are guarded writes on the pinned /v1 contract: project seats refuse with the account-layer reason, plan/billing/state verdicts are Vercel's — attempted, classified and given remedies, never pre-judged — and the one product-owned refusal is data integrity: a team with enrolled accounts seated on it (this product's own hosting team included, by derivation, never by a named ID) refuses deletion until the enrollments are removed as their own act (`vercel_remove_account`, AUD-AA). Deleting the account's default team is disclosed, with `newDefaultTeamId` as the contract's own replacement mechanism.

**C-1b common result summaries (#42):** Reusable summary/field projection utilities now available to future provider tool cards. Secret-value keys are omitted even at full detail and unknown selectors are reported. No new MCP tool was registered in this slice; the result handle and default dispatcher integration belong to C-1c.

**C-1 safe result layer (#41–#43):** Read tools get centrally advertised `fields/detail` options and read-only/idempotent annotations. Over-8KB outputs produce a one-bearer scoped, 24-hour, 20-row paged handle instead of silent truncation; secret values cannot be recovered at full detail. Future workflows own their structured output schemas.

**AUD-D stored-result symmetry (2026-10-28, design D-D):** The stored-overflow promise now applies symmetrically. An over-8KB **write** result returns the write's verified receipt (status, confirmed state, request key) plus a `resultHandle` readable through `vercel_get_result` by the same bearer only — never a size error after the write has landed; if the result cannot be stored, the answer is `outcome_unknown` (verify by read-back, do not retry blindly). An over-8KB write **preview** or target list is stored and referenced by handle in the preview payload and the change-log row instead of refusing the change. The Global Config family shapes through this same delivery path, so its oversized outputs return the same stored-handle contract. The 8 KB figure remains the inline display bound for every tool; nothing is silently truncated.

**AUD-H outcome legibility + deployment target encoding (2026-10-28, VMCP-023):** A guarded write whose provider dispatch fails now returns `outcome_unknown` carrying a bounded `failure` detail — the pattern-validated provider error `code`, the operation `leg` that failed, a coarse `failureClass` (`timeout` / `network` / `http_status` / `shape`) and the HTTP status — never an error message or provider body, so a caller can tell upload from create from verify at a glance. Deployment create/verify checks accept the provider's real target encoding (a preview deployment's `target` is `null`, per the vendored API snapshot) through one shared matcher used by `vercel_deploy_create_from_files`, `vercel_deploy_create_from_git`, `vercel_dev_seed` and `vercel_dev_cleanup`; the guarded file-upload path serves both deploy tools the write wrapper authorizes, and uploads share the transport-standard 25 s bound.

**AUD-J first-deployment project settings (2026-10-28, VMCP-023):** A deployment create now carries `projectSettings` whenever it may be a project's first deployment — the provider requires them for a first deployment and saves them for later ones (vendored API snapshot), and omitting them against a settings-less project is a 400 `missing_project_settings`. `vercel_dev_seed` sends its scenario's framework with the remaining settings null (provider auto-detects); `vercel_deploy_create_from_files` echoes the project record's own stored settings fields, read during its identity check, so configured projects keep exactly their settings. The shape is stated once in `src/vercel/project-settings.js`.

**AUD-AD file-create settings only on first deployment (2026-10-30, dev-preview construction):** The AUD-J echo is narrowed to the case it exists for. `vercel_deploy_create_from_files` now sends the echoed `projectSettings` only when the project record's `hasDeployments` is `false` — the create IS the first deployment. On a deployed project it omits them and the provider inherits its saved settings (the create contract's inheritance rule; the shape git create and branch previews already used). Resending the record's settings on a non-first deployment was the sole body difference from every proven create route and what the provider refused with HTTP 400 in the 2026-10-30 live staging, which left the dev-preview family unable to construct a true preview; effective settings are unchanged, since the saved copy is the record's values. Dossier: `dev-preview-dossier-2026-10-30.md` in the audit goal workspace.

**AUD-AH preflight refusal reasons (2026-10-30):** A guarded write refused during classification now tells the caller why, in the tool's own words. The write preflight used to collapse every throw out of a tool's `before()`/`production()`/`targets()`/`preview()` hooks into the one generic reason "Could not safely preview or classify the change" — including the tools' own static, plain-words refusals naming the exact failed predicate. A tool now throws the typed `RefusalError` (core) for a refusal it constructs value-free, and the preflight passes that reason verbatim in the unchanged `refused_by_guard` envelope after a boundary screen (length, control characters, credential-likeness, ID shapes; screen failure falls back to the generic sentence). Every untyped throw — above all provider errors, which can echo messages, identifiers and values — keeps the generic sentence byte-for-byte; that fallback is a leak-safety property, not a bug. 421 inventoried tool-layer refusal sites migrated (dossier: `preflight-reasons-dossier-2026-10-30.md` in the audit goal workspace); interpolated and provider-rethrow sites deliberately stay generic. No tool names, schemas or request shapes change.

**AUD-AG file-create refusal fingerprint (2026-10-30, dev-preview construction round 2):** The AUD-AD fix was falsified as sufficient by the 2026-10-30 live probe — the settings-less create on a deployed project still drew a provider 400 at `deployments_create`, and no cause survived: the client strips the provider message by design, the AUD-H failure detail reaches only the ephemeral result, and the guarded-write executor journals no change-log row for an apply-path `outcome_unknown`. A full-body dossier (`dev-preview-dossier-round2-2026-10-30.md` in the audit goal workspace) leaves two contract-visible suspects outside evidence cannot separate — the documented framework auto-detection confirmation, which no caller in this product suppresses, and the explicit `target: 'preview'` the documented request vocabulary omits in favor of omission — so the card builds the AUD-M2 instrument instead of a guessed fix: when the `deployments_create` write throws, `vercel_deploy_create_from_files` best-effort journals one change-log row whose summary is a redacted shape fingerprint — the AUD-H verdict fields (HTTP status, pattern-validated provider code) plus the dispatched body's field names with type words, settings and target presence first (the two suspects' discriminators; the recent-changes read truncates summaries at 160 characters) — never values, digests, identifiers or provider messages. The tool result is unchanged; the operator reads the conviction back through `vercel_recent_changes` after one more live attempt. No request shape changes in this card.

**AUD-AL file-create construction (2026-10-31, dev-preview construction round 3):** The AUD-AG instrument's first live readout (2026-10-31, promoted build `8fb9e83`; SHAPE-FP change_log id 90: `failed=[400:bad_request]`, `projectSettings:absent`, `target:string`, manifest exact) separates only the already-cleared named class (`missing_project_settings`) — the auto-detection confirmation's code is documented nowhere — so the dossier (`files-create-conviction-dossier-2026-10-31.md` in the audit goal workspace) convicts the construction **class**: `vercel_deploy_create_from_files`' non-first construction was the only create construction diverging from the documented contract on both create-shaping instructions at once — a preview requested with the literal `target: "preview"`, which the documented request vocabulary omits in favor of omission ("If omitted, the target will be `preview`"), and the only create whose framework input is solely the uploaded tree, sent without the documented `skipAutoDetectionConfirmation` suppressor ("Use this to suppress that check in automated pipelines"; no caller in the product sent it). The tool now requests a preview by omission (`production`, which is documented, is sent verbatim; the caller's `target` argument, preview text, production classification and `verify()` read-back matching are unchanged) and sends `skipAutoDetectionConfirmation: "1"` on its create dispatch through the existing provider plumbing, uniform across the route. The AUD-AG fingerprint's query slot now renders the actual dispatched query key names (caller's keys plus the transport's `teamId`, sorted, names only) computed from the write params. The seed, branch-preview, git-create and redeploy constructions, the AUD-AD settings rule, the upload leg and every tool schema are unchanged; live acceptance (a true preview on a seeded project, then VMCP-028's delete probe and VMCP-016's branch-F alias leg) runs after the nightly promotion.
**AUD-AI recheck conviction (2026-10-30, VMCP-026 A-13 gate):** `vercel_check_token` can now say why it failed and what it derived. Live on 2026-10-30 the recheck on the owner's seat returned `unknown_error` twice with no status and no journal row, while its recorded scope (`team`) gated the AUD-AB cross-team read — and the recheck itself was structurally unable to clear the question: it gated its scope derivation on the stored scope, so a credential whose reach had grown since enrollment (a second team) refused with broader-visibility instead of reporting the drift, and the derived scope was not in the result at all. The recheck now derives ungated (it persists nothing; enrollment keeps its consent gate) and returns `derivedScope` beside `storedScope`. Probe refusals also keep the provider status the probe re-wrap used to drop, and the error classifier names the failed leg (identity / team visibility / project visibility / broader visibility / installation configuration / stored credential) as `recheck_failed` with the status class — provider text is still never surfaced, and every non-probe error classifies byte-identically. A refused recheck best-effort journals one change-log row whose summary is a redacted fingerprint (`SHAPE-FP recheck failed=[leg:status:code] route:… stored:…`, verdict first under the recent-changes read's 160-char bound; never values, IDs or provider messages), readable back through `vercel_recent_changes`; a throwing journal never changes the outcome. Dossier: `recheck-conviction-dossier-2026-10-30.md` in the audit goal workspace. No tool names, schemas or request shapes change.

**AUD-AM Git-import identity proof (2026-10-31, VMCP-016 fixture blocker):** `vercel_project_create` Git imports now prove the repository identity the provider actually offers. Live on the promoted build, the fixture create refused "Git repository identity is absent or ambiguous" with the namespace verified and exactly one search result: the shared predicate demanded `fullName === "owner/repo"`, but the pinned contract documents NO `fullName` field on a search-repo row — the row's name fields are the bare `name`/`slug` inside the namespace, under a `gitAccount` root bound to that namespace — and the live row carries the bare name. The proof is now the pair (verified namespace, bare name): a supplied `fullName` remains the canonical claim and decides alone (qualified or bare equality matches; any other value is a contradiction no alias can override — the D-1au protection stands, its premise corrected: there is no documented `fullName` "when Vercel returns one"), and without one the documented `slug`/`name` decide with agreement required. Exactly-one-match and the foreign/restricted/reauth refusals are unchanged; the same predicate serves the preflight proof and the execution-time re-proof. Dossier: `git-identity-dossier-2026-10-31.md` in the audit goal workspace. No tool names, schemas or request shapes change.

**AUD-K cleanup reconciliation and deletion proof (2026-10-28, VMCP-027):** `vercel_dev_cleanup` now reconciles a run's creation intents instead of deadlocking on them: an intent is cleaned when its intended creation is proven to have produced nothing unrecorded (the target is absent, or present and recorded as its own object in the run); an existing unrecorded target blocks for manual reconciliation, and intents identify the project they concerned as their write target so an intent-only run is identified to the guard. The empty-project inventory behind `vercel_project_delete` and cleanup's project step reads only fields the documented project schema carries: the completeness-checked deployment, domain and env lists are the proof, `link` and `crons` count as none when absent, and `hasDeployments` remains a conservative denial signal. Storage is outside the provable inventory (no documented record field or list operation exists for it; store wiring surfaces as project environment variables, covered by the env inventory).

**AUD-L in-progress create shape (2026-10-28, VMCP-023):** A deployment create's response is verified against BOTH documented shapes: the full deployment object, and the in-progress shape (id, target, readyState — no projectId) the provider returns while the deployment is still building. `vercel_dev_seed`, `vercel_deploy_create_from_files` and `vercel_deploy_create_from_git` require the response's projectId to match the target project when the response carries one; the binding project proof is each tool's verify() read-back of the full deployment object, which checks projectId equality independently.

**AUD-M lifecycle shapes (2026-10-28, VMCP-023 + VMCP-027):** Create verify() read-backs accept every documented deployments_get shape: projectId (and, for vercel_dev_seed, the run meta) is required when the read-back carries it — the in-progress and reduced shapes do not — while the deployment id and target remain the anchors. vercel_dev_seed also confirms a provider-promoted first deployment (target production); the user-facing create tools keep their requested-target demand. The shared project-deletion inspect accepts the env list's documented no-pagination branch ({envs, hiddenProductionEnvCount}) as complete exactly when the hidden count is 0. In vercel_dev_cleanup, pre-dispatch proof failures land at blocked (uncertain is reserved for post-dispatch doubt), and uncertain project and intent objects reconcile by inspection inside a confirmed cleanup: absent means cleaned with no new dispatch, present means inspected and deleted exactly once.

**AUD-N create shapeResult (2026-10-28, VMCP-023):** The create shapeResult in vercel_dev_seed, vercel_deploy_create_from_files and vercel_deploy_create_from_git is an identity check only — deployment id plus project identity when carried. It carries no target arm: the documented deployment response target enum is production/staging/null ('preview' is a request instruction, never a response value), and the provider promotes a project's first deployment at creation. Target judgment lives in verify(): the seed confirms on the preview encoding or the promotion; the user-facing tools report a create promoted against the requested target as applied with confirmed: false.

**AUD-O deletion proof and the canonical domain (2026-10-28, VMCP-027):** The empty-project inventory behind vercel_project_delete and vercel_dev_cleanup reports the total domain count for disclosure, but the project's own canonical production domain — <project-name>.vercel.app with no git branch, redirect or custom environment — is part of the project's identity, not an attached resource, and does not block deletion; every real project carries one from creation. Custom domains, owner-added subdomains, and branch or redirect domains still block. Cleanup's project-step refusal names the observed inventory counts and the hasDeployments signal, so a blocked cleanup states its own reason.

**AUD-P deployment aliases in cleanup (2026-10-28, VMCP-023/027):** vercel_dev_cleanup's deployment step judges the read-back's alias list by identity rather than demanding it empty: the deployment's own URL host is its identity in any project, and inside the run's proven scratch project the project's vercel.app family (the canonical domain a promoted first deployment necessarily serves, and its team-scoped form) is likewise identity. A custom domain or foreign hostname still blocks deletion, and in an existing user project a production-domain alias still blocks.

**AUD-Q outcome-cap fix (2026-10-28, VMCP-027):** vercel_dev_cleanup's project-step refusal is recorded in a compact form that names every inventory count within the outcome store's 160-character limit; the AUD-O long form exceeded the limit, its recording threw, and the pass surfaced as an unrecorded outcome_unknown.

**AUD-R canonical-domain fix (2026-10-28, VMCP-027/023):** vercel_project_delete's proof and vercel_dev_cleanup identify a project's canonical *.vercel.app domain structurally (Vercel truncates long project names when minting it), and cleanup accepts the project's actual canonical host — read from its domains inventory — as deployment identity under the scratch proof.

**AUD-S legibility (2026-10-28, VMCP-023):** vercel_dev_cleanup's deployment-step refusals now name the exact failing check (identity id/project, run provenance, alias-list form, plural aliases field, or the specific alias host outside the project's family) instead of one compound message.

**AUD-T team-scoped host (2026-10-29, VMCP-023):** vercel_dev_cleanup's deployment family test also admits the team-scoped production host in its truncated form — `<project name>-<team slug>.vercel.app` with the name cut to the 63-character label budget — as exactly one deterministic (name, slug) host, the slug read only when an otherwise-unmatched vercel.app alias remains under the scratch proof. Other projects' hosts, wrong cut lengths, and foreign teams' slugs still refuse.

## Authenticated write classification (security fix #56)

Routine provider writes are admitted only if their frozen `writeContract` originates in the registered `defineWrite` spec and the handler was created by `bindGuardedWrite` for that same spec; the registry rejects spoofed metadata at startup. `vercel_call` inherits the identical guarded dispatcher. The MCP public catalog deliberately strips internal `writes`, `guardedWrite` and contracts, but derives `readOnlyHint: false` and `idempotentHint: false` from the original authenticated metadata before stripping them. It must not inject read-specific `fields`/`detail` into any write schema. Per-provider-mutation transport replay keys are distinct within one logical write (operation, canonical parameters and stable optional discriminator). This is a safety-catalog note, not a new tool or expanded permission.

D-1ar (#91): Project/team member inventory preflight refuses contradictory user UID aliases before guarded membership changes. No new tools or elevated roles.

D-1as (#92): `vercel_project_list` and `vercel_project_get` report `paused: null` when provider pause metadata is missing or contradictory, rather than false assurance of an unpaused project.

D-1at (#93): Read-only `vercel_git_search_repos` only projects canonical URLs from the selected provider host; off-provider and lookalike URLs are suppressed.

D-1au (#94): `vercel_project_create` Git imports require authoritative matching `fullName` when Vercel returns one; a conflicting repository `slug` cannot satisfy the guarded identity proof.

D-1av (#95): destructive `vercel_project_delete` empty-only gate conservatively counts all supplied storage inventory aliases and refuses malformed aliases; nonempty deletion stays disabled.
D-1ba (#100): Git discovery repository links require canonical provider HTTPS host *and* exact full-repository path; mismatched root `gitAccount` or repository provider/namespace entries are rejected rather than mislabeled. Includes #99 post-merge P1 correction: encoded/double-encoded cron paths or schedules are suppressed before disclosure.
D-1az (#99): `vercel_cron_list` suppresses credential-shaped and decoded path/schedule metadata while keeping safe stripped URL paths and UTC/Denver examples; read-only only.
D-1ay (#98): member read pages refuse contradictory or duplicate user identities, do not substitute membership-record IDs for user UIDs, and honor root continuation contradiction signals for project/member lists.
D-1ax (#97): `vercel_project_transfer` revalidates exact issuer team/account and immutable project ID/name immediately before requesting any owner-vaulted transfer code; rotated authority or renamed projects refuse.
D-1aw (#96): destructive `vercel_project_delete` requires pinned `pagination.count` and cross-checks declared root/pagination totals for domains, env vars and deployments against terminal page lengths before both deletion scans; contradictory totals refuse irreversible DELETE.

<!-- D-1bb #101: Git discovery and metered Git import now share top-level authenticated gitAccount proof; no tool status or authorization change. -->

D-1bc (#102): project access grant/removal now refuses membership-only IDs and requires proven user UIDs in every scoped inventory and execution-time recheck.

D-1bd (#103): project/Git read metadata and the shared compact result shaper now screen nested percent-encoded credential text before presenting it to agents.

D-1be (#104): `vercel_project_create` now refuses stale name-availability proofs by rechecking the proposed project name with its bound write credential immediately before creation.

D-1bf (#105): project member grants/removals now reject conflicting pagination count and continuation flags during complete project/team inventory before access changes.

D-1bg (#106): the eighth percent decode is screened for generic high-entropy secrets in compact/project/Git responses; metered Git imports revalidate the owner spend setting after the last project-name read.

IN-07 (#107): existing optional protected project exclusions can be cleared only by the authenticated owner in setup; no hard-coded service name or server project ID is a permanent write ban. Server credential and other safeguards remain.

IN-08 (#108): priced operations will require separately authenticated transaction-bound owner purchase approvals. Ledger is implemented first; it does not grant any new paid tool authority and is not itself a purchase operation. Verified additional Pro developer seat rate: $20/month; free Viewer seats (Vercel Pro pricing).

IN-08 (#109): owner purchase review/approval exists only on authenticated /api/vercel/setup, not in MCP tool registry. UI displays account, operation, expiring reference, pricing source/quote and explicit owner ceiling; never issues Vercel calls.

IN-08 (#110): central guarded-write executor routes charges through separately owner-approved, one-use account/tool/request/argument/price binding; AI confirm and positive daily spend settings cannot authorize charged operations. Unbounded metered Git imports are blocked pending a provider-enforceable owner ceiling. $0 empty-project creation remains free.

**AUD-I S3 box reporting (2026-10-29, VMCP-026):** vercel_whoami now reports the two-layer box beside the account: `box` (declaredBox — the record of what the user chose at their door — probedBox, source, accountKind, scopeVerified, and a plain-words divergence when they differ, including the Full-Account-token-reads-as-one-team case), `accountLayer` (whether account-wide actions are part of this seat, with the token-tier route when they are not — A-12), and `workingBoxChanges` (within-ceiling changes are instant flips; beyond-ceiling changes name their step — A-10). All additive; no existing field changed. The owner setup page's connected-teams list shows the same declared box and ceiling per account.

**AUD-I S5 revocation posture (2026-10-29, VMCP-026):** probe failures now name the dead-integration cause class in plain words — a 403 with provider code `integration_configuration_disabled` (Vercel disables an installation's configuration when its installer leaves the team) surfaces as leg `integration_disabled` with the remedy (disconnect still completes server-side; a current team member reinstalls), wherever a probe runs, including vercel_check_token. Recheck routes by account kind: personal seats re-prove through the user-keyed probe, team seats through the team probe, as before. The owner setup page's revoke section states the complete disconnect (server revocation + token deletion in Vercel for token-tier seats; dead credentials still disconnect).

**AUD-U error legibility (2026-10-29, VMCP-030):** tool errors that are the tools' own curated validation refusals (invalid identifiers, identity mismatches, unusable pagination — TypeErrors carrying no provider code) no longer collapse into `unknown_error` with a text blaming the provider. They classify as `invalid_request`: the refusal's own in-repo message is the explanation (after the safety screens — length, control characters, credential shapes, secret labels), the cause states the failure happened on this server while checking the selection or shaping the record, and the next step points at the exact-ID contract. Provider errors and generic errors keep their existing classes. The deployment summary's outside-project refusal now also names the ID-keyed contract, so a by-name deployment read instructs instead of merely failing.

**AUD-V deployment-delete proof (2026-10-29, VMCP-028):** vercel_deploy_delete's preview proof no longer demands the request-side literal `target: 'preview'`, which no read-back record carries (the response enum is production/staging/null; a preview deployment reads back with target null). The proof accepts exactly the two preview forms — null, or the literal where a shape carries it, mirroring the deployment-cancel proof — and still refuses production, staging, and absent targets, with the state, alias, and identity proofs unchanged.

**AUD-W consent-page honesty (2026-10-29, VMCP-025):** the OAuth consent page no longer hides production mode silently when it is unavailable. It renders a disabled "production (not available)" option with the reason beside the Mode field — the account's production switch being off (naming the owner's switch-on routes and the later vercel_set_working_box flip) or the server not running its production deployment. Submission validation is unchanged; the disabled option can never be posted into an authorization.

**AUD-X post-apply stored treatment (2026-10-29, VMCP-011):** a landed, verified write can no longer be turned into an error envelope by its own paperwork. Everything the write executor shapes after apply — the verified receipt, the inverse, the audit's before/after/result copies, and the replay completion — now takes the stored treatment AUD-D gave previews and targets: oversized values are stored and referenced (the replay copy keeps the receipt scalars beside its reference), and the returned result is screened at the storage cap so the delivery layer's stored-result path answers with the receipt plus a vercel_get_result handle. Non-size shaper refusals (secrets, cycles, depth) still throw, and storeless contexts keep the original refusal.

**AUD-Y audit-entry fitting (2026-10-29, VMCP-011 second layer):** the write executor now fits each audit entry to the audit writer's aggregate 8 KB record cap before writing it — measuring exactly as the writer measures (before-wrap, delegation merge, summary) and replacing the largest fields with stored references until the entry fits. A landed, verified write can no longer be turned into an error envelope by the sum of its own audit paperwork; replaced fields read back through vercel_get_result. The writer's cap stays, the summary headline is never replaced, and storeless contexts keep the original refusal.

**AUD-Z working-box reachability (2026-10-30, VMCP-026 A-8 facet 2):** `vercel_set_working_box` is reachable by the owner connection again. The tool shipped in AUD-I S4 declared localAdmin but was never named in the MCP boundary's owner-tools list, so the profile gate refused it for every profile; it is now on that list, with its designed owner-only posture unchanged (full profile only, invisible to everyday and read_only). A boundary test now drives the production registry through the real listing and dispatch gates, so any future localAdmin tool missing from the list fails CI instead of shipping unreachable. The tool's catalog entry above is unchanged.

**AUD-AS envelope apply on the owner's connection (2026-10-31, sign-in cleanup §2.4):** `vercel_apply_owner_approval` joins the owner family above. Every approval envelope the proposal tools issue — owner account changes, exact purchase intents, RTC pass requests, production-enable receipts — can now be inspected (dryRun, never consuming) and applied (confirm) on the owner's own connection, through the same family apply functions and journaling the setup page uses; the page remains an apply path until AUD-AV deletes the route. The proof change is stated plainly (dossier D2): applying no longer re-proves the administrator passphrase on a page — the gates are the owner's own connector credential (the handler refuses any connection whose kind is not `connector`, so a delegated pass, even a write-capable full-profile one, can never apply an approval), the unguessable single-use reference with its ~10-minute TTL, an inspect/compare of the exact envelope before consumption, and the family's journal. A fixed-price purchase is approved at exactly its quoted total; the one metered shape (Sandbox create) is approved only as an explicit unbounded acknowledgment whose summary states the non-guaranteed variable-charge risk. An issued pass's bearer is delivered exactly as the page delivered it — as a one-time secret reference, never in the tool result. Proposal results' `reviewAt` now names this tool instead of the setup page.

**AUD-AA account-row removal (2026-10-30, owner step 4 tooling gap):** `vercel_remove_account` joins the owner family above. It proposes removing one exact enrolled account row — beside `vercel_revoke_connection`, never conflated with it: revocation kills one connector's standing and keeps the enrollment; removal deletes the enrollment itself (the stored credential, its connections and passes revoked, its pending inputs/secrets/codes and account-scoped protections deleted; audit history and purchase records kept for 400 days under the AUD-AO retention clocks) through the owner's separate approval on setup, or the setup page's own removal form — both execute the same atomic db operation. The default account refuses while other accounts remain (choose a new default first), because the new-connection default is the account list's order and deleting the row would silently promote the next one. Self-removal and last-account removal are disclosed in the plan, not gated: the approving authority (the setup session) is independent of the connection being removed.

**F-1 deployment protection (2026-10-30):** the protection family lands its project layer. `vercel_protection_get` and `vercel_protection_list_bypass` project the project record's protection fields (Vercel Authentication, password protection, trusted IPs, OPTIONS allowlist, bypass notes) — bypass secret values are map keys in the provider record and are never returned; state between preview and apply is carried as SHA-256 fingerprints. The three settings writes share one guarded PATCH of the pinned projects contract with drift re-check and read-back verification; loosening a scope is declared as an access change, and the password itself arrives only as a setup-page pending input consumed inside apply. `vercel_protection_create_bypass` sends a bare `generate` (the snapshot makes a supplied secret optional and pattern-binds it to 32 alphanumeric characters, so the provider mints; the tool proves exactly one new key by fingerprint diff and delivers it through the one-time-secret page). `vercel_alias_set_shareable_link` creates/revokes per-URL links on the alias protection-bypass contract; the create response is documented opaque, so the minted link secret is recovered from the documented alias read, never invented.

**AUD-AT account tools for the form-only owner actions (2026-10-31, sign-in cleanup §2.5):** the eight setup-page owner actions gain tool twins, each carrying its form's validations verbatim (the setup test suites are the parity fixtures). The four actions that carried the page's fresh-passphrase tier — purchase policy, the no-expiry attestation, production strictness, clearing project exclusions — become owner-approval envelopes of a new kind (`owner_account_setting`, `src/vercel/account-settings.js`), applied through `vercel_apply_owner_approval` (AUD-AS) by the same db setters the page calls; a proposal is never the owner's act until the owner applies it. The attestation envelope is bound to the token version current at proposal (field `boundVersion` — the write path's audit screen bars credential-shaped keys in journaled before-images): a rotation between proposal and application makes the db setter's version predicate refuse, surfaced as unverified, so the AUD-E property survives the move off the page. The four passphrase-plus-confirm actions run directly on the owner's own connector connection, hard-gated to it like the apply tool: the data export (journal-first — the change_log row lands before the stored result exists, per O-5b; shape-identical to the page's `buildOwnerExport` output), adding a project protection, the token recheck (full-profile twin of the page action; `vercel_check_token` keeps its all-profile read), and the Blob store disconnect that pairs AUD-AR's enrollment. The setup page's forms are untouched and keep working until AUD-AV deletes the route.

**AUD-AV setup route deleted (2026-10-31, sign-in cleanup §2.5/§2.6, dossier D9):** `/api/vercel/setup` and its 28 POST actions are gone; no tool was added or removed (registry stays 253). Every action's replacement landed before the deletion — enrollment in the sign-in flow (AUD-AR), envelope apply (AUD-AS), the eight account tools (AUD-AT), pass issuance/revocation/reveal (AUD-AU) — except `pending_input`, removed outright: the six consuming input paths (`vercel_env_set`, `vercel_env_set_many`, `vercel_shared_env_set`, `vercel_dev_wire_preview_env`, `vercel_protection_set_password`, the registrar contact/auth-code inputs) refuse the removed parameter by name with the guided Vercel-dashboard remedy. Consequences stated plainly: a Secret env value the owner chooses is set in the Vercel dashboard (or generated with `generate`); turning password protection on, or changing its password, is a dashboard act (scope changes and off are unaffected); `vercel_registrar_buy` and `vercel_registrar_transfer_in` refuse with the dashboard remedy since their required contact (and auth code) have no supply path, while `vercel_registrar_renew` without a contact input proceeds as before. The `pending_inputs` table stays (additive-only rule); its rows expire unconsumed under AUD-AO's 180-day sweep. Created-secret delivery texts across the catalog now name the real path, `vercel_reveal_one_time_secret`. Earlier dated notes in this catalog that describe the setup page describe the state at their date; this note closes them.

**AUD-AY docs/catalog shadow — the sign-in cleanup program is closed on paper (2026-10-31):** the program's final state is: one sign-in with derived issuance (AUD-AZ, PR #356), enrollment as a branch of the sign-in flow (AUD-AR, #362), envelope apply on the owner's connection (AUD-AS, #365), the eight account tools (AUD-AT, #366), pass issuance/revocation/reveal (AUD-AU, #369), the setup route deleted (AUD-AV, #370), the read-only switch (AUD-AQ, #360), the developer handoff hardened to the standard connection (AUD-AW, #349) and the front door polished onto the fleet shell (AUD-AX, #371). The registry stands at **253 registered of 254 catalog rows**, re-measured from the code by this pass (lowest profile: read_only 103, everyday 41, full 109; cumulative 103/144/253). Every living statement in this catalog and the companion guides (README, OWNER-GUIDE, CLIENT-CONNECTIONS, DEPLOY, START-HERE, ARCHITECTURE, GO-LIVE-CHECKLIST) was re-checked against the shipped code: owner review/apply happens with `vercel_apply_owner_approval`, passes are issued with `vercel_issue_pass`, secrets are revealed with `vercel_reveal_one_time_secret`, credentials enroll at `/api/oauth/enroll`, and read-only is `vercel_set_read_only` — a switch on the user's own connection, never a sign-in class. Dated notes that describe the retired page remain as their dates' record and are closed by the AUD-AV note above and this one. The program's live evidence (both-address 404 on the deleted route, the authorize-page render, the read-only flip test, journal sampling) is owed at the next promotion and is listed, not claimed, on the AUD-AY card.

**AUD-BB working-box journaling (2026-10-31):** `vercel_set_working_box` now journals a confirmed mode flip to the change log, in the same handler shape AUD-AQ gave `vercel_set_read_only` — the gap AUD-AQ's card filed (the dossier's "journaled like the working-box flip" premise was off: the working-box flip wrote no row). Both posture flips now read back through `vercel_recent_changes`. No tool added, removed or renamed; the registry is unchanged at 253.

**AUD-BP branch-preview intent fix (2026-11-01):** `vercel_dev_preview_branch`'s apply() hashed `b.gitSha` into its dispatch-intent id, but its before() returns the commit under `sha` (and the `owned()` base carries neither), so `createHash().update(undefined)` threw `ERR_INVALID_ARG_TYPE` after the run checkpoint and before any provider call — the exact failure the 2026-11-01 live probe recorded against the deployed server (VMCP-016 branch G: run created, zero deployments, empty object inventory, cleanup refusing for want of recorded targets). apply() now reads `b.sha`, the key preview(), record() and the mutationId already used. No tool added, removed or renamed; no schema or described behavior changes — the row above already stated what this tool does, and the fix makes the code match it; the registry is unchanged at 253.
