// D-1i: guarded removal of viewer/developer project-only permission.
import {defineWrite,bindGuardedWrite,requirePreDispatch} from '../core/write.js';
import {compact} from '../core/util.js';
import {readProvider,writeProvider} from '../vercel/provider.js';
import {checkProtected} from './self-guard.js';
import {checkApp} from './app-guard.js';
import {verifyEligibleTeamMember,completeMembers} from './project-member-safety.js';

const ID=/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const properties={
  project:{type:'string',minLength:1,maxLength:128},
  uid:{type:'string',minLength:1,maxLength:128},
  dryRun:{type:'boolean'},confirm:{type:'boolean'},
  requestKey:{type:'string',pattern:'^[a-zA-Z0-9_-]{8,128}$'}
};
function validate(args){
  if(!args||typeof args!=='object'||Array.isArray(args)||
    Object.keys(args).some(k=>!Object.hasOwn(properties,k))||
    typeof args.project!=='string'||!ID.test(args.project)||
    typeof args.uid!=='string'||!ID.test(args.uid)||
    (args.dryRun!==undefined&&typeof args.dryRun!=='boolean')||
    (args.confirm!==undefined&&typeof args.confirm!=='boolean'))
    throw new TypeError('Invalid member removal arguments');
}
const listMembers=(client,id)=>completeMembers(client,'projects_members_list',{idOrName:id});
const context=({db,connection,env,fetchImpl})=>({
  db,connection,env,fetchImpl,shape:compact,
  audit:x=>db.recordChange(x),replayStore:db.requestReplayStore(),
  guardProtected:targets=>checkProtected(targets,{db,connection,env}),
  guardApp:targets=>checkApp(targets,{db,connection,env})
});
const revoke=defineWrite({
  name:'vercel_project_remove_member',
  async before(args,ctx){
    validate(args);
    if(ctx.connection?.profile!=='full')
      throw new TypeError('Full profile is required for project member removal');
    const {client,account}=await readProvider(ctx);
    if(account.scope!=='team'&&account.scope!=='full')
      throw new TypeError('Team-level permission is required');
    // Derive the acting principal from THIS bound credential, not from an
    // optional environment variable or a caller-supplied UID.
    const identity=await client.request('user_get');
    const selfUid=identity?.user?.id;
    if(typeof selfUid!=='string'||!ID.test(selfUid))
      throw new TypeError('The current token owner cannot be verified');
    if(args.uid===selfUid)
      throw new TypeError('Cannot revoke the credential owner or the server itself');
    const project=await client.request('projects_get',{path:{idOrName:args.project}});
    if(typeof project?.id!=='string'||typeof project?.name!=='string')
      throw new TypeError('Project identity unavailable');
    const rows=await listMembers(client,project.id);
    const user=rows.find(row=>(row.uid??row.userId??row.id)===args.uid);
    // A successful DELETE makes the target absent. Permit completed-key
    // replay to reach the atomic store; a new key is a verified no-op.
    if(user && (!['PROJECT_VIEWER','PROJECT_DEVELOPER'].includes(user.role)||rows.length<2))
      throw new TypeError('Admin, owner and final-member changes require separate owner checks');
    // Project role alone is insufficient proof of the target's team authority.
    // Remove only an independently verified team contributor, never an owner,
    // member or an ambiguous identity even when a project page labels it viewer.
    if(user)await verifyEligibleTeamMember(client,account.team_id,args.uid);
    return {project:project.id,name:project.name,uid:args.uid,role:user?.role??null,
      alreadyAbsent:!user};
  },
  async preview(_args,_ctx,before){
    return before.alreadyAbsent ?
      'User '+before.uid+' already has no explicit project role on '+before.name+
        '; verified no-op only' :
      'Remove the '+before.role+' project role from user '+before.uid+
        ' on '+before.name+'; team membership remains unchanged';
  },
  async production(){
    return {production:true,why:'Project role removal can interrupt production access'};
  },
  async targets(_args,before){
    return [{kind:'project',id:before.project,name:before.name}];
  },
  async apply(_args,ctx,before,requestKey){
    if(before.alreadyAbsent)return {accepted:false,unchanged:true};
    // The role, team authority and acting principal can change after preview.
    // Re-evaluate every lockout guard against the same authenticated account
    // immediately before DELETE; never trust the earlier inventory alone.
    const provider=await writeProvider(ctx);
    await requirePreDispatch(async()=>{
      const {account}=provider;
      const client={request:(id,params)=>provider.read(id,params)};
      if(!['team','full'].includes(account.scope))
      throw new TypeError('Team authority changed before project role removal');
    const identity=await client.request('user_get');
    const selfUid=identity?.user?.id;
    if(typeof selfUid!=='string'||!ID.test(selfUid)||selfUid===before.uid)
      throw new TypeError('Acting principal cannot safely remove this project role');
    const project=await client.request('projects_get',{path:{idOrName:before.project}});
    if(project?.id!==before.project||project?.name!==before.name)
      throw new TypeError('Project identity changed before role removal');
    const rows=await listMembers(client,before.project);
    const user=rows.find(row=>(row.uid??row.userId??row.id)===before.uid);
    if(rows.length<2||user?.role!==before.role||
      !['PROJECT_VIEWER','PROJECT_DEVELOPER'].includes(user.role))
      throw new TypeError('Project role or last-member status changed before removal');
    await verifyEligibleTeamMember(client,account.team_id,before.uid);
    });
    return provider.write('projects_members_remove',{
      path:{idOrName:before.project,uid:before.uid}
    },{requestKey,tool:'vercel_project_remove_member',
      shapeResult:()=>({accepted:true})});
  },
  async verify(_args,ctx,before){
    const {client}=await readProvider(ctx);
    const rows=await listMembers(client,before.project);
    return {confirmed:!rows.some(row=>(row.uid??row.userId??row.id)===before.uid),
      project:before.project,member:before.uid};
  }
});
export const projectRemoveTools={
  tools:[{name:'vercel_project_remove_member',writes:true,guardedWrite:true,
    profiles:['full'],area:'projects',
    description:'Remove viewer/developer project access; production confirmation required and owner roles protected.',
    inputSchema:{type:'object',properties,required:['project','uid'],additionalProperties:false},
    annotations:{readOnlyHint:false,destructiveHint:true},
    writeContract:revoke.writeContract}],
  handlers:{
    vercel_project_remove_member:bindGuardedWrite(revoke,context,result=>({
      isError:['refused_by_guard','outcome_unknown'].includes(result.status),
      content:[{type:'text',text:JSON.stringify(result)}]
    }))
  }
};
