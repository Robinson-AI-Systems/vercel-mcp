# Reusable developer connection — owner authorized 2026-10-13

## Outcome and boundary
Let the implementing agent connect once, retain its developer authorization securely,
refresh access and run approved tests without repeated owner-page pass creation or copying.
This does not restrict the production MCP catalog, supported operations or runtime profiles.
Development authority applies to the implementing/testing agent and approved test resources;
it is not a blanket read_only restriction on the finished product. Full test profiles remain
available for genuine fixture writes; independent money-out, paid capacity, live activation,
production data destruction and resource-isolation gates remain unchanged.

## Integration and acceptance
- Reuse native OAuth code + S256 PKCE, existing owner consent and refresh/revocation logic.
- Mobile owner opens one prefilled link; no bearer or account ID copied through chat.
- Credentials remain in protected client storage, never MCP tool results or instructions.
- Expired access refreshes within the existing grant; revoked/invalid grants require consent.
- Each standalone service remains usable without Hub; rtool manages multiple connections.
- Native MCP testing uses the connected developer principal and existing write guards.
- Separate source, offline tests, deployed revision and real provider/scratch acceptance.

## Resume
Implemented mobile PKCE/RSA authorization handoff in each standalone service and native
rtool OAuth connection/refresh/check/call commands in Hub's CLI. Product catalog/profile
filters unchanged. New service-owned developer_oauth_handoffs table is additive and lazily
initialized by the developer endpoint, separate from native provider/account storage.
Unit/CLI tests run locally; SQL race/expiry tests require disposable CI Postgres.
CI provenance guard separates standard connectors and custom-service proof. Exact-head CI,
reviewed deployment, initial owner consent and real provider/scratch acceptance pending.

## Role-drift and completion review
Read docs/reviews/2026-10-13-completion-recovery.md. Review the actual source/index
before extending scope: preserve full product capability, isolate builder permission,
use the native custom service for acceptance, and finish finite supported workflows.

## Connection review corrections — 2026-10-13

Authenticated polling retries return the same encrypted authorization code until the
original request expires; native OAuth token exchange remains single use. The trusted
service client-IP helper and atomic per-IP SQL counter enforce concurrent start quotas.
Backend outages return retryable 503 instead of malformed-request 400. Native 32-character
Google authorization codes are accepted. Since AUD-AW (2026-10-31) the handoff
requests the standard connection only: a start carries no profile or listing
field (one is refused as an unknown key), the authorize request the handoff
builds sets neither, and consent derives both values exactly as it does for
any other sign-in — there is no developer sign-in class.

Evidence must explicitly track all eight layers exactly once. Deployment-provider metadata
can prove only deployment; runtime acceptance must use the actual custom-service transport.
Full provider acceptance includes permitted reads/writes, resource and identity denial, and
provider readback. Schema validity alone supplies none of these observations.

Regression tests cover these failures; exact PR CI and real provider acceptance are separate.

Follow-up review: completed handoffs remain immutable until expiry even if another process
starts setup for the same client. Hub acceptance requires a Hub-mediated RTC route and
its readback; standalone MCP initialization or a bare service RTC request is insufficient.

## Agent connection recovery when private plugin tools are absent

The owner's phone/Android client is not a reason to repeat provider setup or to stop
custom-service acceptance. A private plugin's tools being absent from this conversation
is distinct from missing provider credentials, expired access tokens, revoked service
grants and a runtime that cannot issue HTTPS requests.

1. Read this card and inspect this conversation's actual terminal/HTTP capabilities.
   If a native custom-service tool is callable, use it. Otherwise use the existing
   rtool native developer client against this service's verified deployed OAuth/MCP origin.
   A cloud agent runtime can do this while the owner stays on mobile; the owner's PC
   is not the runner. Standard provider connectors remain infrastructure tools only.
2. The shared client is in Robinson-AI-Systems/robinsons-toolkit-hub:
   packages/cli/bin/rtool.js and packages/cli/src/{developer-client,developer-vault,developer-checkpoint}.js.
   Configure RTOOL_SERVERS with this service's alias and independently verified exact
   origin; use OS keychain storage or RTOOL_DEVELOPER_VAULT_DIR in a private non-Git directory.
   Run developer-check, developer-tools and developer-call using the syntax below.
   These developer commands call the standalone service directly; they do not require
   Hub federation to be finished.
3. For the coordinating Repo Management runner, six saved native grants are retained in
   the existing Hub project's Development-only encrypted RTOOL_BUILDER_SESSION checkpoint.
   Retrieve only that named secret through authorized Vercel control-plane tools,
   privately restore an empty vault with restoreDeveloperCheckpoint and exact-origin
   validation, then saveDeveloperCheckpoint after token changes and before stopping.
   Never print, commit, attach, place in Library or send credential values to another chat.
   See Hub's DEVELOPER-CONNECTION card for the existing recovery procedure.
4. **One serialized runner owns that checkpoint.** It is not a concurrent shared token
   pool. Do not restore stale checkpoint copies over newer local credentials or run
   independent agents against the same rotating refresh tokens. A different agent
   coordinates acceptance with that runner, or uses its own separately authorized grant.
   Persist approved test evidence in the relevant repository so implementing agents can
   use it without receiving credentials.
5. Expired access normally renews with the saved refresh grant. An authentication failure
   alone does not prove owner consent is lost: check exact origin, deployment protection,
   saved record freshness and refresh outcome first. Avoid testing renewal by setting the
   client clock in the future against a live server: that can save an inaccurate expiry.
   If a saved access expiry is known stale, renew through developerAccess using actual
   current time and persist the replacement. Never replay a possibly executed mutation.
   Request new consent only after a genuine revoked/invalid grant or added authority is proved.
6. If this particular conversation has neither native custom tools nor an HTTPS-capable
   execution runtime, report that specific limit and coordinate the required run/evidence
   with the existing runner. Do not ask the mobile owner to install a desktop plugin,
   copy passes, reconnect the underlying provider, or certify a test the agent cannot run.

Commands below run from a checkout of the shared Hub CLI, with this service's exact
origin and protected vault configured. rtool can also be used when installed. The CLI
server alias must match the existing saved record; a renamed alias is a different record.
Deployment protection, where present, requires its authorized exact-origin access
in addition to service OAuth; do not disable protection or switch to a convenient alias.

```sh
node packages/cli/bin/rtool.js developer-check vercel
node packages/cli/bin/rtool.js developer-tools vercel
node packages/cli/bin/rtool.js developer-call vercel vercel_whoami --args '{}'
```

Initialize/tool discovery/identity, provider reads, fixture writes/readback/cleanup,
scope denial, renewal/revocation and Hub federation are separate evidence. Record
the exact deployed revision/origin before claiming real acceptance. Successful standard
connectors, source CI, mock providers or another service's connection prove none of
this server's independent acceptance. Preserve its complete product catalog and all
existing operation-specific approval/isolation/spending gates.

### This repository's purpose and first identity check

Vercel teams, projects, deployments, files, logs and configuration. Verify team/project authority; use approved nonproduction deployment fixtures for acceptance; preserve production and spending gates.

Use `vercel_whoami` through this service's own saved `vercel` grant. The six connections were directly rechecked by the coordinating runner on October 13, 2026; all six authenticated initialize requests succeeded without desktop plugin activation. That transport observation does not complete this repository's provider/write/RTC/Hub acceptance. Current grants were saved after renewal; reverify actual identity, scope and deployed revision on the next run.
