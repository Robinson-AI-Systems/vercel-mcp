# AUD-N — The create shapeResult is an identity check, not a target judgment (VMCP-023)

**Status:** built 2026-10-28, after the single closure probe on the
AUD-L + AUD-M release failed at the seed's create leg for the third
time (`response_shape_unverified`, leg `deployments_create`). The
diagnosis below is proven from the vendored snapshot; the probe is
the confirmation that remains.

## Diagnosis (from the contract, not from another probe)

The documented `target` on **every** deployment response shape —
both `deployments_create` branches and all three `deployments_get`
branches — is:

```json
{ "nullable": true, "type": "string", "enum": ["production", "staging", null] }
```

The literal `'preview'` is **not a documented response value**: a
preview deployment reads back as `target: null`. The request side is
different — `target: 'preview'` is a valid create instruction ("if
omitted, the target will be preview") — which is how the fiction
survived: the tools modeled the response field on the request field.

The seed requests `target: 'preview'` against a brand-new project.
The provider promotes a project's first deployment (live-proven
three times: every probe's deployment read back `READY`, target
`production`), and the promotion is already present **in the create
response**. The seed's create `shapeResult` demanded the preview
matcher over that response — `null` passes it, `'production'`
throws — so every seed on a fresh project died at
`response_shape_unverified` *after the provider did the work*,
leaving an unrecorded deployment behind. AUD-L removed the
`projectId` arm of the same check; this target arm was the remaining
thrower. The from-files and from-git `shapeResult`s carried the
same target arm against the user-requested target: a
provider-promoted first deployment in a user's new project would
likewise surface as `outcome_unknown` instead of an honestly
unconfirmed success.

## Scope

- **All three create tools** (`vercel_dev_seed`,
  `vercel_deploy_create_from_files`, `vercel_deploy_create_from_git`):
  the create `shapeResult` is an **identity check only** — deployment
  id plus project identity when carried (`projectId ?? project.id`,
  per the PR #255 review rule). No target arm.
- **Target judgment stays in `verify()`**, unchanged: the seed
  accepts the preview encoding (`null`) or the provider's promotion
  (`'production'`) alongside its id/meta/object proofs; the
  user-facing tools keep demanding the requested target, so a
  promoted-against-the-ask create reports `applied` with
  `confirmed: false` and the read-back — never `outcome_unknown`.
- **Tests:** the seed confirms when the create response itself
  carries the promoted target (branch-0 shape: no `projectId`, no
  `meta`); both user-facing tools report a promoted create as
  `applied` + `confirmed: false`.

## Recorded sibling (not this packet)

`vercel_deploy_delete`'s `prove()` demands `row.target === 'preview'`
— a value outside the documented response enum — so the tool cannot
delete any deployment the API describes, previews included. Filed
in the audit register as candidate **VMCP-028**; its fix is a
separate packet (the tool is not part of the rtc lifecycle).

## Release posture

One corrective release on top of the AUD-L + AUD-M release
(`255928a`), on the owner's word, then the closure probe re-runs
once with a fresh request key. VMCP-023's closure criteria are
unchanged.
