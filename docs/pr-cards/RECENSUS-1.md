# RECENSUS-1 — OAuth client registration lifecycle: list, read, update, delete

**Commissioned:** 2026-11-04 by the fleet completeness re-census
(Critic Step 0 two-source reconciliation under the RAS MCP
Standard's 2026-11-04 completeness amendment; CONFORMANCE.md row 15
re-issued in the same PR, missing-with-plan row M1). The re-census
graded Vercel Unleashed by Robinson AI Systems against the
service's full published surface and checked lifecycle
completeness on the server's own stores with the same force. It
found the fleet's headline wound class present here in full:

- Registrations are **create-only**. `POST /api/oauth/register`
  inserts the row (`db.createOAuthClient`, `src/db.js`) and the
  201 response carries `client_id` (and `client_secret` for
  confidential clients) — and **no `registration_access_token`**,
  no client-management URI.
- The only read is internal: `db.getOAuthClient`, called by the
  authorize / token / revocation handlers and the developer
  handoff. No owner tool and no GET route exposes a registration.
- There is **no list function, no update function, and no
  `DELETE FROM oauth_clients` anywhere** in `src/` or `api/` —
  grep-verified by the census inventory: the only `oauth_clients`
  data functions in the codebase are `createOAuthClient` and
  `getOAuthClient`. No deregistration route exists, and the
  retention sweep never touches the table.
- So a stored registration, once created, has **no removal leg in
  the product**. Registrations accumulate forever — the exact
  failure the fleet has already met on a sibling server, where
  inert probe registrations sit in the store undeletable.

Checked before filing (no duplication): no existing card carries
these legs. The work index's CAP line (CAP-1…CAP-5, the
MAXIMUM-AUTHORITY program) was read — none scopes a registration
list/update/delete. A-3-CLIENT-REVOCATION builds RFC 7009
*grant* revocation (the `oauth_tokens` store — symmetric and
complete); it does not touch registrations, and its own text
states that registration is not account authority. This card
scopes only what is missing.

## The build

Give `oauth_clients` the lifecycle every other server-self store
in this codebase already has:

- **List** — an owner-surface list of registrations (client_id,
  name, redirect URIs, client type, created-at, and whatever
  activity markers the row honestly carries), through the
  owner-only door this server already uses for its `localAdmin`
  tools. Other principals see only their own registrations if a
  per-client door is also built (next bullet); the owner list is
  the acceptance surface.
- **Read** — an owner read of one registration by client_id.
- **Update** — at minimum the mutable registration metadata the
  platform's own registration model allows (name, redirect URIs),
  or an explicit recorded decision, in this card's delivery, of
  which fields stay immutable and why.
- **Delete** — a hard delete of the registration row through the
  owner door, following this server's confirmed-action pattern
  (row 17): evaluate the exact target, disclose in plain words,
  bind confirmation to the evaluation, execute, journal it in
  `change_log`, and verify by read-back. Deleting a registration
  must also settle its dependent state deliberately: live
  `oauth_tokens` families issued to that client are revoked in
  the same action (the revocation machinery already exists), and
  the delivery states what happens to `oauth_codes` rows, if any
  survive to the moment of deletion.
- **Management credential (decide in delivery, record the
  decision):** either issue a `registration_access_token` at
  registration time (the RFC 7592 shape, enabling the standard
  client-management endpoints) or record why the owner-door-only
  shape is this server's settled answer. Either is acceptable;
  silence is not.
- **Retention story:** with a delete leg in place, state whether
  the retention sweep should ever reap abandoned registrations
  (e.g. never-used, never-revoked after a stated age) or whether
  registrations are owner-reaped only, and record the choice in
  the delivery. Do not build a sweep silently.

New tools, if any, are registered through the registry like
every other tool, catalogued in `docs/TOOL-CATALOG.md` in the
same PR, and the registry count moves only by what this card
actually adds (STATUS records the count either way, per house
practice).

## Tests

- Lifecycle proof against an isolated store, in the shape of the
  existing revocation proofs: register → list shows it → read
  returns it → update changes what the card says is mutable →
  delete → list and read both show it gone, and the dependent
  token families read back revoked.
- Refusal proofs: another principal cannot list, read, update, or
  delete a registration that is not theirs; deleting a
  nonexistent client_id is a clean no-op or a clean refusal,
  never a partial mutation.
- The full check suite at the exact head, with the catalog check
  and registry pins updated only for what this card adds.

## Docs

`docs/TOOL-CATALOG.md` gains the new surface in the same PR;
`docs/STATUS.md` carries the dated entry; CONFORMANCE.md row 15's
M1 is re-read against this card's delivery when it lands (the
grade itself is re-judged by a census, not by this card).

## Acceptance

In plain terms: **registrations created through the server
become listable and deletable through the product, and after
deletion a registration reads back as gone.** Concretely, at a
checked release: register a throwaway client through the public
registration route; the owner list shows it; delete it through
the product's owner door under the confirmed-action pattern; the
owner list and the owner read both show it gone; tokens issued
to it read back revoked. The fleet census's three inert probe
registrations on the sibling Workspace server are the cautionary
tale, not this card's test data — this card proves itself on
registrations created for the purpose.

**Not changed by this card:** the authorize/token/revocation
flows (complete and symmetric today), CIMD clients (stateless —
nothing stored, nothing owed), enrolled-account lifecycle
(complete), and the IN-16 closure, which stands as ruled.

## Delivery (2026-11-04, this card's PR)

**What was built.** `src/db.js` gains the lifecycle legs beside
`createOAuthClient` / `getOAuthClient`: `listOAuthClients`,
`getOAuthClientRegistration` (one aggregate public shape for both
reads — client_id, name, redirect URIs, auth method, client type,
real `created_at`, and activity markers computed from the token
and code stores: live/total token families, last use, outstanding
codes; the stored secret hash is never in the shape),
`updateOAuthClient`, and `deleteOAuthClient`. Four owner-door
tools (`src/tools/oauth-clients.js`, registered through the
registry and added to the owner-door list in
`src/core/mcp-server.js`): `vercel_list_oauth_clients`,
`vercel_get_oauth_client`, `vercel_update_oauth_client`,
`vercel_delete_oauth_client`. Registry 253 → 257; catalog rows
added in the same PR.

**Delete follows the row-17 confirmed-action pattern:** the dry
run evaluates the exact target and discloses it in plain words
(live token families and outstanding codes counted); confirmation
must echo the evaluation fingerprint the dry run returned;
execution re-reads and re-binds, so a registration that changed
since the evaluation refuses instead of deleting; the delete
itself is one statement (the `revokeRtcPass` shape) — dependent
revocation, code cleanup, row removal and the `change_log`
journal land together or not at all, every mutation gated on the
registration existing in the statement's snapshot; the handler
verifies by read-back (row gone) before it calls the deletion
confirmed. Deleting a nonexistent client_id is a clean refusal
that mutates nothing and journals nothing — proven against
orphan token rows keyed to a client with no registration.

**Dependent state, stated plainly.** Deleting a registration
**revokes its live `oauth_tokens` families in the same action**
(the rows stay as the revocation record; already-revoked families
are untouched). Its **`oauth_codes` rows are removed in the same
action** — a code for a deleted client can never be exchanged
(the token route reads the client first), and expired codes were
already the retention sweep's to reap.

**The three recorded decisions.**

1. **Mutable fields:** the display name (`client_name`) and the
   redirect URIs (`redirect_uris`) — the metadata the registration
   model itself treats as descriptive. **Immutable:** `client_id`
   (the registration's identity), `token_endpoint_auth_method`
   and the stored secret hash (credential material — changing
   either is a re-registration, not an edit; a client that needs
   a new secret or auth method registers again). The update
   method refuses every other field by construction, and the
   update's read-back proves the credential survived untouched.
2. **Management credential: owner-door-only is the settled
   answer; no `registration_access_token` is issued.** A
   registration on this server is created by anonymous public
   registration and carries no account authority (A-3's own
   boundary), so the registrant has no management claim to
   credential; the only principal with a legitimate management
   interest in the store as a whole is the server owner, whose
   door already exists and is already authenticated by the
   owner's own connector connection. Issuing an RFC 7592 token
   would create a new bearer-credential class — stored, leaked,
   rotated, revoked — to serve a surface nobody but the owner
   may use. If a future card gives registrants a per-client door
   (the card's "if a per-client door is also built" case), the
   token decision reopens with it.
3. **Retention: registrations are owner-reaped only; the sweep
   never touches `oauth_clients`, and no sweep was built.** A
   registration's age cannot judge its liveness (a stored client
   may be dormant but legitimate), and deletion revokes live
   token families — too destructive for an unattended reaper.
   The delete leg is the reap tool; the owner works it from the
   list's activity markers.

**Refusals.** The four tools are visible and callable only on
the owner door (full profile + the owner-tool list); handlers
additionally refuse any connection that is not the owner's own
connector connection before touching the store, so a delegated
pass — even a full-profile one — can neither list, read, update
nor delete any registration, and narrower profiles never see the
tools at all. Because registrations carry no per-principal
owner, "a registration that is not theirs" is every registration,
for every non-owner principal.

**Live acceptance — PENDING the nightly train, declared.** At
the checked release: register a throwaway client through the
public route, see it in the owner list, delete it through the
owner door under the confirmed-action pattern, and read back
list/read empty with its tokens revoked. The lifecycle is proven
now against isolated Postgres and at the tool boundary in unit
tests; the live leg runs after this merge rides the train.
