// Bounded MCP read presentation: sanitized, projected, then either inline or scoped handle.
import {prepareResult} from '../core/result-rules.js';
import {summarizeObject} from '../tools/summaries.js';
import {shapeMcpResult} from './shape.js';
function text(payload){return {type:'text',text:JSON.stringify(payload)}}
export async function shapeStoredMcpResult(response,{connection,db,args={},readOnly=false,tool}={}){
  if(!readOnly)return shapeMcpResult(response,{connection,tool});
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
