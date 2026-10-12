// O-1 guarded security settings; SAML and auto-join excluded until lockout-safe evidence exists.
import {createHash} from 'node:crypto';
import {defineWrite,bindGuardedWrite,requirePreDispatch} from '../core/write.js';
import {compact} from '../core/util.js';
import {readProvider,writeProvider} from '../vercel/provider.js';
import {checkProtected} from './self-guard.js';
import {checkApp} from './app-guard.js';
import {validateRequest} from '../vercel/openapi-validation.js';

const ID=/^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/;
const FIELDS=['hideIpAddresses','hideIpAddressesInLogDrains','requireVerifiedCommits',
  'sensitiveEnvironmentVariablePolicy','disjunctiveProductionSecretPolicy',
  'strictDeploymentProtectionSettings','strictPasswordProtectionSettings','strictShareableLinks'];
const props={
  ...Object.fromEntries(FIELDS.slice(0,3).map(k=>[k,{type:'boolean'}])),
  ...Object.fromEntries(FIELDS.slice(3,5).map(k=>[k,{type:'string',enum:['on','off']} ])),
  ...Object.fromEntries(FIELDS.slice(5).map(k=>[k,{type:'object',additionalProperties:false,
    required:['enabled'],properties:{enabled:{type:'boolean'}}}])),
  confirm:{type:'boolean'},dryRun:{type:'boolean'},
  requestKey:{type:'string',pattern:'^[a-zA-Z0-9_-]{8,128}$'}
};
const inputSchema={type:'object',properties:props,additionalProperties:false};
function validate(args){
  if(!args||typeof args!=='object'||Array.isArray(args)||
    Object.keys(args).some(k=>!Object.hasOwn(props,k))||
    !FIELDS.some(k=>args[k]!==undefined)||
    ['confirm','dryRun'].some(k=>args[k]!==undefined&&typeof args[k]!=='boolean')||
    args.requestKey!==undefined&&(typeof args.requestKey!=='string'||
      !/^[a-zA-Z0-9_-]{8,128}$/.test(args.requestKey)))
    throw new TypeError('Invalid team security request');
  for(const key of FIELDS){
    const value=args[key];
    if(value===undefined)continue;
    if(FIELDS.slice(0,3).includes(key)?typeof value!=='boolean':
      FIELDS.slice(3,5).includes(key)?!['on','off'].includes(value):
      !value||typeof value!=='object'||Array.isArray(value)||
        Object.keys(value).length!==1||typeof value.enabled!=='boolean')
      throw new TypeError('Invalid team security value');
  }
}
const equal=(a,b)=>JSON.stringify(a??null)===JSON.stringify(b??null);
function loosening(args,keys){
  return keys.filter(k=>args[k]===false||args[k]==='off'||args[k]?.enabled===false);
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
  if(ctx.connection?.profile!=='full')throw new TypeError('Full owner profile required');
  const {client,account}=await readProvider(ctx);
  if(!['team','full'].includes(account.scope)||!ID.test(account.team_id))
    throw new TypeError('Team profile write requires a team-scoped account');
  const row=await client.request('teams_get',{path:{teamId:account.team_id}});
  if(!row||row.id!==account.team_id||!ID.test(row.id))
    throw new TypeError('Connected team identity could not be verified');
  return {row,account};
}
const update=defineWrite({
  name:'vercel_team_update_security',
  async before(args,ctx){
    validate(args);
    const body=Object.fromEntries(FIELDS.filter(k=>args[k]!==undefined).map(k=>[k,args[k]]));
    validateRequest('teams_patch',{path:{teamId:'team_FAKE_validation'},body});
    const {row}=await team(ctx);
    const changeKeys=FIELDS.filter(key=>args[key]!==undefined&&!equal(args[key],row[key]));
    if(!changeKeys.length)throw new TypeError('No team profile changes requested');
    return {teamId:row.id,oldSlug:row.slug??null,oldName:row.name??null,
      changeKeys,etag:fingerprint(row,changeKeys)};
  },
  risk:{access:true},
  async access(args,before){
    const keys=loosening(args,before.changeKeys);
    return {widens:keys.length>0,who:'Team members and deployment visitors',
      what:'Fewer privacy, secret isolation or owner-only protection restrictions'};
  },
  async preview(args,_ctx,before){
    const keys=loosening(args,before.changeKeys);
    return 'Update team security fields: '+before.changeKeys.join(', ')+
      (keys.length?'; ACCESS WIDENING: team members and deployment visitors gain fewer restrictions: '+keys.join(', '):
        '; tighten team privacy and security restrictions')+
      '; verified commits can prevent unsigned deployments; PRODUCTION owner confirmation required. '+
      'SAML enforcement and email-domain auto-join require separate lockout-safe owner evidence and are not accepted.';
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
    const confirmed=account.team_id===before.teamId&&
      before.changeKeys.every(k=> equal(row[k],args[k]));
    return {confirmed,teamId:before.teamId};
  }
});
export const teamSecurityWriteTools={
  tools:[{name:'vercel_team_update_security',writes:true,guardedWrite:true,
    area:'teams',profiles:['full'],
    description:'Guard team privacy, secret isolation and owner-only protection changes with access warnings and verified GET readback.',
    inputSchema,writeContract:update.writeContract,
    annotations:{readOnlyHint:false,destructiveHint:false}}],
  handlers:{
    vercel_team_update_security:bindGuardedWrite(update,ctxFor,result=>({
      isError:['refused_by_guard','outcome_unknown'].includes(result.status),
      content:[{type:'text',text:JSON.stringify(result)}]
    }))
  }
};
