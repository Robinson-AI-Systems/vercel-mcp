// O-6: the branded public front door (RAS MCP Standard, "Branded front
// door"). One shell for both public pages so they cannot drift apart, in
// the fleet's ONE dark look — charcoal surfaces, white headlines, muted
// body text, emerald accents (owner design rule, 2026-10-30; the Robinson
// GitHub MCP's src/brand/brand.js + home-page.js are the reference
// implementation, tokens copied from robinsonaisystems.com/assets/
// brand.css). System fonts only, so no outside font request is made.
//
// The product name below is PAGE PRESENTATION ONLY (fleet naming, Chris
// 2026-10-30): stable identifiers — SERVICE_DISPLAY_NAME, the MCP server
// title, the integration slug, OAuth registration/client metadata and the
// connector registration — are deliberately NOT renamed here.
export const FRONT_DOOR_PRODUCT_NAME = 'Vercel Unleashed by Robinson AI Systems';
export const FRONT_DOOR_TAGLINE = 'Practical software. More capable AI.';
// Instructions name the branded address only (the Standard's rule); the
// pages themselves serve on every attached address.
export const BRANDED_ORIGIN = 'https://vercel.robinsonaisystems.com';
export const ICON_PATH = '/brand/icon-256.png';

export const FRONT_DOOR_CSP =
  "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'";

const BRAND_CSS =
  ':root{--bg:#0C0C0C;--surface:#1E1E1E;--text:#F8FAF8;--muted:#9FA5A3;' +
  '--border:#333;--brand:#00B67A;--teal:#00E3C2;' +
  '--grad:linear-gradient(90deg,#00B67A,#00E3C2);--err:#FF5F5F}' +
  '*{box-sizing:border-box}' +
  'body{margin:0;background:var(--bg);color:var(--text);' +
  'font:16px/1.65 "IBM Plex Sans",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}' +
  'main{max-width:640px;margin:0 auto;padding:28px 18px 48px}' +
  'header.brand{display:flex;align-items:center;gap:12px;margin-bottom:22px}' +
  'header.brand img{width:44px;height:44px;border-radius:10px}' +
  'header.brand b{display:block;font:700 18px/1.2 Inter,-apple-system,"Segoe UI",sans-serif}' +
  'header.brand small{color:var(--muted)}' +
  'h1{font:700 26px/1.2 Inter,-apple-system,"Segoe UI",sans-serif;margin:0 0 12px;letter-spacing:-.02em}' +
  'h2{font:700 19px/1.3 Inter,-apple-system,sans-serif;margin:0 0 8px}' +
  'p{margin:0 0 14px}small,.muted{color:var(--muted)}' +
  'a{color:var(--teal)}' +
  'section{border-top:1px solid var(--border);padding-top:14px;margin-top:18px}' +
  '.addr{display:block;background:var(--surface);border:1px solid var(--brand);' +
  'border-radius:12px;padding:14px;margin:10px 0 18px;' +
  'font:600 15px/1.4 ui-monospace,Menlo,Consolas,monospace;word-break:break-all;user-select:all}' +
  'code{background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:1px 6px;' +
  'font:14px/1.5 ui-monospace,Menlo,Consolas,monospace;word-break:break-all}' +
  'a.button{display:block;text-align:center;font:600 16px Inter,-apple-system,sans-serif;' +
  'color:#fff;background:var(--grad);border-radius:50px;padding:13px 20px;text-decoration:none;margin:14px 0}' +
  'ul.links{list-style:none;padding:0;display:flex;flex-wrap:wrap;gap:6px 18px}' +
  'footer{margin-top:28px;color:var(--muted);font-size:14px}' +
  // Form elements: the authorize page (AUD-AZ) is the shell's first
  // form. The status and connection pages contain no form elements,
  // so these rules leave their rendering untouched.
  'form{display:grid;gap:14px}' +
  'label{display:grid;gap:6px;color:var(--muted)}' +
  'input,select{font:inherit;padding:10px;border-radius:8px;border:1px solid var(--border);' +
  'background:var(--surface);color:var(--text)}' +
  'button{font:600 16px Inter,-apple-system,"Segoe UI",sans-serif;color:#fff;background:var(--grad);' +
  'border:0;border-radius:50px;padding:13px 20px;cursor:pointer}' +
  'button[disabled]{opacity:.45;cursor:default}' +
  'p[role="alert"]{color:var(--err)}';

export const brandHeader = () =>
  '<header class="brand"><img src="' + ICON_PATH + '" alt="" width="44" height="44"><div><b>' +
  FRONT_DOOR_PRODUCT_NAME + '</b><small>' + FRONT_DOOR_TAGLINE + '</small></div></header>';

// The footer disclaimer is the fleet's standard short block, verbatim
// (fleet disclaimer protection pass 2026-10-30 §7(b); canonical text in
// the website blueprint's Legal & disclosures section). It replaces the
// earlier one-line affiliation note so both public pages carry the
// non-affiliation, availability/change and provider-terms elements.
export const brandFooter = () =>
  '<footer>Operated by <a href="https://www.robinsonaisystems.com" rel="noopener noreferrer">' +
  'Robinson AI Systems</a>. ' +
  'Vercel Unleashed is an independent service by Robinson AI Systems and is not ' +
  'affiliated with or endorsed by Vercel. Availability, features and tools can ' +
  'change at any time, and Vercel can change or limit the service this tool works ' +
  'through — this page describes things as they stand today, not a promise about ' +
  'tomorrow. Vercel Unleashed works through your own Vercel account, and ' +
  'Vercel\'s own terms govern that account. ' +
  '<a href="/">Status</a> · <a href="/connection">My connection</a></footer>';

export function frontDoorPage({ title, heading, body }) {
  return '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + title + '</title><style>' + BRAND_CSS + '</style></head><body>' +
    '<main>' + brandHeader() +
    '<h1>' + heading + '</h1>' + body + brandFooter() + '</main>' +
    '</body></html>';
}
