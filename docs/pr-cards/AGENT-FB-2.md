# AGENT-FB-2 — Deployment provenance and identifier guidance

Source: agent improvement list 2026-11-02 (Vercel MCP, one High and one Medium).

## Outcome
An agent can prove exactly what is running: deployment reads show the real Git commit ID and branch. A project name used where a project ID is needed gets a plain, actionable message.

## Scope
- Commit IDs (bare hex, 7-64 characters, under a commit-named field) are no longer hidden by the secret filter.
- `vercel_deploy_get` requests Git source details from Vercel and falls back across hosts (GitHub, GitLab, Bitbucket, plain Git).
- Name-vs-ID guidance in the refusal and in the formatter's next-step text.

## Acceptance
- Tests: gitSource commit, multi-host fallback with null result, name-vs-ID message, commit-visibility (3).
- Secret hiding unchanged for any other long hex string.
- Unverified: live production deployment read after release.

## Drift check
DRIFT-PROTOCOL checklist B: STATUS.md, this card and TOOL-CATALOG.md updated in the same PR; no tool added, removed or renamed.
