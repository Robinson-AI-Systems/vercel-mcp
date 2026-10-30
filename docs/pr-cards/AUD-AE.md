# AUD-AE — Consent form: modes follow the account actually chosen (preselect the flagged default; recompute per account)

**Baseline inspected:** main `e231bac` (AUD-AC, #284). Main
advanced mid-flight to `513a4a1` (the sibling dev-preview card,
PR #285), merged into this branch and re-verified; that sibling
also took the card ID AUD-AD, so this card is AUD-AE. Dossier:
`consent-form-modes-dossier-2026-10-30.md` in the audit goal
workspace (authorizePage data flow, default-flag semantics,
mechanism choice, consumer map) — written before code, per the
research-first rule.

**Conviction (live + code, 2026-10-30 ~08:16–08:24 MDT).** The main
chat inspected the live authorize page read-only. Two stacked
presentation defects make production mode unobtainable through the
form for any user:

1. **Preselection by list position.** `authorizePage`
   (`src/core/oauth-handlers.js`) preselected
   `params.account || accounts[0]` — on a plain GET, simply the
   first row of `listVercelAccounts()` (`ORDER BY is_default DESC,
   label ASC`). Live, that surfaced the "RAS Acceptance Scratch"
   enrollment row instead of the owner's Robinson AI Systems
   account.
2. **Modes baked at render, never recomputed.** The Mode dropdown,
   the AUD-W disabled production option and its reason note were
   computed once for the preselected account; the page carries no
   script, so changing the account dropdown changed nothing.
   Verified live: switching to Robinson AI Systems — whose
   `production_enabled` is TRUE — left "production (not
   available)" disabled with the "switched off for this account"
   note. A disabled option can never be submitted.

**The authority layer is right.** The POST handler re-derives
`modesFor` for the SUBMITTED account (oauth-handlers.js authorize
POST branch; pinned by the existing forged-mode refusal test). A
submission carrying the real account + production would have been
accepted — the form could simply never produce it. This card fixes
the presentation layer only; POST validation is byte-identical.

**The default is a flag, not a position.** `is_default` is the
data-model default: `setDefaultOwnerAccount` sets it atomically
(exactly one row) from owner setup, and the rest of the codebase
(owner-approvals, owner-proposals, the AUD-AA removal guard) keys
on the flag. `accounts[0]` equals the flagged row only while
exactly one default exists; with none flagged, position is just
label order — arbitrary. Preselection now keys on the flag.

## What ships

`src/core/oauth-handlers.js` only (no change to `modesFor`, the
login service, routes, or POST validation):

1. **`modeView(account)` helper** — modes + disabled-production
   flag + note HTML (both AUD-W variants, verbatim strings), one
   source of truth for the initial render and the per-account map.
2. **Preselection precedence:** explicit `params.account` (resumed
   flow / error re-render keeps the user's choice) → the
   `is_default` row → `accounts[0]`.
3. **Per-account recompute:** the page embeds every account's
   modeView as a JSON block (server-generated values only — fixed
   mode names and the two fixed notes; account labels never enter
   it; `<` escaped) and a small fixed inline script swaps the Mode
   options and the note on account change, keeping a still-offered
   selection and falling back to `preview` exactly as the server
   does. The note gains a stable container; the selects gain ids.
   With script unavailable the page behaves exactly as before for
   the (now correctly preselected) default account — the script
   only extends server-rendered honesty to other selections.

**No tool-surface change** (no tool added, removed or re-shaped),
so no TOOL-CATALOG note rides this card, per drift checklist B.

## Verification

- Pre-fix render against the live-shaped fixture (switch-off row
  first, switch-on default second, production deployment):
  scratch row selected, production disabled, switch-off note, no
  script. Post-fix: default selected, production selectable, map
  carries both accounts' own views.
- New tests (tests/unit/oauth-handlers.test.js, +3): default
  preselection + per-account map + the production submission the
  old form could never produce (POST 302, code bound to the real
  account in production mode); both AUD-W note variants per
  account on a preview deployment; explicit account choice still
  winning over the default with that account's modes. Against the
  pre-fix source, exactly these 3 fail and all 11 pre-existing
  tests pass; with the fix, 14/14.
- Full local check and CI at the exact head: recorded in the PR.

Rides the nightly promotion. Live closure is the owner's next
reconnect: the consent page opens on the Robinson AI Systems
default with production selectable on the production deployment.
