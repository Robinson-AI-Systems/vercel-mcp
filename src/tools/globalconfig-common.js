// E-3 Global Config: common selected-team identity and safe shape primitives.
// An absent connected-project, owner or pagination proof is UNKNOWN, never empty.
import {readProvider} from '../vercel/provider.js';
import {compact,credentialLike} from '../core/util.js';
export const STORE=/^ecfg_[A-Za-z0-9_-]{3,124}$/;
export const SLUG=/^[A-Za-z0-9_-]{1,64}$/;
export const KEY=/^[A-Za-z_][A-Za-z0-9_./-]{0,127}$/;
export const ID=/^prj_[A-Za-z0-9_-]{3,124}$/;
// AUD-D (design D-D, VMCP-010): output() no longer imposes the 8 KB inline
// display bound itself. It redacts at the result store's own 1 MB cap and
// hands the result to the shared delivery path (shapeStoredMcpResult),
// which returns it inline when it fits and stores + handles it when it
// does not — the same contract as every other tool family. Results at or
// under the inline bound are byte-identical to the previous behavior.
export const RESULT_STORE_CAP=1048576;
export const output=x=>({content:[{type:'text',text:JSON.stringify(compact(x,RESULT_STORE_CAP))}]});
export const schema=(properties,required=[])=>({
  type:'object',properties,required,additionalProperties:false
});
export function strictArgs(args,keys){
  if(!args||typeof args!=='object'||Array.isArray(args)||
    Object.keys(args).some(k=>!keys.includes(k)))
    throw new TypeError('Unsupported Global Config selector');
}
export function safeLabel(value,max=128){
  return typeof value==='string'&&value.length>0&&value.length<=max&&
    !credentialLike(value)&&!/[^\x20-\x7e]/.test(value)?value:null;
}
export async function selected(ctx,teamOnly=false){
  const {client,account}=await readProvider(ctx);
  if(teamOnly&&!['team','full'].includes(account.scope))
    throw new TypeError('Selected team credential required');
  return {client,account};
}
export function record(raw,teamId){
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||
    !STORE.test(raw.id??'')||!SLUG.test(raw.slug??'')||
    credentialLike(raw.slug)||
    (raw.teamId!=null&&raw.teamId!==teamId)||
    (raw.ownerId!=null&&raw.ownerId!==teamId))
    throw new TypeError('Unknown Global Config store owner or identity');
  // Vercel versions differ in connection metadata. Never invent a list.
  const links=raw.connectedProjects??raw.projects;
  let projects=null;
  if(links!==undefined){
    if(!Array.isArray(links)||links.length>50)
      throw new TypeError('Global Config connected-project metadata is unsafe');
    projects=links.map(x=>{
      const id=typeof x==='string'?x:x?.id??x?.projectId;
      if(!ID.test(id??''))throw new TypeError('Unknown linked project');
      return id;
    });
    if(new Set(projects).size!==projects.length)
      throw new TypeError('Duplicate linked project');
  }
  const itemCount=Number.isSafeInteger(raw.itemCount)&&raw.itemCount>=0?
    raw.itemCount:Number.isSafeInteger(raw.itemsCount)&&raw.itemsCount>=0?
      raw.itemsCount:null;
  // AUD-AF: the pinned contract names the size field sizeInBytes;
  // size was the E-3 fakes' invention, so size read back null for
  // every real store. Keep the legacy name as a fallback, the same
  // dual-name tolerance itemCount already gets above.
  const sizeRaw=Number.isSafeInteger(raw.sizeInBytes)?raw.sizeInBytes:raw.size;
  return {id:raw.id,slug:raw.slug,name:safeLabel(raw.name),
    itemCount,projects,size: Number.isSafeInteger(sizeRaw)&&sizeRaw>=0?
      sizeRaw:null,
    updatedAt:Number.isSafeInteger(raw.updatedAt)&&raw.updatedAt>0?
      raw.updatedAt:null};
}
export function listRows(page,team){
  const raw=Array.isArray(page)?page:
    page?.data??page?.edgeConfigs??page?.stores;
  if(!Array.isArray(raw)||raw.length>100)
    throw new TypeError('Global Config inventory unavailable or too large');
  const ids=new Set(),slugs=new Set();
  const rows=raw.map(x=>{
    const item=record(x,team);
    if(ids.has(item.id)||slugs.has(item.slug))
      throw new TypeError('Duplicate Global Config store metadata');
    ids.add(item.id);slugs.add(item.slug);return item;
  });
  const next=page?.pagination?.next;
  // AUD-AC completeness rule (dossier: globalconfig-create-dossier):
  // the pinned contract for GET /v1/global-config documents the 200
  // response as the bare array of ALL stores — no envelope, no
  // pagination parameters — and the live response (2026-10-30) carries
  // no pagination block either. So an inventory with no pagination
  // block IS the whole inventory, duplicate-checked and under the
  // 100-row bound above; at exactly the bound a silent provider cap
  // is indistinguishable from a genuine 100, so only an explicit
  // pagination end (next === null) certifies there. A pagination
  // block whose next is anything else never certifies.
  const paginated=page!==null&&typeof page==='object'&&
    !Array.isArray(page)&&page.pagination!==undefined&&
    page.pagination!==null;
  const verified=paginated?next===null:rows.length<100;
  return {rows,complete:verified,next:typeof next==='number'&&
    Number.isSafeInteger(next)&&next>0?next:null};
}
export async function exact(ctx,id){
  if(!STORE.test(id??''))throw new TypeError('Exact store ID required');
  const {client,account}=await selected(ctx);
  const raw=await client.request('global_config_get',{
    path:{edgeConfigId:id}});
  const row=record(raw,account.team_id);
  if(row.id!==id)throw new TypeError('Global Config identity changed');
  return {client,account,row};
}
// AUD-AF (dossier: globalconfig-mutate-dossier): the pinned contract
// documents GET .../items as a bare array of GlobalConfigItem objects
// ({key, value, ...}); the family's first fakes modelled a key map
// instead, and the items consumers accepted only that invented
// shape. Normalize every shape the contract or the family's history
// can produce into validated [key, value] entries — this is the
// items endpoint's one shape authority; allItems (mutate) and
// safeItems (below) both build from it. The documented item schema
// requires `value` (null is a legal value); a wrapped pagination
// response is never a complete inventory.
export function itemEntries(raw){
  if(raw?.pagination?.next!==undefined&&raw.pagination.next!==null)
    throw new TypeError('Paginated Global Config items are not a complete inventory');
  const body=raw?.items??raw;
  let entries;
  if(Array.isArray(body)){
    entries=body.map(item=>{
      if(!item||typeof item!=='object'||Array.isArray(item)||
        typeof item.key!=='string'||!Object.hasOwn(item,'value'))
        throw new TypeError('Global Config item inventory unverified');
      return [item.key,item.value];
    });
  }else if(body&&typeof body==='object'){
    entries=Object.entries(body);
  }else{
    throw new TypeError('Global Config item inventory unverified');
  }
  if(entries.length>200)
    throw new TypeError('Global Config item inventory unverified');
  const seen=new Set();
  for(const [key,value] of entries){
    if(!KEY.test(key)||credentialLike(key)||seen.has(key))
      throw new TypeError('Unknown Global Config item key');
    seen.add(key);
    if(value===undefined||typeof value==='function'||
      typeof value==='symbol'||typeof value==='bigint')
      throw new TypeError('Unpresentable Global Config item');
  }
  return entries;
}
export function safeItems(raw){
  const all=itemEntries(raw).map(([key,value])=>({
    key,data:compact(value,RESULT_STORE_CAP)}));
  // Never represent an unverified API response as globally complete.
  return {items:all.slice(0,20),shown:Math.min(20,all.length),
    capped:all.length>20,complete:false,
    note:'Bounded item view; full provider pagination and completeness not proven'};
}
