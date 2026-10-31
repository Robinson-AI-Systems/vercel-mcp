# Owner guide — Vercel by Robinson AI Systems

**Current connection guidance (2026-10-19):** The independent, unofficial service is branded **Vercel by Robinson AI Systems**. Existing service-owned OAuth connections use `/api/mcp` directly; RTC passes can use the HTTPS API without Hub. Hub is optional. Authenticated remote desktop/mobile support must be tested per actual client; login or handshake alone is not proof (the owner's own desktop connector is in verified daily use; the formal per-client matrix remains open). The configurable RTC pass rate policy (1–600/minute, 120 default; old grants retain 60) is implemented and live. RTC write passes (R-1W) and user-controlled spend/production delegation (IN-08 as ruled; OP-2) are built — the 2026-10-30 verdict pass in `PRODUCT-AUTHORITY-AUDIT.md` records their state, and `STATUS.md` records live acceptance. Read `PRODUCT-AUTHORITY-AUDIT.md` before treating older examples as guaranteed product behavior. (Guidance updated 2026-10-31, AUD-AN.)


Examples of intended owner operations by batch, **not** a certification that every operation is deployed, owner-authorized or tested with actual Vercel resources. Several already have source implementations and fake-provider tests; verify the current connection profile, release and [STATUS](STATUS.md) acceptance row before relying on live mutations.

**Built since (2026-10-31):** the batches this note once listed as unimplemented all shipped in the 2026-10-30 build-out — buying a domain (N-3), firewall (F), team members and billing (O-2/O-4), Appliance Desk readiness and project setup (P), ship/rollback workflows (W) and domain attach (N-1) are merged and registered (240 of 241 catalog tools; see `docs/TOOL-CATALOG.md`). The rows below describe shipped behaviour; live acceptance varies per row and `STATUS.md` is its record.

| Say something like… | What happens | Batch |
|---|---|---|
| "Who am I connected to in Vercel?" | Team, PREVIEW or PRODUCTION, the expiry you chose for your key (if any — your choice, IN-04), today's spend limit | A/B |
| "Make me a preview of the feature-x branch." | Deploys a preview (never the live site), gives you the link, cleans it up later | V |
| "Why did that build fail?" | The first error in plain words, the likely cause and the exact fix | V/W |
| "Set up preview settings for this feature." | Adds preview-only settings; secret values come from your setup page, never chat | V |
| "Start an isolated 10-minute Sandbox for this test run and run the checks." | Records requested minutes without a server-imposed daily quota, discloses metered exposure and uses the currently implemented account-owner approval flow before charges (user-delegated policy modes still require separate remediation); supports bounded commands/files and run-owned stop | V-4 |
| "Prepare a synthetic preview webhook key, then send the sample deployment event." | Reveals the per-run test key on the authenticated owner page, never in chat, and sends only to an exact recorded READY preview over pinned public HTTPS | V-5 |
| "Clean up everything from that test run." | Removes exactly what that run made, nothing else | V |
| "What's live on the rental site?" | Which version is live, what's waiting, whether anything is rolling out | W |
| "Ship this preview to the live site." | Checks the build, tests and a few pages, asks you, switches over, confirms | W |
| "The site is broken — roll it back." | Goes back to the last good version after you OK it, warns about database changes | W |
| "Add the domain example.com to my project." | Attaches it, sets or lists the DNS records, waits for the certificate | N/W |
| "Buy example.com." | Shows the exact price and renewal, asks you, buys only within your spend limit | N |
| "Change the CRON_SECRET for Appliance Desk." | Makes a new random value on the server, saves it, redeploys after your OK; nobody sees it | W |
| "Is anyone attacking my site? Block this IP." | Firewall status and events; blocks after you confirm | F |
| "Who's on my Vercel team? Invite Sam as a developer." | Members and roles; invites after you confirm (shows the seat cost) | O |
| "Review my Vercel team." | Members, keys, security settings, domains renewing, spend — ok or needs attention | O |
| "Turn on spend alerts." / "Set my production branch to live." | Vercel has no API for these, so you get exact steps; it checks the result where it can | O |
| "How much is Vercel costing me this month?" | Charges by service and project vs your target, and what would lower it | O/W |
| "Is Vercel ready for Appliance Desk?" | Every item the app needs: done, fixed with your OK, or exactly what you need to click | P |
| "Set up Vercel for my new project." | Project, settings, domains and preview rules — previewed first | P |
| "Propose a different default account, daily spend cap or exact connector revocation." | An authorized full production-mode connector can submit an encrypted one-use request; you must review, confirm and reenter your passphrase on the separate setup page before anything changes. The tools are built and registered (`vercel_set_default_account`, `vercel_set_spend_limit`, `vercel_revoke_connection`); a $0 figure in `vercel_whoami` is the unset-budget default, not a block — the owner's explicit word executes, under, over or with no budget (OP-2). | B |
| "What changed in Vercel through Claude this week?" | The change log | B |
| "Undo that." | Reverses the last change when it has a clean opposite; says plainly when it doesn't | X |
| "Make a 24-hour read-only pass for Codex." | A pass shown once via owner setup; the agent uses the standalone HTTPS RTC API directly, without requiring the optional Hub | R |
| Anything else in Vercel | The universal tools find the right Vercel operation and run it with the same safety | U |

For instructions on owner-controlled activation of this server (without sharing keys with an AI), see [DEPLOY.md](DEPLOY.md). No Vercel team is connected or deployed as part of completing Batch A.

## Coding-agent development access (2026-10-13)

The implementing agent uses a renewable native OAuth connection, not a new copied RTC
pass for every retest. `rtool developer-connect ALIAS --profile full` prepares one mobile
link using the custom service. Choose the intended account/resources and authorize once;
return to chat without copying secrets. The agent reruns the command to finish privately,
then uses developer-check, developer-tools and developer-call. Existing original service
write previews, owner approvals and resource guards still apply. This developer workflow
does not reduce the finished product's tool capabilities.

On a managed POSIX cloud runner, configure RTOOL_DEVELOPER_VAULT_DIR to an absolute private
folder outside every Git checkout. The CLI creates a separate 0600 encryption key and
AES-GCM encrypted connection files in a 0700 folder; keep that private runner state for
resumes. OS credential managers remain the desktop default. Neither option places secrets
in chats, prompts, Git or shared artifacts. Initial provider consent or an expired/revoked
underlying authorization can still require a new owner sign-in. Source/tests are not
proof that the new deployed workflow has been exercised against the real provider.
