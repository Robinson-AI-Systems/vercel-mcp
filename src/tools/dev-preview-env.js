// V-2: preview-only environment values, private inputs and per-object recovery.
import {randomBytes} from 'node:crypto';
import {defineWrite,bindGuardedWrite,requirePreDispatch} from '../core/write.js';
import {readProvider} from '../vercel/provider.js';
import {validateRequest} from '../vercel/openapi-validation.js';
import {pendingInputs} from '../core/pending-inputs.js';
import {credentialLike} from '../core/util.js';
import {common,exact,owned,safeBranch,noPreview,context,respond,
  startRun,preIntent,record,markIntent,selectedWrite} from './dev-preview-common.js';
const ENV=/^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const PENDING=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const envSource={type:'object',properties:{
  key:{type:'string',pattern:ENV.source},value:{type:'string',minLength:1,maxLength:512},
  pendingInputId:{type:'string',pattern:PENDING.source},
  generate:{type:'boolean',const:true}
},required:['key'],additionalProperties:false};
const props={...common,gitBranch:{type:'string',minLength:1,maxLength:128},
  vars:{type:'array',items:envSource,minItems:1,maxItems:5}};
const schema={type:'object',properties:props,required:['runId','project','vars'],
  additionalProperties:false};
function valid(a){
  exact(a,props,schema.required);
  if(a.gitBranch!==undefined&&(!safeBranch(a.gitBranch)||
     noPreview(a.gitBranch,a.outsideApp)))throw new TypeError('No-preview branch refused');
  if(!Array.isArray(a.vars)||a.vars.length<1||a.vars.length>5)
    throw new TypeError('One to five environment variables required');
  const seen=new Set();
  for(const item of a.vars){
    if(!item||typeof item!=='object'||Array.isArray(item)||
       Object.keys(item).some(k=>!Object.hasOwn(envSource.properties,k))||
       !ENV.test(item.key??'')||seen.has(item.key)||
       ['VERCEL_ENV','VERCEL_URL','VERCEL_REGION'].includes(item.key))
      throw new TypeError('Unsafe, duplicate or reserved environment key');
    seen.add(item.key);
    const sources=['value','pendingInputId','generate'].filter(k=>item[k]!==undefined);
    if(sources.length!==1||
       item.value!==undefined&&
         (typeof item.value!=='string'||!item.value||item.value.length>512||
          credentialLike(item.value))||
       item.pendingInputId!==undefined&&!PENDING.test(item.pendingInputId)||
       item.generate!==undefined&&item.generate!==true)
      throw new TypeError('Exactly one approved value source required per key');
  }
}
function rows(result){
  const items=result?.envs;
  if(!Array.isArray(items)||items.length>100||
     result?.pagination?.next!=null)
    throw new TypeError('Complete bounded preview environment inventory required');
  return items;
}
function matches(row,key,branch){
  const targets=Array.isArray(row?.target)?row.target:[row?.target];
  return row?.key===key&&targets.includes('preview')&&
    (row.gitBranch??null)===(branch??null);
}
export async function planPreviewEnv(a,ctx){
    valid(a);
    const b=await owned(a,ctx);
    const {client}=await readProvider(ctx);
    const current=rows(await client.request('project_env_list',
      {path:{idOrName:b.project},query:{limit:100}}));
    if(a.vars.some(v=>current.some(r=>matches(r,v.key,a.gitBranch))))
      throw new TypeError('Existing preview variable cannot be overwritten by a development run');
    const planned=a.vars.map(v=>({key:v.key,type:'encrypted',
      target:['preview'],...(a.gitBranch?{gitBranch:a.gitBranch}:{})}));
    for(const v of planned)
      validateRequest('project_env_create',{path:{idOrName:b.project},
        query:{teamId:b.teamId},body:{...v,value:'synthetic-validation-placeholder',
          comment:'rtc_run='+b.runId}});
    return {...b,planned,branch:a.gitBranch??null,priorCount:current.length};
}
const wire=defineWrite({
  name:'vercel_dev_wire_preview_env',secretIn:true,
  before:planPreviewEnv,
  async preview(_a,_ctx,b){
    return 'Create '+b.planned.length+' named encrypted preview-only environment variables in '+
      b.project+(b.branch?' on branch '+b.branch:' on all preview branches')+
      '. Private pending values and generated values never appear in chat or audit; recorded for exact cleanup.';
  },
  async production(){return {production:false,why:'Preview-only environment target'};},
  async targets(_a,b){return [{kind:'project',id:b.project,name:b.name}];},
  async apply(a,ctx,b,key){
    const provider=await selectedWrite(ctx,b);
    await requirePreDispatch(async()=>{
      const fresh=rows(await provider.read('project_env_list',
        {path:{idOrName:b.project},query:{limit:100}}));
      if(fresh.length!==b.priorCount||
         b.planned.some(v=>fresh.some(r=>matches(r,v.key,b.branch))))
        throw new TypeError('Environment inventory changed after confirmation');
    });
    await startRun(ctx,b);
    const completed=[];
    for(const v of b.planned){
      const source=a.vars.find(x=>x.key===v.key);
      let value=source.value;
      if(source.pendingInputId){
        value=await pendingInputs({db:ctx.db,env:ctx.env}).consume({
          id:source.pendingInputId,account:ctx.connection.account,kind:'env_value'});
      }else if(source.generate)value=randomBytes(32).toString('hex');
      if(typeof value!=='string'||value.length<1||value.length>65536)
        throw new TypeError('Approved value was unavailable, not consumed or too large');
      await requirePreDispatch(async()=>{
        const fresh=rows(await provider.read('project_env_list',
          {path:{idOrName:b.project},query:{limit:100}}));
        if(fresh.some(r=>matches(r,v.key,b.branch)))
          throw new TypeError('Preview key was created concurrently');
      });
      const intent=await preIntent(ctx,b,'env',v.key+'-'+(b.branch??'all'),
        {key:v.key,branch:b.branch});
      const out=await provider.write('project_env_create',{
        path:{idOrName:b.project},body:{...v,value,comment:'rtc_run='+b.runId}
      },{tool:'vercel_dev_wire_preview_env',requestKey:key,
        mutationId:'env-'+v.key,shapeResult:row=>{
          const created=row?.created??row;
          if(typeof created?.id!=='string'||created.key!==v.key||
             !Array.isArray(created.target)||created.target.length!==1||
             created.target[0]!=='preview'||(created.gitBranch??null)!==b.branch)
            throw new TypeError('Provider did not attest private preview variable metadata');
          return {id:created.id,key:v.key};
        }});
      await record(ctx,b,'env',out.id,{key:v.key,branch:b.branch,target:'preview'});
      await markIntent(ctx,b,intent);
      completed.push({id:out.id,key:v.key});
    }
    return {created:completed.map(x=>x.id)};
  },
  async verify(_a,ctx,b,r){
    if(!Array.isArray(r?.created)||r.created.length!==b.planned.length)
      return {confirmed:null};
    const {client,account}=await readProvider(ctx);
    if(account.team_id!==b.teamId)return {confirmed:null};
    const list=rows(await client.request('project_env_list',
      {path:{idOrName:b.project},query:{limit:100}}));
    const objects=await ctx.db.listDevRunObjects({account:ctx.connection.account,id:b.runId});
    return {confirmed:r.created.every((id,i)=>list.some(row=>
      row.id===id&&matches(row,b.planned[i].key,b.branch))&&
      objects.some(o=>o.object_type==='env'&&o.object_id===id)),
      count:r.created.length};
  }
});
export const devPreviewEnvTools={
  tools:[{name:'vercel_dev_wire_preview_env',area:'developer',writes:true,guardedWrite:true,
    profiles:['full'],inputSchema:schema,writeContract:wire.writeContract,
    description:'Write bounded preview-only environment variables from private or generated value sources.',
    annotations:{readOnlyHint:false,destructiveHint:false}}],
  handlers:{vercel_dev_wire_preview_env:bindGuardedWrite(wire,context,respond)}
};
