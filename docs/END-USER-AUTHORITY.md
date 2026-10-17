# End-user authority versus developer-agent restrictions

**Owner decision: October 16, 2026. Applies to the finished service, not to this coding session's permissions.** This document supersedes any interpretation of developer-agent rules as end-user product restrictions.

## Separate principals and their authority

**Developer/implementation agent:** Instructions such as autonomous spending $0, no production activation, no unapproved live mutation, restricted fixtures, tests/reviews and releases constrain the agent **building, testing and deploying this repository**. Continue to obey them. They do **not** define what the finished service must prohibit its end users from authorizing.

**End user and their delegated coding agent:** The product should make **every feasible provider-supported action** available to a user or agent who actually holds the necessary delegated authority: paid and metered resources, financial operations, security and access administration, production changes, destructive actions and ordinary reads/writes. A dangerous action warrants a clear notice of its impact, cost/uncertainty and recoverability, **not an artificial permanent prohibition** inherited from development instructions. Where provider policies or an end user's chosen delegation policy require a new confirmation, get it; where a user has expressly delegated that operation, do not impose a developer-only approval.

## Product behavior and hard boundaries

- Authenticate the real end-user principal, honor tenant and credential scopes, provider permissions, genuine revocations, user-selected budgets/approval modes and applicable provider restrictions. A user grant never authorizes unrelated accounts or another person's secrets.
- Before sensitive effects, show target, actor, side effects, irreversible/security implications, and any actual price or metered-exposure uncertainty. An unknown price must be reported honestly and offered through a genuinely authorized execution route—not guessed as zero or made permanently “guide only” merely because of billing risk.
- Where an API exists, implement actual verified execution with request deduplication, appropriate user authorization, readback, audit and uncertain-result recovery. Guided instructions are appropriate only when the provider truly requires an external manual step, or a separate feature remains genuinely unimplemented and is tracked as unfinished.
- Optional end-user spending ceilings, protected resources, or confirmation requirements are **user-configured delegation policies**; the developer's default $0 budget and preview/production restrictions are **implementation operating constraints**, not silent defaults that deprive customers of available functionality.
- Do not weaken secrets handling, scoped delegated authority, independent verification, provider restrictions or approval requirements actually chosen by the end user. Do not perform forbidden paid/live acceptance just to demonstrate this decision.

## Mandatory follow-through

Audit implementation, design, tool catalog, setup defaults, test fixtures and roadmap for developer controls leaking into user-visible denials: “spend $0”, “unknown price”, “unbounded risk”, “guide only”, “production disabled”, “security restricted”, “money out”, “admin approval” and blanket refusals. Categorize each as (a) developer-only, (b) real provider/credential limitation, (c) end-user-selected policy, or (d) a product defect to remedy. Plan and implement (d) through the existing roadmap and full CI/review/release procedures; this clarification is **not** evidence of completed remediation.

Regression checks must prove both: developer/test agents remain unable to spend/activate without *their* separate authorization; a properly entitled end user's delegated agent can complete the same provider-supported operations after the required user risk disclosure/authorization, and can verify the results. These are independent assertions.

**Cross-repository decision:** apply the same actor distinction in GitHub MCP, Stripe MCP, Vercel MCP, Neon MCP, Google Workspace MCP, Robinson's Toolkit Hub and other active user-facing projects; retain service-specific access controls and provider limitations.