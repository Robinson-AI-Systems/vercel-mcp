// Public API metadata only. No credential binding, provider I/O or authorization.
import {readOpenApi} from './openapi-validation.js';
import {OPENAPI_SNAPSHOT} from './client.js';
const METHODS=new Set(['get','head','post','put','patch','delete']);
let indexed;
export function apiIndex(){
  if(indexed)return indexed;
  const seen=new Set();
  indexed=Object.entries(readOpenApi().paths).flatMap(([path,item])=>
    Object.entries(item).filter(([method])=>METHODS.has(method)).map(([method,doc])=>{
      if(!doc.operationId||seen.has(doc.operationId))throw new TypeError('Ambiguous API operation identity');
      seen.add(doc.operationId);
      return Object.freeze({op:doc.operationId,method:method.toUpperCase(),path,
        summary:String(doc.summary||doc.operationId).slice(0,180),
        tags:Object.freeze([...(doc.tags||[])]),doc,pathItem:item});
    }));
  if(indexed.length!==OPENAPI_SNAPSHOT.operations)throw new TypeError('API snapshot count mismatch');
  return Object.freeze(indexed);
}
export function apiOperation(op){
  if(typeof op!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(op))throw new TypeError('Invalid API operation');
  const row=apiIndex().find(x=>x.op===op);
  if(!row)throw new TypeError('Unknown documented API operation');
  return row;
}
function risk(row){
  const description=row.path+' '+row.op+' '+row.summary;
  return {changes:!['GET','HEAD'].includes(row.method),
    spends:/buy|purchase|renew|upgrade|credit|billing|plan|invoice|create.*(?:team|store|sandbox)|resourceconfig/i.test(description),
    secret:/token|secret|credential|password|decrypt|auth.?code|signing|environment.?variable|\/env(?:\/|$)|bypass/i.test(description),
    authorization:'Metadata only; invocation requires independently verified scope and safety policy'};
}
export const apiMetadata=row=>({op:row.op,method:row.method,path:row.path,summary:row.summary,risk:risk(row)});
export function searchApi({query,limit=10,offset=0}){
  if(typeof query!=='string'||query.trim().length<1||query.length>120||
    !Number.isInteger(limit)||limit<1||limit>20||!Number.isInteger(offset)||offset<0||offset>500)
    throw new TypeError('Invalid API search');
  const terms=query.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if(!terms.length)throw new TypeError('Search must contain words');
  const rows=apiIndex().map(row=>({row,text:[row.op,row.path,row.summary,...row.tags].join(' ').toLowerCase()}))
    .filter(({text})=>terms.every(term=>text.includes(term)))
    .sort((a,b)=>a.row.op.localeCompare(b.row.op));
  return {snapshot:OPENAPI_SNAPSHOT.date,total:rows.length,
    operations:rows.slice(offset,offset+limit).map(({row})=>apiMetadata(row)),
    nextOffset:offset+limit<rows.length?offset+limit:null};
}
function resolve(schema){
  if(!schema?.$ref)return schema;
  const parts=schema.$ref.split('/');
  if(parts.length!==4||parts[0]!=='#'||parts[1]!=='components')
    throw new TypeError('Unsupported API schema reference');
  const value=readOpenApi().components?.[parts[2]]?.[parts[3]];
  if(!value)throw new TypeError('Missing API schema reference');
  return value;
}
function trimmed(schema,depth=1){
  schema=resolve(schema);
  if(!schema)return null;
  const out=Object.fromEntries(['type','nullable','enum','required','minimum','maximum',
    'minLength','maxLength','minItems','maxItems','pattern','additionalProperties']
    .filter(k=>schema[k]!==undefined&&typeof schema[k]!=='object'||k==='enum'||k==='required')
    .filter(k=>schema[k]!==undefined).map(k=>[k,schema[k]]));
  // Bound every metadata branch, omit examples/defaults/descriptions.
  for(const key of ['enum','required'])if(Array.isArray(out[key])&&out[key].length>30){
    out[key]=out[key].slice(0,30);out[key+'Omitted']=schema[key].length-30;
  }
  if(schema.properties){
    const names=Object.keys(schema.properties);
    out.fields=names.slice(0,30);
    out.omittedFields=Math.max(0,names.length-30);
    if(depth>0)out.properties=Object.fromEntries(names.slice(0,30).map(k=>[k,trimmed(schema.properties[k],depth-1)]));
  }
  if(schema.items)out.items=depth>0?trimmed(schema.items,depth-1):{nested:true};
  for(const key of ['anyOf','oneOf','allOf'])if(schema[key]){
    out[key]=depth>0?schema[key].slice(0,5).map(x=>trimmed(x,depth-1)):[{nested:true}];
    if(schema[key].length>5)out[key+'Omitted']=schema[key].length-5;
  }
  return out;
}
export function describeApi({op,bodyField}){
  const row=apiOperation(op);
  if(bodyField!==undefined&&(typeof bodyField!=='string'||bodyField.length>120||
    !/^[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+){0,5}$/.test(bodyField)))
    throw new TypeError('Invalid body schema field');
  const body=resolve(row.doc.requestBody)?.content?.['application/json']?.schema;
  if(bodyField!==undefined){
    let schema=body;
    for(const key of bodyField.split('.')){
      const properties=resolve(schema)?.properties;
      schema=properties&&Object.hasOwn(properties,key)?properties[key]:null;
      if(!schema)throw new TypeError('Unknown API body field');
    }
    return {...apiMetadata(row),bodyField,schema:trimmed(schema,2)};
  }
  const parameters=[...(row.pathItem.parameters||[]),...(row.doc.parameters||[])].map(resolve)
    .filter(p=>['query','path'].includes(p.in));
  return {...apiMetadata(row),snapshot:OPENAPI_SNAPSHOT.date,
    parameters:parameters.slice(0,30).map(p=>({name:p.name,in:p.in,required:p.required===true,schema:trimmed(p.schema,1)})),
    omittedParameters:Math.max(0,parameters.length-30),body:trimmed(body,1),
    note:'Trimmed schema; nested/omitted fields are not permission. Use bodyField to inspect a named nested body schema; execution validates the full snapshot.'};
}
