// D-4: bounded, selected-project rolling-release state and drift proofs.
import {projectContext,PROJECT,DEPLOY} from './release-common.js';
import { RefusalError } from '../core/write.js';
import {createHash} from 'node:crypto';

const STATES=new Set(['ACTIVE','COMPLETED','ABORTED','PENDING','PAUSED']);
export const shared={
  project:{type:'string',pattern:PROJECT.source},
  outsideApp:{type:'boolean',const:true},
  dryRun:{type:'boolean'},confirm:{type:'boolean'},
  requestKey:{type:'string',pattern:'^[A-Za-z0-9_-]{8,128}$'}
};
export function exact(a,properties,required=['project']){
  if(!a||typeof a!=='object'||Array.isArray(a)||
    Object.keys(a).some(k=>!Object.hasOwn(properties,k))||
    required.some(k=>a[k]===undefined)||!PROJECT.test(a.project??'')||
    a.outsideApp!==undefined&&a.outsideApp!==true||
    a.confirm!==undefined&&typeof a.confirm!=='boolean'||
    a.dryRun!==undefined&&typeof a.dryRun!=='boolean'||
    a.requestKey!==undefined&&!/^[A-Za-z0-9_-]{8,128}$/.test(a.requestKey))
    throw new RefusalError('Exact rolling-release project and safe arguments required');
}
export function stageArray(raw){
  if(!Array.isArray(raw)||raw.length<2||raw.length>10)
    throw new RefusalError('Rolling release needs two to ten stages');
  let prev=-1;
  return raw.map((row,i)=>{
    if(!row||typeof row!=='object'||Array.isArray(row)||
      Object.keys(row).some(k=>!['targetPercentage','duration','requireApproval'].includes(k))||
      !Number.isInteger(row.targetPercentage)||row.targetPercentage<0||
      row.targetPercentage>100||row.targetPercentage<=prev||
      row.duration!==undefined&&(!Number.isInteger(row.duration)||
        row.duration<1||row.duration>1440)||
      row.requireApproval!==undefined&&typeof row.requireApproval!=='boolean')
      throw new TypeError('Invalid rolling-release stage '+i);
    prev=row.targetPercentage;
    return {targetPercentage:row.targetPercentage,
      ...(row.duration!==undefined?{duration:row.duration}:{}),
      ...(row.requireApproval!==undefined?{requireApproval:row.requireApproval}:{})};
  }).map((row,i,all)=>{
    if(i===all.length-1&&row.targetPercentage!==100)
      throw new RefusalError('Final rolling-release stage must serve 100 percent');
    return row;
  });
}
function number(value){
  return Number.isSafeInteger(value)&&value>=0?value:null;
}
function deployed(value){
  const id=value?.id??value?.uid;
  return typeof id==='string'&&DEPLOY.test(id)?id:null;
}
export function normalizeActive(reply){
  if(reply==null||reply?.rollingRelease===null)return null;
  const row=reply?.rollingRelease;
  if(!row||typeof row!=='object'||Array.isArray(row)||
    typeof row.state!=='string'||!STATES.has(row.state))
    throw new RefusalError('Cannot prove rolling-release state');
  const index=number(row.activeStage?.index);
  const canary=deployed(row.canaryDeployment);
  const current=deployed(row.currentDeployment);
  if((row.state==='ACTIVE'||row.state==='PAUSED')&&
    (!canary||!current||index===null||canary===current))
    throw new RefusalError('Active rolling release identity or stage is unknown');
  return {state:row.state,substate:typeof row.substate==='string'?
    row.substate:null,canary,current,stageIndex:index,
    nextStageIndex:number(row.nextStage?.index),
    currentCanaryPercentage:number(row.currentCanaryPercentage),
    updatedAt:number(row.updatedAt),
    advancementType:row.advancementType==='manual-approval'?
      'manual-approval':row.advancementType==='automatic'?'automatic':null,
    requiresApproval:row.activeStage?.requireApproval===true,
    finalStage:row.activeStage?.isFinalStage===true,
    targetPercent:number(row.activeStage?.targetPercentage)};
}
export function normalizeConfig(reply){
  const row=reply?.rollingRelease;
  if(row==null)return {enabled:false,stages:[],advancementType:null,target:'production'};
  if(typeof row!=='object'||Array.isArray(row)||row.target!=='production'||
    !Array.isArray(row.stages)||row.stages.length>10)
    throw new RefusalError('Cannot prove rolling-release configuration');
  const stages=row.stages.map(x=>({
    targetPercentage:number(x?.targetPercentage),
    duration:number(x?.duration),requireApproval:x?.requireApproval===true
  }));
  if(stages.some(x=>x.targetPercentage===null))
    throw new RefusalError('Rolling-release stage data is unknown');
  return {enabled:row.enabled!==false,stages,
    advancementType:row.advancementType==='manual-approval'?
      'manual-approval':row.advancementType==='automatic'?'automatic':null,
    target:'production'};
}
export function configFingerprint(config){
  return createHash('sha256').update(JSON.stringify(config)).digest('hex');
}
export async function rollingSnapshot(args,ctx,{billing=false}={}){
  const scoped=await projectContext(args,ctx);
  const path={idOrName:scoped.project};
  const [configuration,active,price]=await Promise.all([
    scoped.client.request('rolling_config_get',{path}),
    scoped.client.request('rolling_active_get',{path}),
    billing?scoped.client.request('rolling_billing_get',{path}):Promise.resolve(null)
  ]);
  const config=normalizeConfig(configuration);
  const rollout=normalizeActive(active);
  const slots=number(price?.availableSlots);
  return {...scoped,config,rollout,
    billing:billing?{availableSlots:slots,
      eligible:slots!==null&&slots>0,
      reason:typeof price?.reason==='string'?
        price.reason.slice(0,80):null}:null};
}
export function sameRollout(a,b){
  return a&&b&&a.state===b.state&&a.canary===b.canary&&
    a.current===b.current&&a.stageIndex===b.stageIndex&&
    a.updatedAt===b.updatedAt;
}
export function releaseTargets(snapshot,canary){
  return [{kind:'account',id:snapshot.account.team_id},
    {kind:'project',id:snapshot.project,
      ...(snapshot.projectName?{projectName:snapshot.projectName}:{})},
    ...(canary?[{kind:'deployment',id:canary,
      projectId:snapshot.project}]:[]),
    ...(snapshot.rollout?.current?[{kind:'deployment',id:snapshot.rollout.current,
      projectId:snapshot.project}]:[])];
}
