# AUD-O — the deletion proof counts the project's own canonical domain as content

- **Finding:** VMCP-027 (the rtc deletion half) — its remaining layer,
  found by the step-4 live cleanup on the stranded run
  `run_20261028_7fc338074246` (2026-10-28): both intents reconciled to
  cleaned under AUD-K, but the project stayed `blocked` on the shared
  deletion inspect.
- **Basis:** owner directive 2026-10-28 — full contract before code;
  elimination from live reads plus the vendored snapshot.

## The evidence

The cleanup's blocked string was the inspect's *not-empty* verdict, not
its *cannot-prove* verdict — so every read completed and exactly one
input was nonzero. Live reads from the closure seat eliminated the
rest: deployments 0 (list, complete), environment 0, git link none,
hasDeployments null on the shaped record. The unobserved input was
the domains count — and it is structurally nonzero: **every real
project carries its canonical production domain**
(`<project-name>.vercel.app`) in `GET /v9/projects/{id}/domains` from
the moment of creation. The AUD-K-era fakes modeled the domains list
as empty for an empty project — the same fixture blindness, one layer
down. No live project deletion had ever passed this proof (the S7
fixture's teardown was performed in the dashboard), which is
consistent with the proof being unpassable as built.

The documented domains-item schema (`vendor/vercel-openapi`, both
response branches agree) carries `name`, `apexName`, `projectId`,
`gitBranch`, `redirect`, `redirectStatusCode`, `customEnvironmentId`,
`verification`, `verified` — no system/auto flag. The canonical entry
is identifiable by the fields themselves: name exactly
`<project>.vercel.app`, `gitBranch` null, `redirect` null,
`customEnvironmentId` null.

## The change

1. **Deletion proof (`project-delete.js`, shared by cleanup):** the
   inventory still reports the total domain count; a new
   `domainsAttached` count excludes only the canonical entry. The
   emptiness verdict now requires deployments, git link, crons,
   attached domains, and env vars all zero, plus the existing
   hasDeployments signal — replacing the blunt every-count-zero
   conjunction so the total can stay disclosed without blocking.
   Any other entry — a custom domain, an owner-added `*.vercel.app`
   subdomain, a branch or redirect domain — still blocks deletion.
2. **Legibility (AUD-H doctrine applied):** cleanup's project-branch
   refusal now names the observed inventory and the hasDeployments
   signal, so any future block is its own discriminator; the inspect
   returns the signal explicitly for that purpose.
3. **Tests (project-delete + dev-runs):** deletion succeeds with only
   the canonical domain present; a custom domain or an owner-added
   subdomain alongside it still refuses with zero DELETEs; the
   stranded-run shape discharges end-to-end with the canonical domain
   wired, as live reality carries it.

## Scope boundaries

- The disclosure posture is unchanged: previews still print every
  observed count, including total domains.
- No change to what counts as attached content beyond the single
  canonical exclusion; uncertain cases err toward blocking.
- Release posture: merges under the audit pipeline rule; rides the
  same owner-worded corrective release as AUD-N, and the closure
  probe's step 4 — the stranded cleanup — is its live proof.
