# Rules

## Relational map rule

Every feature built or changed refreshes `docs/relational-map/` in the
same change; a feature is not landed until the diagram matches the
code. The map covers the real system only — parts, connections (calls,
reads/writes, publishes, depends-on) — and `docs/MAP.md` stays a short
pointer to it.

Counts, dates, live-state claims and policy rules the map states are checked against the code by `scripts/check-map-counts.mjs` (MAP-COUNTS-1, MAP-CLAIMS-1), using `docs/relational-map/counts.json` and `docs/relational-map/claims.json`; a count or date with no registered source fails the check.
