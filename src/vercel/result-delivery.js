// Bounded MCP read presentation: sanitized, projected, then either inline or scoped handle.
import {prepareResult} from '../core/result-rules.js';
import {summarizeObject} from '../tools/summaries.js';
import {shapeMcpResult} from './shape.js';
function text(payload){return {type:'text',text:JSON.stringify(payload)}}
// AUD-D (design D-D, VMCP-011): stored-result symmetry for writes. An
// oversized write result is stored exactly as an oversized read is — same
// connection-scoped store, same handle — and the caller receives the
// write's own verified receipt (status, confirmed state, request key, tool)
// plus the handle, never the raw oversized payload. This runs after the
// provider write has landed and been journaled, so size must never become
// a throw the caller reads as failure: if storage itself is unavailable,
// the answer is the write executor's outcome_unknown honesty shape, which
// tells the caller to verify by read-back instead of retrying blindly.
async function shapeStoredWriteResult(response,{connection,db,tool}={}){
  if(!response || !Array.isArray(response.content))throw new TypeError('Invalid tool result');
  try{
    return shapeMcpResult(response,{connection});
  }catch(error){
    if(!(error instanceof RangeError))throw error;
  }
  const unknown=()=>shapeMcpResult({content:[text({
    status:'outcome_unknown',confirmed:null,tool:tool??null,
    reason:'The write result was too large to return and could not be stored; '+
      'verify the resource with a read-back before retrying'
  })]},{connection});
  if(!db?.putResult || !connection?.resultOwner || !connection?.account)
    return unknown();
  const content=[];
  for(const part of response.content){
    if(part?.type!=='text'||typeof part.text!=='string'){
      try{content.push(shapeMcpResult({content:[part]},{connection}).content[0]);}
      catch{return unknown();}
      continue;
    }
    let parsed;
    try{parsed=JSON.parse(part.text);}catch{parsed=part.text;}
    const count=Array.isArray(parsed)?parsed.length:
      Array.isArray(parsed?.rows)?parsed.rows.length:1;
    const summary=String(tool||'vercel_write').slice(0,100)+': '+count+' saved record(s)';
    let issued;
    try{
      issued=await db.putResult({
        account:connection.account,owner:connection.resultOwner,summary,body:parsed
      });
    }catch{return unknown();}
    const receipt=(parsed&&typeof parsed==='object'&&!Array.isArray(parsed))?{
      status:parsed.status??'applied',confirmed:parsed.confirmed??null,
      ...(typeof parsed.mode==='string'?{mode:parsed.mode}:{}),
      ...(typeof parsed.requestKey==='string'?{requestKey:parsed.requestKey}:{}),
      // A target summary joins the receipt only when it is itself small —
      // the receipt must always fit the inline bound on its own.
      ...(Array.isArray(parsed.targets)&&
        Buffer.byteLength(JSON.stringify(parsed.targets))<=500?
        {targets:parsed.targets}:{})
    }:{status:'applied',confirmed:null};
    const safe=shapeMcpResult({content:[text({
      ...receipt,tool:tool??null,resultHandle:issued.handle,
      expiresAt:issued.expiresAt,count,
      note:'Result too large to return inline; the full verified write result is '+
        'stored — call vercel_get_result with resultHandle to read it'
    })]},{connection});
    content.push(safe.content[0]);
  }
  return {...response,content};
}
export async function shapeStoredMcpResult(response,{connection,db,args={},readOnly=false,tool}={}){
  if(!readOnly)return shapeStoredWriteResult(response,{connection,db,tool});
  if(!response || !Array.isArray(response.content))throw new TypeError('Invalid tool result');
  // Do not let unsupported payload types bypass secret screening. Text
  // outside JSON is still untrusted provider output and must be redacted.
  // Validate the entire response before storing or returning any part.
  if(response.content.some(part=>part?.type!=='text'||typeof part.text!=='string'))
    throw new TypeError('Unstructured non-text read result is unavailable');
  const content=[];
  for(const part of response.content){
    let parsed;
    try{parsed=JSON.parse(part.text);}catch{parsed=part.text;}
    const {result,unknownFields}=prepareResult(parsed,{
      detail:args.detail??'summary',fields:args.fields,kind:args.resultKind,summaryMapper:summarizeObject
    });
    const presentation=unknownFields.length?{result,unknownFields}:result;
    // Try the normal secret-safe MCP presentation. Oversized results are stored,
    // never silently truncated. The owner must come from bearer authentication.
    try {
      const inline=shapeMcpResult({content:[text(presentation)]},{connection});
      content.push(inline.content[0]);
    }catch(error){
      if(!(error instanceof RangeError))throw error;
      if(!db?.putResult || !connection?.resultOwner || !connection?.account)
        throw new TypeError('Scoped result storage unavailable');
      const count=Array.isArray(result)?result.length:
        Array.isArray(result?.rows)?result.rows.length:1;
      const summary=String(tool||'vercel_read').slice(0,100)+': '+count+' saved record(s)';
      const issued=await db.putResult({
        account:connection.account,owner:connection.resultOwner,summary,body:result
      });
      const preview=JSON.stringify(result).slice(0,500);
      const safe=shapeMcpResult({content:[text({
        status:'stored',handle:issued.handle,expiresAt:issued.expiresAt,
        count,summary,preview,unknownFields,
        next:'Call vercel_get_result with this handle and optional page/fields'
      })]},{connection});
      content.push(safe.content[0]);
    }
  }
  return {...response,content};
}
