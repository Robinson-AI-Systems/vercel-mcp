# Robinson Vercel MCP

A hosted MCP server that lets Chris Robinson's AI agents build on and run his Vercel teams safely — previews,
deployments, releases, environment variables, domains, security, logs, members, tokens and billing — with production
changes and purchases always asking first, and no secret ever passing through an AI. It follows the Robinson Tool
Contract but works fully on its own.

**Status:** foundation (A-1), database schema (A-2), OAuth/MCP endpoints (A-3) and validated Vercel HTTP client (A-4, PR #12) implemented. Account token setup, tool handlers and real deployment remain; no Neon database or Vercel token has been configured. Start at
[`docs/START-HERE.md`](docs/START-HERE.md). AI agents: read [`AGENTS.md`](AGENTS.md) first.
