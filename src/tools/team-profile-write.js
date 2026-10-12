// O-1b: production-class owner profile mutation, never an unguarded PATCH.
// Only the server-held exact team identity can be addressed, and apply rechecks
// both the encrypted account scope and each previewed field before dispatch.
import {createHash} from 'node:crypto';
import {defineWrite,bindGuardedWrite,requirePreDispatch} from '../core/write.js';
import {compact,credentialLike} from '../core/util.js';
import {readProvider,writeProvider} from '../vercel/provider.js';
import {checkProtected} from './self-guard.js';
import {checkApp} from './app-guard.js';
import {validateRequest} from '../vercel/openapi-validation.js';

const ID=/^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/;
const SLUG=/^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/;
const DOMAIN=/^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/;
const FIELDS=['name','slug','description','previewDeploymentSuffix'];
const props={
  name:{type:'string',minLength:1,maxLength:256},
  slug:{type:'string',maxLength:100,pattern:SLUG.source},
  description:{type:'string',maxLength:140},
  previewDeploymentSuffix:{anyOf:[{type:'string',maxLength:253},{type:'null'}]},
  confirm:{type:'boolean'},dryRun:{type:'boolean'},
  requestKey:{type:'string',pattern:'^[a-zA-Z0-9_-]{8,128}$'}
};
const inputSchema={type:'object',properties:props,additionalProperties:false};
function validate(args){
  if(!args||typeof args!=='object'||Array.isArray(args)||
    Object.keys(args).some(key=>!Object.hasOwn(props,key))||
    !FIELDS.some(key=>args[key]!==undefined)||
    args.confirm!==undefined&&typeof args.confirm!=='boolean'||
    args.dryRun!==undefined&&typeof args.dryRun!=='boolean')
    throw new TypeError('Invalid team profile request');
  for(const key of FIELDS){
    const value=args[key];
    if(value===undefined)continue;
    if(key==='previewDeploymentSuffix'&&value===null)continue;
    if(typeof value!=='string'||value.length>(key==='description'?140:key==='name'?256:key==='slug'?100:253)||
      (key==='name'&&value.length===0)||
      (key==='slug'&&!SLUG.test(value))||
      (key==='previewDeploymentSuffix'&&(!DOMAIN.test(value)||value.includes('..')))||
      /[\x00-\x1f\x7f]/.test(value)||credentialLike(value)||
      /(?:password|secret|access.?token|private.?key)\s*[:=]/i.test(value))
      throw new TypeError('Unsafe team profile value');
  }
  if(args.requestKey!==undefined&&
    (typeof args.requestKey!=='string'||!/^[a-zA-Z0-9_-]{8,128}$/.test(args.requestKey)))
    throw new TypeError('Invalid team settings request key');
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
  name:'vercel_team_update_profile',
  async before(args,ctx){
    validate(args);
    const body=Object.fromEntries(FIELDS.filter(k=>args[k]!==undefined).map(k=>[k,args[k]]));
    validateRequest('teams_patch',{path:{teamId:'team_FAKE_validation'},body});
    const {row}=await team(ctx);
    const changeKeys=FIELDS.filter(key=>args[key]!==undefined&&args[key]!== (row[key]??null));
    if(!changeKeys.length)throw new TypeError('No team profile changes requested');
    return {teamId:row.id,oldSlug:row.slug??null,oldName:row.name??null,
      changeKeys,etag:fingerprint(row,changeKeys)};
  },
  async preview(args,_ctx,before){
    return 'Update Vercel team '+before.teamId+' profile fields: '+before.changeKeys.join(', ')+
      (before.changeKeys.includes('slug')?
        '; team slug affects dashboard URLs; Vercel limits slug changes to six per week':'')+
      (before.changeKeys.includes('previewDeploymentSuffix')?
        '; preview deployment URL suffixes may change':'')+
      '; PRODUCTION owner confirmation required';
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
      requestKey,tool:'vercel_team_update_profile',shapeResult:row=>{
        if(row?.id!==before.teamId)
          throw new TypeError('Provider did not confirm team identity');
        return {teamId:before.teamId,accepted:true};
      }
    });
  },
  async verify(args,ctx,before){
    const {row,account}=await team(ctx);
    const confirmed=account.team_id===before.teamId&&
      before.changeKeys.every(k=> (row[k]??null)===(args[k]??null));
    return {confirmed,teamId:before.teamId};
  }
});
export const teamProfileWriteTools={
  tools:[{name:'vercel_team_update_profile',writes:true,guardedWrite:true,
    area:'teams',profiles:['full'],
    description:'Guard owner-only live team profile changes with strict preview, recheck, and independent GET verification.',
    inputSchema,writeContract:update.writeContract,
    annotations:{readOnlyHint:false,destructiveHint:false}}],
  handlers:{
    vercel_team_update_profile:bindGuardedWrite(update,ctxFor,result=>({
      isError:['refused_by_guard','outcome_unknown'].includes(result.status),
      content:[{type:'text',text:JSON.stringify(result)}]
    }))
  }
};
