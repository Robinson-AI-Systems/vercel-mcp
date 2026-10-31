# AUD-AM — Git-import identity proof reconciled with the real search shape (VMCP-016 fixture blocker)

**Baseline inspected:** main `8fb9e83` (AUD-AK, #341; the build
promoted live 2026-10-31). Dossier:
`git-identity-dossier-2026-10-31.md` in the audit goal workspace —
written before code, per the research-first rule: the pinned
snapshot's contract for both Git integration endpoints, the
three identity predicates audited against it and against the
live captures, and every caller inventoried.

**The live fact.** On the promoted build, 2026-10-31 ~00:52 MDT,
the VMCP-016 fixture create — `vercel_project_create` with
`gitRepository {type:"github",
repo:"Robinson-AI-Systems/ras-vercel-fixture-scratch",
namespaceId:"165469780"}`, dry-run — refused: "Git repository
identity is absent or ambiguous". Every other leg passed: the
namespace verified (Vercel's own namespace id, from
`vercel_git_list_namespaces` — not the GitHub org id the staging
notes carried), and the search returned exactly one repository
whose name fields are the BARE repository name. (The same
session's bare, unlinked `vercel_project_create` dry-run planned
cleanly: the earlier candidate finding that project_create's
classification refused all creates is resolved by the promotion
and is not part of this card.)

**The conviction (dossier §3).** `verifyExactGitRepository`
(`src/tools/git-identity.js`) matched a row only when
`row.fullName === "owner/repo"` (or, absent a string `fullName`,
`row.slug === "owner/repo"`). The pinned OpenAPI snapshot
documents NO `fullName` field on a `search-repo` row at all:
the row's name fields are `name` and `slug`, both the bare
repository name inside the namespace (required fields:
`defaultBranch`, `id`, `name`, `namespace`, `owner`,
`ownerType`, `private`, `provider`, `slug`, `updatedAt`,
`url`), under a `gitAccount` root that binds the response to
the requested namespace. Both branches of the predicate are
therefore unsatisfiable on a conforming response, and the one
live capture confirms the conforming shape. Git-linked project
creation was dead against the real provider — fixture
blindness again: the fakes were built around a
`{fullName:'acme/site'}` row the contract never documented,
under the D-1au design note's assumption that Vercel returns
a `fullName`.

**What ships.** One predicate change in
`src/tools/git-identity.js`; the identity a row must prove is
the pair (verified namespace, bare name):

- A supplied string `fullName` remains the row's canonical
  claim and decides alone — qualified (`owner/name`) or bare
  (namespace-scoped) equality with the requested repo matches;
  ANY other value is a contradiction and the row cannot match,
  so a stale or attacker-controlled alias still cannot override
  a canonical claim (the D-1au protection, preserved verbatim
  in effect).
- Without a `fullName`, the documented fields decide: `slug`
  equals the bare name (or the legacy full path), and `name`,
  when a string, must agree with it.
- Unchanged: `verifyGitNamespace` and `verifyGitSearchAccount`
  (both audited sound against contract + live), the
  exactly-one-match rule (duplicates refuse as ambiguous), and
  the matched row's foreign-provider / foreign-namespace /
  restricted / reauth refusals. `row.namespace` is deliberately
  not used: documented-required, but its live value was never
  captured, and the namespace binding is already proven by the
  sibling predicates.
- Callers: exactly two, both in `src/tools/project-create.js`
  (`before()` preflight and `apply()`'s execution-time
  re-proof) — one predicate fix covers both. The discovery
  tools in `src/tools/git.js` do not call this predicate and
  are untouched.

**Catalog judgment (drift checklist B).** `src/tools/`
changes, so this card carries a TOOL-CATALOG note in the first
commit: it records the corrected identity proof for
`vercel_project_create` Git imports and supersedes the D-1au
note's premise (an authoritative `fullName` "when Vercel
returns one" — the pinned contract documents no such field);
the D-1au contradiction protection itself stands.

## Verification

- `tests/unit/git-identity.test.js` (11 tests): fakes
  remodeled to the documented row (the live fixture's shape,
  identifiers generalized — the repository id is a fake
  number; the captured real id lives only in the dossier).
  Pins: the documented row matches (object and bare-array
  responses); canonical precedence in both directions
  (qualified match; qualified contradiction defeating a bare
  matching slug; bare contradiction defeating a full-path
  slug; bare canonical match); legacy full-path slug;
  slug/name disagreement refuses; duplicate documented rows
  refuse as ambiguous; foreign provider/namespace, restricted
  and reauth documented rows refuse.
- `tests/unit/project-create.test.js` (28 tests): every Git
  fake remodeled via `gitRepoRow`/`gitNamespaceRow`
  factories on the documented shapes; all pre-existing
  scenarios re-expressed unchanged in intent (identity passes
  and the metered-import spend refusal still fires with the
  same call sequence; wrong repo, restricted/missing
  namespace, duplicates, root-account mismatches and the
  execution-time races still refuse before any POST).
- `tests/unit/git.test.js` (15 tests) green unchanged —
  the discovery tools' seam is not a caller.
- Focused local run: 3 files, 54 tests, all passing
  (terminal output of the completed run). Full
  `npm run check` at the PR head recorded in the PR's
  self-review.

**Live acceptance (not run by this card).** After the nightly
promotion, the coordinator creates `rtc-git-fixture` from
`Robinson-AI-Systems/ras-vercel-fixture-scratch`
(namespaceId `165469780`) and runs VMCP-016's branch-G
alias/fetch legs; the fixture's deletion afterward is the
recorded commitment from the fixture staging. Fakes only here.
