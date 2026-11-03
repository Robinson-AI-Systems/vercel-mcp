# Vercel Unleashed — Page and Brand Blueprint

This is Vercel's own blueprint: how this product is branded, where
its mark appears, how its instructions page is structured, and how
it goes onto the website. The branding RULES live in
[UNLEASHED-BRAND-SPEC.md](UNLEASHED-BRAND-SPEC.md) — that spec is
the single source for the rules and this doc does not duplicate
it; this doc records how the rules land on this one product. The
canonical record of claimed names, accents and slugs is the
Library registry named in the spec (§3, §8); if this doc and the
registry ever disagree, the registry wins.

## 1. The product and its assigned mark

- Product name, in full on first reference: **Vercel Unleashed by
  Robinson AI Systems** (spec §4). "Vercel Unleashed" thereafter.
- Assigned accent: **Sky `#5FA8FF`** (spec §3) — the flat shard
  color in the Break-Out mark. Never Vercel's own brand color,
  never another product's accent, never the master-gradient mark
  (that one is the product LINE's own identity, spec §1).
- Assigned mark file: `docs/unleashed-vercel.png` is the repo's
  reference render of the Sky-accent mark.
- Required disclaimer (spec §6), carried on the connect surfaces
  in the fleet's standard footer wording: Vercel Unleashed is a
  Robinson AI Systems product; it is not affiliated with,
  endorsed by, or sponsored by Vercel.

## 2. Where the mark appears (this server)

Per spec §7, a product's OAuth/app logo, favicon, connector icon
and social avatar all use its own accent file — one mark, every
surface, no per-surface improvisation. On this server that is:

| Surface | How it is served |
|---|---|
| Page header logo (home page, `/connection`, sign-in and every page on the shared shell) | `/brand/icon-256.png`, the 256 px derivative of the assigned mark |
| Favicon | The shell declares `/brand/icon-256.png` as the page icon |
| Connector / app icon (the `/brand/icon-256.png` and `/brand/icon-64.png` routes) | 256 px and 64 px derivatives of the assigned mark |

Mechanics: derivatives are generated from the master render and
carried as base64 PNGs in `src/brand-assets.js` — the codebase's
one-function, no-static-folder pattern — and served by
`api/index.js`. The company R mark is the Robinson AI Systems
company mark; it is not this product's mark and does not appear
on this product's pages (the pre-spec front door carried it as a
placeholder; AUD-BW replaced it).

## 3. The instructions page

- **Where it lives:** the home page, `https://vercel.robinsonaisystems.com/`
  — browsers get the HTML page; programs keep the plain JSON
  status from the same address. The connect section is `#connect`.
  `/connection` ("My connection": what a connection can and
  cannot do, and how to disconnect) links to it, and the shared
  footer links it from every page. Placement reasoning is
  recorded on the AUD-BW card (`docs/pr-cards/AUD-BW.md`).
- **Structure** (modeled on GitHub Unleashed's home page): what
  the service does, the one server address in a bordered,
  selectable block — `https://vercel.robinsonaisystems.com/api/mcp`
  — then one section per client, in this order: **Muse**,
  **Claude (web, desktop and phone)**, **ChatGPT**,
  **Claude Code**, **Cursor**. Each section gives that client's
  own steps and ends at the same place: sign in with your own
  Vercel account.
- **The Muse-only Client ID rule:** the Client ID paste step
  appears ONLY in the Muse section — Muse users paste the
  server's own client document
  (`https://vercel.robinsonaisystems.com/.well-known/muse-client.json`)
  as the Client ID and leave the Secret blank. Claude, ChatGPT,
  Claude Code, Cursor and every other client leave Client ID and
  Client Secret blank: the app identifies itself automatically.
  The Muse document declares only Muse's own return address, so
  pasting it into any other client fails (AUD-BV). A unit test
  pins the document address to the Muse section alone.
- **Look:** the fleet's one dark look via the shared shell in
  `src/front-door.js` — charcoal `#0C0C0C`, graphite surfaces,
  emerald-to-teal gradient accents, Inter/IBM Plex Sans system
  fonts, the product lockup (mark left of the name, spec §4) and
  the standard footer disclaimer.

## 4. How it goes onto the website

- **Listing:** robinsonaisystems.com's `/tools` listing carries
  Vercel Unleashed with its Sky-accent mark, its full name on
  first reference, and a link to the server's own home page
  (above) — the listing points at the instructions; it does not
  copy them, so the steps can never drift into two versions.
- **Its own page:** the website's branded connection/instructions
  page for Vercel Unleashed uses the same assigned mark and the
  same lockup, names the same server address, and sends the
  reader to the server's home page for the per-client steps. The
  Muse-only Client ID rule is stated there exactly as here if the
  page repeats any connect steps at all.
- **The line's page:** the website's Unleashed section as a whole
  uses the master-gradient mark — the product line's own identity
  (spec §1) — never as Vercel's mark; Vercel's entry inside it
  carries the Sky-accent mark.
