# ARCHITECTURE — runtime facts, as built

This file describes what **exists**, and is updated in the same PR that ships it (DRIFT-PROTOCOL checklist B). What the
system is designed to become is in `docs/designs/`; do not copy design text here before it is built.

As of 2026-10-10: **nothing is built.** The repository holds the plan only.

## Infrastructure

| Piece | State |
|---|---|
| GitHub repo `Robinson-AI-Systems/vercel-mcp` | Created by Chris; plan written 2026-10-10 (not yet pushed) |
| Vercel project | Not created (IN-02) |
| Neon database | Not created (IN-02) |
| Vercel tokens | None added |

## Environment variables

None yet. Batch A defines `DATABASE_URL`, `ADMIN_PASSPHRASE`, `PUBLIC_BASE_URL`, `TOKEN_ENCRYPTION_KEY`; record each
here with its environments when A-5 ships. Never record values.

## Database tables

None yet. Each batch's design lists its tables; record them here as they ship.

## Endpoints

None yet.

## Vercel API

No OpenAPI snapshot vendored yet (A-4). Record the snapshot date, SHA-256 and operation count here when A-4 ships, and
every path-version or snapshot move after that.
