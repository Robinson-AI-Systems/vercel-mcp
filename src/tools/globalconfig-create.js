// E-3: zero-usage store creation with selected-team, slug, and durable write gates.
import {defineWrite,bindGuardedWrite,requirePreDispatch} from '../core/write.js';
import {compact,credentialLike} from '../core/util.js';
import {readProvider,writeProvider} from '../vercel/provider.js';
import {checkProtected} from './self-guard.js';
import {checkApp} from './app-guard.js';
import {STORE,SLUG,selected,listRows,schema,strictArgs} from './globalconfig-common.js';

const keys=['slug','outsideApp','confirm','dryRun','requestKey'];
const props={
  slug:{type:'string',pattern:SLUG.source,maxLength:64},
  outsideApp:{type:'boolean',const:true},
  confirm:{type:'boolean'},dryRun:{type:'boolean'},
  requestKey:{type:'string',pattern:'^[A-Za-z0-9_-]{8,128}$'}
};
function valid(a){
  strictArgs(a,keys);
  if(!SLUG.test(a.slug??'')||credentialLike(a.slug)||
    a.outsideApp!==true||a.confirm!==undefined&&typeof a.confirm!=='boolean'||
    a.dryRun!==undefined&&typeof a.dryRun!=='boolean'||
    a.requestKey!==undefined&&!/^[A-Za-z0-9_-]{8,128}$/.test(a.requestKey))
    throw new TypeError('New Global Config store needs exact safe slug and outside-app intent');
}
async function before(a,ctx){
  valid(a);
  const {client,account}=await selected(ctx,true);
  const all=listRows(await client.request('global_config_list'),account.team_id);
  if(!all.complete||all.rows.length>100||all.rows.some(x=>x.slug===a.slug))
    throw new TypeError('Unable to prove unique selected-team Global Config slug');
  return {slug:a.slug,teamId:account.team_id};
}
function context({db,connection,env,fetchImpl}){
  return {db,connection,env,fetchImpl,shape:compact,
    audit:x=>db.recordChange(x),replayStore:db.requestReplayStore(),
    guardProtected:t=>checkProtected(t,{db,connection,env}),
    guardApp:t=>checkApp(t,{db,connection,env})};
}
const write=defineWrite({
  name:'vercel_globalconfig_create',
  before,
  async preview(_a,_ctx,b){
    return 'Create empty Global Config store '+b.slug+
      ' for stored team; no tokens, items, project connections or deployment created';
  },
  async production(){
    return {production:false,why:'Creates an unlinked empty store; no production application reads'};
  },
  async targets(_a,b){
    return [{kind:'account',id:b.teamId}];
  },
  async apply(a,ctx,b,requestKey){
    const provider=await writeProvider(ctx);
    await requirePreDispatch(async()=>{
      if(provider.account.team_id!==b.teamId||
        !['team','full'].includes(provider.account.scope))
        throw new TypeError('Stored team authority changed');
      const now=await before(a,ctx);
      if(now.teamId!==b.teamId||now.slug!==b.slug)
        throw new TypeError('Global Config name or team changed');
    });
    return provider.write('global_config_create',{body:{slug:b.slug}},{
      requestKey,tool:'vercel_globalconfig_create',shapeResult:r=>{
        if(!STORE.test(r?.id??'')||r.slug!==b.slug)
          throw new TypeError('New Global Config identity unverified');
        return {id:r.id};
      }});
  },
  async verify(_a,ctx,b,created){
    if(!STORE.test(created?.id??''))return {confirmed:null};
    try{
      const {client,account}=await readProvider(ctx);
      if(account.team_id!==b.teamId)return {confirmed:null};
      const row=await client.request('global_config_get',{
        path:{edgeConfigId:created.id}});
      if(row?.id!==created.id||row.slug!==b.slug||
        row.teamId!=null&&row.teamId!==b.teamId)
        return {confirmed:false};
      const projects=row.connectedProjects??row.projects;
      // AUD-AF: the documented record reports no project links at
      // all, so demanding an array left every real create
      // unconfirmed forever. Links the record DOES report must be
      // empty; unreported linkage cannot contradict a store this
      // call just created empty and identity-proved above.
      if(Array.isArray(projects)&&projects.length>0)
        return {confirmed:false};
      return {confirmed:true,store:created.id};
    }catch{return {confirmed:null};}
  }
});
export const globalConfigCreateTools={
  tools:[{name:'vercel_globalconfig_create',writes:true,guardedWrite:true,
    profiles:['everyday','full'],area:'env',
    description:'Create a verified empty, unlinked Global Config store with owner-scoped team and durable write guards.',
    inputSchema:schema(props,['slug','outsideApp']),writeContract:write.writeContract,
    annotations:{readOnlyHint:false,destructiveHint:false}}],
  handlers:{
    vercel_globalconfig_create:bindGuardedWrite(write,context,r=>({
      isError:['refused_by_guard','outcome_unknown'].includes(r.status),
      content:[{type:'text',text:JSON.stringify(r)}]
    }))
  }
};
