// D-3: irreversible cleanup of a terminal, unaliased preview.
// AUD-CJ (2026-11-03, the owner's ruling from the AUD-CH refusal
// audit — "convert deployment deletion the same way"): the D-3
// restriction was an eligibility veto over everything else. A
// healthy preview, an aliased deployment and every production
// deployment now delete through the owner-confirmed path: a
// complete evaluation of the deployment (state, target, its
// addresses, whether it is the project's current production
// deployment), fingerprinted; the owner's confirmation must
// name that exact evaluation; execution re-evaluates before
// the DELETE and verifies by 404 read-back. The terminal
// unaliased preview keeps its simple path, unchanged.
import {createHash} from 'node:crypto';
import {defineWrite,bindGuardedWrite,requirePreDispatch, RefusalError } from '../core/write.js';
import {compact} from '../core/util.js';
import {scopedDeployment} from './deployments.js';
import {readProvider,writeProvider} from '../vercel/provider.js';
import {checkProtected} from './self-guard.js';
import {checkApp} from './app-guard.js';

const ID=/^dpl_[A-Za-z0-9_-]{3,120}$/;
const PROJECT=/^[A-Za-z0-9][A-Za-z0-9_-]{1,127}$/;
const TERMINAL=new Set(['ERROR','CANCELED']);
const ALL_STATES=new Set(['QUEUED','BUILDING','READY','ERROR','CANCELED']);
const inputSchema={type:'object',properties:{
  deployment:{type:'string',pattern:ID.source,minLength:7,maxLength:128},
  project:{type:'string',pattern:PROJECT.source,minLength:2,maxLength:128},
  expectedState:{type:'string',enum:['QUEUED','BUILDING','READY','ERROR','CANCELED']},
  evaluationId:{type:'string',pattern:'^[0-9a-f]{64}$'},
  outsideApp:{type:'boolean',const:true},
  dryRun:{type:'boolean'},confirm:{type:'boolean'},
  requestKey:{type:'string',pattern:'^[A-Za-z0-9_-]{8,128}$'}
},required:['deployment','project','expectedState','outsideApp'],additionalProperties:false};
function checkArgs(args){
  if(!args||typeof args!=='object'||Array.isArray(args)||
    Object.keys(args).some(k=>!Object.hasOwn(inputSchema.properties,k))||
    typeof args.deployment!=='string'||!ID.test(args.deployment)||
    typeof args.project!=='string'||!PROJECT.test(args.project)||
    !ALL_STATES.has(args.expectedState)||args.outsideApp!==true||
    args.evaluationId!==undefined&&
      (typeof args.evaluationId!=='string'||!/^[0-9a-f]{64}$/.test(args.evaluationId))||
    args.confirm!==undefined&&typeof args.confirm!=='boolean'||
    args.dryRun!==undefined&&typeof args.dryRun!=='boolean')
    throw new RefusalError('Exact deployment identity and outside-app intent required');
}
function proveIdentity(row,expected){
  if(!row||typeof row!=='object'||Array.isArray(row)||
    row.uid!=null&&row.id!=null&&row.uid!==row.id||
    (row.uid??row.id)!==expected.id||
    row.projectId!==expected.project||
    row.project?.id!=null&&row.project.id!==expected.project)
    throw new RefusalError('Provider deployment identity or project is unverified');
}
function prove(row,expected){
  proveIdentity(row,expected);
  // VMCP-028 (AUD-V): 'preview' is a request-side literal only — on
  // every documented read-back shape a preview deployment's target
  // is null (the response enum is production/staging/null, per the
  // lifecycle contract dossier). Demanding the literal made this
  // proof unsatisfiable against real records. Accept exactly the
  // two preview forms (null read-back, or 'preview' where a shape
  // carries it — the deployment-cancel proof's tolerant form);
  // production, staging, and absent targets all refuse.
  if(!(row.target===null||row.target==='preview'))
    throw new RefusalError('Only preview deployments can be deleted');
  // A preview can be assigned to an externally serving domain. Absent alias
  // metadata is unknown, not evidence that the deployment is unaliased.
  if(!Array.isArray(row.alias)||row.alias.length!==0||
     row.aliases!=null&&(!Array.isArray(row.aliases)||row.aliases.length!==0))
    throw new RefusalError('Cannot prove deployment has no serving aliases');
  if((row.readyState??row.state)!==expected.state||!TERMINAL.has(expected.state))
    throw new RefusalError('Only unchanged failed or canceled previews can be deleted');
}
// Every address that points at the deployment, from the provider
// record's two alias shapes. An unprovable list refuses the
// evaluation — the warning must be complete or it does not exist.
function aliasList(row){
  const out=new Set();
  const take=(list)=>{
    if(!Array.isArray(list))throw new RefusalError('Deployment alias list could not be proven');
    for(const entry of list){
      const value=typeof entry==='string'?entry:entry?.alias;
      if(typeof value!=='string'||!value)throw new RefusalError('Deployment alias entry could not be proven');
      out.add(value);
    }
  };
  take(row.alias);
  if(row.aliases!=null)take(row.aliases);
  return [...out].sort();
}
function isSimpleCandidate(verified,raw){
  return TERMINAL.has(verified.state)&&
    (verified.target===null||verified.target==='preview')&&
    Array.isArray(raw.alias)&&raw.alias.length===0&&
    (raw.aliases==null||(Array.isArray(raw.aliases)&&raw.aliases.length===0));
}
async function listProjectDeployments(client,project){
  const rows=[];let until;
  for(let page=0;page<50;page++){
    const reply=await client.request('deployments_list',
      {query:{projectId:project,limit:100,...(until?{until}:{})}});
    if(!reply||!Array.isArray(reply.deployments))
      throw new RefusalError('Project deployment inventory could not be proven');
    rows.push(...reply.deployments);
    const next=reply.pagination?.next;
    if(next===null||next===undefined){
      if(reply.pagination&&(reply.pagination.hasNext===true||reply.pagination.hasMore===true))
        throw new RefusalError('Project deployment inventory could not be proven');
      return rows;
    }
    const n=typeof next==='string'&&/^[1-9][0-9]{0,15}$/.test(next)?Number(next):next;
    if(!Number.isSafeInteger(n)||n<=0)
      throw new RefusalError('Project deployment inventory could not be proven');
    until=n;
  }
  throw new RefusalError('Project deployment inventory could not be proven');
}
// AUD-CJ evaluation: everything the warning must state, and the
// fingerprint the owner's confirmation binds to. Mirrors AUD-CH.
async function evaluate(client,verified,raw){
  const aliases=aliasList(raw);
  const projectRow=await client.request('projects_get',
    {path:{idOrName:verified.projectId}});
  if(!projectRow||typeof projectRow!=='object'||Array.isArray(projectRow)||
    projectRow.id!==verified.projectId||typeof projectRow.name!=='string')
    throw new RefusalError('Project identity could not be proven for the deletion evaluation');
  const designations=[];
  for(const key of ['productionDeploymentId','currentDeploymentId']){
    if(projectRow[key]!=null)designations.push(projectRow[key]);
  }
  if(projectRow.productionDeployment!=null){
    const d=projectRow.productionDeployment;
    designations.push(typeof d==='string'?d:d?.id??d?.uid);
  }
  let currentProduction;
  if(designations.length>0){
    if(designations.some(d=>typeof d!=='string'||!d))
      throw new RefusalError('Project production designation could not be proven');
    currentProduction=designations.includes(verified.id);
  }else{
    const rows=await listProjectDeployments(client,verified.projectId);
    let newest=null;
    for(const row of rows){
      const id=row?.uid??row?.id;
      const state=row?.readyState??row?.state;
      const created=Number.isSafeInteger(row?.created)?row.created:
        Number.isSafeInteger(row?.createdAt)?row.createdAt:null;
      if(typeof id!=='string'||created===null)
        throw new RefusalError('Project deployment inventory could not be proven');
      if(row.target==='production'&&state==='READY'&&
        (!newest||created>newest.created))newest={id,created};
    }
    currentProduction=newest!==null&&newest.id===verified.id;
  }
  const evaluation={
    id:verified.id,project:verified.projectId,projectName:projectRow.name,
    state:verified.state,target:verified.target,url:verified.url,
    createdAt:verified.createdAt,branch:verified.branch,commit:verified.commit,
    aliases,currentProduction
  };
  const canonical=JSON.stringify(evaluation,Object.keys(evaluation).sort());
  const evaluationId=createHash('sha256').update(canonical).digest('hex');
  return {evaluation,evaluationId};
}
function context({db,connection,env,fetchImpl}){
  return {db,connection,env,fetchImpl,shape:compact,
    audit:row=>db.recordChange(row),replayStore:db.requestReplayStore(),
    guardProtected:targets=>checkProtected(targets,{db,connection,env}),
    guardApp:targets=>checkApp(targets,{db,connection,env})};
}
const remove=defineWrite({
  name:'vercel_deploy_delete',
  async before(args,ctx){
    checkArgs(args);
    const {client,account,project,verified}=await scopedDeployment(args,ctx);
    if(verified.state!==args.expectedState)throw new RefusalError('Deployment state is not the expected state');
    const raw=await client.request('deployments_get',{path:{idOrUrl:verified.id}});
    proveIdentity(raw,{id:verified.id,project});
    if(isSimpleCandidate(verified,raw)){
      prove(raw,{id:verified.id,project,state:verified.state});
      return {id:verified.id,project,state:verified.state,
        teamId:account.team_id,simple:true};
    }
    const {evaluation,evaluationId}=await evaluate(client,verified,raw);
    if(args.evaluationId!==undefined&&args.evaluationId!==evaluationId)
      throw new RefusalError('That evaluation is no longer current: '+
        'the deployment or its situation has changed since it was taken. '+
        'Run the plan again and confirm the evaluation it shows now.');
    if(args.confirm===true&&args.dryRun!==true&&args.evaluationId===undefined)
      throw new RefusalError('Deleting this deployment requires confirming '+
        'the exact evaluation: run the plan, read what would be destroyed, '+
        'then confirm with evaluationId set to the value the plan shows.');
    return {id:verified.id,project,state:verified.state,
      teamId:account.team_id,simple:false,evaluation,evaluationId};
  },
  async preview(_args,_ctx,before){
    if(before.simple)return 'Permanently delete only the unaliased '+before.state+
      ' preview deployment '+before.id+' in project '+before.project+
      '. Its files and preview URL will be lost. No production or serving alias is eligible';
    const e=before.evaluation;
    const lines=[
      'OWNER-CONFIRMED DELETION: '+e.id+' is a '+(e.target??'preview')+
      ' deployment in state '+e.state+' in project '+e.projectName+
      ' ('+e.project+'). Permanently deleting it destroys the deployment '+
      'and its files.'];
    if(e.currentProduction)
      lines.push('IT IS THE CURRENT PRODUCTION DEPLOYMENT: the live site '+
        'this project serves goes down until another deployment is promoted.');
    if(e.aliases.length>0)
      lines.push('These addresses point at it and stop working: '+
        e.aliases.join(', ')+'.');
    if(e.url)lines.push('Its own address '+e.url+' stops working.');
    lines.push('Evaluation: '+before.evaluationId+'. To proceed, confirm '+
      'with evaluationId set to that exact value; if anything about the '+
      'deployment changes, the evaluation changes and the confirmation '+
      'is refused.');
    return lines.join(' ');
  },
  async production(_args,_ctx,before){
    if(!before.simple&&
      (before.evaluation.target==='production'||before.evaluation.currentProduction||
       before.evaluation.aliases.length>0))
      return {production:true,why:'The deployment serves production traffic or holds serving addresses'};
    return {production:false,why:'Only a terminal unaliased preview is eligible'};
  },
  async targets(_args,before){
    return [{kind:'deployment',id:before.id,projectId:before.project},
      {kind:'project',id:before.project}];
  },
  async apply(args,ctx,before,requestKey){
    const provider=await writeProvider(ctx);
    await requirePreDispatch(async()=>{
      if(provider.account.team_id!==before.teamId||
         provider.account.scope==='project'&&provider.account.project_id!==before.project)
        throw new TypeError('Selected team changed');
      const fresh=await provider.read('deployments_get',{path:{idOrUrl:before.id}});
      proveIdentity(fresh,before);
      if(before.simple){prove(fresh,before);return;}
      const {verified}=await scopedDeployment(
        {deployment:before.id,project:before.project},ctx);
      const reader={request:(op,opts)=>provider.read(op,opts)};
      const {evaluationId}=await evaluate(reader,verified,fresh);
      if(evaluationId!==before.evaluationId)
        throw new TypeError('Deletion evaluation changed');
    });
    return provider.write('deployments_delete',{path:{id:before.id}},{
      requestKey,tool:'vercel_deploy_delete',shapeResult:()=>({accepted:true})
    });
  },
  async verify(_args,ctx,before){
    try{
      const {client,account}=await readProvider(ctx);
      if(account.team_id!==before.teamId||
         account.scope==='project'&&account.project_id!==before.project)
        return {confirmed:null};
      await client.request('deployments_get',{path:{idOrUrl:before.id}});
      return {confirmed:false};
    }catch(error){
      return {confirmed:error?.status===404?true:null};
    }
  }
});
const output=result=>({isError:['refused_by_guard','outcome_unknown'].includes(result.status),
  content:[{type:'text',text:JSON.stringify(result)}]});
export const deploymentDeleteTools={
  tools:[{name:'vercel_deploy_delete',writes:true,guardedWrite:true,
    profiles:['full'],area:'deployments',
    description:'Delete a deployment after identity and confirmation; a failed or canceled unaliased preview deletes directly, anything else needs the plan\'s exact evaluationId.',
    inputSchema,writeContract:remove.writeContract,
    annotations:{readOnlyHint:false,destructiveHint:true}}],
  handlers:{vercel_deploy_delete:bindGuardedWrite(remove,context,output)}
};
