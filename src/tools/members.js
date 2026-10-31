// O-2 team members: projected roster read plus guarded invite, role,
// remove and revoke-invite writes (BATCH-O sections 5.1/5.2/5.4).
// Seat price recorded in the O-2 dossier from Vercel's published Pro
// pricing: an additional deploying seat is $20/month; Viewer, Billing
// and Contributor seats are free; SECURITY has no published seat price.
import {createHash} from 'node:crypto';
import {defineWrite,bindGuardedWrite,requirePreDispatch, RefusalError } from '../core/write.js';
import {compact,credentialLike} from '../core/util.js';
import {readProvider,writeProvider} from '../vercel/provider.js';
import {checkProtected} from './self-guard.js';
import {checkApp} from './app-guard.js';
import {validateRequest} from '../vercel/openapi-validation.js';

const ID=/^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/;
const READ_PROFILES=['read_only','everyday','full'];
export const ROLE_ENUM=['OWNER','MEMBER','DEVELOPER','SECURITY','BILLING','VIEWER','VIEWER_FOR_PLUS','CONTRIBUTOR'];
const PROJECT_ROLES=['ADMIN','PROJECT_DEVELOPER','PROJECT_GUEST','PROJECT_VIEWER'];
const TEAM_PERMISSIONS=['AiGatewayBudgetManager','AiGatewayCredits','AiGatewaySettings',
  'AiGatewayTranscriptsManager','AiGatewayTranscriptsViewer','AiGatewayUser','ConnectorManager',
  'CreateProject','EnvVariableManager','EnvironmentManager','FullProductionDeployment',
  'IntegrationManager','OrgAdmin','OrgViewer','UsageViewer','V0Builder','V0Chatter','V0Viewer',
  'WorkflowDecryptor'];
export const SEAT_PRICE_CENTS=2000;
const PAID_ROLES=['OWNER','MEMBER','DEVELOPER'];
// {cents, known} — SECURITY is deploying-adjacent with no published price.
export function seatPrice(role){
  if(PAID_ROLES.includes(role))return {cents:SEAT_PRICE_CENTS,known:true};
  if(role==='SECURITY')return {cents:null,known:false};
  return {cents:0,known:true};
}
// AUD-AJ (owner ruling 2026-10-30): the exact SECURITY disclosure.
// Vercel publishes no seat price for the role — no figure is stored
// anywhere; this sentence is the whole disclosure, shared by every
// surface so they cannot drift apart.
export const SECURITY_SEAT_DISCLOSURE='Security role — seat price not published by Vercel. This role is Enterprise-only; any charge is set by your team\'s Enterprise agreement.';
export const SECURITY_TOTAL_LABEL='known costs only — excludes the Security seat';
const ACK_REFUSAL=SECURITY_SEAT_DISCLOSURE+' To proceed, re-run with acknowledgeUnpricedSeat: true to acknowledge this unpriced-seat disclosure.';
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
async function teamClient(ctx,{write=false}={}){
  if(ctx.connection?.profile!=='full'&&write)
    throw new RefusalError('Full owner profile required');
  const {client,account}=await (write?writeProvider(ctx):readProvider(ctx));
  if(!['team','full'].includes(account.scope)||!ID.test(account.team_id))
    throw new RefusalError('Member tools require a team-scoped account');
  return {client,account,teamId:account.team_id};
}
async function roster(client,teamId){
  const members=[],invites=[];let until=null,pages=0,complete=false;
  do{
    const query={limit:100};if(until!==null)query.until=until;
    const page=await client.request('teams_members_list',{path:{teamId},query});
    if(!page||!Array.isArray(page.members)||!Array.isArray(page.emailInviteCodes))
      throw new RefusalError('Member roster could not be read');
    members.push(...page.members);invites.push(...page.emailInviteCodes);
    until=page.pagination?.next??null;pages++;
    if(until===null)complete=true;
  }while(until!==null&&pages<5);
  return {members,invites,complete};
}
function projectMember(row){
  return {uid:ID.test(row?.uid??'')?row.uid:null,
    username:safe(row?.username),name:safe(row?.name),email:safe(row?.email,254),
    role:ROLE_ENUM.includes(row?.role)?row.role:null,
    confirmed:typeof row?.confirmed==='boolean'?row.confirmed:null,
    createdAt:typeof row?.createdAt==='number'?row.createdAt:null,
    projects:Array.isArray(row?.projects)?row.projects.slice(0,50).map(p=>({
      id:ID.test(p?.id??'')?p.id:null,name:safe(p?.name),
      role:PROJECT_ROLES.includes(p?.role)?p.role:null})):[],
    // The member contract carries no two-step field; reported honestly.
    twoStepLogin:null};
}
function projectInvite(row){
  return {id:typeof row?.id==='string'?row.id:null,email:safe(row?.email,254),
    role:ROLE_ENUM.includes(row?.role)?row.role:null,
    expired:row?.expired===true,
    createdAt:typeof row?.createdAt==='number'?row.createdAt:null,
    accessGroups:Array.isArray(row?.accessGroups)?row.accessGroups
      .filter(x=>typeof x==='string').slice(0,20):[]};
}
async function selfUid(client){
  const identity=await client.request('user_get');
  const uid=identity?.user?.id;
  if(typeof uid!=='string'||!ID.test(uid))
    throw new RefusalError('The current token owner cannot be verified');
  return uid;
}
async function verifiedTeam(ctx){
  const {client,account,teamId}=await teamClient(ctx);
  const row=await client.request('teams_get',{path:{teamId}});
  if(!row||row.id!==teamId)
    throw new RefusalError('Connected team identity could not be verified');
  return {client,account,teamId,row};
}
const teamFingerprint=(teamId,rows)=>createHash('sha256')
  .update(JSON.stringify([teamId,rows.map(r=>[r.uid,r.role])])).digest('hex');

// ---------------- vercel_member_invite ----------------
const inviteProps={
  email:{type:'string'},role:{type:'string',enum:ROLE_ENUM},
  projects:{type:'array',items:{type:'object',additionalProperties:false,
    required:['projectId','role'],properties:{projectId:{type:'string'},
    role:{type:'string',enum:PROJECT_ROLES}}}},
  confirm:{type:'boolean'},dryRun:{type:'boolean'},
  acknowledgeUnpricedSeat:{type:'boolean'},
  requestKey:{type:'string',pattern:'^[a-zA-Z0-9_-]{8,128}$'}};
function validateInvite(args){
  if(!args||typeof args!=='object'||Array.isArray(args)||
    Object.keys(args).some(k=>!Object.hasOwn(inviteProps,k))||
    typeof args.email!=='string'||!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(args.email)||
    args.email.length>254||
    (args.role!==undefined&&!ROLE_ENUM.includes(args.role))||
    (args.projects!==undefined&&(!Array.isArray(args.projects)||args.projects.length>50||
      args.projects.some(p=>!p||!ID.test(p.projectId??'')||!PROJECT_ROLES.includes(p.role))))||
    ['confirm','dryRun','acknowledgeUnpricedSeat'].some(k=>args[k]!==undefined&&typeof args[k]!=='boolean')||
    args.requestKey!==undefined&&(typeof args.requestKey!=='string'||
      !/^[a-zA-Z0-9_-]{8,128}$/.test(args.requestKey)))
    throw new RefusalError('Invalid member invite request');
}
const invite=defineWrite({
  name:'vercel_member_invite',
  async before(args,ctx){
    validateInvite(args);
    const role=args.role??'MEMBER';
    // AUD-AJ: a confirmed SECURITY invite needs the caller's
    // explicit acknowledgement of the unpriced-seat disclosure.
    if(role==='SECURITY'&&args.confirm===true&&args.dryRun!==true&&
      args.acknowledgeUnpricedSeat!==true)
      throw new RefusalError(ACK_REFUSAL);
    const entry={email:args.email,role};
    if(args.projects?.length)entry.projects=args.projects
      .map(p=>({projectId:p.projectId,role:p.role}));
    validateRequest('teams_members_invite',{path:{teamId:'team_FAKE_validation'},body:[entry]});
    const {teamId}=await verifiedTeam(ctx);
    return {teamId,entry,role,price:seatPrice(role)};
  },
  risk:{spend:true,access:true},
  async spend(_args,_ctx,before){
    return {cents:before.price.cents,recurring:true,
      description:before.price.known
        ?(before.price.cents? 'Paid team seat at the stored Pro seat price ($20/month per deploying seat)'
          :'Free seat role — no seat charge')
        :SECURITY_SEAT_DISCLOSURE};
  },
  async access(_args,before){
    return {widens:true,who:before.entry.email,
      what:'Joins the team with the '+before.role+' role'+(before.entry.projects
        ?' and the listed project roles':'')};
  },
  async preview(_args,_ctx,before){
    const seat=!before.price.known?SECURITY_SEAT_DISCLOSURE
      :before.price.cents?'Seat: $20/month paid deploying seat (stored Pro seat price)'
      :'Seat: free role, no seat charge';
    return 'Invite '+before.entry.email+' to this team as '+before.role+
      '. They receive an invitation email from Vercel. '+seat+
      (seat.endsWith('.')?'':'.')+' PRODUCTION owner confirmation required.';
  },
  async production(){
    return {production:true,why:'Team membership changes apply to the live owner account'};
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
    return provider.write('teams_members_invite',{path:{teamId:before.teamId},
      body:[before.entry]},{
      requestKey,tool:'vercel_member_invite',shapeResult:row=>{
        if(!row||row.email!==before.entry.email||typeof row.uid!=='string')
          throw new TypeError('Provider did not confirm the invitation');
        return {teamId:before.teamId,uid:row.uid,email:row.email,
          role:ROLE_ENUM.includes(row.role)?row.role:before.role};
      }
    });
  },
  async verify(_args,ctx,before){
    const {client}=await teamClient(ctx);
    const {members,invites}=await roster(client,before.teamId);
    const found=[...members,...invites]
      .find(r=>r.email===before.entry.email);
    return {confirmed:Boolean(found)&&
      (found.role===before.role||found.role===undefined),teamId:before.teamId};
  }
});

// ---------------- vercel_member_update_role ----------------
const roleProps={
  uid:{type:'string'},role:{type:'string',enum:ROLE_ENUM},
  teamPermissions:{type:'array',items:{type:'string',enum:TEAM_PERMISSIONS}},
  projects:{type:'array',items:{type:'object',additionalProperties:false,
    required:['projectId'],properties:{projectId:{type:'string'},
    role:{type:['string','null'],enum:[...PROJECT_ROLES,null]}}}},
  confirm:{type:'boolean'},dryRun:{type:'boolean'},
  acknowledgeUnpricedSeat:{type:'boolean'},
  requestKey:{type:'string',pattern:'^[a-zA-Z0-9_-]{8,128}$'}};
function validateRole(args){
  if(!args||typeof args!=='object'||Array.isArray(args)||
    Object.keys(args).some(k=>!Object.hasOwn(roleProps,k))||
    !ID.test(args.uid??'')||
    (args.role===undefined&&args.teamPermissions===undefined&&args.projects===undefined)||
    (args.teamPermissions!==undefined&&(!Array.isArray(args.teamPermissions)||
      args.teamPermissions.some(p=>!TEAM_PERMISSIONS.includes(p))))||
    (args.projects!==undefined&&(!Array.isArray(args.projects)||args.projects.length>50||
      args.projects.some(p=>!p||!ID.test(p.projectId??'')||
        (p.role!==undefined&&p.role!==null&&!PROJECT_ROLES.includes(p.role)))))||
    ['confirm','dryRun','acknowledgeUnpricedSeat'].some(k=>args[k]!==undefined&&typeof args[k]!=='boolean')||
    args.requestKey!==undefined&&(typeof args.requestKey!=='string'||
      !/^[a-zA-Z0-9_-]{8,128}$/.test(args.requestKey)))
    throw new RefusalError('Invalid member role request');
}
const updateRole=defineWrite({
  name:'vercel_member_update_role',
  async before(args,ctx){
    validateRole(args);
    const body={};
    if(args.role!==undefined)body.role=args.role;
    if(args.teamPermissions!==undefined)body.teamPermissions=args.teamPermissions;
    if(args.projects!==undefined)body.projects=args.projects;
    validateRequest('teams_member_patch',{path:{teamId:'team_FAKE_validation',uid:'usr_FAKE'},body});
    const {client,teamId}=await verifiedTeam(ctx);
    const {members,complete}=await roster(client,teamId);
    if(!complete)throw new RefusalError('Member roster is too large to verify the lockout guards');
    const target=members.find(m=>m.uid===args.uid);
    if(!target)throw new RefusalError('Member not found on this team');
    const self=await selfUid(client);
    if(args.uid===self)
      throw new RefusalError('Refusing to change the role of the token\'s own user');
    if(target.role==='OWNER'&&args.role!==undefined&&args.role!=='OWNER'&&
      members.filter(m=>m.role==='OWNER').length<=1)
      throw new RefusalError('Refusing to demote the team\'s last Owner');
    const priceDelta=args.role!==undefined&&seatPrice(args.role).cents>0&&
      !(seatPrice(target.role).cents>0);
    const unknownPrice=args.role==='SECURITY'&&target.role!=='SECURITY';
    // AUD-AJ: a confirmed move INTO SECURITY needs the caller's
    // explicit acknowledgement of the unpriced-seat disclosure.
    if(unknownPrice&&args.confirm===true&&args.dryRun!==true&&
      args.acknowledgeUnpricedSeat!==true)
      throw new RefusalError(ACK_REFUSAL);
    return {teamId,target:{uid:target.uid,role:target.role,email:target.email},
      body,priceDelta,unknownPrice,
      widens:args.role==='OWNER'&&target.role!=='OWNER'||
        (args.teamPermissions?.length??0)>0,
      etag:teamFingerprint(teamId,members)};
  },
  risk:{spend:true,access:true},
  async spend(_args,_ctx,before){
    if(before.unknownPrice)return {cents:null,recurring:true,
      description:SECURITY_SEAT_DISCLOSURE};
    return {cents:before.priceDelta?SEAT_PRICE_CENTS:0,recurring:true,
      description:before.priceDelta
        ?'Change moves the member onto a paid deploying seat ($20/month stored Pro seat price)'
        :'No new paid seat — no seat charge'};
  },
  async access(_args,before){
    return {widens:before.widens,who:before.target.email??before.target.uid,
      what:before.widens?'Gains broader team access (role/permissions widen)'
        :'Team role or project roles change without widening team access'};
  },
  async preview(_args,_ctx,before){
    const parts=['Change '+(before.target.email??before.target.uid)+
      '\'s role from '+before.target.role+' to '+(before.body.role??before.target.role)];
    if(before.body.teamPermissions)parts.push('team permissions set to '+
      (before.body.teamPermissions.join(', ')||'none'));
    if(before.body.projects)parts.push('project roles updated for '+
      before.body.projects.length+' project(s)');
    if(before.priceDelta)parts.push('this moves them onto a paid seat: $20/month');
    return parts.join('; ')+'.'+(before.unknownPrice
      ?' '+SECURITY_SEAT_DISCLOSURE:'')+
      ' PRODUCTION owner confirmation required.';
  },
  async production(){
    return {production:true,why:'Member roles govern access on the live owner account'};
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
      const {members}=await roster(readClient,before.teamId);
      const target=members.find(m=>m.uid===args.uid);
      if(!target||target.role!==before.target.role||
        teamFingerprint(before.teamId,members)!==before.etag)
        throw new TypeError('Member roster changed after preview');
    });
    return provider.write('teams_member_patch',{path:{teamId:before.teamId,uid:args.uid},
      body:before.body},{
      requestKey,tool:'vercel_member_update_role',shapeResult:row=>{
        if(row?.id!==before.teamId)
          throw new TypeError('Provider did not confirm the role change');
        return {teamId:before.teamId,uid:args.uid,accepted:true};
      }
    });
  },
  async verify(args,ctx,before){
    const {client}=await teamClient(ctx);
    const {members}=await roster(client,before.teamId);
    const target=members.find(m=>m.uid===args.uid);
    const confirmed=Boolean(target)&&
      (args.role===undefined||target.role===args.role);
    return {confirmed,teamId:before.teamId};
  },
  // X-1: restore the recorded previous team role. The previous team
  // permissions / project roles are not captured by this tool's
  // before state, so a permissions-only change stores the honest
  // descriptive inverse instead.
  async inverse(args,before){
    if(before.body.role!==undefined)
      return {tool:'vercel_member_update_role',uid:args.uid,
        role:before.target.role};
    return {undo:'Restore the previous team permissions and project roles with vercel_member_update_role directly — they were not captured when this change was made'};
  }
});

// ---------------- vercel_member_remove ----------------
const uidProps={uid:{type:'string'},confirm:{type:'boolean'},dryRun:{type:'boolean'},
  requestKey:{type:'string',pattern:'^[a-zA-Z0-9_-]{8,128}$'}};
function validateUid(args){
  if(!args||typeof args!=='object'||Array.isArray(args)||
    Object.keys(args).some(k=>!Object.hasOwn(uidProps,k))||!ID.test(args.uid??'')||
    ['confirm','dryRun'].some(k=>args[k]!==undefined&&typeof args[k]!=='boolean')||
    args.requestKey!==undefined&&(typeof args.requestKey!=='string'||
      !/^[a-zA-Z0-9_-]{8,128}$/.test(args.requestKey)))
    throw new RefusalError('Invalid member request');
}
const remove=defineWrite({
  name:'vercel_member_remove',
  async before(args,ctx){
    validateUid(args);
    validateRequest('teams_member_delete',{path:{teamId:'team_FAKE_validation',uid:'usr_FAKE'}});
    const {client,teamId}=await verifiedTeam(ctx);
    const {members,complete}=await roster(client,teamId);
    if(!complete)throw new RefusalError('Member roster is too large to verify the lockout guards');
    const target=members.find(m=>m.uid===args.uid);
    if(!target)throw new RefusalError('Member not found on this team');
    const self=await selfUid(client);
    if(args.uid===self)
      throw new RefusalError('Refusing to remove the token\'s own user');
    if(target.role==='OWNER'&&members.filter(m=>m.role==='OWNER').length<=1)
      throw new RefusalError('Refusing to remove the team\'s last Owner');
    return {teamId,target:{uid:target.uid,role:target.role,email:target.email},
      etag:teamFingerprint(teamId,members)};
  },
  async preview(_args,_ctx,before){
    return 'Remove '+(before.target.email??before.target.uid)+' ('+before.target.role+
      ') from this team. They lose all team and project access immediately. '+
      'PRODUCTION owner confirmation required.';
  },
  async production(){
    return {production:true,why:'Removing a member revokes access on the live owner account'};
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
      const {members}=await roster(readClient,before.teamId);
      if(teamFingerprint(before.teamId,members)!==before.etag)
        throw new TypeError('Member roster changed after preview');
    });
    return provider.write('teams_member_delete',{path:{teamId:before.teamId,uid:args.uid}},{
      requestKey,tool:'vercel_member_remove',shapeResult:()=>{
        return {teamId:before.teamId,uid:args.uid,accepted:true};
      }
    });
  },
  async verify(args,ctx,before){
    const {client}=await teamClient(ctx);
    const {members}=await roster(client,before.teamId);
    return {confirmed:!members.some(m=>m.uid===args.uid),teamId:before.teamId};
  }
});

// ---------------- vercel_member_revoke_invite ----------------
const inviteIdProps={inviteId:{type:'string'},confirm:{type:'boolean'},dryRun:{type:'boolean'},
  requestKey:{type:'string',pattern:'^[a-zA-Z0-9_-]{8,128}$'}};
const revokeInvite=defineWrite({
  name:'vercel_member_revoke_invite',
  async before(args,ctx){
    if(!args||typeof args!=='object'||Array.isArray(args)||
      Object.keys(args).some(k=>!Object.hasOwn(inviteIdProps,k))||
      typeof args.inviteId!=='string'||!ID.test(args.inviteId)||
      ['confirm','dryRun'].some(k=>args[k]!==undefined&&typeof args[k]!=='boolean')||
      args.requestKey!==undefined&&(typeof args.requestKey!=='string'||
        !/^[a-zA-Z0-9_-]{8,128}$/.test(args.requestKey)))
      throw new RefusalError('Invalid invite request');
    validateRequest('teams_invite_delete',{path:{teamId:'team_FAKE_validation',inviteId:'inv_FAKE'}});
    const {client,teamId}=await verifiedTeam(ctx);
    const {invites}=await roster(client,teamId);
    const target=invites.find(i=>i.id===args.inviteId);
    if(!target)throw new RefusalError('Invitation not found on this team');
    return {teamId,target:{id:target.id,email:target.email,role:target.role}};
  },
  async preview(_args,_ctx,before){
    return 'Revoke the pending invitation for '+(before.target.email??before.target.id)+
      ' ('+(before.target.role??'member')+'). The invite link stops working. '+
      'PRODUCTION owner confirmation required.';
  },
  async production(){
    return {production:true,why:'Invitations grant access to the live owner account'};
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
    return provider.write('teams_invite_delete',
      {path:{teamId:before.teamId,inviteId:args.inviteId}},{
      requestKey,tool:'vercel_member_revoke_invite',shapeResult:()=>{
        return {teamId:before.teamId,inviteId:args.inviteId,accepted:true};
      }
    });
  },
  async verify(args,ctx,before){
    const {client}=await teamClient(ctx);
    const {invites}=await roster(client,before.teamId);
    return {confirmed:!invites.some(i=>i.id===args.inviteId),teamId:before.teamId};
  }
});

const wrap=(name,update)=>bindGuardedWrite(update,ctxFor,result=>({
  isError:['refused_by_guard','outcome_unknown'].includes(result.status),
  content:[{type:'text',text:JSON.stringify(result)}]}));
export const memberTools={
  tools:[
    {name:'vercel_member_list',writes:false,area:'teams',profiles:READ_PROFILES,
      description:'List the connected team\'s members and pending invites with roles and project roles, safely projected.',
      inputSchema:{type:'object',properties:{limit:{type:'integer',minimum:1,maximum:100}},additionalProperties:false},
      annotations:{readOnlyHint:true}},
    {name:'vercel_member_invite',writes:true,guardedWrite:true,area:'teams',profiles:['full'],
      description:'Invite a person to the connected team by email with a role; preview shows the seat price for paid roles.',
      inputSchema:{type:'object',required:['email'],properties:inviteProps,additionalProperties:false},
      writeContract:invite.writeContract,annotations:{readOnlyHint:false,destructiveHint:false}},
    {name:'vercel_member_update_role',writes:true,guardedWrite:true,area:'teams',profiles:['full'],
      description:'Change a member\'s team role, team permissions or project roles; refuses self-changes and demoting the last Owner.',
      inputSchema:{type:'object',required:['uid'],properties:roleProps,additionalProperties:false},
      writeContract:updateRole.writeContract,annotations:{readOnlyHint:false,destructiveHint:false}},
    {name:'vercel_member_remove',writes:true,guardedWrite:true,area:'teams',profiles:['full'],
      description:'Remove a member from the connected team; refuses removing yourself or the last Owner.',
      inputSchema:{type:'object',required:['uid'],properties:uidProps,additionalProperties:false},
      writeContract:remove.writeContract,annotations:{readOnlyHint:false,destructiveHint:true}},
    {name:'vercel_member_revoke_invite',writes:true,guardedWrite:true,area:'teams',profiles:['full'],
      description:'Revoke a pending team invitation so its invite link stops working.',
      inputSchema:{type:'object',required:['inviteId'],properties:inviteIdProps,additionalProperties:false},
      writeContract:revokeInvite.writeContract,annotations:{readOnlyHint:false,destructiveHint:false}}
  ],
  handlers:{
    async vercel_member_list(args,ctx){
      if(!args||typeof args!=='object'||Array.isArray(args)||
        Object.keys(args).some(k=>k!=='limit')||
        (args.limit!==undefined&&(!Number.isInteger(args.limit)||args.limit<1||args.limit>100)))
        throw new TypeError('Member list accepts only an optional limit');
      const {client,teamId}=await teamClient(ctx);
      const {members,invites,complete}=await roster(client,teamId);
      const limit=args.limit??100;
      return text({teamId,members:members.slice(0,limit).map(projectMember),
        invites:invites.map(projectInvite),
        truncated:!complete||members.length>limit,
        note:'Two-step login is not reported by the member API and is shown as null, never guessed.'});
    },
    vercel_member_invite:wrap('vercel_member_invite',invite),
    vercel_member_update_role:wrap('vercel_member_update_role',updateRole),
    vercel_member_remove:wrap('vercel_member_remove',remove),
    vercel_member_revoke_invite:wrap('vercel_member_revoke_invite',revokeInvite)
  }
};
