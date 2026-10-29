# AUD-T — cleanup's family test learns the truncated team-scoped host (VMCP-023, final leg)

Status: BUILT 2026-10-29 from the diagnostic the AUD-S build was
written to produce. One arm, one fix; bundles with the AUD-I first
release per the owner's batching rule (no solo release).

## The conviction (live, verbatim)

The 75dd diagnostic confirm ran on the AUD-S build (live `5ca170d`,
recovered by owner dispatch after GitHub's scheduler missed all four
nightly triggers). The deployment object recorded, verbatim:

> Deployment alias outside the project family:
> rtc-run-20261029-75dd2a554591-static-si-chris-projects-de6cd1bf.vercel.app

That host is the deployment's **team-scoped production host**:
`<project name>-<team slug>.vercel.app`, with the project name
**truncated so the label fits the 63-character DNS limit** — name 41
chars, slug 23, prefix exactly 39 (`…static-si`). AUD-P's family arm
demands the full-name prefix (`h.startsWith(name + '-')`), which the
truncation breaks; AUD-R's canonical row is a different host (the
bare truncated domain from the project's domains inventory). The
comment AUD-P left even promised "its team-scoped form" — the form
was implemented only for names short enough not to truncate.

## The fix

In cleanup's deployment branch (`src/tools/dev-runs.js`), when a
foreign host survives every existing family arm and the scratch
proof holds, the branch now reads the project's team slug
(`projects_get` → `accountId` → `teams_get`) and admits exactly one
more host: the deterministic team-scoped form
`name.slice(0, min(name.length, 63 − 1 − slug.length)) + '-' + slug +
'.vercel.app'`. One host exists per (name, slug) pair, so there is
no pattern to over-match: a different project's name, a wrong
truncation length, or a foreign team's slug all still refuse. The
deployment's identity is already proven above this arm (id +
project + run meta) — the family test bounds which assigned hosts
are plausible for this project, it does not carry identity. The slug
reads happen only when an otherwise-unmatched vercel.app host
remains, so no other path gains a call (the AUD-P/AUD-R test queues
are untouched).

## Tests

`tests/unit/dev-runs.test.js` (50 passing): the 75dd shape modeled
exactly (39-char scratch name, 24-char slug cutting the name at 38 —
the same `…static-si` cut; alias list = own URL + truncated
canonical + team-scoped host) discharges end-to-end — deployment and
project cleaned, both DELETEs dispatched. Three refusal shapes
hold: another project's team-scoped host, our name cut at the wrong
length, our truncated name under a foreign slug — each blocked with
the family refusal naming the host, zero DELETEs.

## Closure path

On the bundle release (AUD-I train): one 75dd cleanup confirm. A
`confirmed: true` discharges run `run_20261029_75dd2a554591` and
closes VMCP-023's last leg; the closure filings follow in that
packet.
