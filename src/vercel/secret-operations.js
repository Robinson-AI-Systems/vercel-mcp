// Universal reads never retrieve credentials, even if an endpoint is a GET.
export function secretOperation(row){
  return /token|secret|credential|password|decrypt|auth.?code|signing|sdk.?key|\/env(?:\/|$)|bypass/i
    .test(row.op+' '+row.path+' '+row.summary);
}
// Universal writes additionally refuse operations whose RESPONSE mints a
// credential (Batch U, U5). Two classes escape the read classifier's arms
// (measured against the pinned snapshot, 2026-10-30): creating a webhook
// returns its secret, and the KMS signing operations match neither
// /signing/ nor /token/ in op, path or summary. The read classifier is
// left byte-identical; this wrapper is the write side's rule.
export function secretWriteOperation(row){
  if(secretOperation(row))return true;
  if(row.op==='createWebhook')return true;
  return /^signKms(?:Message|Token)$/.test(row.op)||
    /\/kms\/.+\/sign\//.test(row.path);
}
