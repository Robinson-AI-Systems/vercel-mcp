// D-1h: add an existing team member by stable user ID. No email invites or seats.
import {defineWrite,bindGuardedWrite} from '../core/write.js';
import {compact} from '../core/util.js';
import {readProvider,writeProvider} from '../vercel/provider.js';
import {checkProtected} from './self-guard.js';
import {checkApp} from './app-guard.js';

const ID=/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const ROLES=['ADMIN','PROJECT_DEVELOPER','PROJECT_VIEWER'];
const properties={
  project:{type:'string',minLength:1,maxLength:128},
  uid:{type:'string',minLength:1,maxLength:128},
  role:{type:'string',enum:ROLES},
  confirm:{type:'boolean'},dryRun:{type:'boolean'},
  requestKey:{type:'string',pattern:'^[a-zA-Z0-9_-]{8,128}$'}
};
function validate(args){
  if(!args||typeof args!=='object'||Array.isArray(args)||
    Object.keys(args).some(k=>!Object.hasOwn(properties,k))||
    typeof args.project!=='string'||!ID.test(args.project)||
    typeof args.uid!=='string'||!ID.test(args.uid)||
    !ROLES.includes(args.role)||
    (args.confirm!==undefined&&typeof args.confirm!=='boolean')||
    (args.dryRun!==undefined&&typeof args.dryRun!=='boolean'))
    throw new TypeError('Invalid project member request');
}
const scope=async(ctx,project)=>{
  if(ctx.connection?.profile!=='full')throw new TypeError('Full-profile connection required for access changes');
  const bound=await readProvider(ctx);
  if(bound.account.scope!=='team'&&bound.account.scope!=='full')
    throw new TypeError('Team-level permission required to change project membership');
  const row=await bound.client.request('projects_get',{path:{idOrName:project}});
  if(typeof row?.id!=='string'||typeof row?.name!=='string')
    throw new TypeError('Project ownership cannot be verified');
  return {client:bound.client,id:row.id,name:row.name};
};
const members=async(client,project)=>{
  const page=await client.request('projects_members_list',{path:{idOrName:project},query:{limit:100}});
  if(!Array.isArray(page?.members)||page.pagination?.next!=null)
    throw new TypeError('Member list is incomplete or unavailable; refuse mutation');
  return page.members;
};
const context=({db,connection,env,fetchImpl})=>({
  db,connection,env,fetchImpl,shape:compact,
  audit:entry=>db.recordChange(entry),
  replayStore:db.requestReplayStore(),
  guardProtected:targets=>checkProtected(targets,{db,connection,env}),
  guardApp:targets=>checkApp(targets,{db,connection,env})
});
const grant=defineWrite({
  name:'vercel_project_add_member',risk:{access:true},
  async before(args,ctx){
    validate(args);
    const project=await scope(ctx,args.project);
    const rows=await members(project.client,project.id);
    const current=rows.find(row=>(row.uid??row.userId??row.id)===args.uid);
    if(current && current.role!==args.role)
      throw new TypeError('Member already has another project role; role changes need separate review');
    // A completed replay must be reachable even after the first grant succeeded.
    // A new key with the same role becomes a verified idempotent no-op.
    return {project:project.id,name:project.name,uid:args.uid,role:args.role,
      alreadyAssigned:Boolean(current)};
  },
  async preview(_args,_ctx,before){
    return 'Grant '+before.role+' project access to existing team user '+before.uid+
      ' on project '+before.name+' ('+before.project+')'+
      (before.alreadyAssigned?'; role already assigned (no mutation)':
        '; no team invitation or paid seat');
  },
  async production(){return {production:true,why:'Project access may reach production data and resources'};},
  async targets(_args,before){return [{kind:'project',id:before.project,name:before.name}];},
  async access(_args,before){return {widens:true,who:before.uid,what:before.role+' on '+before.project};},
  async apply(_args,ctx,before,requestKey){
    if(before.alreadyAssigned)return {accepted:false,unchanged:true};
    const provider=await writeProvider(ctx);
    return provider.write('projects_members_add',{
      path:{idOrName:before.project},body:{uid:before.uid,role:before.role}
    },{requestKey,tool:'vercel_project_add_member',
      shapeResult:()=>({accepted:true})});
  },
  async verify(_args,ctx,before){
    const {client}=await readProvider(ctx);
    const rows=await members(client,before.project);
    const found=rows.find(row=>(row.uid??row.userId??row.id)===before.uid);
    return {confirmed:found?.role===before.role,
      project:before.project,member:before.uid};
  }
});
const output=r=>({isError:['refused_by_guard','outcome_unknown'].includes(r.status),
  content:[{type:'text',text:JSON.stringify(r)}]});
export const projectMemberTools={
  tools:[{name:'vercel_project_add_member',writes:true,guardedWrite:true,
    profiles:['full'],area:'projects',
    description:'Grant an existing team user a project role by UID; requires production-mode confirmation.',
    inputSchema:{type:'object',properties,required:['project','uid','role'],additionalProperties:false},
    annotations:{readOnlyHint:false,destructiveHint:false},
    risk:{access:true},writeContract:grant.writeContract}],
  handlers:{
    vercel_project_add_member:bindGuardedWrite(grant,context,output)
  }
};
