# AUD-AB — account-layer team lifecycle (VMCP-026 A-13)

Status: in progress · Parent: BATCH O (team administration) ·
Dossier: `team-lifecycle-dossier-2026-10-30.md` in the audit goal
workspace (full endpoint contracts, credential classes, shape map,
guard decisions).

## Purpose

The last VMCP-026 acceptance leg that fails as a pure capability
gap: A-13. The product has no team-create and no team-delete tool
on any connection, and the team reads are seat-bound — while the
connect page advertises the token door as "this connection your
whole account — every team, team creation, account settings," and
IN-16 rules that account-wide is a tier capability: the account
layer itself (create teams, act on a not-yet-existing team), never
a bundle of installs. This card builds that layer: the cross-team
read, and the create/delete pair as guarded writes.

## What ships

1. **Operations** (`src/vercel/operations.js`): `teams_create`
   (POST /v1/teams) and `teams_delete` (DELETE /v1/teams/{teamId}),
   both `teamScoped: false` — the paths/methods the vendored
   snapshot pins (the create/delete contract lives at /v1; list
   and get stay at /v2 where they already are).
2. **`vercel_account_teams`** (new read, `src/tools/teams.js`):
   every team on the credential's bounded list page, each row
   through the O-1 safe projector plus a `selected` marker for
   the connection's own team, with `count` and
   `providerPageComplete`. Stored scope `full` only — narrower
   seats refuse with the IN-16 account-layer sentence. The
   selected team must appear exactly once on the page or the
   read refuses (O-1 inventory hygiene: no unverified inventory
   is ever presented as the account's teams). `vercel_team_list`
   is NOT changed: its seat-bound contract is a tested O-1
   security property of narrow seats, so the root fix is a
   sibling account-layer read, not a contract break.
3. **`vercel_team_get`** gains an optional `teamId`. Absent —
   byte-identical to today. Equal to the selected team — the
   same read. Different — an account-layer read requiring
   stored scope `full`, identity-checked against the requested
   id and projected through the same safe projector; narrower
   seats refuse with the reason (O-1 posture preserved).
4. **`vercel_team_create`** (new write,
   `src/tools/team-lifecycle.js`): guarded write, full profile,
   production-class. Seat gate: stored scope team|full; project
   seats refuse with the account-layer reason. The preview
   discloses the plan fact in plain words (a new team lands on
   Vercel's current plan/trial terms; the dashboard paywall of
   2026-10-30 is the live data point; this tool never collects
   payment) and, for team-reach seats, the account-layer fact
   with its remedy — the attempt is never pre-stopped on
   assumed plan or reach state (IN-18); provider refusals
   classify from status + the client's safe code (400 slug in
   use — choose another slug; 403 — this credential class/role
   cannot create teams; remedy a Full Account connection).
   A slug already visible on the account is disclosed, not
   refused. Apply re-checks seat authority pre-dispatch; the
   create response must carry a well-formed team id echoing
   the requested slug; verify reads the new team back (a seat
   that cannot see it confirms null, never false).
5. **`vercel_team_delete`** (new write, same module): guarded
   write, full profile, production-class, destructive. Args
   `teamId` + optional `newDefaultTeamId` (contract query
   parameter; the `reasons` diary body and the `slug` query
   hint are deliberately not exposed — no product job).
   Before(): seat gate; the target must be visible to the
   credential (identity-checked read; absence/no-access
   classify). **The enrollment guard** — any enrolled account
   row seated on the target (team, project or full rows; the
   `listVercelAccounts` scan) refuses the delete with the count
   and the remedy (remove the enrollment first —
   `vercel_remove_account`, AUD-AA — then delete). One derived
   guard covers the product's hosting team (the owner's seat is
   enrolled on it), the seat's own team, and any other
   connection's seat team; no real ID is ever named in code —
   an enrollment row is a live credential whose death AUD-AA
   made a separate named act, and deleting a team beneath live
   enrollments would strand dead rows and the write's own
   verify. The guard is enforced through the write machinery's
   guard channel — composed after the owner-protection check —
   because that is the only channel whose refusal reason
   reaches the caller verbatim (every `before()` throw is
   genericized by the preflight; the VMCP-010 staging run met
   that generic text live), and it is re-checked inside the
   pre-dispatch recheck at apply. Default-team status is
   disclosed via the user read (not refused); the provider's
   `newDefaultTeamIdError` flag is carried into the result.
   Verify: the target must read back not-found; still readable
   confirms false; ambiguous confirms null. Platform verdicts
   stay the platform's: 402 billing, 409 conflict/state,
   Enterprise organization linkage — attempted and classified
   with remedies, never pre-judged.
6. **Catalog and pins**: TOOL-CATALOG gains the three tools in
   the teams family; the totals move 238 → 241 in the catalog
   and in `checks.test.js`. STATUS bullet in this PR. No db
   change, no new SQL (the enrollment scan reuses
   `listVercelAccounts`).

## Self-review checklist

- [x] Write-contract suite passes for both writes through the
      shared helper (generic class), with the plan/confirm/
      journal machinery unmodified.
- [x] Defect conviction: with the enrollment guard disabled
      (both the guard channel and the apply-time recheck), the
      three guard tests fail — enrollment-seated refusal,
      own-team refusal, apply-time recheck — and the other 14
      lifecycle tests still pass (run 2026-10-30, local); the
      project-seat refusal is asserted before any provider
      call, and delete refusals before any DELETE.
- [x] O-1's existing read suite is untouched and green —
      `vercel_team_list` and the default `vercel_team_get`
      behavior are byte-identical.
- [x] No real team id, slug or token in any fixture (FAKE-shaped
      only); whole-tree conflict-marker grep clean.
- [x] No live exercise: fakes only. Live acceptance (the
      two-team read-back on the owner seat) rides the
      2026-10-31 00:01 promotion; A-13's delete leg closes when
      the owner runs the scratch team's scheduled deletion
      (enrollment removal via AUD-AA, then delete).
