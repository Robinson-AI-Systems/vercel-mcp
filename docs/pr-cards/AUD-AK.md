# AUD-AK — Front-door disclaimer: fleet standard block in the shared footer + as-is sentence on /connection

**Baseline inspected:** main `4afc8fb` (O-6 design correction, #340).
Source of the texts: Chris's fleet-wide disclaimer protection pass,
2026-10-30, §7(b) — the texts are frozen and reproduced verbatim;
their canonical home is the website blueprint's Legal & disclosures
section (site repo `docs/WEBSITE-BLUEPRINT.md`).

**The gap.** The fleet's standard disclaimer block has three
elements: non-affiliation, availability/change ("tools can change or
be limited by the provider"), and third-party dependency (the
provider's own terms govern). The Vercel MCP's public pages carried
only the non-affiliation element, as the one-line footer note
"Not affiliated with or endorsed by Vercel.", and no as-is line
anywhere. The availability/change element and the as-is line were
missing.

**The change (two edits, both in the O-6 front-door surface).**

1. `src/front-door.js` `brandFooter()`: the one-line footer note is
   replaced with the full standard block, so the front door and
   /connection both carry it via the shared shell:

   "Vercel Unleashed is an independent service by Robinson AI
   Systems and is not affiliated with or endorsed by Vercel.
   Availability, features and tools can change at any time, and
   Vercel can change or limit the service this tool works through —
   this page describes things as they stand today, not a promise
   about tomorrow. Vercel Unleashed works through your own Vercel
   account, and Vercel's own terms govern that account."

   Per §7(b)'s one-edit-point scoping, the in-body affiliation
   mentions (the status page's small-print line, the connection
   page's "Where things stand" paragraph) are unchanged.
2. `api/connection.js`: one sentence added after the plan-limits
   paragraph in "What it cannot do":

   "Vercel Unleashed is provided as-is, without warranties of any
   kind, and with no service-level guarantee."

## Drift check

- Presentation/copy only: no tool is added, removed or changed —
  the registry stays 240 and `docs/TOOL-CATALOG.md` is untouched.
  No schema, route, CSP or behaviour change; the shared shell is
  the only render path for both pages, so one footer edit covers
  both, exactly as §7(b) scoped it.
- This PR changes this card and a STATUS bullet in its first
  commit, per checklist B.
- The texts contain no identifiers and no secrets; the secret scan
  is part of the check.

## Acceptance

- `tests/unit/landing-status.test.js`: the root page carries the
  full block verbatim and does NOT carry the as-is sentence (it
  belongs to /connection only); the pre-existing in-body small-print
  pin is unchanged.
- `tests/unit/connection-page.test.js`: /connection carries the
  full block verbatim and the as-is sentence verbatim, positioned
  after the plan-limits paragraph. No pre-existing expectation
  changed — the old footer line was asserted only as the substring
  "not affiliated with or endorsed by Vercel", which the new block
  still contains.
- `npm run check` green; the change rides the 2026-11-01 00:01 MDT
  nightly promotion (next-batch material — no daytime promotion).
