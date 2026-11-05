// D-1k: explicit production-traffic changes. No deployment/resource edits.
// Vercel's POST success body is empty; independent project state is required.
import {defineWrite,bindGuardedWrite,requirePreDispatch, RefusalError } from '../core/write.js';
import {compact} from '../core/util.js';
import {readProvider,writeProvider} from '../vercel/provider.js';
import {checkProtected} from './self-guard.js';
import {checkApp} from './app-guard.js';

const ID=/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const properties={
  project:{type:'string',minLength:1,maxLength:128,pattern:ID.source},
  dryRun:{type:'boolean'},confirm:{type:'boolean'},
  requestKey:{type:'string',pattern:'^[a-zA-Z0-9_-]{8,128}$'}
};
const inputSchema={type:'object',properties,required:['project'],additionalProperties:false};
function assertArgs(args){
  if(!args || typeof args!=='object' || Array.isArray(args) ||
    Object.keys(args).some(key=>!Object.hasOwn(properties,key)) ||
    typeof args.project!=='string' || !ID.test(args.project) ||
    (args.dryRun!==undefined && typeof args.dryRun!=='boolean') ||
    (args.confirm!==undefined && typeof args.confirm!=='boolean'))
    throw new RefusalError('Invalid project traffic request');
}
function context({db,connection,env,fetchImpl}){
  return {db,connection,env,fetchImpl,shape:compact,
    audit:x=>db.recordChange(x),replayStore:db.requestReplayStore(),
    guardProtected:targets=>checkProtected(targets,{db,connection,env}),
    guardApp:targets=>checkApp(targets,{db,connection,env})};
}
async function project(ctx,selector){
  const {client,account}=await readProvider(ctx);
  if(!['team','full'].includes(account.scope))
    throw new RefusalError('Team-capable account required for production traffic changes');
  const row=await client.request('projects_get',{path:{idOrName:selector}});
  if(typeof row?.id!=='string' || !ID.test(row.id) ||
    typeof row?.name!=='string' || !row.name)
    throw new RefusalError('Project identity unavailable');
  return {row,client};
}
// Pause state in the provider's real project shape. The flag is a
// boolean while a pause is in effect or after one is lifted, and null
// on a never-paused project (the project list shows the same null);
// pauseStatus can speak independently. A flag of any other type, a
// missing flag with no status, an unrecognized status, or a conflict
// between the two is unknown — unknown refuses, never guesses. This
// mirrors verifiedPaused in projects.js, plus the live-proven null
// flag (AUD-CQ; the 2026-11-04 pause dead-end, where the previous
// boolean-only check refused every never-paused project).
function pausedState(row){
  const flag=row?.paused;
  if(flag!==undefined&&typeof flag!=='boolean'&&flag!==null)return null;
  const fromFlag=flag===undefined?null:flag===true;
  const status=row?.pauseStatus?.status;
  if(status!==undefined&&status!==null){
    if(status!=='PAUSED'&&status!=='UNPAUSED')return null;
    const fromStatus=status==='PAUSED';
    return fromFlag!==null&&fromFlag!==fromStatus?null:fromStatus;
  }
  return fromFlag;
}
function trafficWrite({name,id,desired,opposite}){
  return defineWrite({
    name,
    async before(args,ctx){
      assertArgs(args);
      const {row}=await project(ctx,args.project);
      const paused=pausedState(row);
      if(paused===null)
        throw new RefusalError('Project pause state cannot be verified');
      return {id:row.id,name:row.name,paused};
    },
    async preview(_args,_ctx,before){
      const change=desired?'Pause production traffic':'Resume production traffic';
      const effect=desired?
        '; users may receive a 503 while paused':
        '; active traffic and metered usage may resume';
      return change+' on project '+before.name+' ('+before.id+')'+
        (before.paused===desired?'; already in requested state, no provider write':effect);
    },
    async production(){
      return {production:true,why:'Production traffic availability changes'};
    },
    async targets(_args,before){
      return [{kind:'project',id:before.id,name:before.name}];
    },
    async apply(_args,ctx,before,requestKey){
      if(before.paused===desired)return {unchanged:true};
      const provider=await writeProvider(ctx);
      await requirePreDispatch(async()=>{
        if(!['team','full'].includes(provider.account.scope))
          throw new TypeError('Team authority is required for production traffic');
        // Same immutable credential/team for the final proof and traffic POST.
        const row=await provider.read('projects_get',{path:{idOrName:before.id}});
        if(row?.id!==before.id||row?.name!==before.name||
          pausedState(row)!==before.paused)
          throw new TypeError('Production traffic identity or pause state changed');
      });
      return provider.write(id,{path:{projectId:before.id}},{
        requestKey,tool:name,shapeResult:()=>({accepted:true})
      });
    },
    async verify(_args,ctx,before){
      const {row}=await project(ctx,before.id);
      const paused=pausedState(row);
      return {confirmed:paused===null?null:
        row.id===before.id && paused===desired,
        project:before.id,paused};
    },
    // X-1: pause and unpause are exact opposites.
    async inverse(_args,before){
      return {tool:opposite,project:before.id};
    }
  });
}
const pause=trafficWrite({name:'vercel_project_pause',id:'projects_pause',desired:true,opposite:'vercel_project_unpause'});
const resume=trafficWrite({name:'vercel_project_unpause',id:'projects_unpause',desired:false,opposite:'vercel_project_pause'});
const output=result=>({isError:['refused_by_guard','outcome_unknown'].includes(result.status),
  content:[{type:'text',text:JSON.stringify(result)}]});
function declaration(tool,description,contract){
  return {name:tool,writes:true,guardedWrite:true,profiles:['full'],area:'projects',
    description,inputSchema,writeContract:contract,
    annotations:{readOnlyHint:false,destructiveHint:tool==='vercel_project_pause'}};
}
export const projectTrafficTools={
  tools:[
    declaration('vercel_project_pause',
      'Pause production traffic with explicit confirmation and independent state verification.',
      pause.writeContract),
    declaration('vercel_project_unpause',
      'Resume production traffic and metered usage with confirmation and independent verification.',
      resume.writeContract)
  ],
  handlers:{
    vercel_project_pause:bindGuardedWrite(pause,context,output),
    vercel_project_unpause:bindGuardedWrite(resume,context,output)
  }
};
