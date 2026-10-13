// Universal reads never retrieve credentials, even if an endpoint is a GET.
export function secretOperation(row){
  return /token|secret|credential|password|decrypt|auth.?code|signing|sdk.?key|\/env(?:\/|$)|bypass/i
    .test(row.op+' '+row.path+' '+row.summary);
}
