// V-2 branch previews: exact linked Git identity and a metered build fail-closed under IN-08.
import {defineWrite,bindGuardedWrite,requirePreDispatch,purchaseDelegationFor, RefusalError } from '../core/write.js';
import {readProvider} from '../vercel/provider.js';
import {validateRequest} from '../vercel/openapi-validation.js';
import {deploymentProjectSettings,isFirstDeployment} from '../vercel/project-settings.js';
import {deploymentTargetMatches} from '../vercel/deployment-target.js';
import {common,exact,owned,safeBranch,SHA,DEPLOY,context,respond,
  startRun,preIntent,record,markIntent,selectedWrite} from './dev-preview-common.js';
import {previewBranchRefusal} from './app-guard.js';
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
       await previewBranchRefusal({db:ctx.db,account:ctx.connection?.account,
         branch:a.gitRef,outsideApp:a.outsideApp}))
      throw new RefusalError('Prohibited no-preview branch or ambiguous commit reference');
    const b=await owned(a,ctx);
    const {client}=await readProvider(ctx);
    const row=await client.request('projects_get',{path:{idOrName:b.project}});
    const git=row?.link;
    if(git?.type!=='github'||!REPO.test(git.org??'')||!REPO.test(git.repo??''))
      throw new RefusalError('Project must have verified linked GitHub origin');
    // projectSettings are required for a project's FIRST deployment and
    // saved by the provider for later ones (vendored OpenAPI description;
    // src/vercel/project-settings.js states the shape once). A git-source
    // create that omits them against a settings-less project is refused
    // 400 missing_project_settings (AUD-BS; VMCP-016 branch G, live
    // 2026-11-02: the retained fixture reads framework null, every build
    // field null, never deployed). AUD-AD's rule governs the shape: send
    // them ONLY when this create is that first deployment, echoing the
    // record's own stored fields (null = provider auto-detects; for
    // framework, null selects no framework, the contract's honest value
    // for a project whose record carries none — "other" is not in the
    // pinned enum). On a deployed project the provider inherits its
    // saved settings and the body stays exactly as before. AUD-BZ: the
    // first-deployment proof is isFirstDeployment — the record's flag
    // when present, the provider's deployment inventory when the live
    // record omits the flag (the retained fixture's record omits it,
    // which is why AUD-BS never fired live).
    const firstDeployment=await isFirstDeployment(client,b.project,row);
    const body={name:b.name,project:b.name,target:'preview',
      gitSource:{type:'github',org:git.org,repo:git.repo,ref:a.gitRef,sha:a.gitSha},
      meta:{rtc_run:b.runId},
      ...(firstDeployment?
        {projectSettings:deploymentProjectSettings(row)}:{})};
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
    const intent=await preIntent(ctx,b,'deployment',b.sha,{project:b.project,ref:b.ref});
    const created=await provider.write('deployments_create',{body:b.body},
      {tool:'vercel_dev_preview_branch',requestKey:key,mutationId:'branch-'+b.sha,
        shapeResult:row=>{
          const id=row?.id??row?.uid;
          // Identity only, no target arm (AUD-CA, mirroring AUD-N in
          // vercel_deploy_create_from_files): the provider PROMOTES a
          // project's first deployment to target production, so a
          // first-ever branch preview's create response legitimately
          // carries target 'production'. Judging the target here
          // converted that successful create into outcome_unknown and
          // skipped the record below, orphaning a READY deployment
          // from its run (live conviction, 2026-11-03, retained
          // branch-G fixture: deployment created READY while the tool
          // reported response_shape_unverified). verify() reports
          // the target honestly instead.
          if(!DEPLOY.test(id??'')||row.projectId!==b.project)
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
      // deploymentTargetMatches states the documented encoding once:
      // a preview read-back carries target null (or 'preview'); a
      // provider-promoted first deployment carries 'production' and
      // honestly confirms false, the AUD-AL posture — the deployment
      // stays recorded either way.
      if((row?.uid??row?.id)!==r.id||row.projectId!==b.project||
        !deploymentTargetMatches(row.target,'preview'))
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
