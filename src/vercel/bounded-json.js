// A narrow, byte-capped parser for JSON that may contain deployment file bytes.
// Never read an unbounded response with Response.json()/text()/arrayBuffer().
export async function readBoundedJson(response, signal, maxBytes = 8192) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 65536) {
    throw new TypeError('Invalid read response budget');
  }
  const mime = response.headers?.get('content-type')?.toLowerCase() ?? '';
  if (!/^application\/(?:json|[a-z0-9.+-]+\+json)\b/.test(mime)) {
    throw new TypeError('Provider file response was not JSON');
  }
  // Reject an explicitly over-budget provider response before reading any body.
  const declared=response.headers?.get('content-length');
  if(declared!=null && (!/^(0|[1-9][0-9]*)$/.test(declared) ||
    !Number.isSafeInteger(Number(declared)) || Number(declared)>maxBytes))
    throw new TypeError('Provider file response declared an unsafe byte length');
  const reader = response.body?.getReader?.();
  if (!reader) throw new TypeError('Provider file response is unreadable');
  const decoder = new TextDecoder('utf-8', {fatal:true});
  let text = '', total = 0;
  let abort;
  const timeout = new Promise((_, reject) => {
    abort = () => reject(new TypeError('Provider file response exceeded time budget'));
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, {once:true});
  });
  try {
    while (true) {
      const {done, value} = await Promise.race([reader.read(), timeout]);
      if (done) break;
      if (!(value instanceof Uint8Array)) throw new TypeError('Invalid provider file bytes');
      total += value.byteLength;
      if (total > maxBytes) throw new TypeError('Provider file response exceeded byte budget');
      text += decoder.decode(value, {stream:true});
    }
    text += decoder.decode();
    // SyntaxError messages from JSON.parse may quote the upstream source.
    // Do not reflect any provider-controlled payload fragments into errors.
    try{return JSON.parse(text);}
    catch{throw new TypeError('Invalid provider file JSON');}
  } finally {
    if (abort) signal?.removeEventListener('abort', abort);
    // A malicious or long-lived response must not keep the invocation open.
    Promise.resolve(reader.cancel()).catch(() => {});
  }
}
