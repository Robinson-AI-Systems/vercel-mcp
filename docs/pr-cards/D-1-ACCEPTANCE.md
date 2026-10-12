# D-1 finite completion / acceptance inventory (2026-10-12)

Source of truth: approved Batch D §4 D-1, exact TOOL-CATALOG 15 rows,
registered tool handlers, and the #47–#115 GitHub Actions tests. This file
is a **code/evidence classification**, not a live-account certification.
IN-07 (project eligibility) and IN-08 (per-transaction authenticated spending)
have been **answered**. No new owner answer is required to audit D-1.

| Operations | Code/CI | Intentionally unsupported or policy-restricted | Owner-only gate | Connected acceptance |
|---|---|---|---|---|
| Project list/get | Built #47, #71, #74, #76, #92, #98, #103 | No unscoped token/team override | Stored account only | No real custom MCP read verified |
| Cron list | Built #50, #99 and #100 hardening | Cron run/enable/disable has no approved REST action; never call a cron URL or use CRON_SECRET | None for reads | No real provider read verified |
| Git namespaces and repository search | Built #49, #72, #75, #89, #93, #100–101 | No unauthenticated namespace enumeration | Exact stored token/team scope | No real provider read verified |
| Project member list | Built #48, #90, #91, #98, #105 | No forged membership-row UID | Scoped account | No real provider read verified |
| Empty/unlinked project create and settings updates | Guarded #52–53, #56, #59, #87, #104, #111 | Never bypass replay, readback or app/protected-resource guards | Writes require profile/target confirmation; live production changes separately enabled | No real write verified |
| Project member add/remove | Guarded #54–55, #66–70, #78–79, #86, #102, #105 | Arbitrary role escalation, owner/admin/final user revocation prohibited | Owner/privileged role and access guards independent | No real write verified |
| Pause and unpause | Guarded #58, #84–85 | No preview pass control of live traffic | Owner production enable and explicit confirmation | No production mutation run |
| Project transfer | Owner-only encrypted transfer request #62, #97 | Auto-accept/complete ownership transfer not exposed | Separate owner-only claim/reveal | No actual transfer performed |
| Project delete | Empty-only guarded #60, #69, #73, #77, #82, #95–96 | **Nonempty delete forbidden** regardless of prior owner answer; missing inventory fails closed | Production, confirm, typed name and protections | No actual DELETE verified |
| Build resources and Git-linked import | Guarded #64–65, #80, #83, #88 and IN-08 #108–110, #116, #119 | Metered or recurring cost without a provider-enforced total hard cap **cannot execute** even with owner consent | Exact one-use authenticated owner approval for fixed known charge, no arbitrary approval ceiling; default $0 | No charged operation performed |

**Disposition / finite closure criteria:**

1. Reconcile actual registered D-1 tools against all 15 catalog rows,
   record per-operation passing test paths and identify missing approved
   behavior; do not keep extending D-1 solely with speculative hardening.
2. Mark implemented-and-verified **code** separately from externally
   connected functionality. Keep provider writes and hosted HTTPS/D-4
   certification UNVERIFIED until genuine authorized proof exists.
3. Keep intentionally unsupported operations (cron execution, nonempty
   deletion, unverifiable metered billing) distinct from a missing code
   implementation. Do not weaken gates to label the card complete.
4. The owner-authenticated project-exclusion removal of IN-07 (#107)
   and fixed-price per-transaction IN-08 policy (#108–110, #116, #119)
   are implemented, but applying project rules and real charged acceptance
   still depend on actual deployed owner setup and verified credentials.
5. If all approved code can be proven, update D-1 to CODE_COMPLETE /
   EXTERNAL_ACCEPTANCE_PENDING rather than indefinitely IN_PROGRESS;
   do not claim deployment/production READY. D-2 read-only early-start
   remains approved even while the owner-only acceptance is pending.
