// D-3: cancel only a verified, unfinished preview deployment.
import {defineWrite,bindGuardedWrite,requirePreDispatch} from '../core/write.js';
import {compact} from '../core/util.js';
import {scopedDeployment} from './deployments.js';
import {writeProvider,readProvider} from '../vercel/provider.js';
import {checkProtected} from './self-guard.js';
import {checkApp} from './app-guard.js';

const ID=/^dpl_[A-Za-z0-9_-]{3,120}$/;
const STATES=new Set(['QUEUED','INITIALIZING','BUILDING']);
const properties={
  deployment:{type:'string',pattern:ID.source,minLength:7,maxLength:128},
  project:{type:'string',minLength:2,maxLength:128},
  dryRun:{type:'boolean'},confirm:{type:'boolean'},
  requestKey:{type:'string',pattern:'^[a-zA-Z0-9_-]{8,128}$'}
};
const inputSchema={type:'object',properties,required:['deployment'],additionalProperties:false};
function checkArgs(args){
  if(!args||typeof args!=='object'||Array.isArray(args)||
     Object.keys(args).some(k=>!Object.hasOwn(properties,k))||
     typeof args.deployment!=='string'||!ID.test(args.deployment)||
     args.dryRun!==undefined&&typeof args.dryRun!=='boolean'||
     args.confirm!==undefined&&typeof args.confirm!=='boolean')
    throw new TypeError('Invalid preview deployment cancellation request');
}
function previewOnly(row){
  if(!row||typeof row!=='object'||Array.isArray(row)||
     !Object.hasOwn(row,'target')||
     !(row.target===null||row.target==='preview'))
    throw new TypeError('Unknown or production deployment target cannot be canceled');
}
function identity(row,expected){
  if(row?.uid!=null&&row?.id!=null&&row.uid!==row.id ||
     row?.uid!==expected.id && row?.id!==expected.id)
    throw new TypeError('Deployment identity changed');
  if(row.projectId!==expected.project||
     row.project?.id!=null&&row.project.id!==expected.project)
    throw new TypeError('Deployment ownership changed');
  previewOnly(row);
  if((row.readyState??row.state)!==expected.state)
    throw new TypeError('Deployment state changed since preview');
}
function context({db,connection,env,fetchImpl}){
  return {db,connection,env,fetchImpl,shape:compact,
    audit:x=>db.recordChange(x),
    replayStore:db.requestReplayStore(),
    guardProtected:targets=>checkProtected(targets,{db,connection,env}),
    guardApp:targets=>checkApp(targets,{db,connection,env})};
}
const cancel=defineWrite({
  name:'vercel_deploy_cancel',
  async before(args,ctx){
    checkArgs(args);
    const {client,project,verified}=await scopedDeployment(args,ctx);
    // The safe summary deliberately cannot distinguish an absent provider
    // target from explicit null; the raw scoped read must prove preview.
    const row=await client.request('deployments_get',{path:{idOrUrl:verified.id}});
    const expected={id:verified.id,project,state:verified.state};
    identity(row,expected);
    if(!STATES.has(verified.state)&&verified.state!=='CANCELED')
      throw new TypeError('Only in-progress or already-canceled previews can be canceled');
    return expected;
  },
  async preview(_args,_ctx,before){
    return (before.state==='CANCELED'?'Confirm already-canceled preview ':'Cancel the unfinished preview build ')+before.id+
      ' in project '+before.project+' (currently '+before.state+
      '). No production deployment or other resource is changed';
  },
  async production(){return {production:false,why:'Verified preview only'};},
  async targets(_args,before){
    return [{kind:'deployment',id:before.id,projectId:before.project},
      {kind:'project',id:before.project}];
  },
  async apply(_args,ctx,before,requestKey){
    // A repeated logical request may arrive after the first call completed.
    // Never issue a second PATCH against an already canceled deployment.
    if(before.state==='CANCELED')return {unchanged:true};
    const provider=await writeProvider(ctx);
    await requirePreDispatch(async()=>{
      const current=await provider.read('deployments_get',{path:{idOrUrl:before.id}});
      identity(current,before);
    });
    return provider.write('deployments_cancel',{path:{id:before.id}},{
      requestKey,tool:'vercel_deploy_cancel',
      shapeResult:row=>{
        if(row?.uid!=null&&row.uid!==before.id||
           row?.id!=null&&row.id!==before.id)
          throw new TypeError('Cancellation provider identity changed');
        return {accepted:true};
      }
    });
  },
  async verify(_args,ctx,before){
    const {client}=await readProvider(ctx);
    const row=await client.request('deployments_get',{path:{idOrUrl:before.id}});
    const same=(row?.uid??row?.id)===before.id&&
      row.projectId===before.project&&(row.target===null||row.target==='preview');
    if(!same)return {confirmed:false};
    const state=row.readyState??row.state;
    return {confirmed:state==='CANCELED'?true:
      STATES.has(state)?null:false};
  }
});
const output=x=>({isError:['refused_by_guard','outcome_unknown'].includes(x.status),
  content:[{type:'text',text:JSON.stringify(x)}]});
export const deploymentCancelTools={
  tools:[{
    name:'vercel_deploy_cancel',writes:true,guardedWrite:true,profiles:['everyday','full'],
    area:'deployments',description:'Guardedly cancel an unfinished, project-verified preview build after confirmation.',
    inputSchema,writeContract:cancel.writeContract,
    annotations:{readOnlyHint:false,destructiveHint:true}
  }],
  handlers:{vercel_deploy_cancel:bindGuardedWrite(cancel,context,output)}
};
