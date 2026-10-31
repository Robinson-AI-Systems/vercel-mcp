// O-6: the branded public front door (RAS MCP Standard, "Branded front
// door"). One shell for both public pages so they cannot drift apart.
//
// The product name below is PAGE PRESENTATION ONLY (fleet naming, Chris
// 2026-10-30): stable identifiers — SERVICE_DISPLAY_NAME, the MCP server
// title, the integration slug, OAuth registration/client metadata and the
// connector registration — are deliberately NOT renamed here.
export const FRONT_DOOR_PRODUCT_NAME = 'Vercel Unleashed by Robinson AI Systems';
// Instructions name the branded address only (the Standard's rule); the
// pages themselves serve on every attached address.
export const BRANDED_ORIGIN = 'https://vercel.robinsonaisystems.com';

const STYLE =
  '<style>' +
  'body{margin:0;background:#F8FAF8;color:#0C0C0C;' +
  'font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif;line-height:1.55}' +
  'header{background:linear-gradient(90deg,#006E56,#00B67A 55%,#00E3C2);' +
  'color:#F8FAF8;padding:14px 20px;font-weight:600;letter-spacing:.01em}' +
  'main{max-width:44rem;margin:0 auto;padding:28px 20px 40px}' +
  'h1{font-size:1.7rem;margin:.2em 0 .5em;color:#006E56}' +
  'h2{font-size:1.15rem;margin:1.4em 0 .4em;color:#006E56}' +
  'a{color:#006E56;font-weight:600}' +
  '.card{background:#fff;border:1px solid #dfe9e4;border-radius:12px;' +
  'padding:18px 20px;margin:18px 0}' +
  '.cta{display:inline-block;background:#00B67A;color:#fff;text-decoration:none;' +
  'padding:10px 18px;border-radius:999px;margin:6px 10px 6px 0}' +
  'code{background:#eef5f1;padding:1px 6px;border-radius:6px;' +
  'font-family:"JetBrains Mono",ui-monospace,monospace;font-size:.92em;' +
  'overflow-wrap:anywhere}' +
  'footer{max-width:44rem;margin:0 auto;padding:0 20px 32px;color:#44554d;' +
  'font-size:.92rem}' +
  '</style>';

export function frontDoorPage({ title, heading, body }) {
  return '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + title + '</title>' +
    '<link rel="preconnect" href="https://fonts.googleapis.com">' +
    '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&display=swap" rel="stylesheet">' +
    STYLE + '</head><body>' +
    '<header>' + FRONT_DOOR_PRODUCT_NAME + '</header>' +
    '<main><h1>' + heading + '</h1>' + body + '</main>' +
    '<footer><p>Independent third-party integration; not affiliated with or endorsed by Vercel.</p>' +
    '<p><a href="/">Status</a> · <a href="/connection">My connection</a> · ' +
    '<a href="/api/vercel/setup">Owner setup</a></p></footer>' +
    '</body></html>';
}
