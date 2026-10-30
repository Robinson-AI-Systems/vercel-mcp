// O-1 standard preview authentication defaults; paid advanced modes and passwords refused.
import {createHash} from 'node:crypto';
import {defineWrite,bindGuardedWrite,requirePreDispatch, RefusalError } from '../core/write.js';
import {compact} from '../core/util.js';
import {readProvider,writeProvider} from '../vercel/provider.js';
import {checkProtected} from './self-guard.js';
import {checkApp} from './app-guard.js';
import {validateRequest} from '../vercel/openapi-validation.js';

const ID=/^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/;
const FIELDS=['defaultDeploymentProtection'];
const props={
  ssoProtection:{anyOf:[{type:'null'},{type:'object',required:['deploymentType'],
    additionalProperties:false,properties:{deploymentType:{type:'string',enum:['preview']}}}]},
  confirm:{type:'boolean'},dryRun:{type:'boolean'},
  requestKey:{type:'string',pattern:'^[a-zA-Z0-9_-]{8,128}$'}
};
const inputSchema={type:'object',required:['ssoProtection'],properties:props,additionalProperties:false};
function validate(args){
  if(!args||typeof args!=='object'||Array.isArray(args)||
    Object.keys(args).some(k=>!Object.hasOwn(props,k))||!Object.hasOwn(args,'ssoProtection')||
    ['confirm','dryRun'].some(k=>args[k]!==undefined&&typeof args[k]!=='boolean')||
    args.requestKey!==undefined&&(typeof args.requestKey!=='string'||
      !/^[a-zA-Z0-9_-]{8,128}$/.test(args.requestKey)))
    throw new RefusalError('Invalid team protection request');
  const v=args.ssoProtection;
  if(v!==null&&(!v||typeof v!=='object'||Array.isArray(v)||
    Object.keys(v).length!==1||v.deploymentType!=='preview'))
    throw new RefusalError('Only standard preview Vercel Authentication or its removal is supported');
}
const equal=(a,b)=>JSON.stringify(a??null)===JSON.stringify(b??null);
const intended=args=>({ssoProtection:args.ssoProtection});
function widening(args,row){
  const old=row.defaultDeploymentProtection?.ssoProtection;
  return args.ssoProtection===null||old!=null&&old.deploymentType!=='preview';
}
const fingerprint=(row,keys)=>createHash('sha256').update(JSON.stringify(
  [row.id,...keys.map(key=>[key,row[key]??null])])).digest('hex');
function ctxFor({db,connection,env,fetchImpl}){
  return {db,connection,env,fetchImpl,shape:compact,
    audit:x=>db.recordChange(x),replayStore:db.requestReplayStore(),
    guardProtected:targets=>checkProtected(targets,{db,connection,env}),
    guardApp:targets=>checkApp(targets,{db,connection,env})};
}
async function team(ctx){
  if(ctx.connection?.profile!=='full')throw new RefusalError('Full owner profile required');
  const {client,account}=await readProvider(ctx);
  if(!['team','full'].includes(account.scope)||!ID.test(account.team_id))
    throw new RefusalError('Team profile write requires a team-scoped account');
  const row=await client.request('teams_get',{path:{teamId:account.team_id}});
  if(!row||row.id!==account.team_id||!ID.test(row.id))
    throw new RefusalError('Connected team identity could not be verified');
  return {row,account};
}
const update=defineWrite({
  name:'vercel_team_set_default_protection',
  async before(args,ctx){
    validate(args);
    const body={defaultDeploymentProtection:intended(args)};
    validateRequest('teams_patch',{path:{teamId:'team_FAKE_validation'},body});
    const {row}=await team(ctx);
    const current=row.defaultDeploymentProtection;
    if(current!==undefined&&current!==null&&
      (typeof current!=='object'||Array.isArray(current)))
      throw new RefusalError('Unknown team protection state');
    if(equal(current?.ssoProtection,args.ssoProtection))
      throw new RefusalError('No protection change requested');
    // Never retain or send password material. Refuse combined password state
    // because PATCH merge semantics are not independently established.
    if(current?.passwordProtection!=null)
      throw new RefusalError('Existing password defaults require a secret-safe hand-built workflow');
    return {teamId:row.id,oldSlug:row.slug??null,changeKeys:FIELDS,
      widens:widening(args,row),etag:fingerprint(row,FIELDS)};
  },
  risk:{access:true},
  async access(_args,before){
    return {widens:before.widens,who:'Visitors to newly created projects',
      what:'Can access deployments outside the remaining preview authentication boundary'};
  },
  async preview(args,_ctx,before){
    return 'Set authentication defaults for NEW projects only: '+
      (args.ssoProtection===null?'remove Vercel Authentication':'team viewers must authenticate on previews')+
      (before.widens?'; ACCESS WIDENING: visitors gain access outside remaining preview protection':'')+
      '; existing projects unchanged; only standard preview protection, no paid advanced modes or password changes; PRODUCTION owner confirmation required';
  },
  async production(){
    return {production:true,why:'Team profile settings affect a live owner account'};
  },
  async targets(_args,before){
    return [{kind:'account',id:before.teamId,name:before.oldSlug??before.teamId}];
  },
  async apply(args,ctx,before,requestKey){
    const provider=await writeProvider(ctx);
    await requirePreDispatch(async()=>{
      if(!['team','full'].includes(provider.account.scope)||
        provider.account.team_id!==before.teamId||ctx.connection?.profile!=='full'||
        ctx.connection?.mode!=='production')
        throw new TypeError('Team authority changed');
      const current=await provider.read('teams_get',{path:{teamId:before.teamId}});
      if(current?.id!==before.teamId||
        fingerprint(current,before.changeKeys)!==before.etag)
        throw new TypeError('Team settings changed after preview');
    });
    const body={defaultDeploymentProtection:intended(args)};
    return provider.write('teams_patch',{path:{teamId:before.teamId},body},{
      requestKey,tool:'vercel_team_set_default_protection',shapeResult:row=>{
        if(row?.id!==before.teamId)
          throw new TypeError('Provider did not confirm team identity');
        return {teamId:before.teamId,accepted:true};
      }
    });
  },
  async verify(args,ctx,before){
    const {row,account}=await team(ctx);
    const confirmed=account.team_id===before.teamId&&
      equal(row.defaultDeploymentProtection?.ssoProtection,args.ssoProtection);
    return {confirmed,teamId:before.teamId};
  }
});
export const teamDefaultProtectionTools={
  tools:[{name:'vercel_team_set_default_protection',writes:true,guardedWrite:true,
    area:'teams',profiles:['full'],
    description:'Guard standard preview authentication defaults for new projects with access warnings, state recheck and GET readback.',
    inputSchema,writeContract:update.writeContract,
    annotations:{readOnlyHint:false,destructiveHint:false}}],
  handlers:{
    vercel_team_set_default_protection:bindGuardedWrite(update,ctxFor,result=>({
      isError:['refused_by_guard','outcome_unknown'].includes(result.status),
      content:[{type:'text',text:JSON.stringify(result)}]
    }))
  }
};
