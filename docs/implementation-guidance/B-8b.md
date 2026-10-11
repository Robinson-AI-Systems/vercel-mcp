# Worked example — next eligible B-8b account controls

Planning guidance, **not an execution card or implementation**. Baseline: [inspection](README.md).
Read `docs/pr-cards/B-8.md` remaining scope, BATCH-B B8/§4 B-8, B2/B3/B4 and OWNER-INPUTS IN-07/IN-08.
Write the actual JIT card before coding. Preserve B-8 IN_PROGRESS until all four remaining tools and owner controls pass.

## 1. Evidence and dependencies

| Existing behavior | Reuse / implication |
|---|---|
| `vercel_accounts.is_default`, `spend_limit_cents`, `token_checked_at`, `token_probe` exist | No need to invent a second account/settings table for these fields |
| `createVercelLoginService(db).listAccounts()` orders default first through `db.listVercelAccounts()` | Default changes account ordering; issued OAuth account/mode/profile/listing stay fixed |
| `getAccountCredential(id)` + `loadToken({db,accountId,env})` decrypt internally | Re-probe never accepts or returns the Vercel token in args |
| `probeToken({token,teamId,projectId,allowFull,fetchImpl,baseUrl})` makes three GETs | Access proof only; not exhaustive permission/expiry proof; no automatic widening |
| `listAccountConnections({account,...})` generates `conn_` + first 20 hex of md5(token_hash) | Ref changes on refresh rotation; treat stale ref as missing, never fallback to client ID/all connections |
| `revokeAccessToken(raw)` exists; `revokeProductionTokens(account)` revokes all production rows | Neither is target-specific opaque-ref revocation; do not misuse either |
| `requireMcpToken` exposes no owner ID, connection ref or token hash | `full`/`clientId` are not proof of owner or stable self-connection identity |
| Setup authenticates owner session + CSRF + passphrase reentry for sensitive changes | Exact pattern in `handleSetup` approve_production/add_protected branches |
| `defineWrite` uses before/preview/apply/verify; MCP ctx is only `{connection,db}` | New executor composition must supply mandatory guards/audit/replay/shaper; no allowlist-only bypass |

Before coding owner mutations, record a **dated proposed amendment** in BATCH-B for how owner proof and last-owner /
server-connection protection work. Existing code lacks those identities. The reviewed amendment must state what is
protected, how identity survives refresh, and how overlapping revokes cannot defeat last-owner protection. Do not
invent an `isOwner` request argument or count `full` connections as authenticated owners. Leave unverifiable mutations
fail-closed while implementing independent pieces. This guide does not approve a policy/default change.

## 2. Exact boundary mappings to put in the JIT card

All new names below are **proposed**, absent today. Validate actual chosen names at the implementation boundary.

| Tool / proposed input | Existing columns/API | Before → independent verification | Forbidden side effects |
|---|---|---|---|
| `vercel_set_default_account({account,confirm,dryRun})` | `vercel_accounts.id/is_default`; proposed `setDefaultAccount({account})` | Connected target exists; safe prior default → exactly one selected default, others false, account list order changes | No provider write, issued bearer/refresh settings change, production enable, spend change |
| `vercel_check_token({})` for current account | Internal `loadToken` → probe GET `/v2/user`, `/v2/teams`, `/v10/projects` (`limit:100`, injected teamId) | Stored team/project/scope → actual GET results establish access only; expiry/permission footprint remain unknown unless authoritative | No credential replacement, stored metadata update, scope widening, extra account, provider mutation |
| `vercel_revoke_connection({connectionId,confirm,dryRun})` | Account-scoped predicate using existing opaque-ref expression; set only target `oauth_tokens.revoked_at` | Target belongs to caller account; reviewed protection policy permits → access lookup and refresh both refuse target; unrelated rows identical | No returning hashes, bearer input, deleting Vercel token, bulk production revoke, last-owner/server revoke |
| `vercel_set_spend_limit({limitCents,confirm,dryRun})` | `vercel_accounts.spend_limit_cents`; proposed `setSpendLimit({account,cents})` | Integer cents within DB range; owner approval as required → selected account exact limit | No purchases, other-account updates, default >$0, approvals inferred from confirm |

Tool-facing `limitCents` is a **proposed** integer schema, `0..2147483647` matching current SQL INTEGER; describe/display
it in dollars and cents. Owner form may accept dollars but must parse exact decimal cents (no float rounding; reject
negative, >2 fractional digits, exponent and overflow). The card must settle the public argument before adding it.
IN-08 stays awaiting; no new default or paid-seat price inferred. Real changes still require owner authorization.

Global default selection changes `is_default` across rows, unlike tenant-scoped spend/revoke. Explicitly document this
owner-only operation's global scope in the amendment and audit; never expose it to an arbitrary full connector.
Atomic default selection needs concurrency evidence (constraint/transaction supported by the adapter); an
`UPDATE all false` then `UPDATE target true` without serialization can leave zero/two defaults. Assign any necessary
additive migration to one B-8b slice; maintain at most one migration per PR.

## 3. Detailed first slice — safe token re-probe

Suggested first B-8b slice: **read-only** re-probe. Catalog safety is `—`, profile R (all profiles), not C.
It can reuse existing provider reads without inventing owner-mutation permissions or a migration. Any persistence
of probe metadata is a separate local-write policy amendment with its own guard tests, not part of this example.
This slice is not complete B-8b; owner mutations still need the boundary decisions above.

**Existing files to edit:** `src/vercel/tokens.js` (internal re-probe service), `src/tools/server.js`
(schema/metadata/handler), `src/vercel/setup.js` only if adding a read-only owner-panel action.
**Proposed test:** `tests/unit/account-controls.test.js`.
Existing anchors: token-store, account-observability, server-tools, setup-page, profile and MCP-server tests.
No new SQL method, provider operation, snapshot, local write allowlist or production default change required.

Ordered steps (each includes tests/lint before the next slice):

1. Create fixture with `team_FAKE_a`, `prj_FAKE_a`, encrypted `vcp_FAKE_probe_12345678`, stored project scope and $0.
   Fake rules: user `{user:{id:'user_FAKE'}}`; teams `{teams:[{id:'team_FAKE_a',slug:'fixture-a'}]}`;
   projects `{projects:[{id:'prj_FAKE_a',name:'fixture-a'}],pagination:{next:null}}`.
   Generate key in test memory like token-store test. Never commit real IDs/key material.
2. Proposed internal export `recheckStoredToken({db,accountId,env,fetchImpl,now})`: load the stored credential and
   probe using stored team/project. DB credential method comment currently says setup-only; reconcile its boundary
   explicitly for this approved server-side read service: handlers never select/return credentials themselves.
   Prefer a safe service/factory dependency over exposing the decrypted token in general dispatcher ctx.
   Obtain any allowFull policy from already owner-approved stored scope, never args. Newly broader visibility is
   reported/refused pending owner setup, with no scope change and no call to `upsertVercelAccount`.
3. Return allowlisted `checkedAt`, visible counts, access result and `scopeVerified:false` caveat. Stored expiry may
   be reported as stored metadata/unknown, not inferred from GET success. Do not claim which write tool areas work
   from these three GETs. Add safe known-denied/unknown statuses; further permission probes require documented
   read operations JIT, not trial writes. A non-null next page means incomplete visibility: report incomplete or
   add a separately tested bounded probe adapter; never call the first 100 projects a full permission inventory.
4. Add `vercel_check_token` to serverTools with strict empty input schema, `writes:false`, all three profiles and
   read-only annotations. Runtime rejects unknown fields (including token/account/allowFull) before load/probe.
   Use `connection.account` as authority. Handler returns MCP JSON/text and final `shapeMcpResult` redacts output.
5. Inject only a server-internal safe re-probe function for unit tests/production composition. Current dispatcher
   supplies only connection/db: record in the card whether server handler constructs the safe service or the
   production composition supplies it. Test the real direct handler and `dispatchReadOnlyTool`, not only probeToken.
   Keep general provider writes unavailable; no edits to local owner allowlist are needed for this read tool.
6. Assert DB rows unchanged and zero provider mutations across every case. A successful GET is a read access check,
   not credential rotation, owner permission or production activation. Add a setup read action only behind existing
   cookie/CSRF; no secret is shown there. Complete catalog/STATUS/card evidence for this slice alone.

## 4. Concrete acceptance matrix

These are required cases for the future tests, **not claims they already exist**.

| Fixture/action | Expected evidence |
|---|---|
| Valid project-scoped re-probe | Exactly 3 GETs under current probe; correct stored teamId; no POST/PUT/PATCH/DELETE or SQL mutation; safe access result matches GET evidence |
| Unknown token/account/allowFull/confirm/dryRun args | Invalid input before decrypt/probe; no permission granted by caller flags |
| account A caller tries B; unknown/invalid account/ref | Denied before decrypt/mutation; B SQL row and fake calls unchanged |
| Wider newly visible teams/projects | Safe refusal requiring owner setup; no saved scope change |
| Expired stored token / missing credential | Safe failure, zero provider calls, no metadata success claim |
| Provider 403 or malformed body | Safe failure; no credentials/provider body in response/audit/replay; no metadata overwritten with “ok” |
| 429 reset >5 s / timeout | Bounded failure, no persisted success; no blind repeated probe; short read retry follows client tests |
| Incomplete project page / missing selected project | Incomplete or safe failure; no complete-scope or write-permission claim |
| Same logical mutation requestKey, concurrent handlers (later write slices) | One local apply, safe stored replay result; real Postgres test required |
| read_only/everyday re-probe; forged owner flag/unrelated write | Read succeeds; unknown flag rejected; unrelated write stays unavailable through actual MCP |
| Connection refresh during revoke (later slice) | Old opaque ref refused; new ref scoped correctly; no fallback revoke; protected identity remains protected |
| Two concurrent revokes / default changes (later slices) | Reviewed protected-owner invariant holds; exactly one default; no unrelated row changes |
| Spend 0 / 1125 / -1 / 1.5 / overflow (later slice) | Owner-authorized exact $0.00 / $11.25; invalid values refused; no purchase and other account unchanged |

## 5. Commands, completion and successor inheritance

Existing commands runnable now:

```bash
npx vitest run tests/unit/token-store.test.js tests/unit/setup-page.test.js tests/unit/profiles.test.js tests/unit/write-contract.test.js
npm run test:db -- tests/db/token-store.test.js tests/db/oauth.test.js
```

After proposed file exists: `npx vitest run tests/unit/account-controls.test.js`. Later mutation slices add the
proposed `tests/db/account-controls.test.js` and run `npm run test:db -- tests/db/account-controls.test.js`. Then `npm run check`, `npm test`, exact-head five CI jobs and self-review.
No emulate expansion for local SQL writes; retain existing emulate CI. No real token/Neon/owner setting is changed.

Complete this read slice with mapping/negative/door evidence; owner-write/concurrency requirements remain for the
mutation slices. Record internal service signature, safe probe fields and unresolved owner policies in CHANGES-SINCE-DESIGN. Keep unbuilt
revoke/default/spend tools absent and B-8 IN_PROGRESS. Next slices inherit owner proof/target/replay decisions, not
permission to bypass them. B-8 close-out checks PLAN item-by-item; C inherits safe dispatch/output and no widened defaults.

## 6. Reconciled owner-authorization decision (#29)

The initial worked example predates the [B-8b owner-boundary contract](../designs/B-8B-OWNER-BOUNDARY.md).
Use that contract for owner identity and local default-account concurrency/audit mapping. Do not
expose `vercel_set_default_account` through MCP or infer owner identity from `full`; the first
eligible independent mutation is an authenticated production-server setup form. All other
future owner mutations remain conditional on durable approval and DB-level guard evidence.
