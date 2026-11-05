# AUD-CQ — Write legs that can never confirm: the response-shape dead-end (registrar nameservers first)

**Commissioned:** 2026-11-04 by the owner, from the fleet findings log
(`~/workspace/research_notes/unleashed-findings-log.md`, entry
2026-11-04 ~21:52 MST, with its same-night CORRECTION appended at
~21:55 MST): *"We will need to fix that in Vercel Unleashed."* The
night's production nameserver change is fully live and proven, so
this card is NOT blocking — it joins the queue in normal order.

## The defect (proven live, twice; corrected the same night)

`vercel_registrar_update_nameservers` can never CONFIRM. During the
robinsonaisystems.com nameserver flip (to the Cloudflare pair), the
dry-run previewed correctly (current vs proposed nameservers), but the
confirmed write returned `outcome_unknown` with failure code
`response_shape_unverified`, leg `registrar_nameservers` — twice, in
two separate dry-run → confirm cycles with fresh scoped request keys.

The first report concluded the write never took effect; **that was
wrong, and the findings log's correction supersedes it.** Registry
RDAP shows the change landing at 2026-11-05T04:48:33Z — roughly 1–2
minutes after the SECOND confirmed write — and the dashboard, opened
a minute later, already showed the new nameservers in place. The
write APPLIES, on the registrar's own apply latency. What failed was
confirmation: the tool's read-back leg and the operator's own
20-second read-back both raced that latency and read the pre-change
state, so a successful write reported `outcome_unknown`. The reframed
defect: **the tool cannot verify its own outcome and reports unknown
on a successful write** — an operator cannot distinguish success from
failure, which invites duplicate writes (the operator nearly kept
pushing). No confirmed call through this tool can return a verified
success.

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

The question the first draft left open — did the write land late, or
never land at all? — is ANSWERED by the correction: it landed, on a
delay of roughly 1–2 minutes, and every early read-back (the tool's
immediate verify and the operator's at 20 seconds) raced the
registrar's apply latency. The confirmation design must therefore
model latency, not just shape: see the fix.

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
   none), with a timed read-back series that measures the registrar's
   real apply latency (the one live specimen: ~1–2 minutes).
3. **Remodel the leg's shape map AND its confirmation behaviour**
   from the spec plus the capture: the write leg's shape map admits
   the real envelope, and the verify leg becomes a patient
   poll-with-read-back against the registrar's own record — re-read
   the domain's nameservers until the new set appears or a sane bound
   (modelled on the measured latency, with margin) expires — returning
   a VERIFIED result instead of a one-shot unknown. The test fakes
   are remodeled with both; new tests pin the real shape and the
   delayed-apply confirmation, and FAIL with the fix reverted.
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
  returns a VERIFIED result (no `outcome_unknown` on a successful
  write): the tool polls the registrar's own record until the new
  nameservers appear, inside a bound modelled on the measured apply
  latency, and the new nameservers read back through the tool itself
  — proven on a disposable/scratch domain, never on a production
  domain without the owner's word.
- The pause leg completes a confirmed pause (and resume) against a
  scratch project, or the census records why its shape differs and a
  follow-up card carries it.
- `vercel_domain_get` reads a registrar domain by plain name.
- Full local gate in platform shape before any push; both CI checks
  green at the exact head before merge; release under the owner's
  release-authority rule (nightly train, or his order / a standing
  grant), verified live at the exact deployed SHA after.
