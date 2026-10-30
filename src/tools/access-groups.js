// O-2 access groups: projected reads (get composes summary + members +
// projects, the only shape the catalog promises) plus guarded create,
// update and delete writes (BATCH-O O-2). Enterprise-gated provider
// refusals surface as classified errors, never as permission denials
// the tool invented.
import {createHash} from 'node:crypto';
import {defineWrite,bindGuardedWrite,requirePreDispatch, RefusalError } from '../core/write.js';
import {compact,credentialLike} from '../core/util.js';
import {readProvider,writeProvider} from '../vercel/provider.js';
import {checkProtected} from './self-guard.js';
import {checkApp} from './app-guard.js';
import {validateRequest} from '../vercel/openapi-validation.js';

const ID=/^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/;
const READ_PROFILES=['read_only','everyday','full'];
const PROJECT_ROLES=['ADMIN','PROJECT_DEVELOPER','PROJECT_GUEST','PROJECT_VIEWER'];
const text=value=>({content:[{type:'text',text:JSON.stringify(value)}]});
function safe(value,max=200){
  return typeof value==='string'&&value.length>0&&value.length<=max&&
    !/[\x00-\x1f\x7f]/.test(value)&&!credentialLike(value)?value:null;
}
function ctxFor({db,connection,env,fetchImpl}){
  return {db,connection,env,fetchImpl,shape:compact,
    audit:x=>db.recordChange(x),replayStore:db.requestReplayStore(),
    guardProtected:targets=>checkProtected(targets,{db,connection,env}),
    guardApp:targets=>checkApp(targets,{db,connection,env})};
}
async function teamClient(ctx){
  const {client,account}=await readProvider(ctx);
  if(!['team','full'].includes(account.scope)||!ID.test(account.team_id))
    throw new RefusalError('Access group tools require a team-scoped account');
  return {client,account,teamId:account.team_id};
}
function projectGroup(row){
  if(!row||typeof row!=='object'||typeof row.accessGroupId!=='string')
    throw new RefusalError('Access group record could not be verified');
  return {accessGroupId:row.accessGroupId,name:safe(row.name),
    membersCount:typeof row.membersCount==='number'?row.membersCount:null,
    projectsCount:typeof row.projectsCount==='number'?row.projectsCount:null,
    isDsyncManaged:typeof row.isDsyncManaged==='boolean'?row.isDsyncManaged:null,
    createdAt:typeof row.createdAt==='string'||typeof row.createdAt==='number'?row.createdAt:null,
    updatedAt:typeof row.updatedAt==='string'||typeof row.updatedAt==='number'?row.updatedAt:null};
}
async function listGroups(client,teamId){
  const row=await client.request('access_groups_list',{query:{teamId}});
  const rows=Array.isArray(row?.accessGroups)?row.accessGroups
    :(row&&typeof row.accessGroupId==='string'?[row]:null);
  if(!rows)throw new RefusalError('Access group list could not be read');
  return {groups:rows.map(projectGroup),
    truncated:row?.pagination?.next!=null};
}
async function groupDetail(client,teamId,idOrName){
  const summary=await client.request('access_group_get',
    {path:{idOrName},query:{teamId}});
  const group=projectGroup(summary);
  const mem=await client.request('access_group_members',
    {path:{idOrName},query:{teamId}});
  const proj=await client.request('access_group_projects',
    {path:{idOrName},query:{teamId}});
  if(!Array.isArray(mem?.members)||!Array.isArray(proj?.projects))
    throw new RefusalError('Access group detail could not be read');
  return {group,
    members:mem.members.slice(0,100).map(m=>({uid:ID.test(m?.uid??'')?m.uid:null,
      username:safe(m?.username),email:safe(m?.email,254),
      teamRole:safe(m?.teamRole,40)})),
    membersTruncated:mem.pagination?.next!=null||mem.members.length>100,
    projects:proj.projects.slice(0,100).map(p=>({
      projectId:ID.test(p?.projectId??'')?p.projectId:null,
      name:safe(p?.project?.name),role:PROJECT_ROLES.includes(p?.role)?p.role:null})),
    projectsTruncated:proj.pagination?.next!=null||proj.projects.length>100};
}
function validProjects(projects){
  return projects===undefined||(Array.isArray(projects)&&projects.length<=50&&
    projects.every(p=>p&&ID.test(p.projectId??'')&&
      (p.role===undefined||p.role===null||PROJECT_ROLES.includes(p.role))));
}
function validUids(list){
  return list===undefined||(Array.isArray(list)&&list.length<=100&&
    list.every(u=>typeof u==='string'&&ID.test(u)));
}
const envelope={confirm:{type:'boolean'},dryRun:{type:'boolean'},
  requestKey:{type:'string',pattern:'^[a-zA-Z0-9_-]{8,128}$'}};
function checkEnvelope(args,props){
  if(Object.keys(args).some(k=>!Object.hasOwn(props,k))||
    ['confirm','dryRun'].some(k=>args[k]!==undefined&&typeof args[k]!=='boolean')||
    args.requestKey!==undefined&&(typeof args.requestKey!=='string'||
      !/^[a-zA-Z0-9_-]{8,128}$/.test(args.requestKey)))
    throw new RefusalError('Invalid access group request');
}
async function verifiedTeam(ctx){
  const {client,account,teamId}=await teamClient(ctx);
  const row=await client.request('teams_get',{path:{teamId}});
  if(!row||row.id!==teamId)
    throw new RefusalError('Connected team identity could not be verified');
  return {client,account,teamId};
}
const groupFingerprint=g=>createHash('sha256').update(JSON.stringify(
  [g.accessGroupId,g.name,g.membersCount,g.projectsCount])).digest('hex');

// ---------------- create ----------------
const createProps={name:{type:'string'},
  projects:{type:'array'},membersToAdd:{type:'array'},...envelope};
const create=defineWrite({
  name:'vercel_access_group_create',
  async before(args,ctx){
    if(!args||typeof args!=='object'||Array.isArray(args))throw new RefusalError('Invalid access group request');
    checkEnvelope(args,createProps);
    if(typeof args.name!=='string'||!args.name||args.name.length>100||
      !validProjects(args.projects)||!validUids(args.membersToAdd))
      throw new RefusalError('Invalid access group request');
    const body={name:args.name};
    if(args.projects?.length)body.projects=args.projects;
    if(args.membersToAdd?.length)body.membersToAdd=args.membersToAdd;
    validateRequest('access_group_create',{query:{teamId:'team_FAKE_validation'},body});
    const {teamId}=await verifiedTeam(ctx);
    return {teamId,body,
      widens:(args.membersToAdd?.length??0)>0||(args.projects?.length??0)>0};
  },
  risk:{access:true},
  async access(_args,before){
    return {widens:before.widens,who:'The listed members',
      what:'Gain the listed project roles through the new access group'};
  },
  async preview(_args,_ctx,before){
    return 'Create access group "'+before.body.name+'"'+
      (before.body.projects?' with '+before.body.projects.length+' project role(s)':'')+
      (before.body.membersToAdd?' and '+before.body.membersToAdd.length+' member(s)':'')+
      '. PRODUCTION owner confirmation required.';
  },
  async production(){
    return {production:true,why:'Access groups grant project access on the live owner account'};
  },
  async targets(_args,before){
    return [{kind:'account',id:before.teamId,name:before.teamId}];
  },
  async apply(args,ctx,before,requestKey){
    const provider=await writeProvider(ctx);
    await requirePreDispatch(async()=>{
      if(provider.account.team_id!==before.teamId||ctx.connection?.profile!=='full'||
        ctx.connection?.mode!=='production')
        throw new TypeError('Team authority changed');
    });
    return provider.write('access_group_create',{query:{teamId:before.teamId},body:before.body},{
      requestKey,tool:'vercel_access_group_create',shapeResult:row=>{
        if(!row||typeof row.accessGroupId!=='string')
          throw new TypeError('Provider did not confirm the access group');
        return {teamId:before.teamId,accessGroupId:row.accessGroupId,
          name:safe(row.name)??before.body.name};
      }
    });
  },
  async verify(_args,ctx,before){
    const {client,teamId}=await teamClient(ctx);
    try{
      const {groups}=await listGroups(client,teamId);
      return {confirmed:groups.some(g=>g.name===before.body.name),teamId};
    }catch{return {confirmed:false,teamId};}
  }
});

// ---------------- update ----------------
const updateProps={idOrName:{type:'string'},name:{type:'string'},
  projects:{type:'array'},membersToAdd:{type:'array'},
  membersToRemove:{type:'array'},...envelope};
const update=defineWrite({
  name:'vercel_access_group_update',
  async before(args,ctx){
    if(!args||typeof args!=='object'||Array.isArray(args))throw new RefusalError('Invalid access group request');
    checkEnvelope(args,updateProps);
    if(typeof args.idOrName!=='string'||!args.idOrName||args.idOrName.length>200||
      (args.name===undefined&&args.projects===undefined&&
        args.membersToAdd===undefined&&args.membersToRemove===undefined)||
      (args.name!==undefined&&(typeof args.name!=='string'||!args.name||args.name.length>100))||
      !validProjects(args.projects)||!validUids(args.membersToAdd)||
      !validUids(args.membersToRemove))
      throw new RefusalError('Invalid access group request');
    const body={};
    if(args.name!==undefined)body.name=args.name;
    if(args.projects?.length)body.projects=args.projects;
    if(args.membersToAdd?.length)body.membersToAdd=args.membersToAdd;
    if(args.membersToRemove?.length)body.membersToRemove=args.membersToRemove;
    validateRequest('access_group_update',{path:{idOrName:'ag_FAKE_example'},
      query:{teamId:'team_FAKE_validation'},body});
    const {client,teamId}=await verifiedTeam(ctx);
    const detail=await groupDetail(client,teamId,args.idOrName);
    return {teamId,idOrName:args.idOrName,body,detail,
      widens:(args.membersToAdd?.length??0)>0||(args.projects?.length??0)>0,
      etag:groupFingerprint(detail.group)};
  },
  risk:{access:true},
  async access(_args,before){
    return {widens:before.widens,who:'The added members',
      what:'Gain the listed project roles through this access group'};
  },
  async preview(_args,_ctx,before){
    const parts=['Update access group "'+(before.detail.group.name??before.idOrName)+'"'];
    if(before.body.name)parts.push('rename to "'+before.body.name+'"');
    if(before.body.projects)parts.push(before.body.projects.length+' project role(s) set');
    if(before.body.membersToAdd)parts.push(before.body.membersToAdd.length+' member(s) added');
    if(before.body.membersToRemove)parts.push(before.body.membersToRemove.length+' member(s) removed');
    return parts.join('; ')+'. PRODUCTION owner confirmation required.';
  },
  async production(){
    return {production:true,why:'Access groups grant project access on the live owner account'};
  },
  async targets(_args,before){
    return [{kind:'account',id:before.teamId,name:before.teamId}];
  },
  async apply(args,ctx,before,requestKey){
    const provider=await writeProvider(ctx);
    await requirePreDispatch(async()=>{
      if(provider.account.team_id!==before.teamId||ctx.connection?.profile!=='full'||
        ctx.connection?.mode!=='production')
        throw new TypeError('Team authority changed');
      const readClient={request:(op,opts)=>provider.read(op,opts)};
      const now=await groupDetail(readClient,before.teamId,before.idOrName);
      if(groupFingerprint(now.group)!==before.etag)
        throw new TypeError('Access group changed after preview');
    });
    return provider.write('access_group_update',
      {path:{idOrName:before.idOrName},query:{teamId:before.teamId},body:before.body},{
      requestKey,tool:'vercel_access_group_update',shapeResult:row=>{
        if(!row||typeof row.accessGroupId!=='string')
          throw new TypeError('Provider did not confirm the access group update');
        return {teamId:before.teamId,accessGroupId:row.accessGroupId,accepted:true};
      }
    });
  },
  async verify(_args,ctx,before){
    const {client,teamId}=await teamClient(ctx);
    const detail=await groupDetail(client,teamId,before.idOrName);
    let confirmed=true;
    if(before.body.name!==undefined&&detail.group.name!==before.body.name)confirmed=false;
    if(before.body.membersToAdd)
      for(const uid of before.body.membersToAdd)
        if(!detail.members.some(m=>m.uid===uid))confirmed=false;
    if(before.body.membersToRemove)
      for(const uid of before.body.membersToRemove)
        if(detail.members.some(m=>m.uid===uid))confirmed=false;
    return {confirmed,teamId};
  }
});

// ---------------- delete ----------------
const deleteProps={idOrName:{type:'string'},...envelope};
const removeGroup=defineWrite({
  name:'vercel_access_group_delete',
  async before(args,ctx){
    if(!args||typeof args!=='object'||Array.isArray(args))throw new RefusalError('Invalid access group request');
    checkEnvelope(args,deleteProps);
    if(typeof args.idOrName!=='string'||!args.idOrName||args.idOrName.length>200)
      throw new RefusalError('Invalid access group request');
    validateRequest('access_group_delete',{path:{idOrName:'ag_FAKE_example'},
      query:{teamId:'team_FAKE_validation'}});
    const {client,teamId}=await verifiedTeam(ctx);
    const detail=await groupDetail(client,teamId,args.idOrName);
    return {teamId,idOrName:args.idOrName,detail,etag:groupFingerprint(detail.group)};
  },
  async preview(_args,_ctx,before){
    const d=before.detail;
    return 'Delete access group "'+(d.group.name??before.idOrName)+'" with '+
      d.members.length+' member(s) and '+d.projects.length+' project role(s)'+
      (d.membersTruncated||d.projectsTruncated?' (lists truncated in this preview)':'')+
      '. Members lose the project access this group granted (their team roles are unchanged). '+
      'PRODUCTION owner confirmation required.';
  },
  async production(){
    return {production:true,why:'Access groups grant project access on the live owner account'};
  },
  async targets(_args,before){
    return [{kind:'account',id:before.teamId,name:before.teamId}];
  },
  async apply(args,ctx,before,requestKey){
    const provider=await writeProvider(ctx);
    await requirePreDispatch(async()=>{
      if(provider.account.team_id!==before.teamId||ctx.connection?.profile!=='full'||
        ctx.connection?.mode!=='production')
        throw new TypeError('Team authority changed');
      const readClient={request:(op,opts)=>provider.read(op,opts)};
      const now=await groupDetail(readClient,before.teamId,before.idOrName);
      if(groupFingerprint(now.group)!==before.etag)
        throw new TypeError('Access group changed after preview');
    });
    return provider.write('access_group_delete',
      {path:{idOrName:before.idOrName},query:{teamId:before.teamId}},{
      requestKey,tool:'vercel_access_group_delete',shapeResult:()=>{
        return {teamId:before.teamId,accessGroupId:before.detail.group.accessGroupId,accepted:true};
      }
    });
  },
  async verify(_args,ctx,before){
    const {client,teamId}=await teamClient(ctx);
    const {groups}=await listGroups(client,teamId);
    return {confirmed:!groups.some(g=>g.accessGroupId===before.detail.group.accessGroupId),
      teamId};
  }
});

const wrap=update=>bindGuardedWrite(update,ctxFor,result=>({
  isError:['refused_by_guard','outcome_unknown'].includes(result.status),
  content:[{type:'text',text:JSON.stringify(result)}]}));
function idOrNameArg(args){
  if(!args||typeof args!=='object'||Array.isArray(args)||
    Object.keys(args).some(k=>k!=='idOrName')||
    typeof args.idOrName!=='string'||!args.idOrName||args.idOrName.length>200||
    /[\x00-\x1f\x7f]/.test(args.idOrName))
    throw new TypeError('Access group get accepts only an idOrName');
  return args.idOrName;
}
export const accessGroupTools={
  tools:[
    {name:'vercel_access_group_list',writes:false,area:'teams',profiles:READ_PROFILES,
      description:'List the connected team\'s access groups with member and project counts, safely projected.',
      inputSchema:{type:'object',properties:{},additionalProperties:false},
      annotations:{readOnlyHint:true}},
    {name:'vercel_access_group_get',writes:false,area:'teams',profiles:READ_PROFILES,
      description:'Inspect one access group: its members, projects and project roles, composed from the documented reads.',
      inputSchema:{type:'object',required:['idOrName'],properties:{idOrName:{type:'string'}},additionalProperties:false},
      annotations:{readOnlyHint:true}},
    {name:'vercel_access_group_create',writes:true,guardedWrite:true,area:'teams',profiles:['full'],
      description:'Create an access group with optional project roles and members, with a plain access warning.',
      inputSchema:{type:'object',required:['name'],properties:createProps,additionalProperties:false},
      writeContract:create.writeContract,annotations:{readOnlyHint:false,destructiveHint:false}},
    {name:'vercel_access_group_update',writes:true,guardedWrite:true,area:'teams',profiles:['full'],
      description:'Rename an access group or change its project roles and membership, with a plain access warning.',
      inputSchema:{type:'object',required:['idOrName'],properties:updateProps,additionalProperties:false},
      writeContract:update.writeContract,annotations:{readOnlyHint:false,destructiveHint:false}},
    {name:'vercel_access_group_delete',writes:true,guardedWrite:true,area:'teams',profiles:['full'],
      description:'Delete an access group; the preview lists the members and project roles it currently grants.',
      inputSchema:{type:'object',required:['idOrName'],properties:deleteProps,additionalProperties:false},
      writeContract:removeGroup.writeContract,annotations:{readOnlyHint:false,destructiveHint:true}}
  ],
  handlers:{
    async vercel_access_group_list(args,ctx){
      if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).length)
        throw new TypeError('Access group list accepts no arguments');
      const {client,teamId}=await teamClient(ctx);
      const {groups,truncated}=await listGroups(client,teamId);
      return text({teamId,groups,truncated});
    },
    async vercel_access_group_get(args,ctx){
      const idOrName=idOrNameArg(args);
      const {client,teamId}=await teamClient(ctx);
      const detail=await groupDetail(client,teamId,idOrName);
      return text({teamId,...detail});
    },
    vercel_access_group_create:wrap(create),
    vercel_access_group_update:wrap(update),
    vercel_access_group_delete:wrap(removeGroup)
  }
};
