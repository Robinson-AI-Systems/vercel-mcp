# Owner guide — what you can ask for

Plain-English things to say to Claude once each part is built. Each line names the batch that delivers it; until then
it does not work yet. This file is updated as features ship.

| Say something like… | What happens | Batch |
|---|---|---|
| "Who am I connected to in Vercel?" | Team, PREVIEW or PRODUCTION, your key's expiry, today's spend limit | A/B |
| "Make me a preview of the feature-x branch." | Deploys a preview (never the live site), gives you the link, cleans it up later | V |
| "Why did that build fail?" | The first error in plain words, the likely cause and the exact fix | V/W |
| "Set up preview settings for this feature." | Adds preview-only settings; secret values come from your setup page, never chat | V |
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
| "What changed in Vercel through Claude this week?" | The change log | B |
| "Undo that." | Reverses the last change when it has a clean opposite; says plainly when it doesn't | X |
| "Make a 24-hour read-only pass for Codex." | A pass shown once on your setup page; the agent uses it through Robinson's Toolkit (`rtool`) or the HTTPS API | R |
| Anything else in Vercel | The universal tools find the right Vercel operation and run it with the same safety | U |
