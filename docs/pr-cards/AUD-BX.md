# AUD-BX — Real CIMD resolution: URL client IDs are fetched and validated (fix)

Filed 2026-11-02 from a live owner report: the owner tried to
connect this server from Claude and got
`{"error":"invalid_request","error_description":"Unknown client or redirect address"}`.
AUD-BV fixed the page copy that sent him in with the wrong client
ID. This card is the second, deeper half of the same failure:
Claude's own preferred way of identifying itself never worked
here at all.

## The defect

The authorization-server metadata advertises
`"client_id_metadata_document_supported": true`, but
`resolveClient()` in `src/core/oauth-handlers.js` resolved only
(a) this server's own Muse document URL — locally, to a fixed
record — and (b) clients registered through dynamic client
registration (DCR), from the database. A `client_id` that is any
other URL was never fetched; it fell through to the DCR lookup,
missed, and authorize refused it as an unknown client.

That is exactly the identity Claude presents. Per Anthropic's
connector authentication documentation, Claude uses its Client ID
Metadata Document (CIMD) whenever the server's metadata advertises
BOTH `client_id_metadata_document_supported: true` and `none` in
`token_endpoint_auth_methods_supported` — this server advertises
both, so Claude does not fall back to DCR; it comes in as a CIMD
client and is refused. (The earlier coordinator note that "with no
Client ID, Claude registers itself" was wrong for this server's
own advertised posture: registration was proven possible, but it
is not the path Claude takes when CIMD is advertised. Recorded
here so the register does not carry the error forward.)

Live conviction (coordinator, 2026-11-02, production): an
authorize request in Claude's exact shape — `client_id` =
`https://claude.ai/oauth/mcp-oauth-client-metadata`,
`redirect_uri` = `https://claude.ai/api/mcp/auth_callback`,
43-char S256 challenge, exact resource — returned the owner's
error byte-for-byte. Re-verified in this card's dossier: the
document at that URL fetches clean and is well-formed (below).

## Dossier — the contract, from primary sources

Sources read before building (2026-11-02): the MCP
specification's authorization section (2025-11-25), including its
Client ID Metadata Documents requirements, which incorporate
draft-ietf-oauth-client-id-metadata-document-00; Anthropic's
"Authentication for connectors" documentation (claude.com/docs);
the two live Anthropic documents themselves; and the fleet's own
github-mcp source.

Shape map — what a conforming server must do:

- A CIMD client_id is an HTTPS URL with a path component, no
  fragment, no userinfo (draft §3). The document is fetched from
  exactly that URL.
- The fetched document's `client_id` MUST equal the URL by simple
  string comparison (draft §4.1; MCP "Implementation
  Requirements"). Redirect URIs presented in an authorization
  request MUST be validated against the document's
  `redirect_uris`. The document MUST be valid JSON carrying at
  least `client_id`, `client_name`, and `redirect_uris`.
- The document MUST NOT carry `client_secret` /
  `client_secret_expires_at` (draft §4.1), and shared-secret
  methods are never exercised. On auth methods the draft's
  simple picture is NOT the whole contract — see the PenPal
  precedent below: a document's method offer lives in its
  PLURAL `token_endpoint_auth_methods_supported` when present,
  and the singular field can name a different, preferred
  method. Claude's document declares singular `"none"`;
  ChatGPT's declares singular `"private_key_jwt"` with plural
  `["none", "private_key_jwt"]`. Both are public `"none"`
  clients for this server's purposes.
- Live Claude document (fetched 2026-11-02):
  `{"client_id":"https://claude.ai/oauth/mcp-oauth-client-metadata","client_name":"Claude","client_uri":"https://claude.ai","redirect_uris":["https://claude.ai/api/mcp/auth_callback"],"grant_types":["authorization_code","refresh_token","urn:ietf:params:oauth:grant-type:jwt-bearer"],"response_types":["code"],"token_endpoint_auth_method":"none"}`.
- Claude Code is a separate CIMD client (Anthropic docs): its
  document (`https://claude.ai/oauth/claude-code-client-metadata`,
  fetched live) declares loopback redirects
  `http://localhost/callback` and `http://127.0.0.1/callback` with
  no port. RFC 8252 §7.3 requires the port to be ignored when
  matching loopback redirect URIs, because the client listens on
  an ephemeral port — so exact-string matching alone can never
  admit Claude Code even with CIMD resolution.
- Anthropic's consent guidance: `client_name` in a fetched
  document is self-asserted; the relying party a consent screen
  names is the HOST of the client_id URL. (No change needed
  here: no consent surface in this codebase renders a fetched
  `client_name` — the legacy consent names the service and the
  account being connected, and the SR-2 consent likewise; this
  card introduces no new rendering of it.)
- Caching: the spec says servers SHOULD cache fetched documents
  respecting HTTP cache headers.

Fleet comparison: github-mcp does NOT resolve URL client IDs —
its `src/core/oauth-handlers.js` authorize/token paths look up
`db.getOAuthClient(client_id)` only (its Muse identity is a
pre-registered row, not a fetch). This card makes vercel-mcp the
fleet's first real CIMD resolver; nothing to copy, the shape
above is built from the primary sources.


## The PenPal precedent (imported, not reinvented)

The fleet solved this once already: PenPal's server implements
the same resolution as `resolveCimdClient` in its
`src/oauth.mjs` (read for this dossier), and after its fix its
doors were live-probed with the ChatGPT CIMD document, the Muse
document, and DCR all working (PenPal PR #45 pattern:
reproduction first, real-document fixtures, live probes of all
doors after promotion — the same discipline this card follows).

Imported from PenPal: fetch the document, validate that it
names itself (`client_id` === the URL), normalize it into the
same client-record shape the DCR rows use
(`client_secret_hash: null`, method `"none"`), redirect
refused, timeout + size cap, failures resolve to no client and
a legible "unknown client" refusal, per-process caching, and
the loopback port relaxation (scoped to CIMD records only
here — DCR registrations in this codebase keep the exact-match
semantics they have always had; PenPal applies the relaxation
to every client, a divergence recorded deliberately).

PenPal's convicted ChatGPT bug is the reason the auth-method
check is an intersection, not a string comparison: PenPal's
checker read only the singular `token_endpoint_auth_method`,
saw ChatGPT's `"private_key_jwt"`, and refused ChatGPT with
"Unknown client" — even though ChatGPT's plural
`token_endpoint_auth_methods_supported` is
`["none", "private_key_jwt"]`. The rule built here from the
start: the document's supported methods are the plural list
when present, else the singular method, else `"none"` (PenPal's
shipped default); intersect with this server's own supported
methods; admit the client as a public `"none"` client exactly
when `"none"` is in the intersection; refuse otherwise. Full
`private_key_jwt` support stays out of scope, as it was for
PenPal: a document offering ONLY `private_key_jwt` is refused.
Both real document shapes are regression fixtures in this
card's suite: Claude's (singular `"none"`, fetched live
2026-11-02) and ChatGPT's (singular `"private_key_jwt"`,
plural including `"none"`, redirect
`https://chatgpt.com/connector_platform_oauth_redirect`,
fetched live from https://chatgpt.com/oauth/client.json
2026-11-02).

## Design decisions (recorded, per the research-first rule)

- **One shared resolver.** `resolveClient()` is the single
  funnel for authorize, dev authorize, the attested-flow
  re-check, token exchange, and revocation (which receives it as
  `getClient`). CIMD resolution is added inside that funnel —
  Muse special case first (byte-identical behavior), then CIMD
  for any other `https://` client_id, then the DCR database
  lookup, unchanged. No call site can drift.
- **Fetch guards (SSRF).** The fetch is server-side on an
  attacker-suppliable URL, so: HTTPS only, with a path component,
  no fragment/userinfo; the hostname must not be `localhost` /
  `*.localhost` or a non-public IP literal; for DNS names, every
  resolved address must be public (loopback, private, link-local
  incl. 169.254.0.0/16, CGNAT, multicast, reserved, and the IPv6
  equivalents are refused) before any request is made. Redirects
  are NOT followed (`redirect: 'error'`) — a redirect is a
  refusal, not a hop; the real documents are served at their own
  URLs, so nothing legitimate is lost, and no re-validation of
  redirect targets is needed. Timeout 5s; response body capped
  at 64 KB (checked on the raw body and again on the parsed
  document). DNS is resolved immediately before the fetch; the
  residual time-of-check/time-of-use window is the platform
  resolver's, noted here rather than hidden.
- **Document validation.** Parsed JSON must satisfy:
  `client_id` === the URL fetched (exact string); `client_name`
  present (stored truncated to 100 chars, as DCR does);
  `redirect_uris` a non-empty array of at most 8 distinct URIs
  each passing the codebase's existing `validRedirectUri`;
  the document must admit treatment as a public `"none"`
  client under the PenPal intersection rule (below), and must
  not carry a `client_secret` / `client_secret_expires_at`
  member: a CIMD client is a public client, and this server
  will not pretend to hold a secret it was handed in a public
  document.
  The resolved record carries the same shape as the Muse record,
  including `client_secret_hash: null`, so the token endpoint's
  public-client branch treats it identically.
- **Loopback redirect matching (RFC 8252 §7.3).** Redirect
  checks at authorize / dev authorize / attested re-check /
  token now go through one helper: exact match first (unchanged
  for every existing client), plus — only for CIMD-resolved
  clients — a port-insensitive match when BOTH the registered
  and the presented URI are `http` loopback URIs with the same
  host and path. Scoping the relaxation to CIMD records keeps
  DCR and Muse behavior byte-identical.
- **Caching.** Successful resolutions are cached in memory for
  an hour (bounded map, oldest evicted) — PenPal's proven
  per-process TTL. Failures are never
  cached, so a transient fetch failure cannot lock a client
  out. Fetched clients are NOT written to the DCR table: the
  document at its URL is the registration, the cache is only a
  fetch optimization, and persisting would silently turn a
  revocable-at-source document into a stale local row. The
  fixed TTL is the house-simple choice; honoring upstream
  `Cache-Control` is a named follow-up, not built here.
- **Failure honesty.** Any fetch failure, timeout, oversize, or
  invalid document resolves to no client, and the caller gets
  the existing `Unknown client or redirect address` refusal —
  fetch internals are never leaked to the caller. (This codebase
  has no server-side logger in the OAuth core; none is invented
  for this card.)
- **Injection seam for tests.** `createOAuthHandlers` accepts an
  optional `fetchDocument` (the production default is the
  guarded fetcher). Unit tests inject a mock; no test touches
  the network.

## Tests

New suite `tests/unit/oauth-cimd.test.js` (fetch mocked):
a Claude-shaped document resolves and authorize proceeds past
the client gate; a ChatGPT-shaped document (singular
`private_key_jwt`, plural including `"none"`) resolves the
same way, and a `private_key_jwt`-only document is refused; the full authorize → token exchange completes
for the CIMD client; a document whose `client_id` differs from
its URL is refused; a redirect outside the document is refused;
non-HTTPS and private/loopback-host client_id URLs are refused
WITHOUT any fetch; a document declaring a secret auth method is
refused; fetch failure and oversize are refused; the Claude Code
loopback document admits an ephemeral-port redirect; the Muse
document still resolves locally with no fetch, and DCR
registration + authorize are unchanged. Negative control: with
the resolver bypassed, the Claude-shaped authorize test fails
with the production error.

## Scope notes

- No tool added, removed, or renamed; the registry is
  unchanged, so no TOOL-CATALOG note is needed.
- Live proof — the owner connecting from Claude — can only
  happen after the nightly promotion carries this fix; it is
  listed, not claimed. Batches with the nightly train.
