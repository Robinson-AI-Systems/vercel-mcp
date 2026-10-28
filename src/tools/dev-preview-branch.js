// V-2 branch previews: exact linked Git identity and a metered build fail-closed under IN-08.
import {defineWrite,bindGuardedWrite,requirePreDispatch,purchaseDelegationFor} from '../core/write.js';
import {readProvider} from '../vercel/provider.js';
import {validateRequest} from '../vercel/openapi-validation.js';
import {common,exact,owned,safeBranch,noPreview,SHA,DEPLOY,context,respond,
  startRun,preIntent,record,markIntent,selectedWrite} from './dev-preview-common.js';
const props={...common,gitRef:{type:'string',minLength:1,maxLength:128},
  gitSha:{type:'string',pattern:SHA.source}};
const schema={type:'object',properties:props,required:['runId','project','gitRef','gitSha'],
  additionalProperties:false};
const REPO=/^[A-Za-z0-9_.-]{1,100}$/;
const branch=defineWrite({
  name:'vercel_dev_preview_branch',risk:{spend:true},
  async before(a,ctx){
    exact(a,props,schema.required);
    if(!safeBranch(a.gitRef)||!SHA.test(a.gitSha)||
       noPreview(a.gitRef,a.outsideApp))
      throw new TypeError('Prohibited no-preview branch or ambiguous commit reference');
    const b=await owned(a,ctx);
    const {client}=await readProvider(ctx);
    const row=await client.request('projects_get',{path:{idOrName:b.project}});
    const git=row?.link;
    if(git?.type!=='github'||!REPO.test(git.org??'')||!REPO.test(git.repo??''))
      throw new TypeError('Project must have verified linked GitHub origin');
    const body={name:b.name,project:b.name,target:'preview',
      gitSource:{type:'github',org:git.org,repo:git.repo,ref:a.gitRef,sha:a.gitSha},
      meta:{rtc_run:b.runId}};
    validateRequest('deployments_create',{query:{teamId:b.teamId},body});
    return {...b,body,ref:a.gitRef,sha:a.gitSha,org:git.org,repo:git.repo};
  },
  async preview(_a,_ctx,b){
    return 'Deploy exact GitHub '+b.org+'/'+b.repo+'@'+b.sha+' ('+b.ref+
      ') as recorded preview in '+b.project+'. Build usage is metered; execution follows the account purchase policy (owner word or owner grant).';
  },
  async production(){return {production:false,why:'Preview target only'};},
  async spend(){return {cents:null,recurring:true,
    description:'Git preview build has no provider-enforced lifetime charge maximum'};},
  async targets(_a,b){return [{kind:'project',id:b.project,name:b.name}];},
  async apply(_a,ctx,b,key){
    const provider=await selectedWrite(ctx,b);
    await requirePreDispatch(async()=>{
      // Purchase authority (AUD-A2): a consumed owner grant on the grant
      // path, or the executor's owner-word delegation on an owner
      // connection whose policy does not require a grant.
      if(!purchaseDelegationFor(ctx,'vercel_dev_preview_branch',key)&&
        (ctx.purchaseApproval?.operation!=='vercel_dev_preview_branch'||
         ctx.purchaseApproval.requestKey!==key))
        throw new TypeError('No independently authenticated metered purchase grant');
      const row=await provider.read('projects_get',{path:{idOrName:b.project}});
      if(row.link?.org!==b.org||row.link?.repo!==b.repo||row.link?.type!=='github')
        throw new TypeError('Linked Git repository changed');
    });
    await startRun(ctx,b);
    const intent=await preIntent(ctx,b,'deployment',b.gitSha,{project:b.project,ref:b.ref});
    const created=await provider.write('deployments_create',{body:b.body},
      {tool:'vercel_dev_preview_branch',requestKey:key,mutationId:'branch-'+b.sha,
        shapeResult:row=>{
          const id=row?.id??row?.uid;
          if(!DEPLOY.test(id??'')||row.projectId!==b.project||row.target!=='preview')
            throw new TypeError('Provider did not attest a preview deployment');
          return {id};
        }});
    await record(ctx,b,'deployment',created.id,{target:'preview',ref:b.ref,sha:b.sha});
    await markIntent(ctx,b,intent);
    return {id:created.id};
  },
  async verify(_a,ctx,b,r){
    if(!DEPLOY.test(r?.id??''))return {confirmed:null};
    const {client,account}=await readProvider(ctx);
    if(account.team_id!==b.teamId)return {confirmed:null};
    // Bounded 45-second readback. Pending deploy remains recorded; caller may
    // use D-2 deployment status later without rerunning the charged POST.
    const deadline=Date.now()+45000;
    let row;
    do{
      row=await client.request('deployments_get',{path:{idOrUrl:r.id}});
      if((row?.uid??row?.id)!==r.id||row.projectId!==b.project||row.target!=='preview')
        return {confirmed:false};
      if(['READY','ERROR','CANCELED'].includes(row.readyState))break;
      if(Date.now()+2000>deadline)break;
      await new Promise(resolve=>setTimeout(resolve,2000));
    }while(Date.now()<deadline);
    const objects=await ctx.db.listDevRunObjects({account:ctx.connection.account,id:b.runId});
    return {confirmed:row.readyState==='READY'&&
      objects.some(o=>o.object_type==='deployment'&&o.object_id===r.id),
      deploymentId:r.id,state:row.readyState};
  }
});
export const devPreviewBranchTools={
  tools:[{name:'vercel_dev_preview_branch',area:'developer',writes:true,guardedWrite:true,
    profiles:['full'],inputSchema:schema,writeContract:branch.writeContract,
    description:'Preview a scoped Git branch/commit with durable run tracking; metered builds remain gated.',
    annotations:{readOnlyHint:false,destructiveHint:false}}],
  handlers:{vercel_dev_preview_branch:bindGuardedWrite(branch,context,respond)}
};
