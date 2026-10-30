# AUD-Z — vercel_set_working_box is reachable again: the owner-tools boundary list names it (VMCP-026 A-8, facet 2)

Implements the fix card filed 2026-10-30 in the audit goal workspace as "AUD-L (proposed)" — the repo's AUD-L was already taken (VMCP-023), so the card takes the next free ID. Facet 1 of A-8 (a team→project working-box flip) is a separate product decision and is NOT built here.

**Conviction (live, 2026-10-29 acceptance run).** AUD-I S4 shipped `vercel_set_working_box` declared `localAdmin: true`, `profiles: ['full']` — but never added its name to `LOCAL_OWNER_TOOLS` in `src/core/mcp-server.js`. `visibleToProfile` admits a localAdmin write only when the profile is `full` AND the name is on that list, so the tool was refused for every profile; the live probe on the full-profile owner seat answered "Tool unavailable for this connection." S4's unit tests exercised their own copy of the owner-tools list, so the seam was never tested as wired. Meanwhile the consent page copy promises preview-mode users this flip; until this card, mode was set only at consent.

**Fix.** One line: `vercel_set_working_box` joins `LOCAL_OWNER_TOOLS`. Nothing else about the tool changes — it stays localAdmin/owner-only; this restores the designed reach, it does not widen it. The other five owner tools were audited at the same boundary (below): all reachable, no sibling gap.

**Tests.** New `tests/unit/owner-tools-boundary.test.js` drives the REAL boundary — the production `registry` (src/tools/index.js) through `listMcpTools` and `dispatchReadOnlyTool` (src/core/mcp-server.js), which consult the REAL `LOCAL_OWNER_TOOLS`; no test-local copy of the list exists in the file. It asserts: the registry declares exactly the seven filed owner tools as localAdmin; all seven are listed for a full-profile connection; none is visible to everyday or read_only profiles; a full-profile invocation of `vercel_set_working_box` passes the gate and completes its same-mode no-op; and a non-owner profile is still refused by name with the gate's own message. Verified against the pre-fix tree: the listing and invocation cases fail there, the rest pass — the test convicts the defect it guards.

**Membership count.** The AUD-C baseline test in `tests/unit/front-door.test.js` pins full-profile catalog membership at 123; restoring this tool makes it 124, and the pin is updated to match — compact and everyday/read_only membership are byte-identical, only the owner catalog gains the tool back.

**Catalog.** No catalog change: `vercel_set_working_box` already has its TOOL-CATALOG entry (owner audience, full profile, AUD-I S4). Checklist B's catalog rule triggers on `src/tools/` changes; this change is `src/core/` plus tests and docs. A dated note is appended to TOOL-CATALOG per the AUD-X/AUD-Y precedent to record the reachability restoration.

**Observation (filed, not fixed here).** The `OWNER_TOOLS` set in `src/core/rtc-contract.js` — an audience LABEL for public RTC metadata, not a reachability gate — omits both `vercel_set_working_box` and `vercel_create_pass`, so their catalog rows are labelled builder/operator instead of owner. Cosmetic metadata, separate surface, separate decision.

**Acceptance.** Unit-proven in this packet (boundary test above; full suite and `npm run check` green at the committed range). Live closure of A-8 facet 2 rides the next release: on the owner seat, `vercel_set_working_box` must answer instead of refusing (a no-op preview→preview flip proves reach); closure note filed against VMCP-026 A-8 facet 2.

**Status.** Built 2026-10-30 (this PR). Rides the nightly promotion per the owner's batching rule.
