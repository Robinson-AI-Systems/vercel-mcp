// Bounded MCP read presentation: sanitized, projected, then either inline or scoped handle.
import {prepareResult} from '../core/result-rules.js';
import {summarizeObject} from '../tools/summaries.js';
import {shapeMcpResult} from './shape.js';
function text(payload){return {type:'text',text:JSON.stringify(payload)}}
const size=value=>Buffer.byteLength(JSON.stringify(value),'utf8');
export async function shapeStoredMcpResult(response,{connection,db,args={},readOnly=false,tool}={}){
  if(!readOnly)return shapeMcpResult(response,{connection,tool});
  if(!response || !Array.isArray(response.content))throw new TypeError('Invalid tool result');
  const content=[];
  for(const part of response.content){
    if(part?.type!=='text' || typeof part.text!=='string'){content.push(part);continue;}
    let parsed;
    try{parsed=JSON.parse(part.text);}catch{content.push(part);continue;}
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
