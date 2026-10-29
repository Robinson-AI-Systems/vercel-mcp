# AUD-P — cleanup's deployment branch: the deployment's own aliases are its identity

- **Finding:** VMCP-023 / VMCP-027 (the rtc lifecycle's discharge
  half) — the layer the combined closure probe reached on
  2026-10-28, after the seed's first self-confirming dispatch.
- **Basis:** owner directive 2026-10-28 — full contract before code;
  the probe's live read-backs plus the vendored snapshot.

## The evidence

The closure probe on the AUD-N + AUD-O build (live `c511678a`):
the seed **confirmed itself** — `applied`, `confirmed: true`, the
deployment recorded in its run — closing VMCP-023's create leg on
live evidence. The new run's cleanup then blocked at the deployment
object: "Deployment is aliased or no longer identified".

Cleanup's deployment branch demanded the read-back's `alias` array
be **empty**. The documented contract says otherwise: in all three
`deployments_get` branches, `alias` is an array of the hostnames
assigned to the deployment, and `url` is "the unique URL of the
deployment". A deployment the provider promoted to production
necessarily serves the project's production domain, so its alias
list carries the project's canonical domain alongside its own URL.
The empty-alias demand therefore refuses every promoted deployment
forever — the deployment's own identity mistaken for an outside
attachment, the AUD-O defect one branch over (there, the project's
canonical domain in the *project* deletion proof; here, in the
*deployment* proof).

## The change

Cleanup's deployment inspection (dev-runs.js) now judges aliases by
identity, reusing the scratch proof the AUD-M review established
(projects_get: id match + the deterministic `rtc-<run>-` name,
fetched at most once per inspection and shared with the target arm):

- The deployment's **own URL host** is its identity, never an
  attachment — accepted in any project.
- Inside the **proven scratch project**, the project's vercel.app
  family — the canonical `<name>.vercel.app` and its team-scoped
  `<name>-… .vercel.app` forms — is likewise identity.
- A **custom domain** or any foreign hostname refuses everywhere,
  without further reads; in an **existing user project**, the
  production-domain alias refuses too (the PR #255 posture is
  preserved: the widening exists only under the scratch proof).
- The `aliases` (plural) demand is unchanged — it is inert on every
  documented GET shape and stays as a conservative guard.

Tests (dev-runs): the full live shape discharges end-to-end
(promoted deployment aliased to its own URL + the scratch project's
canonical domain; project carrying only its canonical domain;
2 DELETEs, run confirmed); a custom-domain alias in the scratch
project still blocks with zero DELETEs; the production-domain alias
in an existing user project still blocks; a preview deployment
carrying only its own URL deletes.

## Scope boundaries

- No other cleanup branch changes; the alias *object* branch's
  cross-check was audited in the same pass and carries no alias-array
  demand (it verifies the recorded deployment's identity, which
  AUD-M already made shape-correct).
- Release posture: merges under the audit pipeline rule; one
  owner-worded release, then the discharge probe: the probe run's
  own cleanup driven to fully cleaned, which — with the stranded
  run's discharge — closes VMCP-023 end-to-end and VMCP-027.
