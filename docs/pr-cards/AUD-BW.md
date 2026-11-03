# AUD-BW — Per-client instructions page + Vercel Unleashed product mark (owner order)

Filed 2026-11-02 on the owner's order: Vercel's server gets a proper
per-client instructions page like GitHub's server has, Vercel's
assigned Unleashed logo on its pages, and Vercel's own branding/page
blueprint doc. AUD-BV (#412) already split the `/connection` page's
Client ID paragraph by client; this card keeps that split correct
and carries the same directions onto the home page, per client.

## Placement decision (recorded per the brief)

GitHub's server serves its instructions as its home page
(`src/brand/home-page.js` in Robinson-AI-Systems/github-mcp: the
`/` page carries the address block and one section per client).
Vercel's root is the same shape already: programs (health checks,
scripts) get the plain JSON status, and browsers already get an
HTML front door from the same handler (`api/index.js`). So the
per-client instructions go **on the root page's browser HTML** —
the best-fitting placement in this codebase — not on a new route:
no new rewrite, no new handler, and the JSON status programs rely
on is byte-unchanged. `/connection` keeps its AUD-BV split and
gains a link to the home page's connect section (`/#connect`), and
the shared footer links the connect section too, so every public
page reaches the instructions in one tap.

The page lives at: **`https://vercel.robinsonaisystems.com/`**
(browser HTML; the connect section is `#connect`).

## The instructions (proven facts, not re-litigated)

Server address, everywhere:
`https://vercel.robinsonaisystems.com/api/mcp`.

Per-client sections, modeled on GitHub's home page, adapted to
Vercel (sign-in is with the reader's own Vercel account):

- **Muse** (Meta's personal assistant) — the ONLY section with a
  Client ID step: paste the server's own client document,
  `https://vercel.robinsonaisystems.com/.well-known/muse-client.json`,
  as the Client ID; leave the Client Secret blank.
- **Claude (web, desktop and phone)** — Customize → Connectors →
  Add custom connector → paste the address → Add → Connect → sign
  in with Vercel. Client ID and Client Secret stay blank — the
  app identifies itself automatically. (Copy is outcome-level on
  purpose: Claude identifies itself with its own client document
  (CIMD), not through this server's registration endpoint, and
  this server does not accept that document yet — AUD-BX (CIMD
  resolution, a separate card on its own branch, OAuth core) is
  what makes the Claude path work end to end. No page in this PR
  claims the Claude path is live-proven; the Muse path is the
  proven one.)
- **ChatGPT** — on a phone, add it from the phone's web browser,
  then use it in the app. Plugins → plus → Add custom MCP server →
  name + address → OAuth → confirm → Create as a plugin → install
  → sign in with Vercel. Client ID and Secret blank, same rule.
- **Claude Code** —
  `claude mcp add --transport http vercel-unleashed https://vercel.robinsonaisystems.com/api/mcp`,
  then `/mcp` inside Claude Code to sign in.
- **Cursor** — a `mcpServers` entry with the address in
  `.cursor/mcp.json` (or `~/.cursor/mcp.json`), then sign in when
  asked. Client ID and Secret blank, same rule.

The Muse client document appears ONLY in the Muse section; a
test pins the count and the per-section split.

## Branding (per docs/UNLEASHED-BRAND-SPEC.md)

The spec is the single source for the rules; §7 is explicit: a
product's OAuth/app logo, favicon, connector icon and social
avatar all use its own accent file — no per-surface improvisation.
Vercel Unleashed's assigned mark is the Sky-accent Break-Out
(`docs/unleashed-vercel.png`, accent Sky `#5FA8FF`, §3). The spec
does NOT keep the company R as this product's icon: the R was the
pre-spec placeholder this server inherited from the fleet's first
front door. So the served brand asset changes, in the codebase's
existing pattern (base64 PNGs in `src/brand-assets.js`, served by
`api/index.js` at `/brand/icon-256.png` and `/brand/icon-64.png`):
256 px and 64 px derivatives are generated from the repo's master
render, and those bytes now back the page header logo on every
page the shared shell renders (home, `/connection`, sign-in and
the rest), the `/brand/icon-*` routes, and the favicon the shell
now declares. The master render stays in `docs/` as the design
reference, per §7.

## Blueprint doc

`docs/PAGE-AND-BRAND-BLUEPRINT.md` records how Vercel Unleashed is
branded, its assigned mark and where it appears, how the
instructions page is structured (per-client sections; the
Muse-only Client ID rule), and how it goes onto the website.
It cross-references the brand spec; it does not duplicate it.

## Scope notes

- No tool added, removed, or renamed; the registry is unchanged,
  so no TOOL-CATALOG note is needed.
- No OAuth behavior changed: the Muse client document, dynamic
  registration, and every client's flow are byte-unchanged.
- Batches with the nightly release train; no daytime release.
  Until the promotion lands, production still serves the old
  build — the new page and mark go live on tonight's promotion.
