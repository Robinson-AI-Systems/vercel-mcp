# Tool catalog

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
| `$` | Spends or raises spend: always `confirm`, dollar preview where Vercel states a price, counts toward the daily spend limit |
| `A` | Widens someone's access: always `confirm` |
| `1x` | Creates a secret, shown **once** on the setup page's one-time-secret page, never in a result |
| `G` | Guided: returns structured steps and checks the result by read-back; changes nothing itself |

Every write also passes **self-protection** (B-3): it is refused on a protected resource (this server's own Vercel
project, the other Robinson servers' projects, the token this server runs on) unless Chris edits the protected list on
the setup page.

**Aud.** (audience, contract §3): `B` builder · `O` owner · `Op` operator. **Prof.** lowest profile that has the tool:
`R` read_only · `E` everyday · `F` full (every read tool is in `R`). **App:** `y` = the project-profile guard (Batch P)
checks this tool against resources a profiled app owns; `—` = not applicable.

## Server about itself (`vercel_*`) — 19

| Tool | What it does | Safety | Aud. | Prof. | App | Card |
|---|---|---|---|---|---|---|
| `vercel_whoami` | Which team (or project-scoped account), connection mode (PREVIEW/PRODUCTION), profile, token scope, token last 4 and expiry, daily spend limit and used today | — | B O Op | R | — | A-5 built #15; B-8a built #24; B-8ba built #24; B-8ba built #24; B-8b |
| `vercel_list_accounts` | Show only the current authenticated connection's account and safe settings; global account management remains on owner setup | — | O | R | — | A-5 built #15; B-8 account isolation #28 |
| `vercel_set_default_account` | Propose changing the global default; exact target requires separate signed-in owner approval | P | O | F | — | B-8b built #38 |
| `vercel_check_token` | Re-probe the stored token with bounded GETs; report selected team/project read access, not expiry or write permissions | — | O | R | — | B-8b read-only built #26 |
| `vercel_list_connections` | Claude connections and passes: account, mode, profile, listing, last used, expiry | — | O | R | — | B-8 |
| `vercel_revoke_connection` | Propose revoking an exact current OAuth connector; independently authenticated owner must approve | C | O | F | — | B-8b built #40 |
| `vercel_enable_production` | Request a ten-minute team production approval; only owner passphrase reentry on setup can enable it | C | O | F | — | B-2 |
| `vercel_disable_production` | Disable team production access and revoke existing production-mode connector tokens | P | O | F | — | B-2 |
| `vercel_set_spend_limit` | Propose a tenant-scoped exact-cent daily limit for separate owner approval; no spending or default change | C | O | F | — | B-8b built #39 |
| `vercel_list_protected_resources` | Projects, domains and tokens this server refuses to change, and where Chris edits the list (setup page only) | — | O | R | — | B-3 | 
Protected-resource listings now include both global and team-scoped rules; the editor is additive-only under owner sign-in.

**B-8 close-out (#40):** All three B-8b MCP tools are guarded owner-approval proposals, not instant mutations. Default-account (#38), spend-limit (#39) and exact connector revoke (#40) require a separate owner setup session, CSRF, fresh passphrase and confirmation for any SQL change; no AI-supplied `confirm` authorizes applying the change. IN-07/IN-08 and production activation are unchanged.

**B-8b owner-request write-contract foundation (#37):** An MCP request is only an encrypted owner-approval proposal, never an account mutation. Account/connector targets use production and self-protection checks, durable replay and independently inspected envelopes; a verified proposal returns `awaiting_owner_approval` with `confirmed:false`. No named owner account mutation is registered in this foundation slice. The owner must separately review, confirm and reenter the passphrase on setup before any change. IN-07/IN-08 remain pending.

**B-8a account observability (built #24):** `vercel_list_connections` and `vercel_recent_changes` show only scoped, bounded metadata/safe audit summaries; `vercel_where_is_setting` gives guided dashboard navigation and clearly distinguishes manual vs future API verification. `vercel_whoami` warns of token expiry within fourteen days. Account changes remain B-8b.

**B-7 static safety gate (built #23):** The check-writes CI step cross-checks this catalog's Safety marks against every registered tool's read/write classification and write-contract flags, including production, targets, spend, access and one-time secrets. Adding an incompletely declared write now fails CI before merge.

**B-6 connection profiles (built #22):** The same fail-closed eligibility rules drive both MCP discovery and direct invocation, and the home page shows available tools by read-only, everyday and full profiles. The read-only profile has no write tools, including when an agent calls one by name. This is shared authorization infrastructure.

**B-5 output and secret handling (built #21):** Every MCP result passes recursive secret masking, bounding and Denver-local/money presentation; production mode receives a visible banner. Secrets are accepted only from owner one-use inputs or server-generated values; any created secret is stored encrypted and revealed only through setup. This is shared infrastructure, not a new published tool.

**B-4 error presentation (built #20):** Recognized provider failures return plain-language next actions. MCP results never echo raw upstream messages or credential-shaped labels; technical codes are allowlisted and rate-limit windows display in Denver time. This is shared error handling, not a new published tool.
| `vercel_recent_changes` | What was changed through this server (filter by tool, project, mode, date; previews hidden unless asked) | — | B O Op | R | — | B-8 |
| `vercel_undo_change` | Undo one change-log entry when it has a clean opposite; says plainly when it does not | C | Op | E | y | X-1 |
| `vercel_search_tools` | Search only the profile-eligible tools, with one-line safety classification | — | B O Op | R | — | C-2a built #44 |
| `vercel_describe_tool` | Describe one profile-eligible tool's arguments and safety rules | — | B O Op | R | — | C-2a built #44 |
| `vercel_call` | Call a profile-eligible tool through the same guarded MCP dispatcher | as the tool | B O Op | R | — | C-2b built #45 |
| `vercel_batch` | Preflight and dispatch up to 10 authorized reads; refuse mixed writes | — | B O Op | R | — | C-2b built #45 |
| `vercel_get_result` | Retrieve a 20-row page of the caller's scoped 24-hour sanitized result handle | — | B O Op | R | — | C-1 built #43 |
| `vercel_create_pass` | Make a short-lived pass for the HTTPS API and Robinson's Toolkit (preview, read-only, 24 h, $0 by default; RTC §2) | C A 1x | O | F | — | R-1 |
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
| `vercel_project_create` | Create empty unlinked projects at $0, or Git-linked imports after exact Vercel integration lookup, owner positive spend limit and production confirmation | $ Cp P | B O | E F | — | D-1 (built #65; shared Git identity #75; execution-time spend/Git recheck #80) |
| `vercel_project_update_settings` | Rename/framework plus grouped build/directory overrides (max 256 chars, null resets to defaults), guarded and independently verified; paid resources separate | Cp | B O | E | y | D-1 (partial #53; execution-time selected-config recheck #87) |
| `vercel_project_set_build_resources` | Build machine, concurrency and function compute options (billable); guarded resourceConfig PATCH uses owner-stored account limit, fails at $0, production confirmation and independent read-back | $ Cp | O | F | y | D-1 (built #64) |
| `vercel_project_delete` | Strict empty-project-only deletion: require full profile, production confirmation, typed name, complete scoped inventory and reread before DELETE; nonempty impact shown dry-run only (#77), execution blocked | D PR | O | F | y | D-1 (partial #60; deployments #69; strict inventory #73) |
| `vercel_project_pause` | Guarded pause of project production traffic; authenticated project state before and after, confirmation, production connection | PR | O Op | F | y | D-1 (built #58) |
| `vercel_project_unpause` | Guarded production resumption; authenticated state, full-profile production confirmation, metered usage warning | PR | O Op | F | y | D-1 (built #58) |
| `vercel_project_transfer` | Issue an owner-only encrypted one-time transfer claim code; never auto-completes ownership transfer | A D PR 1x | O | F | y | D-1 (partial #62) |
| `vercel_project_list_members` | Project-level members and their project roles | — | O | R | — | D-1 (built #48; pagination #74) |
| `vercel_project_add_member` | Give an existing team user a project role by UID (no new seat or team invite) | A | O | F | — | D-1 (built #54; ADMIN gated #66; contributor #67; paged #70; apply-time recheck #78; concurrent-role defense #86) |
| `vercel_project_remove_member` | Remove viewer/developer project role by UID; admin/owner/final member removal remains blocked | C | O | F | — | D-1 (partial #55; team identity #68; paged #70; immediate execution recheck #79) |
| `vercel_cron_list` | Cron jobs as deployed to production: path, schedule (UTC and Denver time), enabled, from the production deployment's configuration | — | Op | R | y | D-1 (built #50) |
| `vercel_git_list_namespaces` | Git accounts/orgs the team's Git connection can see (GitHub, GitLab, Bitbucket) | — | B | R | — | D-1 (built #49) |
| `vercel_git_search_repos` | Repositories in a Git namespace, for creating a project from one | — | B | R | — | D-1 (built #49; namespace proof #72) |

## Deployments: reads, logs and checks (`vercel_deploy_*`, `vercel_check_*`) — 10

| Tool | What it does | Safety | Aud. | Prof. | App | Card |
|---|---|---|---|---|---|---|
| `vercel_deploy_list` | Deployments by project, target (production/preview/custom), state, branch, commit, creator, time window | — | B Op | R | — | D-2 |
| `vercel_deploy_get` | One deployment by ID or URL: state, target, commit, branch, aliases, error in plain words, build time | — | B Op | R | — | D-2 |
| `vercel_deploy_get_build_logs` | Build log for a deployment: summary by default (steps, warnings, first error), full text behind a handle | — | B Op | R | — | D-2 |
| `vercel_deploy_get_runtime_logs` | Runtime (function) logs for a deployment, filtered by level, path, status and time | — | B Op | R | — | D-2 |
| `vercel_deploy_list_files` | Files in a deployment's output | — | B | R | — | D-2 |
| `vercel_deploy_get_file` | One file's contents from a deployment (size-capped; key-shaped strings hidden) | — | B | R | — | D-2 |
| `vercel_deploy_wait` | Wait up to 45 seconds for a deployment to finish; returns the state and how to keep waiting | — | B Op | R | — | D-2 |
| `vercel_check_list_runs` | Check runs attached to a deployment (Checks V2) with conclusions | — | B Op | R | — | D-2 |
| `vercel_check_get_run` | One check run with its output | — | B Op | R | — | D-2 |
| `vercel_check_list_project_checks` | The checks configured for a project | — | B O | R | — | D-2 |

## Deployments: changes (`vercel_deploy_*`) — 5

| Tool | What it does | Safety | Aud. | Prof. | App | Card |
|---|---|---|---|---|---|---|
| `vercel_deploy_create_from_git` | Deploy a branch or commit; preview unless `target: production` | Cp | B Op | E | y | D-3 |
| `vercel_deploy_create_from_files` | Deploy a small set of files sent inline (≤2 MB total, e.g. a static page an agent built); preview unless production | Cp | B | E | y | D-3 |
| `vercel_deploy_redeploy` | Rebuild an existing deployment (same commit); keeps its original target; optional build-cache skip | Cp | Op | E | y | D-3 |
| `vercel_deploy_cancel` | Cancel a deployment still building | Cp | B Op | E | y | D-3 |
| `vercel_deploy_delete` | Delete a deployment (refused for the one currently serving production) | D Cp | Op | F | y | D-3 |

## Releases: promote, rollback, aliases, rolling releases — 12

| Tool | What it does | Safety | Aud. | Prof. | App | Card |
|---|---|---|---|---|---|---|
| `vercel_deploy_promote` | Point production traffic at a ready deployment; preview shows what is live now and what will be | PR | Op | E | y | D-4 |
| `vercel_deploy_rollback` | Point production back at an earlier production deployment (instant rollback), with a reason note | PR | Op | E | y | D-4 |
| `vercel_deploy_list_promote_aliases` | Which production aliases moved (or are still moving) during the last promote or rollback | — | Op | R | — | D-4 |
| `vercel_alias_list` | Aliases (custom URLs) by project or deployment | — | B Op | R | — | D-4 |
| `vercel_alias_get` | One alias and the deployment it points to | — | B Op | R | — | D-4 |
| `vercel_alias_assign` | Point an alias at a deployment (production when the alias is a production domain) | Cp | B Op | E | y | D-4 |
| `vercel_alias_delete` | Remove an alias | D Cp | Op | F | y | D-4 |
| `vercel_rolling_get` | Rolling-release settings, the active release and its stage, and billing status | — | Op | R | — | D-4 |
| `vercel_rolling_update_config` | Turn rolling releases on/off for a project and set stages (may be billed) | PR $ | O | F | y | D-4 |
| `vercel_rolling_start` | Start a rolling release of a deployment | PR | Op | E | y | D-4 |
| `vercel_rolling_approve_stage` | Move the active rolling release to its next stage | PR | Op | E | y | D-4 |
| `vercel_rolling_complete` | Finish the rolling release (100% of traffic) | PR | Op | E | y | D-4 |

## Environment variables (`vercel_env_*`) — 9

No tool ever returns an environment variable's value, whatever its type (`docs/designs/BATCH-E.md` E1). Values go in;
names, targets, kind (Config/Secret), branch and dates come out.

| Tool | What it does | Safety | Aud. | Prof. | App | Card |
|---|---|---|---|---|---|---|
| `vercel_env_list` | Variables of a project: key, targets, kind, branch, custom environments, created/updated — never values | — | B O Op | R | y | E-1 |
| `vercel_env_get` | One variable's metadata (never the value) | — | B Op | R | y | E-1 |
| `vercel_env_set` | Create or change one variable for chosen targets; value from the call (non-secret only), `generate`, or a value Chris pasted on the setup page | Cp | B Op | E | y | E-1 |
| `vercel_env_set_many` | Same for up to 50 variables, one preview of all | Cp | B Op | E | y | E-1 |
| `vercel_env_delete` | Remove one variable (from some targets or all) | D Cp | Op | E | y | E-1 |
| `vercel_env_delete_many` | Remove several variables, one preview of all | D Cp | Op | F | y | E-1 |
| `vercel_env_copy` | Copy variables to other targets, branches or projects, server-side (Secret-kind values cannot be copied; it says so) | Cp | Op | E | y | E-1 |
| `vercel_env_compare` | Which keys exist in which targets/projects, and whether two copies hold the same value (compared on the server, never shown) | — | B Op | R | y | E-1 |
| `vercel_env_export_names` | A `.env.example`-style list of names per target (no values) for a codebase | — | B | R | — | E-1 |

## Shared variables and custom environments (`vercel_shared_env_*`, `vercel_environment_*`) — 7

| Tool | What it does | Safety | Aud. | Prof. | App | Card |
|---|---|---|---|---|---|---|
| `vercel_shared_env_list` | Team-level shared variables and which projects they are linked to (never values) | — | O Op | R | — | E-2 |
| `vercel_shared_env_set` | Create or change a shared variable and its project links | Cp | O | F | y | E-2 |
| `vercel_shared_env_delete` | Delete a shared variable, or unlink it from one project | D Cp | O | F | y | E-2 |
| `vercel_environment_list` | Custom environments of a project (e.g. staging) with branch tracking and domains | — | B O | R | — | E-2 |
| `vercel_environment_create` | Add a custom environment (branch rule, copy variables from another environment) | P | B O | E | — | E-2 |
| `vercel_environment_update` | Change a custom environment's name, branch rule or description | P | B O | E | — | E-2 |
| `vercel_environment_delete` | Remove a custom environment | D | O | F | y | E-2 |

## Global Config (formerly Edge Config) (`vercel_globalconfig_*`) — 11

| Tool | What it does | Safety | Aud. | Prof. | App | Card |
|---|---|---|---|---|---|---|
| `vercel_globalconfig_list` | Stores, their size, item count, connected projects, backups available | — | B Op | R | — | E-3 |
| `vercel_globalconfig_create` | New store | P | B | E | — | E-3 |
| `vercel_globalconfig_delete` | Delete a store (refused while connected to a live project unless confirmed as production) | D Cp | O | F | y | E-3 |
| `vercel_globalconfig_list_items` | Items in a store (keys and values; values are configuration, key-shaped strings hidden) | — | B Op | R | — | E-3 |
| `vercel_globalconfig_patch_items` | Create, update or delete items in one batch (live projects read them immediately) | Cp | B Op | E | y | E-3 |
| `vercel_globalconfig_create_token` | Read token for a store, shown once on the setup page | C 1x | B | F | — | E-3 |
| `vercel_globalconfig_restore_backup` | Restore a store to a backup version (newest before a time, or by version) | Cp | Op | E | y | E-3 |
| `vercel_globalconfig_list_tokens` | Read tokens of a store: label, ID, created — never the token itself | — | B O | R | — | E-4 |
| `vercel_globalconfig_revoke_tokens` | Revoke one or more read tokens (apps still using them stop reading the store; preview names the connected projects) | D Cp | O | F | y | E-4 |
| `vercel_globalconfig_get_schema` | The JSON schema a store's items must match (or "none") | — | B Op | R | — | E-4 |
| `vercel_globalconfig_set_schema` | Set, replace or remove a store's JSON schema; preview checks the current items against it and lists any that would no longer match | Cp | B O | E | y | E-4 |

## Developer tools (`vercel_dev_*`) — 17 (preview only; `docs/designs/BATCH-V.md`)

Building with Vercel on any project. Every tool refuses production targets before reading anything (contract §10), and
everything it creates is recorded in a run and tagged where Vercel allows (`rtc_run` in deployment meta and env comments).

| Tool | What it does | Safety | Aud. | Prof. | App | Card |
|---|---|---|---|---|---|---|
| `vercel_dev_seed` | Create a scratch project from a named scenario (static site, Next.js hello, API function, cron demo) with a first preview; recorded in a run | P | B | E | — | V-1 |
| `vercel_dev_list_runs` | Runs and exactly what each created | — | B | R | — | V-1 |
| `vercel_dev_cleanup` | Remove exactly what a run created (preview deployments, preview variables, aliases, bypass secrets, scratch projects, sandboxes) | C | B | E | y | V-1 |
| `vercel_dev_preview_branch` | Deploy a preview of a branch (or commit) for a run; never production; respects a profile's no-preview branches | P | B | E | y | V-2 |
| `vercel_dev_wire_preview_env` | Set preview-only (optionally branch-only) variables for a feature; values never echoed; recorded for cleanup | P | B | E | y | V-2 |
| `vercel_dev_alias_preview` | Give a preview a stable `<name>.vercel.app`-style alias; refuses production domains | P | B | E | y | V-2 |
| `vercel_dev_create_bypass` | A protection-bypass secret for automated tests of protected previews, shown once; revoked by cleanup | C A 1x | B | E | y | V-2 |
| `vercel_dev_tail_logs` | New build and runtime log lines for a preview since the last call (cursor), compact | — | B | R | — | V-3 |
| `vercel_dev_diagnose_build` | Why a preview build failed: first error, likely cause (missing variable, Node version, install, type error, memory, ignored step) and the fix | — | B | R | — | V-3 |
| `vercel_dev_fetch_preview` | Fetch paths on a preview (bypass applied server-side): status, timing, headers, first 4 KB each — a quick smoke test | — | B | R | — | V-3 |
| `vercel_dev_check_integration` | Is a project set up for the app being built: variable names per target, domains, crons, protection/bypass, Node version, integrations — exact steps for gaps | — | B | R | y | V-3 |
| `vercel_dev_sandbox_create` | Start a Vercel Sandbox session (optionally from a Git repo/branch) for a run; counts toward the sandbox-minutes limit | P | B | E | — | V-4 |
| `vercel_dev_sandbox_run` | Run a command in a sandbox session; output summarized, full output behind a handle | P | B | E | — | V-4 |
| `vercel_dev_sandbox_write_files` | Write files into a sandbox session | P | B | E | — | V-4 |
| `vercel_dev_sandbox_read_file` | Read a file from a sandbox session (size-capped) | — | B | R | — | V-4 |
| `vercel_dev_sandbox_stop` | Stop a sandbox session now | P | B | E | — | V-4 |
| `vercel_dev_send_test_webhook` | Send a correctly signed sample Vercel webhook event (deployment created/succeeded/error, project created…) to an app under development | P 1x | B | E | — | V-5 |

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
| `vercel_cert_list` | Certificates: domains covered, issuer, expiry, auto-renewing | — | O Op | R | — | N-2 |
| `vercel_cert_issue` | Ask Vercel to issue (or re-issue) a certificate for domains | PR | O Op | E | — | N-2 |
| `vercel_cert_remove` | Remove a certificate | D PR | O | F | y | N-2 |

Not built: certificate **upload** (the API takes a private key; a private key never passes through chat) — guided.

## Domain registrar (`vercel_registrar_*`) — 9

| Tool | What it does | Safety | Aud. | Prof. | App | Card |
|---|---|---|---|---|---|---|
| `vercel_registrar_search` | Is a name available, and its price; suggestions across TLDs | — | O | R | — | N-3 |
| `vercel_registrar_get_price` | Purchase, renewal and transfer price for a domain or TLD, for N years | — | O | R | — | N-3 |
| `vercel_registrar_buy` | Buy a domain: preview shows the exact price, years, auto-renew and contact details; confirm; counts toward the spend limit | $ | O | F | — | N-3 |
| `vercel_registrar_renew` | Renew a domain for N years at the stated price | $ | O | F | — | N-3 |
| `vercel_registrar_set_auto_renew` | Turn auto-renew on (future charge: `$`) or off (risk of losing the domain: `C`) | $ / C | O | F | — | N-3 |
| `vercel_registrar_transfer_in` | Transfer a domain in from another registrar (auth code pasted on the setup page, never in chat) | $ | O | F | — | N-3 |
| `vercel_registrar_get_status` | An order's, a transfer's or contact verification's status | — | O | R | — | N-3 |
| `vercel_registrar_get_auth_code` | The code to transfer a domain away, shown once on the setup page | C PR 1x | O | F | y | N-3 |
| `vercel_registrar_update_nameservers` | Point a Vercel-registered domain at other nameservers (moves DNS and email away from Vercel) | D PR | O | F | y | N-3 |

## Deployment protection (`vercel_protection_*`) — 8

| Tool | What it does | Safety | Aud. | Prof. | App | Card |
|---|---|---|---|---|---|---|
| `vercel_protection_get` | Vercel Authentication, password protection, trusted IPs, options allowlist and their scope; bypass secrets (notes only) | — | O Op | R | — | F-1 |
| `vercel_protection_set_vercel_auth` | Turn Vercel Authentication on/off and set its scope (previews only, all except custom domains, all) | PR (A when loosening) | O | F | y | F-1 |
| `vercel_protection_set_password` | Password protection on/off and scope; the password is typed on the setup page, never in chat | PR (A when loosening) | O | F | y | F-1 |
| `vercel_protection_set_trusted_ips` | Allowed IP ranges and scope | PR A | O | F | y | F-1 |
| `vercel_protection_list_bypass` | Protection-bypass secrets: note, created, which one is `VERCEL_AUTOMATION_BYPASS_SECRET` (never the secret) | — | B O | R | — | F-1 |
| `vercel_protection_create_bypass` | New bypass secret for automation (shown once on the setup page) | PR A 1x | O | F | y | F-1 |
| `vercel_protection_revoke_bypass` | Revoke a bypass secret (deployments built with it stop bypassing) | PR | O | F | y | F-1 |
| `vercel_alias_set_shareable_link` | Make or revoke a shareable link for one protected URL (the link is shown once on the setup page) | A 1x | O Op | E | y | F-1 |

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
| `vercel_webhook_create` | New webhook (Pro/Enterprise); its signing secret shown once on the setup page | C 1x | O B | F | — | M-2 |
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
reaches only the stores Chris connected on the setup page (IN-15); file contents are never returned, only metadata.

| Tool | What it does | Safety | Aud. | Prof. | App | Card |
|---|---|---|---|---|---|---|
| `vercel_blob_list` | Files in a connected store: pathname, size, content type, uploaded; prefix filter and pages; folder summary by default | — | B O Op | R | y | M-4 |
| `vercel_blob_head` | One file's metadata (size, type, uploaded, cache settings) without downloading it | — | B Op | R | — | M-4 |
| `vercel_blob_put` | Upload one small file (≤4 MB, sent inline) to a connected store; refuses to overwrite unless asked; a store connected to a live project counts as production | Cp | B | E | y | M-4 |
| `vercel_blob_delete` | Delete named files (≤100 per call; no wildcards); preview lists each file and size; refused on a profiled app's store without `outsideApp` | D Cp | O Op | F | y | M-4 |

## Owner: team and security settings (`vercel_team_*`) — 7

| Tool | What it does | Safety | Aud. | Prof. | App | Card |
|---|---|---|---|---|---|---|
| `vercel_team_list` | Teams the token can see | — | O | R | — | O-1 |
| `vercel_team_get` | Team profile, plan name, security settings, default protection, retention, remote caching | — | O | R | — | O-1 |
| `vercel_team_update_profile` | Name, slug (6 changes a week; changes URLs), description, preview deployment suffix | C | O | F | — | O-1 |
| `vercel_team_update_security` | SAML enforced, IP addresses hidden in logs, verified commits required, separate production secret values, strict protection settings, email-domain auto-join | C (A when loosening) | O | F | — | O-1 |
| `vercel_team_set_default_protection` | Default deployment protection for new projects | C (A when loosening) | O | F | — | O-1 |
| `vercel_team_set_deployment_retention` | How long deployments are kept, per target (shortening deletes old deployments) | C D | O | F | y | O-1 |
| `vercel_team_set_directory_role_mappings` | Directory-sync (SAML) group → role mappings (Enterprise) | C A | O | F | — | O-1 |

## Owner: members and access groups (`vercel_member_*`, `vercel_access_group_*`) — 10

| Tool | What it does | Safety | Aud. | Prof. | App | Card |
|---|---|---|---|---|---|---|
| `vercel_member_list` | Members, roles, joined, two-step login if Vercel reports it, pending invites | — | O Op | R | — | O-2 |
| `vercel_member_invite` | Invite someone by email with a role (a message to a person; paid roles add a seat — dollar preview) | A $ | O | F | — | O-2 |
| `vercel_member_update_role` | Change a member's role (widening: `A`; to a paid role: `$`) | C A $ | O | F | — | O-2 |
| `vercel_member_remove` | Remove a member from the team (refused for the token owner and the last Owner) | D C | O | F | — | O-2 |
| `vercel_member_revoke_invite` | Cancel a pending invite code | C | O | F | — | O-2 |
| `vercel_access_group_list` | Access groups (Enterprise) with member and project counts | — | O | R | — | O-2 |
| `vercel_access_group_get` | One access group: members, projects and project roles | — | O | R | — | O-2 |
| `vercel_access_group_create` | New access group with members and project roles | A | O | F | — | O-2 |
| `vercel_access_group_update` | Change an access group's name, members or project roles | A | O | F | — | O-2 |
| `vercel_access_group_delete` | Delete an access group | D C | O | F | — | O-2 |

## Owner: access tokens (`vercel_token_*`) — 3

| Tool | What it does | Safety | Aud. | Prof. | App | Card |
|---|---|---|---|---|---|---|
| `vercel_token_list` | Access tokens of the token's user: name, scope (team/project), created, expires, last used — never values | — | O | R | — | O-3 |
| `vercel_token_create` | New team- or project-scoped token with an expiry (required, ≤1 year); shown once on the setup page | C A 1x | O | F | — | O-3 |
| `vercel_token_delete` | Revoke a token (refused for the token this server runs on) | D C | O | F | — | O-3 |

## Owner: billing, usage and activity (`vercel_billing_*`, `vercel_activity_*`) — 4

| Tool | What it does | Safety | Aud. | Prof. | App | Card |
|---|---|---|---|---|---|---|
| `vercel_billing_list_charges` | Billing charge lines (FOCUS format) for a period, by service, project and resource, in dollars and cents | — | O | R | — | O-4 |
| `vercel_billing_list_commitments` | Contract commitments (Enterprise) and their draw-down | — | O | R | — | O-4 |
| `vercel_billing_summary` | This billing period so far: total, by service and project, against the Pro monthly credit; top cost drivers | — | O | R | — | O-4 |
| `vercel_activity_list` | Team activity log (who did what, when): deployments, settings, members, env changes | — | O Op | R | — | O-4 |

## Owner: administration (`vercel_admin_*`, guided settings) — 5 tools + guided settings

For the account owner, not only developers. Settings with an API are real tools (here and in every area above); every
dashboard-only setting is a **guided setting** — structured steps a person or a browser-capable agent follows while Chris
watches, then checked by read-back where Vercel exposes the value (contract §11).

| Tool | What it does | Safety | Aud. | Prof. | App | Card |
|---|---|---|---|---|---|---|
| `vercel_admin_overview` | The whole team in one view: plan, members and roles, tokens and expiry, security settings, default protection, domains and renewals, certificates, spend so far, integrations, webhooks and drains, plus every guided setting's state (ok / needs attention / can't read) | — | O | R | — | O-5 |
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
automated — steps only); viewing an environment variable's value (setup page, passphrase).

## Project profiles (`vercel_profile_*`, readiness and setup) — 5

| Tool | What it does | Safety | Aud. | Prof. | App | Card |
|---|---|---|---|---|---|---|
| `vercel_profile_list` | Project profiles: which apps manage their own Vercel resources and what each owns | — | B O | R | — | P-1 |
| `vercel_profile_get` | One profile in full (owned variables, domains/DNS, stores, release rule, crons, no-preview branches) | — | B O | R | — | P-1 |
| `vercel_profile_draft` | Turn codebase findings (`vercel.json`, env names, crons, scripts) into a draft profile and `APP-NEEDS-<APP>.md` text; never fetches code | — | B | R | — | P-3 |
| `vercel_workflow_app_readiness` | Every row of a profile (or an inline spec) checked: done / fixed with confirm / needs you (steps) / needs a decision (`IN-xx`) | — (fixes: as the tool used) | B O | R | y | P-2 |
| `vercel_workflow_project_setup` | Set up Vercel for a new project from a short description: project, framework, variable names, domains, protection, preview rules; previewed first; idempotent | P (C for production parts) | B O | F | — | P-3 |

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

## Everything else in Vercel: the universal tools (`vercel_api_*`) — 4

The hand-built tools are the comfortable, plain-English way to do the common jobs. These four reach **every operation in
Vercel's REST API** (438 on 2026-10-10: feature flags, KMS, Vercel CI, container registry, AI Gateway, Connect,
microfrontends, Remote Cache, Marketplace provider operations, and whatever Vercel adds), validated against the vendored
OpenAPI snapshot. The server never guesses an operation or a parameter.

| Tool | What it does | Safety | Aud. | Prof. | App | Card |
|---|---|---|---|---|---|---|
| `vercel_api_search` | Find Vercel operations by plain words: method, path, one-line summary, and whether it reads, changes, spends or returns a secret | — | B O Op | R | — | U-1 |
| `vercel_api_describe` | Parameters for one operation, trimmed to what matters, from the OpenAPI snapshot | — | B O Op | R | — | U-1 |
| `vercel_api_read` | Any GET operation, with the same summaries, `fields`, size cap and handles as every other read; secret-returning operations refused | — | B O Op | R | — | U-1 |
| `vercel_api_write` | Any POST/PUT/PATCH/DELETE operation through the full safety layer: always `confirm`; spend table; production detection; hand-built tools win | C (always) | B O Op | F | y | U-1 |

How `vercel_api_write` stays safe (details `docs/designs/BATCH-U.md`): always `confirm`, supports `dryRun`; spend
detection from a table (`src/vercel/spend-operations.js`) with a safe default (unknown operations whose summary says buy,
purchase, renew, upgrade, credits or billing are treated as spend); production detection from the target (B2); secret
rule (operations that return or take credentials are refused and named); hand-built tools win (refused, naming the
tool); self-protection and profile guards apply; read-back when the response has an ID; change log; `full` profile only;
passes need `allow_writes`.

## Things Vercel has no API for

Handled by `vercel_where_is_setting`, never faked: see "Guided settings covered" above. For each it returns the exact
dashboard link and numbered clicks as structured steps, so an agent with a browser can carry them out with Chris
watching, and the server checks the result where Vercel lets it read the value back (for example production branch
tracking is readable as the project's `link.productionBranch`; Spend Management is not readable — Chris says when done).

## Totals

Counted by `python3` over this file's tables (one row = one tool; rows naming two tools do not exist in this catalog):

| Section | Tools | Batch |
|---|---|---|
| Server about itself | 19 | A, B, C, R, X, O |
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
| Owner: team and security settings | 7 | O |
| Owner: members and access groups | 10 | O |
| Owner: access tokens | 3 | O |
| Owner: billing, usage and activity | 4 | O |
| Owner: administration | 5 | O |
| Project profiles | 5 | P |
| Workflows | 12 | W |
| **Hand-built total** | **232** | |
| Universal tools | 4 | U |
| **All tools** | **236** | |

Per batch, by the card that first builds each tool: A 2 · B 10 · C 5 · D 42 · E 27 · V 17 · N 29 · F 27 · M 25 ·
O 29 · P 5 · W 12 · U 4 · R 1 · X 1 (= 236). By lowest profile: `read_only` 103, `everyday` 160 (103 + 57), `full` all 236
(B-6 prints the exact counts from the registry). In compact mode (`docs/designs/BATCH-C.md`) an agent loads about 20
tools up front and reaches the rest through `vercel_search_tools` / `vercel_call`.

**C-1b common result summaries (#42):** Reusable summary/field projection utilities now available to future provider tool cards. Secret-value keys are omitted even at full detail and unknown selectors are reported. No new MCP tool was registered in this slice; the result handle and default dispatcher integration belong to C-1c.

**C-1 safe result layer (#41–#43):** Read tools get centrally advertised `fields/detail` options and read-only/idempotent annotations. Over-8KB outputs produce a one-bearer scoped, 24-hour, 20-row paged handle instead of silent truncation; secret values cannot be recovered at full detail. Future workflows own their structured output schemas.

## Authenticated write classification (security fix #56)

Routine provider writes are admitted only if their frozen `writeContract` originates in the registered `defineWrite` spec and the handler was created by `bindGuardedWrite` for that same spec; the registry rejects spoofed metadata at startup. `vercel_call` inherits the identical guarded dispatcher. The MCP public catalog deliberately strips internal `writes`, `guardedWrite` and contracts, but derives `readOnlyHint: false` and `idempotentHint: false` from the original authenticated metadata before stripping them. It must not inject read-specific `fields`/`detail` into any write schema. Per-provider-mutation transport replay keys are distinct within one logical write (operation, canonical parameters and stable optional discriminator). This is a safety-catalog note, not a new tool or expanded permission.
