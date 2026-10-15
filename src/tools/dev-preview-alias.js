// V-2 preview aliases never steal an existing hostname or serve a live deployment.
import {defineWrite,bindGuardedWrite,requirePreDispatch} from '../core/write.js';
import {readProvider} from '../vercel/provider.js';
import {validateRequest} from '../vercel/openapi-validation.js';
import {common,exact,owned,DEPLOY,context,respond,
  startRun,preIntent,record,markIntent,selectedWrite} from './dev-preview-common.js';
const HOST=/^[a-z0-9][a-z0-9-]{4,95}\.vercel\.app$/;
const props={...common,deployment:{type:'string',pattern:DEPLOY.source},
  alias:{type:'string',pattern:HOST.source}};
const schema={type:'object',properties:props,
  required:['runId','project','deployment','alias'],additionalProperties:false};
async function absent(client,alias){
  try{await client.request('release_alias_get',{path:{idOrAlias:alias}});}
  catch(e){if(e?.status===404)return;throw e;}
  throw new TypeError('Existing alias must never be reassigned by a preview workflow');
}
async function previewDeployment(client,id,project){
  const row=await client.request('deployments_get',{path:{idOrUrl:id}});
  if((row?.uid??row?.id)!==id||row.projectId!==project||row.target!=='preview'||
     row.readyState!=='READY')
    throw new TypeError('Only a READY, owner-scoped preview deployment can be aliased');
}
const aliasWrite=defineWrite({
  name:'vercel_dev_alias_preview',risk:{access:true},
  async before(a,ctx){
    exact(a,props,schema.required);
    if(!DEPLOY.test(a.deployment??'')||!HOST.test(a.alias??'')||
       !a.alias.startsWith('rtc-'+a.runId.replaceAll('_','-')+'-'))
      throw new TypeError('Alias must be run-namespaced and limited to Vercel preview space');
    const b=await owned(a,ctx,{requireRun:true});
    const objects=await ctx.db.listDevRunObjects({account:ctx.connection.account,id:b.runId});
    if(!objects.some(o=>o.object_type==='deployment'&&o.object_id===a.deployment&&
         o.project_id===b.project&&o.status==='active'))
      throw new TypeError('Deployment is not recorded and active in this run');
    const {client}=await readProvider(ctx);
    await Promise.all([previewDeployment(client,a.deployment,b.project),absent(client,a.alias)]);
    validateRequest('release_alias_assign',{path:{id:a.deployment},
      query:{teamId:b.teamId},body:{alias:a.alias}});
    return {...b,deployment:a.deployment,alias:a.alias};
  },
  async preview(_a,_ctx,b){
    return 'Assign new run-namespaced preview hostname '+b.alias+
      ' exclusively to recorded READY preview '+b.deployment+
      '. Existing aliases and all production domains are refused.';
  },
  async production(){return {production:false,why:'New run-scoped preview-only hostname'};},
  async access(){return {widens:true,who:'Holders of the explicit preview URL',
    what:'Read access through a newly assigned preview URL'};},
  async targets(_a,b){return [{kind:'deployment',id:b.deployment,projectId:b.project},
    {kind:'domain',id:b.alias}];},
  async apply(_a,ctx,b,key){
    const provider=await selectedWrite(ctx,b);
    await requirePreDispatch(async()=>{
      const client={request:(...x)=>provider.read(...x)};
      await Promise.all([previewDeployment(client,b.deployment,b.project),
        absent(client,b.alias)]);
    });
    await startRun(ctx,b);
    const intent=await preIntent(ctx,b,'alias',b.alias,
      {deployment:b.deployment,alias:b.alias});
    const result=await provider.write('release_alias_assign',{
      path:{id:b.deployment},body:{alias:b.alias}
    },{tool:'vercel_dev_alias_preview',requestKey:key,mutationId:'preview-alias',
      shapeResult:row=>{
        if(row?.alias!==b.alias||row?.oldDeploymentId!=null||
           typeof row.uid!=='string')
          throw new TypeError('Alias was silently moved or identity could not be proven');
        return {id:row.uid,alias:row.alias};
      }});
    await record(ctx,b,'alias',result.id,{name:b.alias,deployment:b.deployment});
    await markIntent(ctx,b,intent);
    return {aliasId:result.id,alias:result.alias};
  },
  async verify(_a,ctx,b,r){
    if(!r?.aliasId)return {confirmed:null};
    const {client,account}=await readProvider(ctx);
    if(account.team_id!==b.teamId)return {confirmed:null};
    const item=await client.request('release_alias_get',{path:{idOrAlias:r.aliasId}});
    const objects=await ctx.db.listDevRunObjects({account:ctx.connection.account,id:b.runId});
    return {confirmed:(item?.uid??item?.id)===r.aliasId&&item.alias===b.alias&&
      (item.deploymentId??item.deployment?.id)===b.deployment&&
      objects.some(o=>o.object_type==='alias'&&o.object_id===r.aliasId)};
  }
});
export const devPreviewAliasTools={
  tools:[{name:'vercel_dev_alias_preview',area:'developer',writes:true,guardedWrite:true,
    profiles:['full'],inputSchema:schema,writeContract:aliasWrite.writeContract,
    description:'Add a new run-scoped hostname to a READY tracked preview; refuses alias reassignment.',
    annotations:{readOnlyHint:false,destructiveHint:false}}],
  handlers:{vercel_dev_alias_preview:bindGuardedWrite(aliasWrite,context,respond)}
};
