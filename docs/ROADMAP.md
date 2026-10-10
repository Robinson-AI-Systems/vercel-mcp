# ROADMAP — ideas not being built now

Not approved scope. An item moves into a design only with Chris's approval (a dated DECISIONS entry).

- **Per-permission keys** ("Sign in with Vercel" access tokens with permissions such as "Production Environment
  Variables — Read Only"): switch the recommended credential when Vercel makes API permissions generally available
  (private beta on 2026-10-10).
- **Hand-built tools for feature flags, KMS, Vercel CI, container registry, AI Gateway, Vercel Connect, microfrontends,
  Remote Cache** when one is actually used (signal: repeated `vercel_api_*` calls in the change log).
- **Blob objects** (list, copy, delete files in a store) through the Blob API with a store token entered on the setup
  page — only if Chris needs it; Appliance Desk's runbook forbids casual deletion.
- **Hub workflow: write a secret from one server straight into another** (e.g. a Neon branch connection string into a
  Vercel preview variable) without it entering chat — built in the hub, using this server's `pending_inputs` door.
- **Browser-assisted dashboard steps:** an agent with a browser follows `vercel_where_is_setting`'s structured steps
  while Chris watches; the server then reads back where possible.
- **A scheduled "Vercel health" digest** (failed builds, expiring domains/certificates/keys, spend vs target) once
  scheduled tasks are in regular use.
- **Port fixes back** to the Stripe MCP or the core package when a copied file is improved here.
- **One fresh preview database per preview deployment** for Appliance Desk-style apps (with the Neon server) — the app
  lists it as optional hardening.
