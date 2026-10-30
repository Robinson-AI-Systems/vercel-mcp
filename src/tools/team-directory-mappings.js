// O-1r directory role mappings: POST /v1/teams/{teamId}/dsync-roles.
// The pinned snapshot documents the value shape: each directory group id
// maps to a bare team role (enum) or {accessGroupId: "ag_..."}. Vercel
// offers no GET for these mappings, so verification is the documented
// {ok:true} acceptance itself, reported honestly as confirmed:null.
import {createHash} from 'node:crypto';
import {defineWrite,bindGuardedWrite,requirePreDispatch, RefusalError } from '../core/write.js';
import {compact} from '../core/util.js';
import {readProvider,writeProvider} from '../vercel/provider.js';
import {checkProtected} from './self-guard.js';
import {checkApp} from './app-guard.js';
import {validateRequest} from '../vercel/openapi-validation.js';

const ID=/^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/;
const ROLE_ENUM=['OWNER','MEMBER','DEVELOPER','SECURITY','BILLING','VIEWER','VIEWER_FOR_PLUS','CONTRIBUTOR'];
const props={
  mappings:{type:'object'},
  confirm:{type:'boolean'},dryRun:{type:'boolean'},
  requestKey:{type:'string',pattern:'^[a-zA-Z0-9_-]{8,128}$'}
};
const inputSchema={type:'object',required:['mappings'],properties:props,additionalProperties:false};
function validValue(value){
  if(typeof value==='string')return ROLE_ENUM.includes(value);
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const keys=Object.keys(value);
  return keys.length===1&&keys[0]==='accessGroupId'&&
    typeof value.accessGroupId==='string'&&/^ag_[A-Za-z0-9_ -]+$/.test(value.accessGroupId);
}
function validate(args){
  if(!args||typeof args!=='object'||Array.isArray(args)||
    Object.keys(args).some(k=>!Object.hasOwn(props,k))||
    !args.mappings||typeof args.mappings!=='object'||Array.isArray(args.mappings)||
    ['confirm','dryRun'].some(k=>args[k]!==undefined&&typeof args[k]!=='boolean')||
    args.requestKey!==undefined&&(typeof args.requestKey!=='string'||
      !/^[a-zA-Z0-9_-]{8,128}$/.test(args.requestKey)))
    throw new RefusalError('Invalid directory role mappings request');
  const entries=Object.entries(args.mappings);
  if(!entries.length||entries.length>100||
    entries.some(([group,value])=>!group||group.length>200||!validValue(value)))
    throw new RefusalError('Invalid directory role mapping value');
}
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
    throw new RefusalError('Directory mapping write requires a team-scoped account');
  const row=await client.request('teams_get',{path:{teamId:account.team_id}});
  if(!row||row.id!==account.team_id||!ID.test(row.id))
    throw new RefusalError('Connected team identity could not be verified');
  return {row,account};
}
const describe=(group,value)=>'directory group '+group+' -> '+
  (typeof value==='string'?'team role '+value:'access group '+value.accessGroupId);
const update=defineWrite({
  name:'vercel_team_set_directory_role_mappings',
  async before(args,ctx){
    validate(args);
    validateRequest('teams_dsync_roles',{path:{teamId:'team_FAKE_validation'},
      body:{roles:args.mappings}});
    const {row}=await team(ctx);
    // Mappings only take effect on a connected directory; the team record's
    // saml.connection is the documented evidence of one.
    if(!(row.saml?.connection&&typeof row.saml.connection==='object'))
      throw new RefusalError('Directory role mappings refused: this team has no directory connection. '+
        'Connect Directory Sync first (dashboard, guided), then set mappings.');
    const syncState=row.saml.connection.syncState??'ACTIVE';
    return {teamId:row.id,oldSlug:row.slug??null,mappings:args.mappings,syncState,
      etag:createHash('sha256').update(JSON.stringify(
        [row.id,row.saml?.enforced??null,syncState])).digest('hex')};
  },
  risk:{access:true},
  async access(args){
    const lines=Object.entries(args.mappings).map(([g,v])=>describe(g,v));
    return {widens:true,who:'Directory-synced users',
      what:'Directory group members gain the mapped access: '+lines.join('; ')};
  },
  async preview(args,_ctx,before){
    const lines=Object.entries(args.mappings).map(([g,v])=>describe(g,v));
    return 'Set directory role mappings ('+lines.join('; ')+'). ACCESS WIDENING: '+
      'directory-synced users gain the mapped team roles or access-group memberships. '+
      'Directory sync state: '+before.syncState+'. PRODUCTION owner confirmation required. '+
      'Vercel offers no read-back for mappings; acceptance is the provider ok response.';
  },
  async production(){
    return {production:true,why:'Directory role mappings grant team access on the live owner account'};
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
      const state=current?.saml?.connection?.syncState??'ACTIVE';
      if(current?.id!==before.teamId||!(current.saml?.connection)||
        createHash('sha256').update(JSON.stringify(
          [current.id,current.saml?.enforced??null,state])).digest('hex')!==before.etag)
        throw new TypeError('Directory connection changed after preview');
    });
    return provider.write('teams_dsync_roles',{path:{teamId:before.teamId},
      body:{roles:before.mappings}},{
      requestKey,tool:'vercel_team_set_directory_role_mappings',shapeResult:row=>{
        if(row?.ok!==true)
          throw new TypeError('Provider did not confirm directory mapping acceptance');
        return {teamId:before.teamId,accepted:true};
      }
    });
  },
  async verify(_args,_ctx,before){
    // No GET exists for dsync mappings in the pinned contract; the
    // provider's documented {ok:true} acceptance is the only evidence.
    return {confirmed:null,teamId:before.teamId,
      note:'No read-back exists for directory mappings; provider acceptance (ok:true) is the verification.'};
  }
});
export const teamDirectoryMappingsTools={
  tools:[{name:'vercel_team_set_directory_role_mappings',writes:true,guardedWrite:true,
    area:'teams',profiles:['full'],
    description:'Set Directory Sync group to team-role or access-group mappings with a plain who-gets-what access warning; refuses when no directory is connected.',
    inputSchema,writeContract:update.writeContract,
    annotations:{readOnlyHint:false,destructiveHint:false}}],
  handlers:{
    vercel_team_set_directory_role_mappings:bindGuardedWrite(update,ctxFor,result=>({
      isError:['refused_by_guard','outcome_unknown'].includes(result.status),
      content:[{type:'text',text:JSON.stringify(result)}]
    }))
  }
};
