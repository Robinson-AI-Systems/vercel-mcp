# O-1R — O-1 remainder: deployment retention, directory role mappings, SAML + auto-join

Status: IN_PROGRESS. Approved design: docs/designs/BATCH-O.md (O-1 card scope: "team profile, security + SAML, directory group mappings, default protection, retention"; section 5.4 lockout guards). Baseline inspected: origin/main 625b21a. Dossier: batch-o-dossier-2026-10-30.md (audit goal workspace), O-1r section — full contract extraction from the pinned snapshot before code.

## Read only these
BATCH-O.md sections 0 (O-1 row), 5.1-5.4; src/tools/team-security-write.js; src/tools/team-default-protection.js; vendor/vercel-openapi/openapi-2026-10-11.json (teams_patch, teams_dsync_roles, Team response schema, deployments_list).

## Drift check A
| Assumption | Evidence | Resolution |
|---|---|---|
| Retention reads back in the same enum model it is written in | Team response `defaultExpirationSettings` is a DAYS model (`expirationDays*` numbers + `deploymentsToKeep`); the PATCH body uses duration enums | Verify converts through the documented duration table (1d=1 … 3y=1095; unlimited = field absent); a read-back outside the table is NOT confirmed |
| SAML-configured state is unknowable from the team record | Response `saml.connection` (type/state/status/connectedAt) is the documented connection evidence | Lockout guard keys on `saml.connection` presence: enforcing SAML without it refuses |
| Directory mappings can be read back for verification | No GET exists for dsync roles in the snapshot | Verify reports `confirmed: null` on the documented `{ok:true}` acceptance; never a fabricated read-back |
| Directory mapping values are free-form | Snapshot pins them: bare role enum string or `{accessGroupId: "ag_..."}` | Tool validates exactly that shape |
| Retention removal count is a guess | `deployments_list` (GET /v7/deployments) carries createdAt/readyState/target | Shortening previews count per class from real pages; production honors `deploymentsToKeep`; an unreadable count refuses the preview |

## Build
- `vercel_team_set_deployment_retention` (new, src/tools/team-retention.js): guarded PATCH of `defaultExpirationSettings` with per-field documented enums (canceled/errored lack 3y/2y). Shortening any window is destructive — the preview first counts existing deployments the new window would remove (pages of 100, capped count reported as "at least N"), and refuses when the count cannot be read. Verified by independent GET days readback.
- `vercel_team_set_directory_role_mappings` (new, src/tools/team-directory-mappings.js): POST `teams_dsync_roles` (new operation-table entry). Access-widening by construction — the preview lists every group → role/access-group grant in plain words. Refuses when the team record shows no directory connection. Honest `confirmed: null` verify.
- `vercel_team_update_security` extended (was #146): `saml` ({enforced, roles} in the documented roles value shape) and `emailDomain` (documented hostname pattern, null clears) join the existing guarded PATCH. Lockout guard: `saml.enforced: true` refuses unless the current team record carries `saml.connection`. Loosening lines name who gains what: SAML enforcement off, role-mapping changes, and "anyone with an @domain email can join this team automatically". The pre-O-1r test expectation that SAML/auto-join args refuse outright is replaced by malformed-value refusals plus the lockout-guard tests — the behavior change this card exists to make.

Tests: tests/unit/team-retention.test.js (5), tests/unit/team-directory-mappings.test.js (4), tests/unit/team-security-write.test.js (9, +3 net). Fake provider only; no live member/team mutation. Verification ran locally (Workshop unreachable 2026-10-30, wstunnel handshake failure — disclosed).

## Next
O-2 members + access groups (same dossier file, O-2 section written).
