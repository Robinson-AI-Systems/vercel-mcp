// D-2c: Checks V2 metadata reads; never surface raw check output or
// credential-shaped integration payloads. Every deployment read independently
// verifies the parent against the encrypted server-selected project account.
import {readProvider} from '../vercel/provider.js';
import {credentialLike} from '../core/util.js';
import {projectFor,scopedDeployment} from './deployments.js';

const PROFILES=['read_only','everyday','full'];
const ID=/^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/;
const asText=x=>({content:[{type:'text',text:JSON.stringify(x)}]});
const schema=(properties,required=[])=>({type:'object',properties,required,additionalProperties:false});
function validate(args,keys){
  if(!args||typeof args!=='object'||Array.isArray(args)||
    Object.keys(args).some(k=>!keys.includes(k)))throw new TypeError('Invalid checks read request');
}
function safe(value,max=128){
  return typeof value==='string'&&value.length>0&&value.length<=max&&
    /^[A-Za-z0-9 _.-]+$/.test(value)&&!credentialLike(value)?value:null;
}
function safeId(value){
  if(typeof value!=='string'||!ID.test(value)||credentialLike(value))
    throw new TypeError('Invalid check identifier');
  return value;
}
function number(value){return Number.isSafeInteger(value)&&value>=0?value:null;}
function rowOfCheck(row,project,deployment){
  if(!row||typeof row!=='object'||Array.isArray(row))
    throw new TypeError('Malformed check result');
  if(row.projectId!==undefined&&row.projectId!==project)
    throw new TypeError('Check refers to a different project');
  if(deployment!==undefined&&row.deploymentId!==undefined&&row.deploymentId!==deployment)
    throw new TypeError('Check refers to a different deployment');
  const id=safeId(row.id);
  const task=row.taskSummary;
  return {id,name:safe(row.name,100),status:safe(row.status,35),
    conclusion:safe(row.conclusion,35),blocks:safe(row.blocks,40),
    deploymentId:deployment??safe(row.deploymentId,128),
    checkId:safe(row.checkId,128),
    createdAt:number(row.createdAt),completedAt:number(row.completedAt),
    outputAvailable:row.output!==undefined&&row.output!==null,
    tasks:task&&typeof task==='object'&&!Array.isArray(task)?{
      total:number(task.total),failed:number(task.failed),
      pending:number(task.pending),succeeded:number(task.succeeded)}:null};
}
function sliced(array,project,deployment){
  if(!Array.isArray(array))throw new TypeError('Provider did not return check inventory');
  const seen=new Set(),items=[];
  for(const row of array.slice(0,20)){
    const safeRow=rowOfCheck(row,project,deployment);
    if(seen.has(safeRow.id))throw new TypeError('Duplicate check identity');
    seen.add(safeRow.id);items.push(safeRow);
  }
  return {items,returnedByProvider:array.length,capped:array.length>20,
    completeness:'unverified_provider_page'};
}
async function verifiedProject(ctx,args){
  const {client,account}=await readProvider(ctx);
  const project=projectFor(args,account);
  const row=await client.request('projects_get',{path:{idOrName:project}});
  if(!row||row.id!==project)throw new TypeError('Project identity not independently verified');
  return {client,project};
}
export const checksReadTools={
  tools:[
    {name:'vercel_check_list_runs',writes:false,profiles:PROFILES,area:'deployments',
      description:'List up to 20 safe Checks V2 run summaries for one independently verified deployment.',
      inputSchema:schema({project:{type:'string',maxLength:128},
        deployment:{type:'string',maxLength:128}},['deployment']),
      annotations:{readOnlyHint:true}},
    {name:'vercel_check_get_run',writes:false,profiles:PROFILES,area:'deployments',
      description:'Read safe state/conclusion for an exact deployment check run; never return raw outputs.',
      inputSchema:schema({project:{type:'string',maxLength:128},
        deployment:{type:'string',maxLength:128},
        run:{type:'string',maxLength:128}},['deployment','run']),
      annotations:{readOnlyHint:true}},
    {name:'vercel_check_list_project_checks',writes:false,profiles:PROFILES,area:'deployments',
      description:'List up to 20 configured project checks with an independently verified project.',
      inputSchema:schema({project:{type:'string',maxLength:128}}),
      annotations:{readOnlyHint:true}}
  ],
  handlers:{
    async vercel_check_list_runs(args,ctx){
      validate(args,['project','deployment']);
      const {client,project}=await scopedDeployment(args,ctx);
      const response=await client.request('checks_runs_list',{path:{deploymentId:args.deployment}});
      return asText({project,deployment:args.deployment,
        ...sliced(response?.runs,project,args.deployment)});
    },
    async vercel_check_get_run(args,ctx){
      validate(args,['project','deployment','run']);
      const run=safeId(args.run);
      const {client,project}=await scopedDeployment(args,ctx);
      const row=await client.request('checks_run_get',{
        path:{deploymentId:args.deployment,checkRunId:run}});
      const summary=rowOfCheck(row,project,args.deployment);
      if(summary.id!==run)throw new TypeError('Requested check run identity changed');
      return asText({project,deployment:args.deployment,run:summary,
        rawOutputIncluded:false});
    },
    async vercel_check_list_project_checks(args,ctx){
      validate(args,['project']);
      const {client,project}=await verifiedProject(ctx,args);
      const response=await client.request('checks_project_list',{path:{projectIdOrName:project}});
      if(!Array.isArray(response?.availableNativeChecks))
        throw new TypeError('Provider did not return native checks metadata');
      return asText({project,nativeCheckTypesCount:response.availableNativeChecks.length,
        ...sliced(response?.checks,project)});
    }
  }
};
