// D-1k: explicit production-traffic changes. No deployment/resource edits.
// Vercel's POST success body is empty; independent project state is required.
import {defineWrite,bindGuardedWrite} from '../core/write.js';
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
    throw new TypeError('Invalid project traffic request');
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
    throw new TypeError('Team-capable account required for production traffic changes');
  const row=await client.request('projects_get',{path:{idOrName:selector}});
  if(typeof row?.id!=='string' || !ID.test(row.id) ||
    typeof row?.name!=='string' || !row.name)
    throw new TypeError('Project identity unavailable');
  return {row,client};
}
function trafficWrite({name,id,desired}){
  return defineWrite({
    name,
    async before(args,ctx){
      assertArgs(args);
      const {row}=await project(ctx,args.project);
      if(typeof row.paused!=='boolean')
        throw new TypeError('Project pause state cannot be verified');
      return {id:row.id,name:row.name,paused:row.paused};
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
      return provider.write(id,{path:{projectId:before.id}},{
        requestKey,tool:name,shapeResult:()=>({accepted:true})
      });
    },
    async verify(_args,ctx,before){
      const {row}=await project(ctx,before.id);
      return {confirmed:typeof row.paused==='boolean'?
        row.id===before.id && row.paused===desired : null,
        project:before.id,paused:typeof row.paused==='boolean'?row.paused:null};
    }
  });
}
const pause=trafficWrite({name:'vercel_project_pause',id:'projects_pause',desired:true});
const resume=trafficWrite({name:'vercel_project_unpause',id:'projects_unpause',desired:false});
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
