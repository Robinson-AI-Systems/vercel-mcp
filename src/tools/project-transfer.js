// D-1o: transfer initiation only. The claim code is encrypted into an owner-only
// one-time vault; never return it through an MCP result or a replay/audit record.
import {defineWrite,bindGuardedWrite,requirePreDispatch, RefusalError } from '../core/write.js';
import {compact} from '../core/util.js';
import {oneTimeSecrets} from '../core/one-time-secrets.js';
import {readProvider,writeProvider} from '../vercel/provider.js';
import {checkProtected} from './self-guard.js';
import {checkApp} from './app-guard.js';
import {validateRequest} from '../vercel/openapi-validation.js';

const ID=/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const props={
  project:{type:'string',minLength:1,maxLength:128,pattern:ID.source},
  expectedName:{type:'string',minLength:1,maxLength:128},
  confirm:{type:'boolean'},dryRun:{type:'boolean'},
  requestKey:{type:'string',pattern:'^[a-zA-Z0-9_-]{8,128}$'}
};
const inputSchema={type:'object',properties:props,
  required:['project','expectedName'],additionalProperties:false};
function assertArgs(args){
  if(!args||typeof args!=='object'||Array.isArray(args)||
    Object.keys(args).some(k=>!Object.hasOwn(props,k))||
    typeof args.project!=='string'||!ID.test(args.project)||
    typeof args.expectedName!=='string'||!ID.test(args.expectedName)||
    (args.confirm!==undefined&&typeof args.confirm!=='boolean')||
    (args.dryRun!==undefined&&typeof args.dryRun!=='boolean'))
    throw new RefusalError('Invalid project transfer request');
}
function context({db,connection,env,fetchImpl}){
  return {db,connection,env,fetchImpl,shape:compact,
    audit:x=>db.recordChange(x),replayStore:db.requestReplayStore(),
    guardProtected:targets=>checkProtected(targets,{db,connection,env}),
    guardApp:targets=>checkApp(targets,{db,connection,env})};
}
const transfer=defineWrite({
  name:'vercel_project_transfer',
  risk:{access:true},secretOut:true,
  async before(args,ctx){
    assertArgs(args);
    if(ctx.connection.profile!=='full')throw new RefusalError('Full profile required');
    validateRequest('projects_transfer_request',{
      path:{idOrName:args.project},query:{teamId:'team_FAKE_validation'},body:{}
    });
    const {client,account}=await readProvider(ctx);
    if(!['team','full'].includes(account.scope))
      throw new RefusalError('Team account required');
    const row=await client.request('projects_get',{path:{idOrName:args.project}});
    if(typeof row?.id!=='string'||!ID.test(row.id)||
      typeof row?.name!=='string'||row.name!==args.expectedName)
      throw new RefusalError('Project name must match independent provider identity');
    return {id:row.id,name:row.name,accountId:account.id,
      teamId:account.team_id};
  },
  async preview(_args,_ctx,before){
    return 'Issue a 24-hour claim code for project '+before.name+' ('+before.id+
      '); this may enable another team to claim ownership. '+
      'The code is delivered only through the authenticated owner setup page. '+
      'No transfer is completed by issuing this request.';
  },
  async production(){
    return {production:true,why:'Transfer claims can change ownership of a live project'};
  },
  async targets(_args,before){
    return [{kind:'project',id:before.id,name:before.name}];
  },
  async access(){
    return {widens:true,who:'Holder of one-time owner claim code',
      what:'Ability to accept transfer of the exact project'};
  },
  async apply(_args,ctx,before,requestKey){
    const vault=oneTimeSecrets({db:ctx.db,env:ctx.env});
    const provider=await requirePreDispatch(()=>writeProvider(ctx));
    await requirePreDispatch(async()=>{
      // A transfer claim can hand off a project. Re-prove the exact target with
      // the credential/team that will issue the claim, not a preview-time token.
      if(!['team','full'].includes(provider.account.scope)||
        provider.account.id!==before.accountId||
        provider.account.team_id!==before.teamId)
        throw new TypeError('Transfer issuer authority changed after confirmation');
      const fresh=await provider.read('projects_get',{path:{idOrName:before.id}});
      if(fresh?.id!==before.id||fresh?.name!==before.name)
        throw new TypeError('Transfer project identity changed after confirmation');
    });
    return provider.write('projects_transfer_request',{
      path:{idOrName:before.id},body:{}
    },{requestKey,tool:'vercel_project_transfer',
      shapeResult:async raw=>{
        if(typeof raw?.code!=='string'||raw.code.length<8||raw.code.length>512)
          throw new TypeError('Provider transfer claim was not issued');
        const issued=await vault.issue({account:ctx.connection.account,
          kind:'project_transfer',label:before.name,value:raw.code});
        return {project:before.id,oneTimeId:issued.id,expiresAt:issued.expiresAt};
      }});
  },
  async verify(_args,_ctx,before,issued){
    // No independent GET verifies an unclaimed transfer code. Report unknown,
    // never falsely claim the project was transferred.
    return {confirmed:null,project:before.id,
      oneTimeId:issued?.oneTimeId??null};
  }
});
export const projectTransferTools={
  tools:[{name:'vercel_project_transfer',writes:true,guardedWrite:true,
    profiles:['full'],area:'projects',
    description:'Request an owner-only one-time transfer code; does not transfer the project.',
    inputSchema,writeContract:transfer.writeContract,
    annotations:{readOnlyHint:false,destructiveHint:true}}],
  handlers:{vercel_project_transfer:bindGuardedWrite(transfer,context,result=>({
    isError:['refused_by_guard','outcome_unknown'].includes(result.status),
    content:[{type:'text',text:JSON.stringify(result)}]
  }))}
};
