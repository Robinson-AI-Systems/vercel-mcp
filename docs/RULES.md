# Rules

## Relational map rule

Every feature built or changed refreshes `docs/relational-map/` in the
same change; a feature is not landed until the diagram matches the
code. The map covers the real system only — parts, connections (calls,
reads/writes, publishes, depends-on) — and `docs/MAP.md` stays a short
pointer to it.
