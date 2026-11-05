# AUD-CQ — Write legs that can never succeed: the response-shape dead-end (registrar nameservers first)

**Commissioned:** 2026-11-04 by the owner, from the fleet findings log
(`~/workspace/research_notes/unleashed-findings-log.md`, entry
2026-11-04 ~21:52 MST): *"We will need to fix that in Vercel
Unleashed."* The night's production nameserver change was completed
through the dashboard instead, so this card is NOT blocking — it joins
the queue in normal order.

## The defect (proven live, twice)

`vercel_registrar_update_nameservers` can never complete. During the
robinsonaisystems.com nameserver flip (to the Cloudflare pair), the
dry-run previewed correctly (current vs proposed nameservers), but the
confirmed write returned `outcome_unknown` with failure code
`response_shape_unverified`, leg `registrar_nameservers` — twice, in
two separate dry-run → confirm cycles with fresh scoped request keys.
Independent read-backs after each attempt (`vercel_domain_list` and
public RDAP) agree: the nameservers never changed. The write is a
dead-end: no confirmed call through this tool can succeed.

## Mechanism (from the source)

For writes, the provider client (`src/vercel/client.js`) runs the
handler's `shapeResult` over the real response envelope; a throw is
stamped `response_shape_unverified` with the leg name and the write is
reported `outcome_unknown` (AUD-H / VMCP-023 design: an unrecognized
shape is a named failure, never a silent unknown). The registrar
handler's `shapeResult` (`src/tools/registrar.js`) accepts only
`undefined` or a non-array plain object and discards everything else
as `Invalid nameservers response`. The registrar API's real success
response therefore has a shape this map does not admit — most
plausibly a bare array (the nameserver list) or another envelope the
map's author never saw. The handler was modeled on an assumed shape,
never on a captured one: fixture blindness, the recurring root cause
the research-first rule exists to kill.

One open question the dossier must answer rather than assume: if the
PATCH reached the provider, why did no read-back ever show the change?
Distinguish on the scratch-domain proof (below) between (a) the write
lands but is reported unverified and propagates slowly, and (b) the
provider call itself is being rejected or no-oped upstream. The cure
differs; the card does not guess.

## The fix (dossier-first, per the standing research rule)

1. **Extract the complete documented contract** for
   `PATCH /v1/registrar/domains/{domain}/nameservers` from the pinned
   OpenAPI snapshot — every success and error branch, the exact
   response body shape — and write the shape map into this card's PR.
2. **Capture the real success response** on a disposable/scratch
   domain (never by flipping a production domain back and forth
   without the owner's word): one confirmed write through a
   diagnostic route that records the envelope's SHAPE (keys and
   types, never secret material — a nameserver response carries
   none), then timed read-backs through the tool and RDAP to settle
   question (a) vs (b) above.
3. **Remodel the leg's shape map** from the spec plus the capture, and
   the test fakes with it; new tests pin the real shape and FAIL with
   the fix reverted.
4. **Census the species, not just the specimen:** audit every write
   leg's `shapeResult` against its documented response contract and
   list any other leg whose assumed shape is unproven. The known
   second specimen is **`vercel_project_pause`** (the identical
   dead-end, hit 2026-11-04; no card of its own exists) — its leg is
   in scope for the same cure in this card, and the census output is
   filed as follow-up cards for anything else it convicts.

## Adjacent smaller defect (same area, same card)

`vercel_domain_get` errors on a plain domain name ("Alias inventory
returned an unrelated domain", `src/tools/domains.js`) and demands
exact IDs. A registrar-domain read by name should resolve the domain
and read it, or refuse with precisely what it needs. Fix within this
card's registrar/domain scope.

## Acceptance

- A confirmed nameserver write through `vercel_registrar_update_nameservers`
  COMPLETES (no `response_shape_unverified`) and the new nameservers
  read back through the tool itself — proven on a disposable/scratch
  domain, never on a production domain without the owner's word.
- The pause leg completes a confirmed pause (and resume) against a
  scratch project, or the census records why its shape differs and a
  follow-up card carries it.
- `vercel_domain_get` reads a registrar domain by plain name.
- Full local gate in platform shape before any push; both CI checks
  green at the exact head before merge; release under the owner's
  release-authority rule (nightly train, or his order / a standing
  grant), verified live at the exact deployed SHA after.
