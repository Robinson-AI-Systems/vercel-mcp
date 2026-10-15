// D-4: complete owner-gated production rolling-release lifecycle.
import {defineWrite,bindGuardedWrite,requirePreDispatch} from '../core/write.js';
import {compact} from '../core/util.js';
import {writeProvider} from '../vercel/provider.js';
import {accountSpendGuard} from '../vercel/spend.js';
import {checkProtected} from './self-guard.js';
import {checkApp} from './app-guard.js';
import {schema,ownedAliases,currentDeployment,targetDeployment,DEPLOY}
  from './release-common.js';
import {shared,exact,stageArray,rollingSnapshot,configFingerprint,
  sameRollout,releaseTargets} from './release-rolling-common.js';

const props={
  ...shared,
  deployment:{type:'string',pattern:DEPLOY.source},
  expectedCurrent:{type:'string',pattern:DEPLOY.source},
  expectedStageIndex:{type:'integer',minimum:0,maximum:9},
  expectedUpdatedAt:{type:'integer',minimum:0},
  expectedConfigHash:{type:'string',pattern:'^[a-f0-9]{64}$'},
  enabled:{type:'boolean'},
  advancementType:{type:'string',enum:['automatic','manual-approval']},
  stages:{type:'array',minItems:2,maxItems:10,items:{
    type:'object',additionalProperties:false,
    properties:{targetPercentage:{type:'integer',minimum:0,maximum:100},
      duration:{type:'integer',minimum:1,maximum:1440},
      requireApproval:{type:'boolean'}},
    required:['targetPercentage']}}
};
const names={
  config:'vercel_rolling_update_config',
  start:'vercel_rolling_start',
  approve:'vercel_rolling_approve_stage',
  complete:'vercel_rolling_complete'
};
const input={
  config:['project','enabled','expectedConfigHash','outsideApp'],
  start:['project','deployment','expectedCurrent','outsideApp'],
  approve:['project','deployment','expectedCurrent',
    'expectedStageIndex','expectedUpdatedAt','outsideApp'],
  complete:['project','deployment','expectedCurrent',
    'expectedStageIndex','expectedUpdatedAt','outsideApp']
};
const allowed={
  config:['project','enabled','advancementType','stages','expectedConfigHash',
    'outsideApp','dryRun','confirm','requestKey'],
  start:['project','deployment','expectedCurrent','outsideApp',
    'dryRun','confirm','requestKey'],
  approve:['project','deployment','expectedCurrent','expectedStageIndex',
    'expectedUpdatedAt','outsideApp','dryRun','confirm','requestKey'],
  complete:['project','deployment','expectedCurrent','expectedStageIndex',
    'expectedUpdatedAt','outsideApp','dryRun','confirm','requestKey']
};
function verifyInput(a,kind){
  exact(a,Object.fromEntries(allowed[kind].map(k=>[k,props[k]])),input[kind]);
  if(a.outsideApp!==true ||
    kind==='config'&&(a.enabled===true&&
      (!['automatic','manual-approval'].includes(a.advancementType)||
        !Array.isArray(a.stages))||
      a.enabled===false&&(a.stages!==undefined||a.advancementType!==undefined))||
    kind!=='config'&&(!DEPLOY.test(a.deployment??'')||
      !DEPLOY.test(a.expectedCurrent??'')||
      a.deployment===a.expectedCurrent)||
    ['approve','complete'].includes(kind)&&
      (!Number.isSafeInteger(a.expectedStageIndex)||
        a.expectedStageIndex<0||a.expectedStageIndex>9||
        !Number.isSafeInteger(a.expectedUpdatedAt)||
        a.expectedUpdatedAt<=0))
    throw new TypeError('Exact selected rolling release, production authority and intent required');
}
function stageKey(stages){
  return JSON.stringify(stages.map(x=>({targetPercentage:x.targetPercentage,
    duration:x.duration??null,requireApproval:x.requireApproval===true})));
}
function plannedConfig(a){
  if(a.enabled===false)return {enabled:false};
  return {enabled:true,advancementType:a.advancementType,
    stages:stageArray(a.stages),target:'production'};
}
async function candidate(a,ctx,kind){
  verifyInput(a,kind);
  if(ctx.connection?.profile!=='full')
    throw new TypeError('Rolling releases require full owner profile');
  const s=await rollingSnapshot(a,ctx,
    {billing:kind==='config'||kind==='start'});
  const configHash=configFingerprint(s.config);
  if(kind==='config'){
    if(configHash!==a.expectedConfigHash)
      throw new TypeError('Rolling-release configuration changed since preview');
    if(s.rollout?.state==='ACTIVE'||s.rollout?.state==='PAUSED')
      throw new TypeError('Active traffic must be completed or rolled back before changing config');
    if(a.enabled===true && !s.billing?.eligible)
      throw new TypeError('Rolling-release billing/slot eligibility cannot be proven');
    const desired=plannedConfig(a);
    if(a.enabled===s.config.enabled&&
      (a.enabled===false||
        desired.advancementType===s.config.advancementType&&
        stageKey(desired.stages)===stageKey(s.config.stages)))
      throw new TypeError('No rolling-release configuration change requested');
    return {project:s.project,teamId:s.account.team_id,kind,
      desired,configHash,rollout:s.rollout,billing:s.billing,
      previous:s.config,targets:releaseTargets(s)};
  }
  if(!s.config.enabled||s.config.stages.length<2)
    throw new TypeError('Project does not have verified enabled rolling-release configuration');
  if(kind==='start'){
    if(!s.billing?.eligible)
      throw new TypeError('Provider rolling-release slot unavailable');
    if(s.rollout?.state==='ACTIVE'||s.rollout?.state==='PAUSED')
      throw new TypeError('An active rolling release already exists');
    const aliases=await ownedAliases(s,s.project);
    if(currentDeployment(aliases)!==a.expectedCurrent)
      throw new TypeError('Current production deployment changed');
    const target=await targetDeployment({...ctx,account:s.account},
      s.project,a.deployment);
    if(target.servedAt!==null)
      throw new TypeError('Rollout target must be a never-serving staged deployment');
    return {project:s.project,teamId:s.account.team_id,kind,
      canary:a.deployment,current:a.expectedCurrent,
      configHash,rollout:s.rollout,aliases,
      targets:[...releaseTargets(s,a.deployment),
        {kind:'deployment',id:a.expectedCurrent,projectId:s.project},
        ...aliases.map(x=>({kind:'domain',id:x.domain,projectId:s.project}))]};
  }
  const r=s.rollout;
  if(!r||r.state!=='ACTIVE'||r.substate==='PAUSED'||
    r.canary!==a.deployment||r.current!==a.expectedCurrent||
    r.stageIndex!==a.expectedStageIndex||
    r.updatedAt!==a.expectedUpdatedAt)
    throw new TypeError('Rolling release is absent, paused or changed since preview');
  if(kind==='approve'&&(!r.requiresApproval||
    r.nextStageIndex!==r.stageIndex+1||r.finalStage))
    throw new TypeError('Next rolling-release stage is not awaiting approval');
  if(kind==='complete'&&r.finalStage)
    throw new TypeError('Rolling release is already at the final stage');
  const old=await targetDeployment({...ctx,account:s.account},
    s.project,r.current);
  const target=await targetDeployment({...ctx,account:s.account},
    s.project,r.canary);
  if(old.id!==r.current||target.id!==r.canary)
    throw new TypeError('Deployment identities changed during rollout');
  return {project:s.project,teamId:s.account.team_id,kind,
    canary:r.canary,current:r.current,
    configHash,rollout:r,targets:releaseTargets(s,r.canary)};
}
function context({db,connection,env,fetchImpl}){
  return {db,connection,env,fetchImpl,shape:compact,
    audit:item=>db.recordChange(item),
    replayStore:db.requestReplayStore(),
    guardProtected:targets=>checkProtected(targets,{db,connection,env}),
    guardApp:targets=>checkApp(targets,{db,connection,env}),
    checkSpend:accountSpendGuard({db,account:connection.account})};
}
function sameBefore(a,b){
  return a.project===b.project&&a.teamId===b.teamId&&
    a.kind===b.kind&&a.configHash===b.configHash&&
    JSON.stringify(a.desired)===JSON.stringify(b.desired)&&
    a.canary===b.canary&&a.current===b.current&&
    JSON.stringify(a.aliases)===JSON.stringify(b.aliases)&&
    (a.rollout===null&&b.rollout===null||
      a.rollout!==null&&b.rollout!==null&&
      sameRollout(a.rollout,b.rollout));
}
function factory(kind){
  const name=names[kind];
  return defineWrite({
    name,risk:kind==='config'||kind==='start'?{spend:true}:undefined,
    before:(a,ctx)=>candidate(a,ctx,kind),
    async preview(_a,_ctx,b){
      if(kind==='config')return 'UPDATE rolling-release configuration for '+
        b.project+' from '+JSON.stringify(b.previous)+' to '+
        JSON.stringify(b.desired)+'. Current active releases must be absent. '+
        (b.desired.enabled?'Enabling may bill the account; independently approved provider-enforceable total charge ceiling required.':
          'Disabling prevents new rolling releases; no active rollout is modified.');
      if(kind==='start')return 'START rolling release from '+b.current+
        ' to staged READY production deployment '+b.canary+
        ' on '+b.project+' with '+b.aliases.length+
        ' verified domains. This could incur metered provider charges; no autonomous spending.';
      if(kind==='approve')return 'APPROVE next rolling-release stage '+
        b.rollout.nextStageIndex+' from '+b.rollout.stageIndex+
        ' for '+b.canary+' in production project '+b.project+'.';
      return 'COMPLETE rolling release '+b.canary+' to 100% of production traffic '+
        'from '+b.current+' on '+b.project+'.';
    },
    async production(){return {production:true,
      why:'Rolling releases alter production traffic or paid release configuration'};},
    async targets(_a,b){return b.targets;},
    ...(kind==='config'||kind==='start'?{async spend(_a,_ctx,b){
      if(kind==='config'&&b.desired.enabled===false)
        return {cents:0,recurring:false,
          description:'Disable configuration without initiating a new rolling release'};
      return {cents:null,recurring:true,
        description:'Rolling-release slot or traffic use has no provider-enforceable per-operation lifetime cost ceiling'};
    }}:{}),
    async apply(a,ctx,b,requestKey){
      const provider=await writeProvider(ctx);
      await requirePreDispatch(async()=>{
        if(ctx.connection?.mode!=='production'||
          provider.account.team_id!==b.teamId)
          throw new TypeError('Production connection authorization changed');
        const current=await candidate(a,ctx,kind);
        if(!sameBefore(current,b))
          throw new TypeError('Rolling-release state/configuration changed before dispatch');
        if((kind==='config'&&b.desired.enabled||
          kind==='start')&&
          (ctx.purchaseApproval?.operation!==name||
            ctx.purchaseApproval?.requestKey!==requestKey))
          throw new TypeError('Independent charge approval unavailable');
      });
      const operation={
        config:b.desired.enabled?'rolling_config_update':'rolling_config_delete',start:'rolling_start',
        approve:'rolling_approve',complete:'rolling_complete'}[kind];
      const body=kind==='config'?b.desired:
        kind==='approve'?{
          nextStageIndex:b.rollout.nextStageIndex,
          canaryDeploymentId:b.canary
        }:{canaryDeploymentId:b.canary};
      return provider.write(operation,
        {path:{idOrName:b.project},...(kind==='config'&&!b.desired.enabled?{}:{body})},
        {requestKey,tool:name,shapeResult:()=>({
          project:b.project,operation:kind,
          canary:b.canary??null})});
    },
    async verify(_a,ctx,b){
      try{
        const state=await rollingSnapshot({project:b.project},ctx);
        if(state.project!==b.project||state.account.team_id!==b.teamId)
          return {confirmed:null};
        if(kind==='config'){
          return {confirmed:state.config.enabled===b.desired.enabled&&
            (b.desired.enabled===false||
              state.config.advancementType===b.desired.advancementType&&
              stageKey(state.config.stages)===stageKey(b.desired.stages))};
        }
        const r=state.rollout;
        if(!r||r.canary!==b.canary||r.current!==b.current)
          return {confirmed:null};
        if(kind==='start')return {confirmed:r.state==='ACTIVE'&&
          r.stageIndex!==null};
        if(kind==='approve')return {confirmed:r.state==='ACTIVE'&&
          r.stageIndex===b.rollout.nextStageIndex};
        if(r.state!=='COMPLETED')return {confirmed:null};
        const aliases=await ownedAliases(state,b.project);
        return {confirmed:aliases.length>0&&
          aliases.every(x=>x.deployment===b.canary)?true:null};
      }catch{return {confirmed:null};}
    }
  });
}
const specs=Object.fromEntries(Object.keys(names).map(k=>[k,factory(k)]));
const result=x=>({isError:['refused_by_guard','outcome_unknown'].includes(x.status),
  content:[{type:'text',text:JSON.stringify(x)}]});
export const rollingWriteTools={
  tools:Object.entries(names).map(([kind,name])=>({
    name,writes:true,guardedWrite:true,area:'releases',
    profiles:['full'],description:{
      config:'Guarded version-bound rolling-release stages/disable with strict owner charge ceiling policy.',
      start:'Start a verified staged production canary only with owner-approved metered charge ceiling.',
      approve:'Advance exactly one expected manual rolling-release stage under production confirmation.',
      complete:'Complete the exact active canary with independently confirmed production readback.'
    }[kind],
    inputSchema:schema(Object.fromEntries(allowed[kind].map(k=>[k,props[k]])),
      input[kind]),writeContract:specs[kind].writeContract,
    annotations:{readOnlyHint:false,destructiveHint:kind==='complete'||kind==='config'}
  })),
  handlers:Object.fromEntries(Object.entries(names).map(([kind,name])=>[
    name,bindGuardedWrite(specs[kind],context,result)]))
};
