// D-3: irreversible cleanup is restricted to terminal, unaliased previews.
// The write contract, not tool metadata, enforces confirmation and owner guards.
import {defineWrite,bindGuardedWrite,requirePreDispatch, RefusalError } from '../core/write.js';
import {compact} from '../core/util.js';
import {scopedDeployment} from './deployments.js';
import {readProvider,writeProvider} from '../vercel/provider.js';
import {checkProtected} from './self-guard.js';
import {checkApp} from './app-guard.js';

const ID=/^dpl_[A-Za-z0-9_-]{3,120}$/;
const PROJECT=/^[A-Za-z0-9][A-Za-z0-9_-]{1,127}$/;
const TERMINAL=new Set(['ERROR','CANCELED']);
const inputSchema={type:'object',properties:{
  deployment:{type:'string',pattern:ID.source,minLength:7,maxLength:128},
  project:{type:'string',pattern:PROJECT.source,minLength:2,maxLength:128},
  expectedState:{type:'string',enum:['ERROR','CANCELED']},
  outsideApp:{type:'boolean',const:true},
  dryRun:{type:'boolean'},confirm:{type:'boolean'},
  requestKey:{type:'string',pattern:'^[A-Za-z0-9_-]{8,128}$'}
},required:['deployment','project','expectedState','outsideApp'],additionalProperties:false};
function checkArgs(args){
  if(!args||typeof args!=='object'||Array.isArray(args)||
    Object.keys(args).some(k=>!Object.hasOwn(inputSchema.properties,k))||
    typeof args.deployment!=='string'||!ID.test(args.deployment)||
    typeof args.project!=='string'||!PROJECT.test(args.project)||
    !TERMINAL.has(args.expectedState)||args.outsideApp!==true||
    args.confirm!==undefined&&typeof args.confirm!=='boolean'||
    args.dryRun!==undefined&&typeof args.dryRun!=='boolean')
    throw new RefusalError('Exact terminal preview identity and outside-app intent required');
}
function prove(row,expected){
  if(!row||typeof row!=='object'||Array.isArray(row)||
    row.uid!=null&&row.id!=null&&row.uid!==row.id||
    (row.uid??row.id)!==expected.id||
    row.projectId!==expected.project||
    row.project?.id!=null&&row.project.id!==expected.project)
    throw new RefusalError('Provider deployment identity or project is unverified');
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
    const state={id:verified.id,project,state:verified.state,teamId:account.team_id};
    const raw=await client.request('deployments_get',{path:{idOrUrl:state.id}});
    prove(raw,state);
    return state;
  },
  async preview(_args,_ctx,before){
    return 'Permanently delete only the unaliased '+before.state+
      ' preview deployment '+before.id+' in project '+before.project+
      '. Its files and preview URL will be lost. No production or serving alias is eligible';
  },
  async production(){return {production:false,why:'Only a terminal unaliased preview is eligible'};},
  async targets(_args,before){
    return [{kind:'deployment',id:before.id,projectId:before.project},
      {kind:'project',id:before.project}];
  },
  async apply(_args,ctx,before,requestKey){
    const provider=await writeProvider(ctx);
    await requirePreDispatch(async()=>{
      if(provider.account.team_id!==before.teamId||
         provider.account.scope==='project'&&provider.account.project_id!==before.project)
        throw new TypeError('Selected team changed');
      const fresh=await provider.read('deployments_get',{path:{idOrUrl:before.id}});
      prove(fresh,before);
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
    description:'Delete only an unaliased failed or canceled preview after exact identity, confirmation and readback.',
    inputSchema,writeContract:remove.writeContract,
    annotations:{readOnlyHint:false,destructiveHint:true}}],
  handlers:{vercel_deploy_delete:bindGuardedWrite(remove,context,output)}
};
