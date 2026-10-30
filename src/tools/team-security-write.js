// O-1 guarded security settings. O-1r adds SAML (enforcement + directory
// role mappings) and email-domain auto-join under the design's lockout
// guard: saml.enforced may only be turned on when the team's current
// record already carries a SAML connection (BATCH-O section 5.4).
import {createHash} from 'node:crypto';
import {defineWrite,bindGuardedWrite,requirePreDispatch, RefusalError } from '../core/write.js';
import {compact} from '../core/util.js';
import {readProvider,writeProvider} from '../vercel/provider.js';
import {checkProtected} from './self-guard.js';
import {checkApp} from './app-guard.js';
import {validateRequest} from '../vercel/openapi-validation.js';

const ID=/^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/;
const FIELDS=['hideIpAddresses','hideIpAddressesInLogDrains','requireVerifiedCommits',
  'sensitiveEnvironmentVariablePolicy','disjunctiveProductionSecretPolicy',
  'strictDeploymentProtectionSettings','strictPasswordProtectionSettings','strictShareableLinks'];
const ROLE_ENUM=['OWNER','MEMBER','DEVELOPER','SECURITY','BILLING','VIEWER','VIEWER_FOR_PLUS','CONTRIBUTOR'];
const TEAM_PERMISSIONS=['AiGatewayBudgetManager','AiGatewayCredits','AiGatewaySettings',
  'AiGatewayTranscriptsManager','AiGatewayTranscriptsViewer','AiGatewayUser','ConnectorManager',
  'CreateProject','EnvVariableManager','EnvironmentManager','FullProductionDeployment',
  'IntegrationManager','OrgAdmin','OrgViewer','UsageViewer','V0Builder','V0Chatter','V0Viewer',
  'WorkflowDecryptor'];
const DOMAIN_RE=/^([a-z0-9]+(-[a-z0-9]+)*\.)+[a-z]{2,}$/;
const EXTRA=['saml','emailDomain'];
const ALLKEYS=[...FIELDS,...EXTRA];
const props={
  ...Object.fromEntries(FIELDS.slice(0,3).map(k=>[k,{type:'boolean'}])),
  ...Object.fromEntries(FIELDS.slice(3,5).map(k=>[k,{type:'string',enum:['on','off']} ])),
  ...Object.fromEntries(FIELDS.slice(5).map(k=>[k,{type:'object',additionalProperties:false,
    required:['enabled'],properties:{enabled:{type:'boolean'}}}])),
  saml:{type:'object',additionalProperties:false,properties:{
    enforced:{type:'boolean'},roles:{type:'object'}}},
  emailDomain:{type:['string','null']},
  confirm:{type:'boolean'},dryRun:{type:'boolean'},
  requestKey:{type:'string',pattern:'^[a-zA-Z0-9_-]{8,128}$'}
};
const inputSchema={type:'object',properties:props,additionalProperties:false};
function validRoleMapping(value){
  // Documented saml.roles value: a bare role name, {accessGroupId}, or
  // {teamRoles, teamPermissions?} (pinned snapshot, Team.saml.roles oneOf).
  if(typeof value==='string')return ROLE_ENUM.includes(value);
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const keys=Object.keys(value);
  if(keys.length===1&&keys[0]==='accessGroupId')
    return typeof value.accessGroupId==='string'&&value.accessGroupId.length>0;
  if(keys.includes('teamRoles')&&keys.every(k=>['teamRoles','teamPermissions'].includes(k)))
    return Array.isArray(value.teamRoles)&&value.teamRoles.length>0&&
      value.teamRoles.every(r=>ROLE_ENUM.includes(r))&&
      (value.teamPermissions===undefined||(Array.isArray(value.teamPermissions)&&
        value.teamPermissions.every(p=>TEAM_PERMISSIONS.includes(p))));
  return false;
}
function validate(args){
  if(!args||typeof args!=='object'||Array.isArray(args)||
    Object.keys(args).some(k=>!Object.hasOwn(props,k))||
    !ALLKEYS.some(k=>args[k]!==undefined)||
    ['confirm','dryRun'].some(k=>args[k]!==undefined&&typeof args[k]!=='boolean')||
    args.requestKey!==undefined&&(typeof args.requestKey!=='string'||
      !/^[a-zA-Z0-9_-]{8,128}$/.test(args.requestKey)))
    throw new RefusalError('Invalid team security request');
  for(const key of FIELDS){
    const value=args[key];
    if(value===undefined)continue;
    if(FIELDS.slice(0,3).includes(key)?typeof value!=='boolean':
      FIELDS.slice(3,5).includes(key)?!['on','off'].includes(value):
      !value||typeof value!=='object'||Array.isArray(value)||
        Object.keys(value).length!==1||typeof value.enabled!=='boolean')
      throw new RefusalError('Invalid team security value');
  }
  if(args.saml!==undefined){
    const s=args.saml;
    if(!s||typeof s!=='object'||Array.isArray(s)||
      Object.keys(s).some(k=>!['enforced','roles'].includes(k))||
      (s.enforced===undefined&&s.roles===undefined)||
      (s.enforced!==undefined&&typeof s.enforced!=='boolean')||
      (s.roles!==undefined&&(!s.roles||typeof s.roles!=='object'||Array.isArray(s.roles)||
        !Object.values(s.roles).every(validRoleMapping))))
      throw new RefusalError('Invalid SAML security value');
  }
  if(args.emailDomain!==undefined&&args.emailDomain!==null&&
    (typeof args.emailDomain!=='string'||!DOMAIN_RE.test(args.emailDomain)))
    throw new RefusalError('Invalid email domain');
}
const equal=(a,b)=>JSON.stringify(a??null)===JSON.stringify(b??null);
const samlOf=row=>({enforced:row?.saml?.enforced??null,roles:row?.saml?.roles??null});
const currentOf=(row,key)=>key==='saml'?samlOf(row):(row[key]??null);
function isChange(key,args,row){
  if(args[key]===undefined)return false;
  if(key==='saml'){
    const cur=samlOf(row);
    return (args.saml.enforced!==undefined&&args.saml.enforced!==cur.enforced)||
      (args.saml.roles!==undefined&&!equal(args.saml.roles,cur.roles));
  }
  return !equal(args[key],row[key]);
}
function loosening(args,keys){
  return keys.filter(k=>FIELDS.includes(k)&&
    (args[k]===false||args[k]==='off'||args[k]?.enabled===false));
}
function grants(args,keys){
  const out=[];
  if(keys.includes('saml')){
    if(args.saml.enforced===false)out.push('SAML enforcement turned off');
    if(args.saml.roles!==undefined)out.push('SAML directory role mappings changed');
  }
  if(keys.includes('emailDomain')&&typeof args.emailDomain==='string')
    out.push('anyone with an @'+args.emailDomain+' email can join this team automatically');
  return out;
}
const fingerprint=(row,keys)=>createHash('sha256').update(JSON.stringify(
  [row.id,...keys.map(key=>[key,currentOf(row,key)])])).digest('hex');
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
  name:'vercel_team_update_security',
  async before(args,ctx){
    validate(args);
    const body=Object.fromEntries(ALLKEYS.filter(k=>args[k]!==undefined).map(k=>[k,args[k]]));
    validateRequest('teams_patch',{path:{teamId:'team_FAKE_validation'},body});
    const {row}=await team(ctx);
    const changeKeys=ALLKEYS.filter(key=>isChange(key,args,row));
    if(!changeKeys.length)throw new RefusalError('No team profile changes requested');
    // Lockout guard (BATCH-O 5.4): SAML may only be ENFORCED when the
    // team's current record already carries a SAML connection; enforcing
    // sign-in through an IdP that is not connected locks everyone out.
    if(changeKeys.includes('saml')&&args.saml.enforced===true&&
      !(row.saml?.connection&&typeof row.saml.connection==='object'))
      throw new RefusalError('SAML enforcement refused: this team has no SAML connection configured. '+
        'Connect the identity provider first (dashboard, guided), then enforce.');
    return {teamId:row.id,oldSlug:row.slug??null,oldName:row.name??null,
      changeKeys,etag:fingerprint(row,changeKeys)};
  },
  risk:{access:true},
  async access(args,before){
    const keys=loosening(args,before.changeKeys);
    const gained=grants(args,before.changeKeys);
    return {widens:keys.length>0||gained.length>0,
      who:'Team members, directory-synced users and deployment visitors',
      what:[keys.length?'Fewer privacy, secret isolation or owner-only protection restrictions':null,
        ...gained].filter(Boolean).join('; ')||'Team access rules change'};
  },
  async preview(args,_ctx,before){
    const keys=loosening(args,before.changeKeys);
    const gained=grants(args,before.changeKeys);
    let text='Update team security fields: '+before.changeKeys.join(', ');
    if(keys.length)text+='; ACCESS WIDENING: team members and deployment visitors gain fewer restrictions: '+keys.join(', ');
    if(gained.length)text+='; ACCESS WIDENING: '+gained.join('; ');
    if(!keys.length&&!gained.length)text+='; tighten team privacy and security restrictions';
    if(before.changeKeys.includes('saml')&&args.saml.enforced===true)
      text+='; SAML sign-in will be enforced for the whole team (a SAML connection is configured)';
    if(before.changeKeys.includes('emailDomain')&&args.emailDomain===null)
      text+='; email-domain auto-join removed';
    return text+'; verified commits can prevent unsigned deployments; PRODUCTION owner confirmation required.';
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
    const body=Object.fromEntries(before.changeKeys.map(k=>[k,args[k]]));
    return provider.write('teams_patch',{path:{teamId:before.teamId},body},{
      requestKey,tool:'vercel_team_update_security',shapeResult:row=>{
        if(row?.id!==before.teamId)
          throw new TypeError('Provider did not confirm team identity');
        return {teamId:before.teamId,accepted:true};
      }
    });
  },
  async verify(args,ctx,before){
    const {row,account}=await team(ctx);
    const fieldOk=k=>{
      if(k==='saml'){
        if(args.saml.enforced!==undefined&&row.saml?.enforced!==args.saml.enforced)return false;
        if(args.saml.roles!==undefined&&!equal(row.saml?.roles??null,args.saml.roles))return false;
        return true;
      }
      return equal(row[k],args[k]);
    };
    const confirmed=account.team_id===before.teamId&&before.changeKeys.every(fieldOk);
    return {confirmed,teamId:before.teamId};
  }
});
export const teamSecurityWriteTools={
  tools:[{name:'vercel_team_update_security',writes:true,guardedWrite:true,
    area:'teams',profiles:['full'],
    description:'Guard team privacy, secret isolation and strict protection settings, SAML and email-domain auto-join (lockout-guarded), with access warnings and GET readback.',
    inputSchema,writeContract:update.writeContract,
    annotations:{readOnlyHint:false,destructiveHint:false}}],
  handlers:{
    vercel_team_update_security:bindGuardedWrite(update,ctxFor,result=>({
      isError:['refused_by_guard','outcome_unknown'].includes(result.status),
      content:[{type:'text',text:JSON.stringify(result)}]
    }))
  }
};
