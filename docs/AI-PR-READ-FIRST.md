# Read before any PR that touches production, spend, tokens, secrets, guards, login or passes

Blocking review input, in the spirit of Appliance Desk's audit note and the Stripe MCP's file. Write one line per
applicable item in the PR description saying how it is honored.

## Production
1. Every write declares `production()` per `docs/designs/BATCH-B.md` B2; a preview connection never changes production;
   a production write on a production connection needs `confirm`, carries the PRODUCTION banner and is logged as
   production. Universal `vercel_api_write` treats unknown writes on a live project as production.
2. Promote and rollback read what is live first; rollback uses the rollback operation and names the deployment it
   chose; a profile's release rule and `rollback_caution` are honored.
3. Read-back decides `confirmed`; a tool never says "done" from the request alone; nothing waits more than 45 seconds.

## Spend
4. Every paid tool (TOOL-CATALOG) declares its provider/published verified cost (never an AI-supplied price), shows a dollar line and requires `confirm` PLUS one independently authenticated, exact owner approval consumed before dispatch. A positive daily limit alone cannot authorize payment. Default autonomous spend is $0. For variable cost, a chosen ceiling is insufficient without provider enforcement, so dispatch refuses. Unknown buy/renew/upgrade/credit/billing operations are paid by default.
5. Registrar purchases send `expectedPrice` equal to the quoted price. No test, script or CI job buys anything.

## Secrets
6. No Vercel token, environment variable value (any type), bypass secret, webhook secret, Global Config token, transfer
   code, pass, passphrase, encryption key or GitHub token in code, tests, fixtures, logs, change-log rows, tool results
   or PR text. The key-scan test and the planted-value env test must stay green.
7. Tokens enter only through the setup page; secret inputs only through `pending_inputs` or server-side `generate`;
   created secrets leave only through the one-time page. Credential-shaped plain values are refused.
8. Retries are safe without Vercel idempotency keys: the request key in the change log within 10 minutes; POST/PUT/PATCH
   never retried automatically.

## Guards
9. No write bypasses `defineWrite`, the production guard, self-protection, the profile guard, the spend limit or the
   profile filter — through any door (MCP, `vercel_call`, HTTPS). The write-contract helper runs through every door that
   exists.
10. IN-07: no project identity is permanently excluded. The authenticated owner can remove existing project-exclusion
    rules on setup; server credential and last-owner protections, production, app, destructive and spend gates remain.
    A project is never rejected solely because it belongs to an MCP service.
11. Resources a profiled app owns are refused without `outsideApp: true` (emergency rollback excepted and labelled).
12. Access-widening changes (members, roles, tokens, passes, bypass secrets, shareable links, protection loosening)
    always need `confirm`; nobody can be locked out (last Owner, the server's own token).
13. `read_only` profiles and read-only passes cannot write, even by name.

## Login and passes
14. Lockout after 5 wrong passphrases in 15 minutes (counted in the database); tokens stored hashed; revoked tokens and
    expired passes refused.
15. Pass defaults stay narrow (preview, read-only, 24 h, $0). Widening a default is an owner decision.
16. A token refresh copies every connection setting (account, mode, profile, listing, and any later column) from the
    issuing row — never defaults. Rate limits live in the database (shared by every serverless instance), never in
    memory. Production mode is never offered on a non-production deployment of this server.
17. Contract behavior (RTC 1) unchanged unless the PR moves to a newer contract version; conformance stays green.

## Context
18. New tools keep listing descriptions ≤160 characters and default results ≤8 KB or a handle (budget check green);
    logs are summarized by default.

## IN-08 owner purchase approval (2026-10-12)
A stored daily limit, AI `confirm:true` or a proposed intent must never independently authorize money-out. Before charging, verify a separately authenticated owner's one-use, account/tool/payload/quote-bound approval. Variable fees require the owner to approve an explicit ceiling and fail closed without enforceable cost evidence. The owner has no arbitrary spending maximum. Record verified read-back and refuse replay, revocation or stale pricing.
