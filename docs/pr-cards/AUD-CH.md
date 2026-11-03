# AUD-CH — Owner-confirmed deletion of a non-empty project

Commissioned by the owner on 2026-11-03, from the rtc-git-fixture
leftover: branch G's cleanup could not delete the retained test
project because this tool refused any project holding resources,
and the owner was sent to the dashboard for a one-minute job his
own tool should do. His ruling: his tools must never veto their
owner — for a dangerous action the pattern is (1) re-evaluate and
verify the facts, (2) explain the danger and consequences in
plain words, (3) get his explicit confirmation, (4) execute and
journal it. A warning is a duty; a refusal is an overreach. His
refinement: "Not every tool, just the important ones. Most of
them should just obey me." (The same doctrine already stands in
docs/END-USER-AUTHORITY.md: developer restrictions must not
become permanent tool denials.)

## What vercel_project_delete did before

D-1m restricted deletion to provably EMPTY projects (complete
inventories of deployments, domains, env variables, crons and
the git link, all zero). A non-empty project's impact could be
inspected in a dry-run, but confirmation was refused outright:
"Nonempty deletion disabled."

## The change (src/tools/project-delete.js only)

- The inventory inspection now also returns the evaluation
  detail behind the counts — deployment ids with target and
  state, attached (non-canonical) domain names, the canonical
  domain's name, the code link's identity, environment variable
  KEYS (values are never read into the record), cron paths —
  and an `evaluationId`: a SHA-256 fingerprint of that exact
  state, including the hasDeployments signal.
- The plan for a non-empty project renders the warning in plain
  terms: exactly what will be permanently destroyed (production
  deployments called out as the live site going down, attached
  domains as addresses that stop working, the code link cut
  with the repository itself untouched, variable values lost),
  ending with the evaluationId.
- Confirming a non-empty deletion requires `evaluationId`
  naming the CURRENT evaluation. A missing one refuses with the
  instruction to review the plan; a stale one (anything about
  the project changed since the plan) refuses with the
  instruction to re-plan. Naming an evaluation is checked on
  the empty path too, so a confirmation can never silently bind
  to contents the owner did not see.
- Execution re-inspects immediately before the DELETE on the
  bound provider token and refuses if identity, emptiness or
  the evaluation changed since confirmation; the framework
  journals the write (before-state, targets, result) and the
  tool verifies by read-back (project GET must answer 404).
- The empty-project path is unchanged. No tool added, removed
  or renamed; the registry stays 253. The new argument is
  optional and only meaningful for non-empty projects.

Sibling refusals evaluated, per the commission: deleting a
deployment with a production target (vercel_deploy_delete is
preview-and-terminal-only) and cutting a project's code link
(no standalone tool exists) are NOT converted here — they are
inventoried in the refusal audit reported to the owner with
this card, and convert only on his word after he sees the
landscape. Project deletion itself does not need them: the
provider's project DELETE is the same operation the dashboard
performs, and the evaluation is where those contents are
named and confirmed.

## Acceptance

Unit proof in this PR (tests/unit/project-delete.test.js, all
pre-existing tests unchanged and green): the plan renders the
full warning with the evaluation id and deletes nothing; a
confirm naming no evaluation and one naming a stale evaluation
both refuse without a DELETE; a confirm naming the exact
evaluation deletes a project holding a production deployment,
an attached domain, a code link, a variable and a cron —
verified by the 404 read-back, journal written, and the
variable's value absent from every output; contents changing
between plan and confirm refuse. Each new test fails with the
fix reverted. Full suite and npm run check green locally; CI
`ci` + `release-policy` green at the exact head.

Live proof, owed after the nightly promotion carries this to
production (no daytime release; the owner has not ordered one
for this card): delete the retained rtc-git-fixture project
through this tool on the owner's own explicit confirmation of
its evaluation — that closes the branch-G leftover through the
tool instead of the dashboard.
