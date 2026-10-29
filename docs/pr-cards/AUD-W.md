# AUD-W — VMCP-025: the consent page stops silently hiding production mode

**Finding.** VMCP-025 (P2 · filed 2026-10-28): the OAuth consent page builds its Mode dropdown from `modesFor(account, env)`, which returns `['preview']` unless the account's production switch is on AND the server runs its production deployment. In both cases production simply vanished from the page — the person connecting could not tell production existed, that it was a switch away, or that a preview connection can be flipped later. Silence where IN-09's model (production stays ON; the switch is the end user's) calls for a visible, explained option.

**Fix (render-only, `src/core/oauth-handlers.js`).** When production is not among the selectable modes, the dropdown now also carries a **disabled** `production (not available)` option, and a note beside the Mode field names the actual reason:
- switch off for the account → *"Production mode is switched off for this account. The account owner can switch it on in setup or with vercel_enable_production; a connection made in preview can be flipped to production afterwards with vercel_set_working_box."*
- switch on but this server is not its production deployment → *"Production mode is offered by this server's production deployment."*

Submission validation is untouched: `modesFor` remains the authority at POST, the disabled option can never be posted into an authorization, and the existing forged-production refusal test stands unamended. When production IS available, the page is byte-identical to before.

**Tests.** The one assertion that enshrined the silent hiding (`not.toContain('value="production"')`) is amended with the cause recorded here and in the test comment: the preview-deployment case now asserts the disabled option plus the deployment reason; a new case covers the switch-off reason on a production deployment, naming both remedies.

**Acceptance.** Unit-proven in this packet. Live closure rides the bundle release: the consent page on the production deployment shows the disabled-with-reason option for a switched-off account, and the plain selectable option for Chris's (switched-on) account.

**Status.** Built 2026-10-29 (this PR). Bundles with the AUD-I release train per the owner's batching rule.
