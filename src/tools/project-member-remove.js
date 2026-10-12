// D-1i: guarded removal of viewer/developer project-only permission.
import {defineWrite} from '../core/write.js';
import {compact} from '../core/util.js';
import {readProvider,writeProvider} from '../vercel/provider.js';
import {checkProtected} from './self-guard.js';
import {checkApp} from './app-guard.js';

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
async function listMembers(client,id){
  const page=await client.request('projects_members_list',{
    path:{idOrName:id},query:{limit:100}
  });
  if(!Array.isArray(page?.members)||page.pagination?.next!=null)
    throw new TypeError('Member list incomplete; change refused');
  return page.members;
}
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
    const project=await client.request('projects_get',{path:{idOrName:args.project}});
    if(typeof project?.id!=='string'||typeof project?.name!=='string')
      throw new TypeError('Project identity unavailable');
    if(typeof ctx.env?.VERCEL_USER_ID==='string'&&args.uid===ctx.env.VERCEL_USER_ID)
      throw new TypeError('Cannot remove runtime owner');
    const rows=await listMembers(client,project.id);
    const user=rows.find(row=>(row.uid??row.userId??row.id)===args.uid);
    if(!user)throw new TypeError('Member role not present');
    // Never risk last-owner lockout; defer admin/owner or final member removal.
    if(!['PROJECT_VIEWER','PROJECT_DEVELOPER'].includes(user.role)||rows.length<2)
      throw new TypeError('Admin, owner and final-member changes require separate owner checks');
    return {project:project.id,name:project.name,uid:args.uid,role:user.role};
  },
  async preview(_args,_ctx,before){
    return 'Remove the '+before.role+' project role from user '+before.uid+
      ' on '+before.name+'; team membership remains unchanged';
  },
  async production(){
    return {production:true,why:'Project role removal can interrupt production access'};
  },
  async targets(_args,before){
    return [{kind:'project',id:before.project,name:before.name}];
  },
  async apply(_args,ctx,before,requestKey){
    const provider=await writeProvider(ctx);
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
    async vercel_project_remove_member(args,ctx){
      const result=await revoke.run(args,context(ctx));
      return {isError:['refused_by_guard','outcome_unknown'].includes(result.status),
        content:[{type:'text',text:JSON.stringify(result)}]};
    }
  }
};
