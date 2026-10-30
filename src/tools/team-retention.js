// O-1r deployment retention: PATCH teams defaultExpirationSettings.
// The write model uses duration enums; the team record reads back DAYS
// (pinned snapshot, Team.defaultExpirationSettings). Shortening a window
// is destructive: the preview first counts the existing deployments the
// new window would remove, per class, and refuses if that count cannot
// be read (BATCH-O O-1: "retention shortening is D with the count of
// deployments that would be removed (read first)").
import {createHash} from 'node:crypto';
import {defineWrite,bindGuardedWrite,requirePreDispatch, RefusalError } from '../core/write.js';
import {compact} from '../core/util.js';
import {readProvider,writeProvider} from '../vercel/provider.js';
import {checkProtected} from './self-guard.js';
import {checkApp} from './app-guard.js';
import {validateRequest} from '../vercel/openapi-validation.js';

const ID=/^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/;
const FULL=['3y','2y','1y','6m','3m','2m','1m','2w','1w','1d','unlimited'];
const SHORT=['1y','6m','3m','2m','1m','2w','1w','1d','unlimited'];
const DAYS={'1d':1,'1w':7,'2w':14,'1m':30,'2m':60,'3m':90,'6m':180,'1y':365,'2y':730,'3y':1095};
const FIELDS=[
  {arg:'expiration',read:'expirationDays',label:'preview deployments',enums:FULL},
  {arg:'expirationProduction',read:'expirationDaysProduction',label:'production deployments',enums:FULL},
  {arg:'expirationCanceled',read:'expirationDaysCanceled',label:'canceled deployments',enums:SHORT},
  {arg:'expirationErrored',read:'expirationDaysErrored',label:'errored deployments',enums:SHORT}
];
const props={
  ...Object.fromEntries(FIELDS.map(f=>[f.arg,{type:'string',enum:f.enums}])),
  keepCurrentRetention:{type:'boolean'},
  acknowledgeStorageBilling:{type:'boolean'},
  confirm:{type:'boolean'},dryRun:{type:'boolean'},
  requestKey:{type:'string',pattern:'^[a-zA-Z0-9_-]{8,128}$'}
};
const inputSchema={type:'object',properties:props,additionalProperties:false};
function validate(args){
  if(!args||typeof args!=='object'||Array.isArray(args)||
    Object.keys(args).some(k=>!Object.hasOwn(props,k))||
    !FIELDS.some(f=>args[f.arg]!==undefined)||
    FIELDS.some(f=>args[f.arg]!==undefined&&!f.enums.includes(args[f.arg]))||
    ['keepCurrentRetention','acknowledgeStorageBilling','confirm','dryRun']
      .some(k=>args[k]!==undefined&&typeof args[k]!=='boolean')||
    args.requestKey!==undefined&&(typeof args.requestKey!=='string'||
      !/^[a-zA-Z0-9_-]{8,128}$/.test(args.requestKey)))
    throw new RefusalError('Invalid deployment retention request');
}
const daysOf=value=>value==='unlimited'?null:DAYS[value];
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
    throw new RefusalError('Retention write requires a team-scoped account');
  const row=await client.request('teams_get',{path:{teamId:account.team_id}});
  if(!row||row.id!==account.team_id||!ID.test(row.id))
    throw new RefusalError('Connected team identity could not be verified');
  return {client,row,account};
}
function classify(deployment){
  if(deployment.readyState==='CANCELED')return 'expirationCanceled';
  if(deployment.readyState==='ERROR')return 'expirationErrored';
  if(deployment.target==='production')return 'expirationProduction';
  return 'expiration';
}
// Count, per shortened class, the deployments older than the new window.
// Production keeps the newest `deploymentsToKeep` regardless of age.
async function removalCounts(client,teamId,shortened,keep,now){
  const counts={};let capped=false;
  for(const f of shortened)counts[f.arg]=0;
  let until=null,pages=0;
  const productionAges=[];
  do{
    const query={teamId,limit:100};if(until!==null)query.until=until;
    const page=await client.request('deployments_list',{query});
    if(!page||!Array.isArray(page.deployments))
      throw new RefusalError('Deployment history could not be read to count removals');
    for(const d of page.deployments){
      const cls=classify(d);
      const field=shortened.find(f=>f.arg===cls);
      if(!field||typeof d.createdAt!=='number')continue;
      if(cls==='expirationProduction'){productionAges.push(now-d.createdAt);continue;}
      if(now-d.createdAt>field.newDays*86400000)counts[cls]++;
    }
    until=page.pagination?.next??null;pages++;
    if(until!==null&&pages>=20){capped=true;until=null;}
  }while(until!==null);
  if(counts.expirationProduction!==undefined){
    productionAges.sort((a,b)=>a-b);
    const newDays=shortened.find(f=>f.arg==='expirationProduction').newDays;
    counts.expirationProduction=productionAges
      .filter((age,index)=>index>=keep&&age>newDays*86400000).length;
  }
  return {counts,capped};
}
const settingsFingerprint=(row,settings)=>createHash('sha256')
  .update(JSON.stringify([row.id,settings??null])).digest('hex');
const update=defineWrite({
  name:'vercel_team_set_deployment_retention',
  async before(args,ctx){
    validate(args);
    const settings=Object.fromEntries(FIELDS.filter(f=>args[f.arg]!==undefined)
      .map(f=>[f.arg,args[f.arg]]));
    if(args.keepCurrentRetention!==undefined)settings.keepCurrentRetention=args.keepCurrentRetention;
    if(args.acknowledgeStorageBilling!==undefined)
      settings.acknowledgeStorageBilling=args.acknowledgeStorageBilling;
    validateRequest('teams_patch',{path:{teamId:'team_FAKE_validation'},
      body:{defaultExpirationSettings:settings}});
    const {client,row}=await team(ctx);
    const current=row.defaultExpirationSettings??{};
    const changes=[];
    for(const f of FIELDS){
      if(args[f.arg]===undefined)continue;
      const newDays=daysOf(args[f.arg]);
      const oldDays=typeof current[f.read]==='number'?current[f.read]:null;
      if(newDays===oldDays)continue;
      changes.push({...f,from:args[f.arg],oldDays,newDays,
        shortening:newDays!==null&&(oldDays===null||newDays<oldDays)});
    }
    if(!changes.length)throw new RefusalError('No retention changes requested');
    const shortened=changes.filter(c=>c.shortening);
    let counts=null,capped=false;
    if(shortened.length){
      const now=typeof ctx.now==='function'?ctx.now():Date.now();
      ({counts,capped}=await removalCounts(client,row.id,shortened,
        typeof current.deploymentsToKeep==='number'?current.deploymentsToKeep:0,now));
    }
    return {teamId:row.id,oldSlug:row.slug??null,settings,changes,counts,capped,
      destructive:shortened.length>0,
      etag:settingsFingerprint(row,row.defaultExpirationSettings??null)};
  },
  async preview(args,_ctx,before){
    const lines=before.changes.map(c=>{
      const base=c.label+': '+(c.oldDays===null?'unlimited':c.oldDays+' days')+
        ' -> '+(c.newDays===null?'unlimited':c.newDays+' days');
      if(!c.shortening)return base;
      return base+'; DESTRUCTIVE: about '+(before.capped?'at least ':'')+
        before.counts[c.arg]+' existing '+c.label+' older than the new window would be removed';
    });
    return 'Set team deployment retention. '+lines.join('. ')+
      '. PRODUCTION owner confirmation required.';
  },
  async production(){
    return {production:true,why:'Deployment retention governs deletion of deployment history on the live team account'};
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
        settingsFingerprint(current,current.defaultExpirationSettings??null)!==before.etag)
        throw new TypeError('Retention settings changed after preview');
    });
    return provider.write('teams_patch',{path:{teamId:before.teamId},
      body:{defaultExpirationSettings:before.settings}},{
      requestKey,tool:'vercel_team_set_deployment_retention',shapeResult:row=>{
        if(row?.id!==before.teamId)
          throw new TypeError('Provider did not confirm team identity');
        return {teamId:before.teamId,accepted:true};
      }
    });
  },
  async verify(args,ctx,before){
    const {row,account}=await team(ctx);
    const current=row.defaultExpirationSettings??{};
    const confirmed=account.team_id===before.teamId&&before.changes.every(c=>{
      const readBack=typeof current[c.read]==='number'?current[c.read]:null;
      return readBack===c.newDays;
    });
    return {confirmed,teamId:before.teamId};
  }
});
export const teamRetentionTools={
  tools:[{name:'vercel_team_set_deployment_retention',writes:true,guardedWrite:true,
    area:'teams',profiles:['full'],
    description:'Set team deployment retention windows; shortening first counts the deployments that would be removed and is destructive, with verified days readback.',
    inputSchema,writeContract:update.writeContract,
    annotations:{readOnlyHint:false,destructiveHint:true}}],
  handlers:{
    vercel_team_set_deployment_retention:bindGuardedWrite(update,ctxFor,result=>({
      isError:['refused_by_guard','outcome_unknown'].includes(result.status),
      content:[{type:'text',text:JSON.stringify(result)}]
    }))
  }
};
