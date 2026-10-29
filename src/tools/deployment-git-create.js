// D-3: guarded Git-sourced deployment. Building is metered; IN-08's
// provider-enforced per-operation total ceiling is unavailable, so the
// shared spending gate must refuse confirmed execution before POST.
import {defineWrite,bindGuardedWrite,requirePreDispatch,purchaseDelegationFor} from '../core/write.js';
import {compact} from '../core/util.js';
import {readProvider,writeProvider} from '../vercel/provider.js';
import {deploymentTargetMatches} from '../vercel/deployment-target.js';
import {validateRequest} from '../vercel/openapi-validation.js';
import {checkProtected} from './self-guard.js';
import {checkApp} from './app-guard.js';

const ID=/^[A-Za-z0-9][A-Za-z0-9_-]{1,127}$/;
const NAME=/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const REPO=/^[A-Za-z0-9_.-]{1,100}$/;
const REF=/^[A-Za-z0-9][A-Za-z0-9_.\/-]{0,127}$/;
const SHA=/^[0-9a-f]{40}$/;
const inputSchema={type:'object',properties:{
  project:{type:'string',pattern:ID.source,minLength:2,maxLength:128},
  expectedName:{type:'string',pattern:NAME.source,minLength:1,maxLength:100},
  gitRef:{type:'string',pattern:REF.source,minLength:1,maxLength:128},
  gitSha:{type:'string',pattern:SHA.source,minLength:40,maxLength:40},
  target:{type:'string',enum:['preview','production']},
  outsideApp:{type:'boolean',const:true},
  dryRun:{type:'boolean'},confirm:{type:'boolean'},
  requestKey:{type:'string',pattern:'^[A-Za-z0-9_-]{8,128}$'}
},required:['project','expectedName','gitRef','gitSha','target','outsideApp'],
additionalProperties:false};
function check(args){
  if(!args||typeof args!=='object'||Array.isArray(args)||
    Object.keys(args).some(k=>!Object.hasOwn(inputSchema.properties,k))||
    !ID.test(args.project??'')||!NAME.test(args.expectedName??'')||
    !REF.test(args.gitRef??'')||args.gitRef.includes('..')||
    args.gitRef.split('/').some(x=>x===''||x==='.')||
    !SHA.test(args.gitSha??'')||!['preview','production'].includes(args.target)||
    args.outsideApp!==true||
    args.dryRun!==undefined&&typeof args.dryRun!=='boolean'||
    args.confirm!==undefined&&typeof args.confirm!=='boolean')
    throw new TypeError('Exact authorized Git project, branch, commit and target required');
}
function sourceProject(project,row){
  if(row?.id!==project||typeof row?.name!=='string'||!NAME.test(row.name)||
    row.accountId!=null&&typeof row.accountId!=='string')
    throw new TypeError('Project scope or identity could not be proven');
  // Vercel Git source may belong to a linked repository. Never let the agent
  // select a different Git owner/repository than the verified Vercel project.
  const git=row.link;
  if(!git||git.type!=='github'||!REPO.test(git.org??'')||
    !REPO.test(git.repo??'')||git.repo.includes('..')||git.org.includes('..'))
    throw new TypeError('Project has no verified GitHub repository linkage');
  return {id:row.id,name:row.name,org:git.org,repo:git.repo};
}
function same(a,b){
  return a.id===b.id&&a.name===b.name&&a.org===b.org&&a.repo===b.repo;
}
function context({db,connection,env,fetchImpl}){
  return {db,connection,env,fetchImpl,shape:compact,
    audit:x=>db.recordChange(x),replayStore:db.requestReplayStore(),
    guardProtected:targets=>checkProtected(targets,{db,connection,env}),
    guardApp:targets=>checkApp(targets,{db,connection,env})};
}
const create=defineWrite({
  name:'vercel_deploy_create_from_git',risk:{spend:true},
  async before(args,ctx){
    check(args);
    if(ctx.connection?.profile!=='full')throw new TypeError('Full profile required');
    const {client,account}=await readProvider(ctx);
    if(account.scope==='project'&&account.project_id!==args.project)
      throw new TypeError('Project outside connected scope');
    const row=await client.request('projects_get',{path:{idOrName:args.project}});
    const checked=sourceProject(args.project,row);
    if(checked.name!==args.expectedName||
      row.accountId!=null&&row.accountId!==account.team_id)
      throw new TypeError('Vercel project or team changed');
    const body={name:checked.name,project:checked.name,
      gitSource:{type:'github',org:checked.org,repo:checked.repo,
        ref:args.gitRef,sha:args.gitSha},target:args.target};
    validateRequest('deployments_create',{query:{teamId:'team_FAKE_validation'},body});
    return {...checked,target:args.target,ref:args.gitRef,sha:args.gitSha,
      teamId:account.team_id};
  },
  async preview(_args,_ctx,before){
    return 'Create '+before.target+' deployment of '+before.name+
      ' ('+before.id+') from exact linked GitHub commit '+before.sha+
      ' at '+before.ref+'. This triggers metered build usage; '+
      'execution follows the account purchase policy (owner word or owner grant).';
  },
  async production(_args,_ctx,before){
    return {production:before.target==='production',
      why:'The exact requested deployment target is binding'};
  },
  async targets(_args,before){
    return [{kind:'project',id:before.id,name:before.name}];
  },
  async spend(){
    return {cents:null,recurring:true,
      description:'Git-triggered build incurs unbounded usage-based build charges'};
  },
  async apply(_args,ctx,before,requestKey){
    const provider=await writeProvider(ctx);
    await requirePreDispatch(async()=>{
      if(provider.account.team_id!==before.teamId||
        provider.account.scope==='project'&&provider.account.project_id!==before.id)
        throw new TypeError('Team/project credential changed');
      const row=await provider.read('projects_get',{path:{idOrName:before.id}});
      if(!same(sourceProject(before.id,row),before)||
        row.accountId!=null&&row.accountId!==before.teamId)
        throw new TypeError('Git-linked project identity changed');
      // Purchase authority (AUD-A2): a consumed owner grant on the grant
      // path, or the executor's owner-word delegation on an owner
      // connection whose policy does not require a grant.
      if(!purchaseDelegationFor(ctx,'vercel_deploy_create_from_git',requestKey)){
        if(ctx.purchaseApproval?.operation!=='vercel_deploy_create_from_git'||
          ctx.purchaseApproval.requestKey!==requestKey)
          throw new TypeError('Independent purchase authorization missing');
        const ticket=await ctx.db.getPurchaseIntent({
          account:ctx.connection.account,reference:ctx.purchaseApproval.reference});
        if(ticket?.status!=='consumed'||!ticket.consumed_at)
          throw new TypeError('Owner purchase approval not consumed');
      }
    });
    return provider.write('deployments_create',{
      body:{name:before.name,project:before.name,
        gitSource:{type:'github',org:before.org,repo:before.repo,
          ref:before.ref,sha:before.sha},target:before.target}
    },{requestKey,tool:'vercel_deploy_create_from_git',shapeResult:row=>{
      const id=row?.id??row?.uid;
      // The documented create response has an in-progress shape with
      // no projectId (AUD-L): it must match when carried; the durable
      // project proof is verify()'s read-back of the full object.
      if(typeof id!=='string'||!/^dpl_[A-Za-z0-9_-]{3,120}$/.test(id)||
        ((row.projectId??row.project?.id)!=null&&
         (row.projectId??row.project?.id)!==before.id))
        throw new TypeError('Created Git deployment response identity unverified');
      // No target arm (AUD-N): see deployment-file-create — the
      // documented response target enum is production/staging/null.
      return {id};
    }});
  },
  async verify(_args,ctx,before,created){
    if(typeof created?.id!=='string')return {confirmed:null};
    const {client,account}=await readProvider(ctx);
    if(account.team_id!==before.teamId)return {confirmed:null};
    const row=await client.request('deployments_get',{path:{idOrUrl:created.id}});
    // Project identity is required when the read-back carries it,
    // top-level or as the reduced shape's nested project.id (AUD-M;
    // PR #255 review).
    return {confirmed:(row?.uid??row?.id)===created.id&&
      ((row.projectId??row.project?.id)==null||
       (row.projectId??row.project?.id)===before.id)&&
      deploymentTargetMatches(row.target,before.target),
      deployment:created.id};
  }
});
export const deploymentGitCreateTools={
  tools:[{name:'vercel_deploy_create_from_git',writes:true,guardedWrite:true,
    profiles:['full'],area:'deployments',
    description:'Create GitHub-linked deployment of an exact commit with verified project; metered cost follows the account purchase policy.',
    inputSchema,writeContract:create.writeContract,
    annotations:{readOnlyHint:false,destructiveHint:false}}],
  handlers:{vercel_deploy_create_from_git:bindGuardedWrite(create,context,result=>({
    isError:['refused_by_guard','outcome_unknown'].includes(result.status),
    content:[{type:'text',text:JSON.stringify(result)}]
  }))}
};
