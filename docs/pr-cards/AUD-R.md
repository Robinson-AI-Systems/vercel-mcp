# AUD-R — Vercel truncates long project names when minting the canonical domain

- **Findings:** VMCP-027 (the rtc deletion half — its last layer);
  the same root cause also blocks VMCP-023's end-to-end discharge.
- **Basis:** the discharge probes of 2026-10-28 on live `53f6a72`,
  plus the projects' own domain rows read back verbatim.

## The evidence

On the AUD-P+Q build both discharge confirms applied and recorded
honestly (AUD-Q's fix working as designed). Two blockers remained,
each named in counts:

- the stranded run: `deployments: 0; git: 0; crons: 0; domains: 1
  total, 1 attached; env: 0; hasDeployments: false` — one attached
  domain is the project's whole remaining inventory;
- the probe run: its promoted deployment still read "aliased or no
  longer identified," chaining its project behind it.

The domain rows (read through `vercel_domain_list_project_domains`)
convict a single mechanism. Both projects are named
`rtc-run-<date>-<hex>-static-site` (41 characters); both carry
exactly one domain:

```
{"name":"rtc-run-20261028-7fc338074246-stati.vercel.app",
 "apexName":"vercel.app","gitBranch":null,"customEnvironmentId":null,
 "redirect":null,"redirectStatusCode":null,"verified":true}
```

Every AUD-O exclusion condition passes except the name itself:
**Vercel truncates the project name (here to a 35-character
subdomain) when minting the `*.vercel.app` domain.** AUD-O compared
against the constructed `<full name>.vercel.app`; AUD-P's alias
family did the same construction. The promoted deployment's
production alias is that truncated host, so both judgments missed
the project's own identity on any sufficiently long name — and the
rtc seed names are always long enough.

## The change

Identification becomes structural, in one shared helper
(`canonicalDomainEntry` in project-delete.js): the canonical entry
is the **unique** vercel.app domain carrying no branch, redirect or
custom environment whose subdomain equals the project name **or is
a truncation-prefix of it**. Ambiguity (two candidates) identifies
nothing, and every entry then counts as attached — the safe
direction.

1. **project-delete.js:** the deletion proof excludes exactly the
   structurally identified entry (AUD-O's exact-name comparison is
   subsumed: equality is the untruncated case).
2. **dev-runs.js (cleanup):** under the existing scratch proof, the
   deployment branch now reads the project's own domains inventory
   and accepts its **actual** canonical host as identity alongside
   the constructed forms. Custom domains and foreign hosts still
   refuse; the user-project production posture (PR #255) is
   unchanged.

## Tests

- dev-runs: the probe run's live shape end-to-end — promoted
  deployment aliased to its own URL plus the truncated canonical
  host, project carrying only the truncated entry — discharges
  fully (both deletes fire, run cleaned).
- project-delete: a truncated-only project deletes; two prefix
  candidates (ambiguous) still refuse; the AUD-O set (exact
  canonical deletes, custom domain blocks, foreign vercel.app
  subdomain blocks) is unchanged and green.

## Filed alongside, not fixed here

Candidate **VMCP-030**: `vercel_project_get` and `vercel_deploy_get`
return the `unknown_error` wrapper for the probe run's project and
deployment (three consecutive attempts) while the same records read
fine through the write-side operations and the stranded project's
readers work — a read-side shape problem in those records, to be
diagnosed from the tools' code paths in its own packet. It does not
block the discharge.
