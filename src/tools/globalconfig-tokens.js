// E-4: safe Global Config read-token inventory and guarded revocation.
import {defineWrite,bindGuardedWrite,requirePreDispatch, RefusalError } from '../core/write.js';
import {compact,credentialLike} from '../core/util.js';
import {writeProvider} from '../vercel/provider.js';
import {STORE,SLUG,safeLabel,exact,strictArgs,schema,output} from './globalconfig-common.js';
import {store,targets,classification,context,linkSnapshot} from './globalconfig-mutate.js';

const TOKEN=/^[A-Za-z0-9_-]{3,128}$/;
const props={
  id:{type:'string',pattern:STORE.source},
  expectedSlug:{type:'string',pattern:SLUG.source},
  expectedUpdatedAt:{type:'integer',minimum:1},
  tokenIds:{type:'array',minItems:1,maxItems:10,uniqueItems:true,
    items:{type:'string',pattern:TOKEN.source}},
  outsideApp:{type:'boolean',const:true},
  confirm:{type:'boolean'},dryRun:{type:'boolean'},
  requestKey:{type:'string',pattern:'^[A-Za-z0-9_-]{8,128}$'}
};
function metadata(raw){
  const rows=Array.isArray(raw)?raw:raw?.tokens??raw?.data;
  if(!Array.isArray(rows)||rows.length>100||
    raw?.pagination?.next!==undefined&&raw.pagination.next!==null)
    throw new RefusalError('Selected store token inventory unavailable');
  const seen=new Set();
  return rows.map(x=>{
    if(!x||!TOKEN.test(x.id??'')||seen.has(x.id)||
      safeLabel(x.label,52)===null||credentialLike(x.label))
      throw new RefusalError('Duplicate, secret-shaped or unverified token identity');
    seen.add(x.id);
    // GET may contain actual bearer strings. Never retain, log or return them.
    return {id:x.id,label:x.label,
      createdAt:Number.isSafeInteger(x.createdAt)&&x.createdAt>0?
        x.createdAt:null};
  });
}
function valid(a){
  strictArgs(a,Object.keys(props));
  if(!STORE.test(a.id??'')||!SLUG.test(a.expectedSlug??'')||
    !Number.isSafeInteger(a.expectedUpdatedAt)||a.expectedUpdatedAt<1||
    !Array.isArray(a.tokenIds)||a.tokenIds.length<1||a.tokenIds.length>10||
    a.tokenIds.some(x=>!TOKEN.test(x))||
    new Set(a.tokenIds).size!==a.tokenIds.length||
    a.outsideApp!==true||
    a.confirm!==undefined&&typeof a.confirm!=='boolean'||
    a.dryRun!==undefined&&typeof a.dryRun!=='boolean')
    throw new RefusalError('Exact token identities, store revision and owner intent required');
}
async function before(a,ctx){
  valid(a);
  if(ctx.connection?.profile!=='full')
    throw new RefusalError('Full owner profile required to revoke read tokens');
  const {client,account,row}=await store(ctx,a);
  const all=metadata(await client.request('global_config_tokens',
    {path:{edgeConfigId:row.id}}));
  const chosen=a.tokenIds.map(id=>all.find(x=>x.id===id));
  if(chosen.some(x=>!x))
    throw new RefusalError('Selected token no longer belongs to this store');
  return {id:row.id,slug:row.slug,teamId:account.team_id,
    updatedAt:row.updatedAt,itemCount:row.itemCount,
    projects:linkSnapshot(row),
    tokenIds:[...a.tokenIds].sort(),
    tokenLabels:chosen.map(x=>x.label),
    priorTokens:all.map(x=>({id:x.id,label:x.label}))};
}
function same(a,b){
  return a.id===b.id&&a.slug===b.slug&&a.teamId===b.teamId&&
    a.updatedAt===b.updatedAt&&a.itemCount===b.itemCount&&
    JSON.stringify(a.projects)===JSON.stringify(b.projects)&&
    JSON.stringify(a.priorTokens)===JSON.stringify(b.priorTokens)&&
    JSON.stringify(a.tokenIds)===JSON.stringify(b.tokenIds);
}
const revoke=defineWrite({
  name:'vercel_globalconfig_revoke_tokens',
  before,
  async preview(_a,_ctx,b){
    return 'IRREVERSIBLY revoke '+b.tokenIds.length+' read tokens ['+
      b.tokenLabels.join(', ')+'] for Global Config '+b.slug+
      ' ('+b.id+'). Connected projects: '+(b.projects===null?
        'not reported by the provider; the store is treated as live-connected':
        b.projects.join(', '))+
      '. Applications holding revoked tokens may lose access immediately';
  },
  production:classification,
  async targets(_a,b){return targets(b);},
  async apply(a,ctx,b,requestKey){
    const provider=await writeProvider(ctx);
    await requirePreDispatch(async()=>{
      if(provider.account.team_id!==b.teamId)
        throw new TypeError('Selected team changed');
      const fresh=await before(a,ctx);
      if(!same(b,fresh))
        throw new TypeError('Store or read-token inventory changed before revocation');
    });
    return provider.write('global_config_delete_tokens',
      {path:{edgeConfigId:b.id},body:{ids:b.tokenIds}},
      {requestKey,tool:'vercel_globalconfig_revoke_tokens',
        shapeResult:()=>({id:b.id,revoked:b.tokenIds.length})});
  },
  async verify(_a,ctx,b){
    try{
      const {client,account,row}=await exact(ctx,b.id);
      if(account.team_id!==b.teamId||row.slug!==b.slug||
        JSON.stringify(linkSnapshot(row))!==JSON.stringify(b.projects))
        return {confirmed:null};
      const next=metadata(await client.request('global_config_tokens',
        {path:{edgeConfigId:b.id}}));
      const retained=b.priorTokens.filter(x=>!b.tokenIds.includes(x.id));
      return {confirmed:b.tokenIds.every(id=>next.every(x=>x.id!==id))&&
        retained.every(x=>next.some(y=>y.id===x.id&&y.label===x.label))};
    }catch{return {confirmed:null};}
  }
});
export const globalConfigTokenAdminTools={
  tools:[
    {name:'vercel_globalconfig_list_tokens',writes:false,
      profiles:['read_only','everyday','full'],area:'env',
      description:'List only store token ID, label and issue timestamp; never any bearer value.',
      inputSchema:schema({id:{type:'string',pattern:STORE.source}},['id']),
      annotations:{readOnlyHint:true}},
    {name:'vercel_globalconfig_revoke_tokens',writes:true,guardedWrite:true,
      profiles:['full'],area:'env',
      description:'Revoke exact store read tokens with linked-project production and durable write guards.',
      inputSchema:schema(props,
        ['id','expectedSlug','expectedUpdatedAt','tokenIds','outsideApp']),
      writeContract:revoke.writeContract,
      annotations:{readOnlyHint:false,destructiveHint:true}}
  ],
  handlers:{
    async vercel_globalconfig_list_tokens(args,ctx){
      strictArgs(args,['id']);
      const {client,row}=await exact(ctx,args.id);
      const tokens=metadata(await client.request('global_config_tokens',
        {path:{edgeConfigId:row.id}}));
      return output({store:row.id,tokens:tokens.slice(0,20),
        shown:Math.min(tokens.length,20),capped:tokens.length>20,
        complete:tokens.length<=20,hasTokenValues:false});
    },
    vercel_globalconfig_revoke_tokens:bindGuardedWrite(revoke,context,r=>({
      isError:['refused_by_guard','outcome_unknown'].includes(r.status),
      content:[{type:'text',text:JSON.stringify(compact(r))}]
    }))
  }
};
