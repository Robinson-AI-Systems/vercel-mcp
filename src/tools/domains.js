// N-1: team and project domains. Reads verify team/project ownership the same
// way other read tools do; writes are guarded defineWrite operations with
// production classification per BATCH-N N1 and independent read-back.
import {defineWrite,bindGuardedWrite,requirePreDispatch} from '../core/write.js';
import {compact,credentialLike} from '../core/util.js';
import {readProvider,writeProvider} from '../vercel/provider.js';
import {validateRequest} from '../vercel/openapi-validation.js';
import {domainIsProduction} from '../vercel/production.js';
import {checkProtected} from './self-guard.js';
import {checkApp} from './app-guard.js';
import {PROJECT,DEPLOY,ALIAS,safeAlias,schema,respond,projectContext} from './release-common.js';

const READ_PROFILES=['read_only','everyday','full'];
const EVERYDAY=['everyday','full'];
const FULL=['full'];
const REQUEST=/^[A-Za-z0-9_-]{8,128}$/;
const BRANCH=/^[^\s]{1,250}$/;
const ENV_ID=/^[A-Za-z0-9_-]{1,128}$/;
const DESTINATION=/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const IDENT=/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const REDIRECT_CODES=[301,302,307,308];

function exactArgs(args,allowed){
  if(!args||typeof args!=='object'||Array.isArray(args)||
    Object.keys(args).some(key=>!allowed.includes(key)))
    throw new TypeError('Invalid domain tool arguments');
}
const safeText=(value,max=256)=>typeof value==='string'&&value.length<=max&&
  !/[\x00-\x1f\x7f]/.test(value)&&!credentialLike(value)?value:null;
function safeHostname(value){
  if(typeof value!=='string'||credentialLike(value)||value.length>253||
    /[/?#@:\s\\]/.test(value)||!/^[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(value))
    return null;
  return value;
}
// A returned cursor must be callable with the public integer input schema.
// Never silently claim end-of-list when the provider's cursor is malformed.
function pageCursor(reply,rows,limit){
  if(!Array.isArray(rows)||rows.length>limit||!reply?.pagination)
    throw new TypeError('Domain list page is incomplete or oversized');
  const next=reply.pagination.next;
  if(next===null){
    if(reply.pagination.hasNext===true||reply.pagination.hasMore===true||
      reply.hasMore===true)
      throw new TypeError('Conflicting list pagination flags');
    return null;
  }
  if(reply.pagination.hasNext===false||reply.pagination.hasMore===false||
    reply.hasMore===false)
    throw new TypeError('Conflicting list continuation');
  const numeric=typeof next==='string'&&/^[1-9][0-9]{0,15}$/.test(next)?Number(next):next;
  if(!Number.isSafeInteger(numeric)||numeric<1)
    throw new TypeError('Provider returned an unusable pagination cursor');
  return numeric;
}
function completePage(reply,rows,limit,label){
  if(pageCursor(reply,rows,limit)!==null)
    throw new TypeError(label+' inventory is paginated; cannot prove completeness');
  return rows;
}
async function teamContext(ctx){
  const {client,account}=await readProvider(ctx);
  if(!['team','full'].includes(account.scope))
    throw new TypeError('Team domains are not available to a project-scoped connection');
  return {client,account};
}
// GET /v5/domains/{domain} wraps the record in a {domain} envelope (pinned
// OpenAPI snapshot); unwrap it once here so every caller sees the bare row.
async function getTeamDomain(client,domain){
  const reply=await client.request('domains_get',{path:{domain}});
  const row=reply?.domain;
  if(!row||typeof row!=='object'||Array.isArray(row))
    throw new TypeError('Invalid domain response');
  return row;
}
function domainSummary(row,teamId){
  if(!row||typeof row!=='object'||Array.isArray(row))
    throw new TypeError('Invalid domain response');
  if(row.teamId!==undefined&&row.teamId!==null&&row.teamId!==teamId)
    throw new TypeError('Domain belongs to a different team');
  return {name:safeAlias(row.name),
    verified:typeof row.verified==='boolean'?row.verified:null,
    serviceType:safeText(row.serviceType,32),
    nameservers:Array.isArray(row.nameservers)?
      row.nameservers.slice(0,8).map(value=>safeHostname(value)):null,
    expiresAt:Number.isSafeInteger(row.expiresAt)?row.expiresAt:null,
    createdAt:Number.isSafeInteger(row.createdAt)?row.createdAt:null};
}
function projectDomainSummary(row,project){
  if(!row||typeof row!=='object'||Array.isArray(row))
    throw new TypeError('Invalid project domain response');
  if(row.projectId!==undefined&&row.projectId!==null&&row.projectId!==project)
    throw new TypeError('Project domain belongs to a different project');
  return {name:safeAlias(row.name),project,
    apexName:safeText(row.apexName,253),
    gitBranch:typeof row.gitBranch==='string'?safeText(row.gitBranch,250):null,
    customEnvironmentId:typeof row.customEnvironmentId==='string'?
      safeText(row.customEnvironmentId,128):null,
    redirect:typeof row.redirect==='string'?safeText(row.redirect,253):null,
    redirectStatusCode:REDIRECT_CODES.includes(row.redirectStatusCode)?
      row.redirectStatusCode:null,
    verified:typeof row.verified==='boolean'?row.verified:null,
    createdAt:Number.isSafeInteger(row.createdAt)?row.createdAt:null,
    updatedAt:Number.isSafeInteger(row.updatedAt)?row.updatedAt:null};
}
function configSummary(row){
  if(!row||typeof row!=='object'||Array.isArray(row))
    throw new TypeError('Invalid domain config response');
  if(typeof row.misconfigured!=='boolean')
    throw new TypeError('Domain config state is unknown');
  if(row.configuredBy!==null&&row.configuredBy!==undefined&&
    !['A','CNAME','dns-01','http'].includes(row.configuredBy))
    throw new TypeError('Unknown domain configuration state');
  const values=list=>Array.isArray(list)?list.slice(0,10).map(item=>
    safeText(item?.value,253)).filter(value=>value!==null):null;
  return {misconfigured:row.misconfigured,
    configuredBy:row.configuredBy??null,
    recommendedCNAME:values(row.recommendedCNAME),
    recommendedIPv4:values(row.recommendedIPv4),
    acceptedChallenges:Array.isArray(row.acceptedChallenges)?
      row.acceptedChallenges.filter(value=>['dns-01','http-01'].includes(value)).slice(0,4):null};
}
// Which projects and aliases use a team domain (BATCH-N N6): the alias
// inventory filtered by domain plus every team project's domain list. The
// team project list is a single bounded page; a paginated team refuses
// rather than claiming a complete answer.
async function domainUsage(client,account,domain){
  const aliasPage=await client.request('release_aliases_list',{query:{domain,limit:100}});
  const aliasRows=completePage(aliasPage,aliasPage?.aliases,100,'Alias');
  const aliases=aliasRows.map(row=>{
    const name=safeAlias(row?.alias??row?.domain??row?.name);
    if(name!==domain)throw new TypeError('Alias inventory returned an unrelated domain');
    const deployment=row?.deploymentId??row?.deployment?.id??row?.deployment?.uid;
    return {domain:name,
      projectId:typeof row?.projectId==='string'&&PROJECT.test(row.projectId)?
        row.projectId:null,
      deployment:typeof deployment==='string'&&DEPLOY.test(deployment)?deployment:null};
  });
  const projectPage=await client.request('projects_list',{query:{limit:100}});
  const projects=completePage(projectPage,projectPage?.projects,100,'Team project');
  const using=[];
  for(const project of projects){
    const id=typeof project?.id==='string'?project.id:null;
    if(!id||!IDENT.test(id))
      throw new TypeError('Team project inventory has an invalid identity');
    const page=await client.request('projects_domains_list',
      {path:{idOrName:id},query:{limit:100}});
    const rows=completePage(page,page?.domains,100,'Project domain');
    for(const row of rows){
      const summary=projectDomainSummary(row,id);
      if(summary.name===domain)using.push(summary);
    }
  }
  return {projects:using,aliases};
}
function assertControl(args){
  if((args.confirm!==undefined&&typeof args.confirm!=='boolean')||
    (args.dryRun!==undefined&&typeof args.dryRun!=='boolean')||
    (args.requestKey!==undefined&&!REQUEST.test(args.requestKey)))
    throw new TypeError('Invalid write control arguments');
}
function assertOutsideApp(args){
  if(args.outsideApp!==true)
    throw new TypeError('Domain changes need outsideApp confirmation');
}
function assertFull(ctx){
  if(ctx.connection?.profile!=='full')throw new TypeError('Full profile required');
}
function assertEveryday(ctx){
  if(!EVERYDAY.includes(ctx.connection?.profile))
    throw new TypeError('Everyday or full profile required');
}
function context({db,connection,env,fetchImpl}){
  return {db,connection,env,fetchImpl,shape:compact,
    audit:entry=>db.recordChange(entry),replayStore:db.requestReplayStore(),
    guardProtected:targets=>checkProtected(targets,{db,connection,env}),
    guardApp:targets=>checkApp(targets,{db,connection,env})};
}
const out=result=>({isError:['refused_by_guard','outcome_unknown'].includes(result.status),
  content:[{type:'text',text:JSON.stringify(result)}]});
function productionTarget(before){
  if(domainIsProduction({gitBranch:before.gitBranch??null,
    customEnvironmentId:before.customEnvironmentId??null}))return true;
  // Update flows carry the pre-update record in before.before: moving a
  // domain that currently serves production changes production routing
  // even when the requested state is a branch or custom environment.
  const current=before.before;
  if(current)return domainIsProduction({gitBranch:current.gitBranch??null,
    customEnvironmentId:current.customEnvironmentId??null});
  return false;
}
function productionWhy(before,production){
  return production?'A production domain changes live traffic and mail':
    'A branch or custom-environment domain does not serve production traffic';
}
async function requireProjectDomainState(provider,ctx,before){
  if(provider.account.team_id!==before.teamId)
    throw new TypeError('Project team changed since confirmation');
  if(productionTarget(before)&&ctx.connection?.mode!=='production')
    throw new TypeError('Production project domains require a production connection');
}
const props={
  project:{type:'string',pattern:PROJECT.source},
  domain:{type:'string',pattern:ALIAS.source},
  limit:{type:'integer',minimum:1,maximum:100},
  until:{type:'integer',minimum:1},
  gitBranch:{type:'string',minLength:1,maxLength:250},
  customEnvironmentId:{type:'string',minLength:1,maxLength:128},
  redirect:{type:'string',pattern:ALIAS.source},
  redirectStatusCode:{type:'integer',enum:REDIRECT_CODES},
  zone:{type:'boolean'},
  cdnEnabled:{type:'boolean'},
  echMode:{type:'string',enum:['auto','disabled']},
  destination:{type:'string',minLength:1,maxLength:128},
  outsideApp:{type:'boolean',const:true},
  confirm:{type:'boolean'},dryRun:{type:'boolean'},
  requestKey:{type:'string',pattern:REQUEST.source}
};
const updateProjectProps={
  ...props,
  gitBranch:{type:['string','null'],minLength:1,maxLength:250},
  redirect:{type:['string','null'],pattern:ALIAS.source},
  redirectStatusCode:{type:['integer','null'],enum:[...REDIRECT_CODES,null]}
};
const pick=(source,...keys)=>Object.fromEntries(keys.map(key=>[key,source[key]]));
function checkLimitUntil(args){
  if(args.limit!==undefined&&(!Number.isInteger(args.limit)||args.limit<1||args.limit>100))
    throw new TypeError('Invalid domain limit');
  if(args.until!==undefined&&(!Number.isSafeInteger(args.until)||args.until<1))
    throw new TypeError('Invalid domain pagination cursor');
}

const readHandlers={
  async vercel_domain_list(args,ctx){
    exactArgs(args,['limit','until']);
    checkLimitUntil(args);
    const {client,account}=await teamContext(ctx);
    const reply=await client.request('domains_list',
      {query:{limit:args.limit??20,...(args.until?{until:args.until}:{})}});
    const next=pageCursor(reply,reply?.domains,args.limit??20);
    return respond({domains:reply.domains.map(row=>domainSummary(row,account.team_id)),
      count:reply.domains.length,next,complete:next===null,
      nextStep:next!==null?'Call vercel_domain_list with until='+next+' to continue':null});
  },
  async vercel_domain_get(args,ctx){
    exactArgs(args,['domain']);
    const domain=safeAlias(args.domain);
    const {client,account}=await teamContext(ctx);
    const row=await getTeamDomain(client,domain);
    const summary=domainSummary(row,account.team_id);
    const verification=await client.request('domains_verification',{path:{domain}});
    if(typeof verification?.txtRecord!=='string'||
      typeof verification?.verificationDomain!=='string')
      throw new TypeError('Domain verification record is incomplete');
    const usedBy=await domainUsage(client,account,domain);
    return respond({domain:summary,
      verification:{txtRecord:safeText(verification.txtRecord,512),
        verificationDomain:safeText(verification.verificationDomain,253)},
      usedBy});
  },
  async vercel_domain_check_config(args,ctx){
    exactArgs(args,['domain','project']);
    const domain=safeAlias(args.domain);
    const {client,account}=await readProvider(ctx);
    if(!['team','full'].includes(account.scope))
      throw new TypeError('Team domains are not available to a project-scoped connection');
    let project=null;
    if(args.project!==undefined){
      ({project}=await projectContext(args,ctx));
    }
    const row=await client.request('domains_config',{path:{domain},
      query:{...(project?{projectIdOrName:project}:{})}});
    return respond({domain,project,...configSummary(row)});
  },
  async vercel_domain_list_project_domains(args,ctx){
    exactArgs(args,['project','limit','until']);
    checkLimitUntil(args);
    const {client,project}=await projectContext(args,ctx);
    const reply=await client.request('projects_domains_list',{path:{idOrName:project},
      query:{limit:args.limit??20,...(args.until?{until:args.until}:{})}});
    const next=pageCursor(reply,reply?.domains,args.limit??20);
    return respond({project,
      domains:reply.domains.map(row=>projectDomainSummary(row,project)),
      count:reply.domains.length,next,complete:next===null,
      nextStep:next!==null?
        'Call vercel_domain_list_project_domains with project and until='+next+' to continue':null});
  }
};

// Team-domain writes are production (BATCH-N N1); project-domain writes are
// production unless the domain is tied to a branch or a non-production
// custom environment (domainIsProduction).
async function addBefore(args,ctx){
  exactArgs(args,['domain','zone','cdnEnabled','outsideApp','confirm','dryRun','requestKey']);
  const domain=safeAlias(args.domain);
  if(args.zone!==undefined&&typeof args.zone!=='boolean')
    throw new TypeError('Invalid DNS zone flag');
  if(args.cdnEnabled!==undefined&&typeof args.cdnEnabled!=='boolean')
    throw new TypeError('Invalid CDN flag');
  assertOutsideApp(args);assertControl(args);assertFull(ctx);
  validateRequest('domains_add',{query:{teamId:'team_FAKE_validation'},
    body:{name:domain,...(args.zone!==undefined?{zone:args.zone}:{}),
      ...(args.cdnEnabled!==undefined?{cdnEnabled:args.cdnEnabled}:{})}});
  const {client,account}=await teamContext(ctx);
  try{
    await getTeamDomain(client,domain);
  }catch(error){
    if(error?.status===404)return {domain,teamId:account.team_id,
      zone:args.zone??null,cdnEnabled:args.cdnEnabled??null};
    throw error;
  }
  throw new TypeError('Domain is already on this team');
}
const addWrite=defineWrite({
  name:'vercel_domain_add_to_team',before:addBefore,
  async preview(_args,_ctx,before){
    return 'Add '+before.domain+' to the team'+
      (before.zone===true?' with a Vercel DNS zone':
        before.zone===false?' without a Vercel DNS zone':'')+
      '; no purchase, no DNS edits outside Vercel';
  },
  async production(){return {production:true,
    why:'A team domain can immediately serve live traffic and mail'};},
  async targets(_args,before){return [{kind:'account',id:before.teamId}];},
  async apply(args,ctx,before,requestKey){
    const provider=await writeProvider(ctx);
    await requirePreDispatch(async()=>{
      if(provider.account.team_id!==before.teamId||
        ctx.connection?.mode!=='production')
        throw new TypeError('Team domain add requires an authorized production connection');
      const fresh=await addBefore(args,ctx);
      if(fresh.domain!==before.domain||fresh.teamId!==before.teamId||
        fresh.zone!==before.zone||fresh.cdnEnabled!==before.cdnEnabled)
        throw new TypeError('Domain add state changed since confirmation');
    });
    return provider.write('domains_add',{body:{name:before.domain,
      ...(before.zone!==null?{zone:before.zone}:{}),
      ...(before.cdnEnabled!==null?{cdnEnabled:before.cdnEnabled}:{})}},
      {requestKey,tool:'vercel_domain_add_to_team',shapeResult:value=>{
        if(!value?.domain||typeof value.domain.name!=='string')
          throw new TypeError('Vercel did not return the added domain');
        if(value.domain.name!==before.domain)
          throw new TypeError('Added domain identity changed');
        return {name:value.domain.name};
      }});
  },
  async verify(_args,ctx,before){
    try{
      const {client,account}=await teamContext(ctx);
      if(account.team_id!==before.teamId)return {confirmed:null};
      const row=await getTeamDomain(client,before.domain);
      return {confirmed:row?.name===before.domain,domain:before.domain};
    }catch{return {confirmed:null};}
  }
});
async function updateBefore(args,ctx){
  exactArgs(args,['domain','destination','zone','echMode','outsideApp','confirm','dryRun','requestKey']);
  const domain=safeAlias(args.domain);
  const move=args.destination!==undefined;
  const change=args.zone!==undefined||args.echMode!==undefined;
  if(move===change)
    throw new TypeError('Choose exactly one team-domain change: move or update');
  if(move&&(typeof args.destination!=='string'||!DESTINATION.test(args.destination)))
    throw new TypeError('Invalid move destination');
  if(args.echMode!==undefined&&!['auto','disabled'].includes(args.echMode))
    throw new TypeError('Invalid encrypted-client-hello mode');
  if(args.zone!==undefined&&typeof args.zone!=='boolean')
    throw new TypeError('Invalid DNS zone flag');
  assertOutsideApp(args);assertControl(args);assertFull(ctx);
  const body=move?{op:'move-out',destination:args.destination}:
    {op:'update',...(args.zone!==undefined?{zone:args.zone}:{}),
      ...(args.echMode!==undefined?{echMode:args.echMode}:{})};
  validateRequest('domains_update',{path:{domain},
    query:{teamId:'team_FAKE_validation'},body});
  const {client,account}=await teamContext(ctx);
  const row=await getTeamDomain(client,domain);
  const current=domainSummary(row,account.team_id);
  return {domain,teamId:account.team_id,move,
    destination:move?args.destination:null,
    zone:move?null:args.zone??null,echMode:move?null:args.echMode??null,
    verified:current.verified,body};
}
const updateWrite=defineWrite({
  name:'vercel_domain_update',before:updateBefore,
  async preview(_args,_ctx,before){
    return before.move?
      'Move team domain '+before.domain+' to '+before.destination+
        '; its live traffic, mail and DNS move with it':
      'Update team domain '+before.domain+
        (before.zone!==null?'; DNS zone '+(before.zone?'on':'off'):'')+
        (before.echMode!==null?'; encrypted client hello '+before.echMode:'');
  },
  async production(_args,_ctx,before){return {production:true,
    why:before.move?'Moving a team domain moves its live traffic and mail':
      'A team-domain DNS/zone change affects the live site'};},
  async targets(_args,before){return [{kind:'account',id:before.teamId}];},
  async apply(args,ctx,before,requestKey){
    const provider=await writeProvider(ctx);
    await requirePreDispatch(async()=>{
      if(provider.account.team_id!==before.teamId||
        ctx.connection?.mode!=='production')
        throw new TypeError('Team domain update requires an authorized production connection');
      const fresh=await updateBefore(args,ctx);
      if(fresh.domain!==before.domain||fresh.teamId!==before.teamId||
        fresh.move!==before.move||fresh.destination!==before.destination||
        fresh.zone!==before.zone||fresh.echMode!==before.echMode)
        throw new TypeError('Domain update state changed since confirmation');
    });
    return provider.write('domains_update',{path:{domain:before.domain},body:before.body},
      {requestKey,tool:'vercel_domain_update',shapeResult:value=>{
        if(!value||typeof value!=='object')
          throw new TypeError('Vercel did not return a domain update result');
        if(before.move){
          if(value.moved!==true)throw new TypeError('Domain move was not accepted');
          return {domain:before.domain,moved:true};
        }
        return {domain:before.domain,
          ...(typeof value.echMode==='string'?{echMode:value.echMode}:{})};
      }});
  },
  async verify(_args,ctx,before){
    try{
      const {client,account}=await teamContext(ctx);
      if(account.team_id!==before.teamId)return {confirmed:null};
      if(before.move){
        try{
          await getTeamDomain(client,before.domain);
          return {confirmed:false,domain:before.domain};
        }catch(error){
          return {confirmed:error?.status===404?true:null,domain:before.domain};
        }
      }
      const row=await getTeamDomain(client,before.domain);
      if(row?.name!==before.domain)return {confirmed:false,domain:before.domain};
      if(before.echMode!==null)
        return {confirmed:row.echMode===before.echMode,domain:before.domain};
      return {confirmed:null,domain:before.domain};
    }catch{return {confirmed:null};}
  }
});
async function removeBefore(args,ctx){
  exactArgs(args,['domain','outsideApp','confirm','dryRun','requestKey']);
  const domain=safeAlias(args.domain);
  assertOutsideApp(args);assertControl(args);assertFull(ctx);
  validateRequest('domains_remove',{path:{domain},
    query:{teamId:'team_FAKE_validation'}});
  const {client,account}=await teamContext(ctx);
  const row=await getTeamDomain(client,domain);
  const current=domainSummary(row,account.team_id);
  const usedBy=await domainUsage(client,account,domain);
  const inUse=[...usedBy.projects.map(item=>({project:item.project,domain:item.name})),
    ...usedBy.aliases.map(item=>({alias:item.domain,project:item.projectId,
      deployment:item.deployment}))];
  // Dry runs may inspect the block; confirmation is refused while in use.
  if(inUse.length&&args.dryRun!==true)
    throw new TypeError('Domain '+domain+' is still used; detach it first');
  return {domain,teamId:account.team_id,verified:current.verified,inUse};
}
const removeWrite=defineWrite({
  name:'vercel_domain_remove_from_team',before:removeBefore,
  async preview(_args,_ctx,before){
    if(before.inUse.length){
      const names=before.inUse.map(item=>item.project?
        item.domain+' on '+item.project:item.alias).join(', ');
      return 'REFUSED: '+before.domain+' is still used by '+names+
        '. Detach it from every project and alias first.';
    }
    return 'Remove '+before.domain+' from the team; the site stops answering on it.';
  },
  async production(){return {production:true,
    why:'Removing a team domain stops the live site answering on it'};},
  async targets(_args,before){return [{kind:'account',id:before.teamId}];},
  async apply(args,ctx,before,requestKey){
    const provider=await writeProvider(ctx);
    await requirePreDispatch(async()=>{
      if(provider.account.team_id!==before.teamId||
        ctx.connection?.mode!=='production')
        throw new TypeError('Team domain removal requires an authorized production connection');
      const fresh=await removeBefore({...args,dryRun:true},ctx);
      if(fresh.domain!==before.domain||fresh.teamId!==before.teamId||fresh.inUse.length)
        throw new TypeError('Domain usage changed since confirmation');
    });
    return provider.write('domains_remove',{path:{domain:before.domain}},
      {requestKey,tool:'vercel_domain_remove_from_team',shapeResult:value=>{
        if(!value||typeof value.uid!=='string')
          throw new TypeError('Vercel did not return a removal receipt');
        return {domain:before.domain};
      }});
  },
  async verify(_args,ctx,before){
    try{
      const {client,account}=await teamContext(ctx);
      if(account.team_id!==before.teamId)return {confirmed:null};
      try{
        await getTeamDomain(client,before.domain);
        return {confirmed:false,domain:before.domain};
      }catch(error){
        return {confirmed:error?.status===404?true:null,domain:before.domain};
      }
    }catch{return {confirmed:null};}
  }
});

async function attachBefore(args,ctx){
  exactArgs(args,['project','domain','gitBranch','customEnvironmentId','redirect',
    'redirectStatusCode','outsideApp','confirm','dryRun','requestKey']);
  const domain=safeAlias(args.domain);
  if(args.gitBranch!==undefined&&(typeof args.gitBranch!=='string'||!BRANCH.test(args.gitBranch)))
    throw new TypeError('Invalid project domain branch');
  if(args.customEnvironmentId!==undefined&&(typeof args.customEnvironmentId!=='string'||
    !ENV_ID.test(args.customEnvironmentId)))
    throw new TypeError('Invalid custom environment identifier');
  if(args.redirect!==undefined)safeAlias(args.redirect);
  if(args.redirectStatusCode!==undefined&&!REDIRECT_CODES.includes(args.redirectStatusCode))
    throw new TypeError('Invalid redirect status code');
  assertOutsideApp(args);assertControl(args);assertEveryday(ctx);
  const body={name:domain,...(args.gitBranch!==undefined?{gitBranch:args.gitBranch}:{}),
    ...(args.customEnvironmentId!==undefined?{customEnvironmentId:args.customEnvironmentId}:{}),
    ...(args.redirect!==undefined?{redirect:args.redirect}:{}),
    ...(args.redirectStatusCode!==undefined?{redirectStatusCode:args.redirectStatusCode}:{})};
  validateRequest('projects_domains_add',{path:{idOrName:args.project},
    query:{teamId:'team_FAKE_validation'},body});
  const {client,account,project}=await projectContext(args,ctx);
  if(args.customEnvironmentId!==undefined){
    const env=await client.request('custom_environments_get',
      {path:{idOrName:project,environmentSlugOrId:args.customEnvironmentId}});
    if(!env||typeof env!=='object')
      throw new TypeError('Custom environment not found in this project');
  }
  try{
    await client.request('projects_domains_get',{path:{idOrName:project,domain}});
    throw new TypeError('Domain is already attached to this project');
  }catch(error){
    if(error?.status===404)return {project,teamId:account.team_id,domain,
      gitBranch:args.gitBranch??null,customEnvironmentId:args.customEnvironmentId??null,
      redirect:args.redirect??null,redirectStatusCode:args.redirectStatusCode??null,body};
    throw error;
  }
}
const attachWrite=defineWrite({
  name:'vercel_domain_attach_to_project',before:attachBefore,
  async preview(_args,_ctx,before){
    return 'Attach '+before.domain+' to project '+before.project+
      (before.gitBranch?' for branch '+before.gitBranch:'')+
      (before.customEnvironmentId?' in custom environment '+before.customEnvironmentId:'')+
      (before.redirect?' redirecting to '+before.redirect:'')+
      '; '+(productionTarget(before)?'production traffic':'branch preview only');
  },
  async production(_args,_ctx,before){
    const production=productionTarget(before);
    return {production,why:productionWhy(before,production)};
  },
  async targets(_args,before){return [{kind:'account',id:before.teamId},
    {kind:'project',id:before.project},
    {kind:'domain',id:before.domain,projectId:before.project}];},
  async apply(args,ctx,before,requestKey){
    const provider=await writeProvider(ctx);
    await requirePreDispatch(async()=>{
      await requireProjectDomainState(provider,ctx,before);
      const fresh=await attachBefore(args,ctx);
      if(fresh.project!==before.project||fresh.domain!==before.domain||
        fresh.gitBranch!==before.gitBranch||
        fresh.customEnvironmentId!==before.customEnvironmentId||
        fresh.redirect!==before.redirect||
        fresh.redirectStatusCode!==before.redirectStatusCode)
        throw new TypeError('Project domain attach state changed since confirmation');
    });
    return provider.write('projects_domains_add',
      {path:{idOrName:before.project},body:before.body},
      {requestKey,tool:'vercel_domain_attach_to_project',shapeResult:value=>{
        if(!value||typeof value.name!=='string'||value.name!==before.domain)
          throw new TypeError('Vercel did not return the attached domain');
        if(value.projectId!==before.project)
          throw new TypeError('Attached domain belongs to a different project');
        return {name:value.name,
          verified:typeof value.verified==='boolean'?value.verified:null};
      }});
  },
  // BATCH-N N3: the result carries the check-config output for the new domain.
  async verify(_args,ctx,before){
    try{
      const {client,account,project}=await projectContext({project:before.project},ctx);
      if(account.team_id!==before.teamId)return {confirmed:null};
      const row=await client.request('projects_domains_get',
        {path:{idOrName:project,domain:before.domain}});
      const summary=projectDomainSummary(row,project);
      const confirmed=summary.name===before.domain&&
        summary.gitBranch===before.gitBranch&&
        summary.customEnvironmentId===before.customEnvironmentId&&
        summary.redirect===before.redirect&&
        summary.redirectStatusCode===before.redirectStatusCode;
      let config=null;
      try{
        const cfg=await client.request('domains_config',{path:{domain:before.domain}});
        config={domain:before.domain,...configSummary(cfg)};
      }catch{config=null;}
      return {confirmed,project,domain:before.domain,config};
    }catch{return {confirmed:null};}
  },
  async publicReceipt(_args,_before,_result,verification){
    if(!verification||typeof verification!=='object')return null;
    return {domain:verification.domain??null,config:verification.config??null};
  }
});
async function updateProjectBefore(args,ctx){
  exactArgs(args,['project','domain','gitBranch','redirect','redirectStatusCode',
    'outsideApp','confirm','dryRun','requestKey']);
  const domain=safeAlias(args.domain);
  if(args.gitBranch!==undefined&&args.gitBranch!==null&&
    (typeof args.gitBranch!=='string'||!BRANCH.test(args.gitBranch)))
    throw new TypeError('Invalid project domain branch');
  if(args.redirect!==undefined&&args.redirect!==null)safeAlias(args.redirect);
  if(args.redirectStatusCode!==undefined&&args.redirectStatusCode!==null&&
    !REDIRECT_CODES.includes(args.redirectStatusCode))
    throw new TypeError('Invalid redirect status code');
  if(args.gitBranch===undefined&&args.redirect===undefined&&
    args.redirectStatusCode===undefined)
    throw new TypeError('No project domain change supplied');
  assertOutsideApp(args);assertControl(args);assertEveryday(ctx);
  const body={...(args.gitBranch!==undefined?{gitBranch:args.gitBranch}:{}),
    ...(args.redirect!==undefined?{redirect:args.redirect}:{}),
    ...(args.redirectStatusCode!==undefined?{redirectStatusCode:args.redirectStatusCode}:{})};
  validateRequest('projects_domains_update',{path:{idOrName:args.project,domain},
    query:{teamId:'team_FAKE_validation'},body});
  const {client,account,project}=await projectContext(args,ctx);
  const row=await client.request('projects_domains_get',{path:{idOrName:project,domain}});
  const current=projectDomainSummary(row,project);
  return {project,teamId:account.team_id,domain,body,
    gitBranch:args.gitBranch!==undefined?args.gitBranch:current.gitBranch,
    customEnvironmentId:current.customEnvironmentId,
    redirect:args.redirect!==undefined?args.redirect:current.redirect,
    redirectStatusCode:args.redirectStatusCode!==undefined?
      args.redirectStatusCode:current.redirectStatusCode,
    before:current};
}
const updateProjectWrite=defineWrite({
  name:'vercel_domain_update_project_domain',before:updateProjectBefore,
  async preview(_args,_ctx,before){
    const changes=[];
    if(before.body.gitBranch!==undefined)
      changes.push('branch '+(before.before.gitBranch??'none')+' → '+
        (before.gitBranch??'none'));
    if(before.body.redirect!==undefined)
      changes.push('redirect '+(before.before.redirect??'none')+' → '+
        (before.redirect??'none'));
    if(before.body.redirectStatusCode!==undefined)
      changes.push('redirect status '+(before.before.redirectStatusCode??'none')+
        ' → '+(before.redirectStatusCode??'none'));
    return 'Change project domain '+before.domain+' on '+before.project+': '+
      changes.join('; ')+'; '+
      (productionTarget(before)?'production traffic':'branch preview only');
  },
  async production(_args,_ctx,before){
    const production=productionTarget(before);
    return {production,why:productionWhy(before,production)};
  },
  async targets(_args,before){return [{kind:'account',id:before.teamId},
    {kind:'project',id:before.project},
    {kind:'domain',id:before.domain,projectId:before.project}];},
  async apply(args,ctx,before,requestKey){
    const provider=await writeProvider(ctx);
    await requirePreDispatch(async()=>{
      await requireProjectDomainState(provider,ctx,before);
      const fresh=await updateProjectBefore(args,ctx);
      if(fresh.project!==before.project||fresh.domain!==before.domain||
        fresh.gitBranch!==before.gitBranch||
        fresh.customEnvironmentId!==before.customEnvironmentId||
        fresh.redirect!==before.redirect||
        fresh.redirectStatusCode!==before.redirectStatusCode||
        JSON.stringify(fresh.before)!==JSON.stringify(before.before))
        throw new TypeError('Project domain state changed since confirmation');
    });
    return provider.write('projects_domains_update',
      {path:{idOrName:before.project,domain:before.domain},body:before.body},
      {requestKey,tool:'vercel_domain_update_project_domain',shapeResult:value=>{
        if(!value||typeof value.name!=='string'||value.name!==before.domain)
          throw new TypeError('Vercel did not return the updated domain');
        if(value.projectId!==before.project)
          throw new TypeError('Updated domain belongs to a different project');
        return {name:value.name};
      }});
  },
  async verify(_args,ctx,before){
    try{
      const {client,account,project}=await projectContext({project:before.project},ctx);
      if(account.team_id!==before.teamId)return {confirmed:null};
      const row=await client.request('projects_domains_get',
        {path:{idOrName:project,domain:before.domain}});
      const summary=projectDomainSummary(row,project);
      return {confirmed:summary.name===before.domain&&
        summary.gitBranch===before.gitBranch&&
        summary.customEnvironmentId===before.customEnvironmentId&&
        summary.redirect===before.redirect&&
        summary.redirectStatusCode===before.redirectStatusCode,
        project,domain:before.domain};
    }catch{return {confirmed:null};}
  }
});
async function detachBefore(args,ctx){
  exactArgs(args,['project','domain','outsideApp','confirm','dryRun','requestKey']);
  const domain=safeAlias(args.domain);
  assertOutsideApp(args);assertControl(args);assertFull(ctx);
  validateRequest('projects_domains_remove',{path:{idOrName:args.project,domain},
    query:{teamId:'team_FAKE_validation'}});
  const {client,account,project}=await projectContext(args,ctx);
  const row=await client.request('projects_domains_get',{path:{idOrName:project,domain}});
  const current=projectDomainSummary(row,project);
  return {project,teamId:account.team_id,domain,
    gitBranch:current.gitBranch,customEnvironmentId:current.customEnvironmentId,
    redirect:current.redirect,redirectStatusCode:current.redirectStatusCode};
}
const detachWrite=defineWrite({
  name:'vercel_domain_detach_from_project',before:detachBefore,
  async preview(_args,_ctx,before){
    return 'Detach '+before.domain+' from project '+before.project+
      '; '+(productionTarget(before)?'production traffic on it stops':
        'branch preview routing on it stops');
  },
  async production(_args,_ctx,before){
    const production=productionTarget(before);
    return {production,why:productionWhy(before,production)};
  },
  async targets(_args,before){return [{kind:'account',id:before.teamId},
    {kind:'project',id:before.project},
    {kind:'domain',id:before.domain,projectId:before.project}];},
  async apply(args,ctx,before,requestKey){
    const provider=await writeProvider(ctx);
    await requirePreDispatch(async()=>{
      await requireProjectDomainState(provider,ctx,before);
      const fresh=await detachBefore(args,ctx);
      if(fresh.project!==before.project||fresh.domain!==before.domain||
        fresh.gitBranch!==before.gitBranch||
        fresh.customEnvironmentId!==before.customEnvironmentId)
        throw new TypeError('Project domain state changed since confirmation');
    });
    return provider.write('projects_domains_remove',
      {path:{idOrName:before.project,domain:before.domain}},
      {requestKey,tool:'vercel_domain_detach_from_project',
        shapeResult:()=>({name:before.domain})});
  },
  async verify(_args,ctx,before){
    try{
      const {client,account,project}=await projectContext({project:before.project},ctx);
      if(account.team_id!==before.teamId)return {confirmed:null};
      try{
        await client.request('projects_domains_get',
          {path:{idOrName:project,domain:before.domain}});
        return {confirmed:false,project,domain:before.domain};
      }catch(error){
        return {confirmed:error?.status===404?true:null,project,domain:before.domain};
      }
    }catch{return {confirmed:null};}
  }
});
async function verifyProjectBefore(args,ctx){
  exactArgs(args,['project','domain','outsideApp','confirm','dryRun','requestKey']);
  const domain=safeAlias(args.domain);
  assertOutsideApp(args);assertControl(args);assertEveryday(ctx);
  validateRequest('projects_domains_verify',{path:{idOrName:args.project,domain},
    query:{teamId:'team_FAKE_validation'}});
  const {client,account,project}=await projectContext(args,ctx);
  const row=await client.request('projects_domains_get',{path:{idOrName:project,domain}});
  const current=projectDomainSummary(row,project);
  return {project,teamId:account.team_id,domain,
    gitBranch:current.gitBranch,customEnvironmentId:current.customEnvironmentId,
    wasVerified:current.verified};
}
const verifyProjectWrite=defineWrite({
  name:'vercel_domain_verify_project_domain',before:verifyProjectBefore,
  async preview(_args,_ctx,before){
    return 'Ask Vercel to re-check verification for '+before.domain+
      ' on project '+before.project+
      (before.wasVerified===true?' (already verified; re-check confirms it)':'');
  },
  async production(_args,_ctx,before){
    const production=productionTarget(before);
    return {production,why:productionWhy(before,production)};
  },
  async targets(_args,before){return [{kind:'account',id:before.teamId},
    {kind:'project',id:before.project},
    {kind:'domain',id:before.domain,projectId:before.project}];},
  async apply(args,ctx,before,requestKey){
    const provider=await writeProvider(ctx);
    await requirePreDispatch(async()=>{
      await requireProjectDomainState(provider,ctx,before);
      const fresh=await verifyProjectBefore(args,ctx);
      if(fresh.project!==before.project||fresh.domain!==before.domain||
        fresh.gitBranch!==before.gitBranch||
        fresh.customEnvironmentId!==before.customEnvironmentId)
        throw new TypeError('Project domain state changed since confirmation');
    });
    return provider.write('projects_domains_verify',
      {path:{idOrName:before.project,domain:before.domain}},
      {requestKey,tool:'vercel_domain_verify_project_domain',shapeResult:value=>{
        if(!value||typeof value.name!=='string'||value.name!==before.domain)
          throw new TypeError('Vercel did not return the verified domain');
        return {name:value.name,
          verified:typeof value.verified==='boolean'?value.verified:null};
      }});
  },
  async verify(_args,ctx,before){
    try{
      const {client,account,project}=await projectContext({project:before.project},ctx);
      if(account.team_id!==before.teamId)return {confirmed:null};
      const row=await client.request('projects_domains_get',
        {path:{idOrName:project,domain:before.domain}});
      const summary=projectDomainSummary(row,project);
      return {confirmed:summary.verified===true?true:
        summary.verified===false?false:null,project,domain:before.domain};
    }catch{return {confirmed:null};}
  }
});
export const domainsTools={
  tools:[
    {name:'vercel_domain_list',writes:false,profiles:READ_PROFILES,area:'domains',
      description:'List team domains with registrar, nameservers, expiry and verification state.',
      inputSchema:schema(pick(props,'limit','until'),[]),
      annotations:{readOnlyHint:true}},
    {name:'vercel_domain_get',writes:false,profiles:READ_PROFILES,area:'domains',
      description:'Read one team domain with its verification record and which projects and aliases use it.',
      inputSchema:schema(pick(props,'domain'),['domain']),
      annotations:{readOnlyHint:true}},
    {name:'vercel_domain_check_config',writes:false,profiles:READ_PROFILES,area:'domains',
      description:'Check whether a domain points at Vercel correctly and list the exact records it still needs.',
      inputSchema:schema(pick(props,'domain','project'),['domain']),
      annotations:{readOnlyHint:true}},
    {name:'vercel_domain_add_to_team',writes:true,guardedWrite:true,profiles:FULL,area:'domains',
      description:'Add a domain you already own elsewhere to the team; no purchase, DNS zone optional.',
      inputSchema:schema(pick(props,'domain','zone','cdnEnabled','outsideApp','confirm','dryRun','requestKey'),
        ['domain','outsideApp']),
      writeContract:addWrite.writeContract,
      annotations:{readOnlyHint:false,destructiveHint:false}},
    {name:'vercel_domain_update',writes:true,guardedWrite:true,profiles:FULL,area:'domains',
      description:'Move a team domain to another team, or change its DNS zone and encrypted-client-hello setting.',
      inputSchema:schema(pick(props,'domain','destination','zone','echMode','outsideApp','confirm','dryRun','requestKey'),
        ['domain','outsideApp']),
      writeContract:updateWrite.writeContract,
      annotations:{readOnlyHint:false,destructiveHint:true}},
    {name:'vercel_domain_remove_from_team',writes:true,guardedWrite:true,profiles:FULL,area:'domains',
      description:'Remove a domain from the team once no project or alias uses it; the site stops answering on it.',
      inputSchema:schema(pick(props,'domain','outsideApp','confirm','dryRun','requestKey'),
        ['domain','outsideApp']),
      writeContract:removeWrite.writeContract,
      annotations:{readOnlyHint:false,destructiveHint:true}},
    {name:'vercel_domain_list_project_domains',writes:false,profiles:READ_PROFILES,area:'domains',
      description:'List the domains attached to one verified project with branch, redirect and verification state.',
      inputSchema:schema(pick(props,'project','limit','until'),['project']),
      annotations:{readOnlyHint:true}},
    {name:'vercel_domain_attach_to_project',writes:true,guardedWrite:true,profiles:EVERYDAY,area:'domains',
      description:'Attach a domain to a verified project; production unless a branch or custom environment is given.',
      inputSchema:schema(pick(props,'project','domain','gitBranch','customEnvironmentId','redirect','redirectStatusCode','outsideApp','confirm','dryRun','requestKey'),
        ['project','domain','outsideApp']),
      writeContract:attachWrite.writeContract,
      annotations:{readOnlyHint:false,destructiveHint:true}},
    {name:'vercel_domain_update_project_domain',writes:true,guardedWrite:true,profiles:EVERYDAY,area:'domains',
      description:'Change a project domain redirect, status code or branch; production unless tied to a branch or custom environment.',
      inputSchema:schema(pick(updateProjectProps,'project','domain','gitBranch','redirect','redirectStatusCode','outsideApp','confirm','dryRun','requestKey'),
        ['project','domain','outsideApp']),
      writeContract:updateProjectWrite.writeContract,
      annotations:{readOnlyHint:false,destructiveHint:true}},
    {name:'vercel_domain_detach_from_project',writes:true,guardedWrite:true,profiles:FULL,area:'domains',
      description:'Detach a domain from a verified project; production traffic on it stops.',
      inputSchema:schema(pick(props,'project','domain','outsideApp','confirm','dryRun','requestKey'),
        ['project','domain','outsideApp']),
      writeContract:detachWrite.writeContract,
      annotations:{readOnlyHint:false,destructiveHint:true}},
    {name:'vercel_domain_verify_project_domain',writes:true,guardedWrite:true,profiles:EVERYDAY,area:'domains',
      description:'Ask Vercel to re-check a project domain verification and report the verified state.',
      inputSchema:schema(pick(props,'project','domain','outsideApp','confirm','dryRun','requestKey'),
        ['project','domain','outsideApp']),
      writeContract:verifyProjectWrite.writeContract,
      annotations:{readOnlyHint:false,destructiveHint:false}}
  ],
  handlers:{
    ...readHandlers,
    vercel_domain_add_to_team:bindGuardedWrite(addWrite,context,out),
    vercel_domain_update:bindGuardedWrite(updateWrite,context,out),
    vercel_domain_remove_from_team:bindGuardedWrite(removeWrite,context,out),
    vercel_domain_attach_to_project:bindGuardedWrite(attachWrite,context,out),
    vercel_domain_update_project_domain:bindGuardedWrite(updateProjectWrite,context,out),
    vercel_domain_detach_from_project:bindGuardedWrite(detachWrite,context,out),
    vercel_domain_verify_project_domain:bindGuardedWrite(verifyProjectWrite,context,out)
  }
};
