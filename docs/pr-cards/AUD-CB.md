# AUD-CB — Branch preview: the documented non-first create construction (branch G, fourth leg)

Filed from branch G's continuation on the AUD-CA build
(2026-11-03): with the fixture project now holding its first
(promoted) deployment, the next branch preview create was
refused by the provider — `{code: "bad_request", leg:
"deployments_create", failureClass: "http_status", status:
400}` — on the production branch and on a side branch alike.
No deployment was created by either attempt.

## Root cause (the AUD-AL construction class, second route)

AUD-AL's dossier (in src/tools/deployment-file-create.js)
convicted a construction class for non-first creates from a
live probe on 2026-10-31: a create that (1) requests preview
with the literal `target: 'preview'` — a value the documented
request vocabulary omits ("If omitted, the target will be
preview") — and (2) carries no
`skipAutoDetectionConfirmation` suppressor, the documented
flag for automated pipelines. Files-create's fix requested
preview by omission and sent the suppressor.

`vercel_dev_preview_branch` still sends the convicted
construction on every non-first create: literal 'preview',
no query at all, and (correctly, per AUD-AD) no settings.
Its first create escaped the refusal because the echoed
projectSettings supplied the framework input the
auto-detection check otherwise demands; with settings saved
server-side and none sent, the check fires and the provider
refuses. Today's two live refusals match the convicted class
exactly.

## Fix

Scoped to the non-first construction; the first-create
construction is the live-proven shape (branch G, 2026-11-03:
created READY) and does not change.

- Non-first: the body omits `target` (preview by omission)
  and the create carries `?skipAutoDetectionConfirmation=1`
  (the snapshot's enum form, as files-create sends it),
  threaded from before() through the write's query slot and
  the request validation.
- First: literal `target: 'preview'` plus the echoed
  projectSettings, no suppressor — byte-for-byte as proven.

## Fixture gap, named

The dev-preview suite asserted the dispatched body for the
deployed-project case with the literal target present — the
tests modeled the convicted construction as correct. The
remodeled assertions pin the dispatched construction in both
directions: non-first omits target and carries the
suppressor; first keeps the literal target and no
suppressor. Negative control: with the fix reverted, exactly
the two non-first construction tests fail.

## Acceptance

Unit proof in this PR (dev-preview suite 20 tests); full
suite and `npm run check` green locally; CI `ci` +
`release-policy` green at the exact head. Live proof rides
the promotion under the owner's 2026-11-03 release-now
directive: branch G end-to-end on the fixed build against
the retained fixture (preview → alias → bypass → fetch →
cleanup → fixture deleted, earlier runs dispositioned). No
tool added, removed or renamed; registry unchanged at 253.
