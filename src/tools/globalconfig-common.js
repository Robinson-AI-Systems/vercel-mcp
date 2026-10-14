// E-3 Global Config: common selected-team identity and safe shape primitives.
// An absent connected-project, owner or pagination proof is UNKNOWN, never empty.
import {readProvider} from '../vercel/provider.js';
import {compact,credentialLike} from '../core/util.js';
export const STORE=/^ecfg_[A-Za-z0-9_-]{3,124}$/;
export const SLUG=/^[A-Za-z0-9_-]{1,64}$/;
export const KEY=/^[A-Za-z_][A-Za-z0-9_./-]{0,127}$/;
export const ID=/^prj_[A-Za-z0-9_-]{3,124}$/;
export const output=x=>({content:[{type:'text',text:JSON.stringify(compact(x))}]});
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
  return {id:raw.id,slug:raw.slug,name:safeLabel(raw.name),
    itemCount,projects,size: Number.isSafeInteger(raw.size)&&raw.size>=0?
      raw.size:null,
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
  // A raw array is a bounded presentation, not a proof of completeness.
  const verified=Boolean(page?.pagination&&next===null);
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
export function safeItems(raw){
  const entries=raw?.items??raw;
  if(!entries||typeof entries!=='object'||Array.isArray(entries)||
    Object.keys(entries).length>200)
    throw new TypeError('Unknown Global Config item inventory');
  const all=Object.entries(entries).map(([key,value])=>{
    if(!KEY.test(key)||credentialLike(key))
      throw new TypeError('Unsafe Global Config item key');
    if(value===undefined||typeof value==='function'||
      typeof value==='symbol'||typeof value==='bigint')
      throw new TypeError('Unpresentable Global Config item');
    return {key,data:compact(value)};
  });
  // Never represent an unverified API response as globally complete.
  return {items:all.slice(0,20),shown:Math.min(20,all.length),
    capped:all.length>20,complete:false,
    note:'Bounded item view; full provider pagination and completeness not proven'};
}
