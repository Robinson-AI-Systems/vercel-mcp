// D-3: redeploy the exact existing source with its verified original target.
// Creating a build incurs unbounded metered usage: the independent owner
// ceiling gate refuses execution unless Vercel can enforce a total per-operation cap.
import {defineWrite,bindGuardedWrite,requirePreDispatch,purchaseDelegationFor} from '../core/write.js';
import {compact} from '../core/util.js';
import {scopedDeployment} from './deployments.js';
import {readProvider,writeProvider} from '../vercel/provider.js';
import {validateRequest} from '../vercel/openapi-validation.js';
import {checkProtected} from './self-guard.js';
import {checkApp} from './app-guard.js';

const ID=/^dpl_[A-Za-z0-9_-]{3,120}$/;
const PROJECT=/^[A-Za-z0-9][A-Za-z0-9_-]{1,127}$/;
const STATES=new Set(['READY','ERROR','CANCELED']);
const inputSchema={type:'object',properties:{
  deployment:{type:'string',pattern:ID.source,minLength:7,maxLength:128},
  project:{type:'string',pattern:PROJECT.source,minLength:2,maxLength:128},
  expectedState:{type:'string',enum:[...STATES]},
  expectedTarget:{type:'string',enum:['preview','production']},
  outsideApp:{type:'boolean',const:true},
  dryRun:{type:'boolean'},confirm:{type:'boolean'},
  requestKey:{type:'string',pattern:'^[A-Za-z0-9_-]{8,128}$'}
},required:['deployment','project','expectedState','expectedTarget','outsideApp'],additionalProperties:false};
function check(args){
  if(!args||typeof args!=='object'||Array.isArray(args)||
    Object.keys(args).some(k=>!Object.hasOwn(inputSchema.properties,k))||
    !ID.test(args.deployment??'')||!PROJECT.test(args.project??'')||
    !STATES.has(args.expectedState)||
    !['preview','production'].includes(args.expectedTarget)||
    args.outsideApp!==true||
    args.dryRun!==undefined&&typeof args.dryRun!=='boolean'||
    args.confirm!==undefined&&typeof args.confirm!=='boolean')
    throw new TypeError('Exact original deployment, immutable target and outside-app intent required');
}
function prove(row,before){
  if(!row||typeof row!=='object'||Array.isArray(row)||
    row.uid!=null&&row.id!=null&&row.uid!==row.id||
    (row.uid??row.id)!==before.deployment||
    row.projectId!==before.project||
    row.project?.id!=null&&row.project.id!==before.project||
    row.name!==before.name||
    (row.readyState??row.state)!==before.state||
    row.target!==before.target)
    throw new TypeError('Original deployment identity, project, state or target changed');
}
function context({db,connection,env,fetchImpl}){
  return {db,connection,env,fetchImpl,shape:compact,
    audit:x=>db.recordChange(x),replayStore:db.requestReplayStore(),
    guardProtected:targets=>checkProtected(targets,{db,connection,env}),
    guardApp:targets=>checkApp(targets,{db,connection,env})};
}
const redeploy=defineWrite({
  name:'vercel_deploy_redeploy',risk:{spend:true},
  async before(args,ctx){
    check(args);
    if(ctx.connection?.profile!=='full')throw new TypeError('Full profile required');
    const {client,account,project,verified}=await scopedDeployment(args,ctx);
    if(project!==args.project||verified.state!==args.expectedState||
      verified.target!==args.expectedTarget)
      throw new TypeError('Deployment scope, state or target mismatch');
    const original=await client.request('deployments_get',
      {path:{idOrUrl:args.deployment}});
    if(typeof original?.name!=='string'||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(original.name))
      throw new TypeError('Deployment project name is unavailable');
    const before={deployment:args.deployment,project,name:original.name,
      state:args.expectedState,target:args.expectedTarget,teamId:account.team_id};
    prove(original,before);
    const body={name:before.name,project:before.name,
      deploymentId:before.deployment,target:before.target};
    validateRequest('deployments_create',{
      query:{teamId:'team_FAKE_validation'},body
    });
    return before;
  },
  async preview(_args,_ctx,before){
    return 'Request a new '+before.target+' deployment from '+before.deployment+
      ' in '+before.project+'. Original target is preserved. This starts a billed build; '+
      'execution follows the account purchase policy (owner word or owner grant).';
  },
  async production(_args,_ctx,before){
    return {production:before.target==='production',
      why:'Redeployment inherits the original immutable target'};
  },
  async targets(_args,before){
    return [{kind:'project',id:before.project},
      {kind:'deployment',id:before.deployment,projectId:before.project}];
  },
  async spend(){
    return {cents:null,recurring:true,
      description:'New deployment incurs unbounded usage-based build charges'};
  },
  async apply(_args,ctx,before,requestKey){
    const provider=await writeProvider(ctx);
    await requirePreDispatch(async()=>{
      if(provider.account.team_id!==before.teamId||
        provider.account.scope==='project'&&provider.account.project_id!==before.project)
        throw new TypeError('Changed team or project authorization');
      const original=await provider.read('deployments_get',
        {path:{idOrUrl:before.deployment}});
      prove(original,before);
      // Defense in depth (AUD-A2): a priced build must carry purchase
      // authority — the transaction-specific consumed owner grant on the
      // grant path, or the executor's owner-word delegation on an owner
      // connection whose policy does not require a grant.
      if(!purchaseDelegationFor(ctx,'vercel_deploy_redeploy',requestKey)){
        if(ctx.purchaseApproval?.operation!=='vercel_deploy_redeploy'||
          ctx.purchaseApproval.requestKey!==requestKey)
          throw new TypeError('Independent owner approval not present');
        const grant=await ctx.db.getPurchaseIntent({
          account:ctx.connection.account,reference:ctx.purchaseApproval.reference});
        if(grant?.status!=='consumed'||!grant.consumed_at)
          throw new TypeError('Owner purchase approval not consumed');
      }
    });
    return provider.write('deployments_create',{
      body:{name:before.name,project:before.name,
        deploymentId:before.deployment,target:before.target}
    },{requestKey,tool:'vercel_deploy_redeploy',shapeResult:row=>{
      const id=row?.id??row?.uid;
      if(typeof id!=='string'||!ID.test(id)||id===before.deployment||
        row.projectId!==before.project||row.target!==before.target)
        throw new TypeError('Redeployment provider identity or target unverified');
      return {id,project:before.project,target:before.target};
    }});
  },
  async verify(_args,ctx,before,created){
    if(typeof created?.id!=='string'||!ID.test(created.id))return {confirmed:null};
    const {client,account}=await readProvider(ctx);
    if(account.team_id!==before.teamId)return {confirmed:null};
    const row=await client.request('deployments_get',
      {path:{idOrUrl:created.id}});
    return {confirmed:(row?.uid??row?.id)===created.id&&
      row.projectId===before.project&&row.target===before.target,
      deployment:created.id};
  }
});
export const deploymentRedeployTools={
  tools:[{name:'vercel_deploy_redeploy',writes:true,guardedWrite:true,
    profiles:['full'],area:'deployments',
    description:'Redeploy from an exact source preserving target; metered builds follow the account purchase policy.',
    inputSchema,writeContract:redeploy.writeContract,
    annotations:{readOnlyHint:false,destructiveHint:false}}],
  handlers:{vercel_deploy_redeploy:bindGuardedWrite(redeploy,context,result=>({
    isError:['refused_by_guard','outcome_unknown'].includes(result.status),
    content:[{type:'text',text:JSON.stringify(result)}]
  }))}
};
