// M-3: integrations and storage (design BATCH-M M3; dossier
// batch-m-dossier-2026-10-30.md). The pinned contract is lossy in
// exactly the places this family touches: the store schema documents
// no identity fields (S-2), marketplace plan prices are strings
// (S-6), and resource identity is internalId (S-5). The tools return
// documented fields always, conditional fields only when the
// provider actually sends them, and say which sources answered —
// nothing is filled in. Provider secrets (the direct-create
// response's `secrets` block, resource protocolSettings/metadata)
// are dropped in the shapers and never reach a result or journal.
import {defineWrite,bindGuardedWrite,requirePreDispatch,RefusalError} from '../core/write.js';
import {compact,credentialLike} from '../core/util.js';
import {readProvider,writeProvider} from '../vercel/provider.js';
import {checkProtected} from './self-guard.js';
import {checkApp} from './app-guard.js';
import {validateRequest} from '../vercel/openapi-validation.js';

const READ=['read_only','everyday','full'];
const REQUEST_KEY=/^[a-zA-Z0-9_-]{8,128}$/;
const ANY_ID=/^[A-Za-z0-9_-]{3,128}$/;
const PROJECT_ID=/^prj_[A-Za-z0-9_-]{3,124}$/;
const control=/[\x00-\x1f\x7f]/;
const RESULT_STORE_CAP=1048576;
const PRICING='https://vercel.com/pricing';
const REGIONS=['arn1','bom1','cdg1','cle1','cpt1','dub1','dxb1','fra1','gru1',
  'hkg1','hnd1','iad1','icn1','kix1','lhr1','pdx1','sfo1','sin1','syd1','yul1'];
const ENVIRONMENTS=['production','preview','development'];
const output=x=>({content:[{type:'text',text:JSON.stringify(compact(x,RESULT_STORE_CAP))}]});
const schema=(properties,required=[])=>({type:'object',properties,required,additionalProperties:false});
function strictArgs(args,keys,what){
  if(!args||typeof args!=='object'||Array.isArray(args)||
    Object.keys(args).some(k=>!keys.includes(k)))
    throw new RefusalError('Unsupported '+what+' selector');
}
function safeText(value,max){
  return typeof value==='string'&&value.length>0&&value.length<=max&&
    !control.test(value)&&!credentialLike(value);
}
function safeLabel(value,max=128){
  return safeText(value,max)?value:null;
}
function shapeConfiguration(raw){
  if(!raw||typeof raw!=='object'||typeof raw.id!=='string'||!ANY_ID.test(raw.id))
    return null;
  return {
    id:raw.id,
    integrationId:typeof raw.integrationId==='string'?raw.integrationId:null,
    slug:safeLabel(raw.slug,128),
    name:safeLabel(raw.integration?.name,128),
    status:typeof raw.status==='string'?raw.status:null,
    scopes:Array.isArray(raw.scopes)?raw.scopes.slice(0,30)
      .filter(s=>typeof s==='string'):[],
    projects:Array.isArray(raw.projects)?raw.projects.slice(0,50)
      .filter(p=>typeof p==='string'):[],
    installationType:typeof raw.installationType==='string'?
      raw.installationType:null,
    disabledReason:typeof raw.disabledReason==='string'?raw.disabledReason:null,
    createdAt:typeof raw.createdAt==='number'?raw.createdAt:null,
    updatedAt:typeof raw.updatedAt==='number'?raw.updatedAt:null
  };
}
function shapeResource(raw){
  if(!raw||typeof raw!=='object')return null;
  return {
    resourceId:typeof raw.internalId==='string'?raw.internalId:null,
    name:safeLabel(raw.name,128),
    productId:typeof raw.productId==='string'?raw.productId:null,
    status:typeof raw.status==='string'?raw.status:null,
    billingPlanId:typeof raw.billingPlanId==='string'?raw.billingPlanId:null
  };
}
async function getConfiguration(client,id){
  let raw;
  try{raw=await client.request('integrations_configuration_get',{path:{id}});}
  catch(error){
    if(error?.status===404)
      throw new RefusalError('Integration installation was not found on the selected team');
    if(error?.status===403)
      throw new RefusalError('This credential cannot access that integration installation');
    throw error;
  }
  const shaped=shapeConfiguration(raw);
  if(!shaped)throw new RefusalError('Integration installation metadata was not recognized');
  return {raw,shaped};
}
async function listResources(client,id){
  const page=await client.request('installations_resources_list',
    {path:{integrationConfigurationId:id}});
  if(!page||!Array.isArray(page.resources))
    throw new RefusalError('Integration resources were not recognized');
  return page.resources.slice(0,50).map(shapeResource).filter(Boolean);
}
function shapeStore(raw,requestedId){
  if(!raw||typeof raw!=='object')
    throw new RefusalError('Store metadata was not recognized');
  const projects=Array.isArray(raw.projectsMetadata)?raw.projectsMetadata
    .slice(0,50).map(p=>({
      projectId:typeof p?.projectId==='string'?p.projectId:null,
      name:safeLabel(p?.name,128),
      environments:Array.isArray(p?.environments)?p.environments
        .filter(e=>typeof e==='string').slice(0,5):[],
      environmentVariableNames:Array.isArray(p?.environmentVariables)?
        p.environmentVariables.filter(v=>typeof v==='string').slice(0,50):[]
    })):[];
  return {
    storeId:typeof raw.id==='string'?raw.id:requestedId,
    idReported:typeof raw.id==='string',
    name:safeLabel(raw.name,128),
    type:typeof raw.type==='string'?raw.type:
      typeof raw.kind==='string'?raw.kind:null,
    status:typeof raw.status==='string'?raw.status:null,
    region:typeof raw.region==='string'?raw.region:null,
    size:typeof raw.size==='number'?raw.size:null,
    access:typeof raw.access==='string'?raw.access:null,
    usageQuotaExceeded:typeof raw.usageQuotaExceeded==='boolean'?
      raw.usageQuotaExceeded:null,
    totalConnectedProjects:typeof raw.totalConnectedProjects==='number'?
      raw.totalConnectedProjects:null,
    fileCount:typeof raw.count==='number'?raw.count:null,
    projects,
    connectedProjectIds:projects.map(p=>p.projectId).filter(Boolean)
  };
}
async function getStore(client,id){
  let page;
  try{page=await client.request('storage_store_get',{path:{id}});}
  catch(error){
    if(error?.status===404)
      throw new RefusalError('Store was not found');
    if(error?.status===403)
      throw new RefusalError('This credential cannot access that store');
    throw error;
  }
  return shapeStore(page?.store,id);
}
async function resolveProject(client,idOrName){
  if(!safeText(idOrName,128))
    throw new RefusalError('Project selector is missing or unsafe');
  let row;
  try{row=await client.request('projects_get',{path:{idOrName}});}
  catch(error){
    if(error?.status===404)
      throw new RefusalError('Project was not found on the selected team');
    if(error?.status===403)
      throw new RefusalError('This credential cannot access that project');
    throw error;
  }
  if(!row||typeof row.id!=='string'||!PROJECT_ID.test(row.id))
    throw new RefusalError('Project identity could not be verified');
  return {id:row.id,name:safeLabel(row.name,128)};
}

/* ------------------------------- reads ------------------------------- */
export const integrationsStorageReadTools={
  tools:[
    {name:'vercel_integration_list',writes:false,area:'integrations',profiles:READ,
      description:'Installed integrations on the selected team: status, scopes, projects and product identity.',
      inputSchema:schema({
        installationType:{type:'string',enum:['marketplace','external','provisioning']},
        integration:{type:'string',minLength:1,maxLength:128}}),
      annotations:{readOnlyHint:true}},
    {name:'vercel_integration_get',writes:false,area:'integrations',profiles:READ,
      description:'One installation: permissions, connected projects, resources and the billing plans the records name.',
      inputSchema:schema({id:{type:'string'}},['id']),
      annotations:{readOnlyHint:true}},
    {name:'vercel_storage_get_store',writes:false,area:'storage',profiles:READ,
      description:'One storage store: status and connected projects always; size and region only when the provider reports them.',
      inputSchema:schema({storeId:{type:'string'}},['storeId']),
      annotations:{readOnlyHint:true}}
  ],
  handlers:{
    async vercel_integration_list(args,ctx){
      strictArgs(args,['installationType','integration'],'integration list');
      const {client}=await readProvider(ctx);
      const query={view:'account'};
      if(args.installationType)query.installationType=args.installationType;
      if(args.integration){
        if(!safeText(args.integration,128))
          throw new RefusalError('Integration selector is unsafe');
        query.integrationIdOrSlug=args.integration;
      }
      validateRequest('integrations_configurations_list',{query});
      const page=await client.request('integrations_configurations_list',{query});
      if(!Array.isArray(page))
        throw new RefusalError('Integration inventory was not recognized');
      const shaped=page.map(shapeConfiguration);
      const rows=shaped.filter(Boolean);
      return output({integrations:rows,shown:rows.length,
        providerRows:page.length,skipped:page.length-rows.length,
        note:'Rows without a usable identity are counted as skipped, never silently dropped'});
    },
    async vercel_integration_get(args,ctx){
      strictArgs(args,['id'],'integration get');
      if(typeof args.id!=='string'||!ANY_ID.test(args.id))
        throw new RefusalError('Invalid integration installation identifier');
      const {client}=await readProvider(ctx);
      const {raw,shaped}=await getConfiguration(client,args.id);
      const resources=await listResources(client,args.id);
      const planIds=[...new Set(resources.map(r=>r.billingPlanId).filter(Boolean))];
      const transferPlan=raw.transferRequest?.billingPlan&&
        typeof raw.transferRequest.billingPlan==='object'?
        {id:typeof raw.transferRequest.billingPlan.id==='string'?
            raw.transferRequest.billingPlan.id:null,
          name:safeLabel(raw.transferRequest.billingPlan.name,128),
          type:typeof raw.transferRequest.billingPlan.type==='string'?
            raw.transferRequest.billingPlan.type:null}:null;
      return output({configuration:shaped,resources,
        billingPlanIds:planIds,transferBillingPlan:transferPlan,
        sources:{resources:true,
          transferPlan:transferPlan!==null},
        note:'Billing plan identity comes from the resources and the transfer request when present; resource metadata is never returned'});
    },
    async vercel_storage_get_store(args,ctx){
      strictArgs(args,['storeId'],'store get');
      if(typeof args.storeId!=='string'||!ANY_ID.test(args.storeId))
        throw new RefusalError('Invalid store identifier');
      const {client}=await readProvider(ctx);
      const store=await getStore(client,args.storeId);
      return output({store,
        note:'The pinned store contract documents no identity, size or region fields; they are reported only when the provider includes them'});
    }
  }
};

/* ------------------------------- writes ------------------------------ */
function ctxFor({db,connection,env,fetchImpl}){
  return {db,connection,env,fetchImpl,shape:compact,
    audit:x=>db.recordChange(x),replayStore:db.requestReplayStore(),
    checkSpend:declaration=>declaration.cents===0?
      {allowed:true,code:'allowed',explanation:'No charge for this change'}:
      {allowed:false,code:'owner_required',explanation:'Owner purchase grant required'},
    guardProtected:targets=>checkProtected(targets,{db,connection,env}),
    guardApp:targets=>checkApp(targets,{db,connection,env})};
}
const resultMapper=result=>({
  isError:['refused_by_guard','outcome_unknown'].includes(result.status),
  content:[{type:'text',text:JSON.stringify(result)}]
});
const flags={
  confirm:{type:'boolean'},dryRun:{type:'boolean'},
  requestKey:{type:'string',pattern:REQUEST_KEY.source}
};
function flagsCheck(args,props){
  if(!args||typeof args!=='object'||Array.isArray(args)||
    Object.keys(args).some(k=>!Object.hasOwn(props,k))||
    (args.confirm!==undefined&&typeof args.confirm!=='boolean')||
    (args.dryRun!==undefined&&typeof args.dryRun!=='boolean')||
    (args.requestKey!==undefined&&
      (typeof args.requestKey!=='string'||!REQUEST_KEY.test(args.requestKey))))
    throw new RefusalError('Invalid write request');
}
const idProp={type:'string'};

/* integration remove */
const removeProps={id:idProp,...flags};
const integrationRemove=defineWrite({
  name:'vercel_integration_remove',
  async before(args,ctx){
    flagsCheck(args,removeProps);
    if(typeof args.id!=='string'||!ANY_ID.test(args.id))
      throw new RefusalError('Invalid integration installation identifier');
    const {client,account}=await readProvider(ctx);
    const {shaped}=await getConfiguration(client,args.id);
    const resources=await listResources(client,args.id);
    return {id:args.id,configuration:shaped,resources,
      teamId:account.team_id};
  },
  async preview(_args,_ctx,before){
    const c=before.configuration;
    return 'Uninstall integration '+(c.name??c.slug??before.id)+
      ' ('+before.id+', status '+(c.status??'unknown')+')'+
      '; connected projects: '+(c.projects.length?c.projects.join(', '):'none reported')+
      '; resources removed with it: '+
      (before.resources.length?
        before.resources.map(r=>r.name??r.resourceId??'unnamed').join(', '):'none reported')+
      '; Vercel removes the variables this integration injected — their names live on the linked stores\u2019 project metadata, not on this record, so they cannot be listed here';
  },
  async production(_args,_ctx,before){
    return {production:before.configuration.projects.length>0,
      why:before.configuration.projects.length>0?
        'The installation is connected to projects and may inject production variables (Cp)':
        'No connected projects are reported, so no production variables can be injected'};
  },
  async targets(_args,before){
    // The guard vocabulary has no integration kind; an installation
    // is an account-layer resource, so the account is the target.
    return [{kind:'account',id:before.teamId,
      name:before.configuration.name??before.id}];
  },
  async apply(_args,ctx,before,requestKey){
    const provider=await writeProvider(ctx);
    await requirePreDispatch(async()=>{
      if(provider.account.team_id!==before.teamId)
        throw new TypeError('Team authority changed');
    });
    return provider.write('integrations_configuration_delete',
      {path:{id:before.id}},
      {requestKey,tool:'vercel_integration_remove',
        shapeResult:()=>({configurationId:before.id})});
  },
  async verify(_args,ctx,before){
    const {client}=await readProvider(ctx);
    try{
      const row=await client.request('integrations_configuration_get',
        {path:{id:before.id}});
      return {confirmed:!(row&&row.id===before.id),configurationId:before.id};
    }catch(error){
      return {confirmed:error?.status===404?true:null,
        configurationId:before.id};
    }
  },
  async publicReceipt(_args,before){
    return {configurationId:before.id};
  }
});

/* integration connect resource */
const connectProps={
  configurationId:idProp,resourceId:idProp,project:idProp,
  environments:{type:'array',items:{type:'string',enum:ENVIRONMENTS},
    minItems:1,maxItems:3},
  makeEnvVarsSensitive:{type:'boolean'},
  ...flags
};
const integrationConnect=defineWrite({
  name:'vercel_integration_connect_resource',
  async before(args,ctx){
    flagsCheck(args,connectProps);
    if(typeof args.configurationId!=='string'||!ANY_ID.test(args.configurationId)||
      typeof args.resourceId!=='string'||!ANY_ID.test(args.resourceId))
      throw new RefusalError('Invalid integration resource selector');
    if(args.environments!==undefined&&
      (!Array.isArray(args.environments)||
        args.environments.some(e=>!ENVIRONMENTS.includes(e))))
      throw new RefusalError('Environments must be chosen from production, preview, development');
    const {client,account}=await readProvider(ctx);
    await getConfiguration(client,args.configurationId);
    const project=await resolveProject(client,args.project);
    const body={projectId:project.id,
      ...(args.environments?{envVarEnvironments:args.environments}:{}),
      ...(args.makeEnvVarsSensitive!==undefined?
        {makeEnvVarsSensitive:args.makeEnvVarsSensitive}:{})};
    validateRequest('installations_resource_connect',
      {path:{integrationConfigurationId:args.configurationId,
        resourceId:args.resourceId},body});
    return {configurationId:args.configurationId,resourceId:args.resourceId,
      project,body,teamId:account.team_id,
      environments:args.environments??null};
  },
  async preview(_args,_ctx,before){
    return 'Connect integration resource '+before.resourceId+
      ' to project '+(before.project.name??before.project.id)+
      ' for '+(before.environments?before.environments.join(', '):
        'the provider default environments')+
      '; the integration injects its variables into the project';
  },
  async production(_args,_ctx,before){
    const production=before.environments===null||
      before.environments.includes('production');
    return {production,
      why:production?
        'The environment selection includes or may include production (Cp)':
        'Only preview/development environments are targeted'};
  },
  async targets(_args,before){
    return [{kind:'project',id:before.project.id,
      name:before.project.name??before.project.id}];
  },
  async apply(_args,ctx,before,requestKey){
    const provider=await writeProvider(ctx);
    await requirePreDispatch(async()=>{
      if(provider.account.team_id!==before.teamId)
        throw new TypeError('Team authority changed');
    });
    return provider.write('installations_resource_connect',
      {path:{integrationConfigurationId:before.configurationId,
        resourceId:before.resourceId},body:before.body},
      {requestKey,tool:'vercel_integration_connect_resource',
        shapeResult:()=>({configurationId:before.configurationId,
          resourceId:before.resourceId,projectId:before.project.id})});
  },
  async verify(_args,ctx,before){
    const {client}=await readProvider(ctx);
    try{
      const {raw}=await getConfiguration(client,before.configurationId);
      const listed=Array.isArray(raw.projects)&&
        raw.projects.includes(before.project.id);
      return {confirmed:Array.isArray(raw.projects)?listed:null,
        projectId:before.project.id};
    }catch{return {confirmed:null,projectId:before.project.id};}
  },
  async publicReceipt(_args,before){
    return {configurationId:before.configurationId,
      resourceId:before.resourceId,projectId:before.project.id};
  }
});

/* integration create store */
const createStoreProps={
  configurationId:idProp,product:idProp,
  name:{type:'string',minLength:1,maxLength:128},
  billingPlanId:idProp,
  prepaymentAmountCents:{type:'integer',minimum:50},
  ...flags
};
function planPrice(plan){
  const parts=[];
  if(typeof plan.cost==='string')parts.push('cost '+plan.cost);
  if(typeof plan.initialCharge==='string')
    parts.push('initial charge '+plan.initialCharge);
  if(Array.isArray(plan.quote))
    for(const q of plan.quote.slice(0,4))
      if(q&&typeof q.amount==='string')
        parts.push((typeof q.line==='string'?q.line+': ':'quote: ')+q.amount);
  return parts.length?parts.join('; '):'price not stated by the provider';
}
function shapePlan(raw){
  if(!raw||typeof raw!=='object'||typeof raw.id!=='string')return null;
  return {id:raw.id,name:safeLabel(raw.name,128),
    type:typeof raw.type==='string'?raw.type:null,
    scope:typeof raw.scope==='string'?raw.scope:null,
    paymentMethodRequired:raw.paymentMethodRequired===true,
    price:planPrice(raw)};
}
const integrationCreateStore=defineWrite({
  name:'vercel_integration_create_store',risk:{spend:true},
  async before(args,ctx){
    flagsCheck(args,createStoreProps);
    if(typeof args.configurationId!=='string'||!ANY_ID.test(args.configurationId)||
      typeof args.product!=='string'||!ANY_ID.test(args.product))
      throw new RefusalError('Invalid integration store selector');
    if(!safeText(args.name,128))throw new RefusalError('Unsafe store name');
    const {client,account}=await readProvider(ctx);
    const {shaped}=await getConfiguration(client,args.configurationId);
    const integrationRef=shaped.integrationId??shaped.slug;
    if(!integrationRef)
      throw new RefusalError('The installation record names no integration to price against');
    const page=await client.request('integration_product_plans',
      {path:{integrationIdOrSlug:integrationRef,productIdOrSlug:args.product},
        query:{integrationConfigurationId:args.configurationId}});
    if(!page||!Array.isArray(page.plans))
      throw new RefusalError('Billing plans were not recognized');
    const plans=page.plans.map(shapePlan).filter(Boolean);
    const chosen=args.billingPlanId?
      plans.find(p=>p.id===args.billingPlanId)??null:null;
    if(args.billingPlanId&&!chosen)
      throw new RefusalError('Billing plan was not found for this product');
    if(chosen?.type==='prepayment'&&args.prepaymentAmountCents===undefined)
      throw new RefusalError('Prepayment plans need prepaymentAmountCents (the contract field, at least 50)');
    const body={name:args.name,integrationConfigurationId:args.configurationId,
      integrationProductIdOrSlug:args.product,
      ...(args.billingPlanId?{billingPlanId:args.billingPlanId}:{}),
      ...(args.prepaymentAmountCents!==undefined?
        {prepaymentAmountCents:args.prepaymentAmountCents}:{})};
    validateRequest('storage_integration_direct_create',{body});
    return {configurationId:args.configurationId,product:args.product,
      name:args.name,plans,chosen,body,teamId:account.team_id};
  },
  async preview(_args,_ctx,before){
    const list=before.plans.length?
      before.plans.slice(0,10).map(p=>p.id+' "'+(p.name??'')+'" ('+
        (p.type??'plan')+'): '+p.price).join(' | '):'none returned';
    return 'Create Marketplace store "'+before.name+'" on product '+
      before.product+
      (before.chosen?' on plan '+before.chosen.id+' ('+before.chosen.price+')':
        ' on the provider default plan')+
      '; plans the provider offers: '+list+
      '; the create response carries injected secrets — they are stored by Vercel and never shown here';
  },
  async production(){
    return {production:false,
      why:'Creating a store provisions a new resource; it changes no production project until connected'};
  },
  async spend(_args,_ctx,before){
    if(before.chosen?.type==='prepayment')
      return {cents:before.body.prepaymentAmountCents,recurring:false,
        description:'Prepayment for plan '+before.chosen.id+' ('+before.chosen.price+')'};
    if(before.chosen)
      return {cents:null,recurring:true,
        description:'Plan '+before.chosen.id+' is billed by the provider ('+
          before.chosen.price+'; '+PRICING+')'};
    return {cents:null,recurring:true,
      description:'Marketplace store on the provider default plan; plan prices are listed in the preview ('+PRICING+')'};
  },
  async targets(_args,before){
    return [{kind:'account',id:before.teamId,name:before.name}];
  },
  async apply(_args,ctx,before,requestKey){
    const provider=await writeProvider(ctx);
    await requirePreDispatch(async()=>{
      if(provider.account.team_id!==before.teamId)
        throw new TypeError('Team authority changed');
    });
    return provider.write('storage_integration_direct_create',
      {body:before.body},
      {requestKey,tool:'vercel_integration_create_store',shapeResult:row=>{
        const store=row?.store;
        if(!store||typeof store!=='object')
          throw new TypeError('Provider did not confirm the new store');
        // The response's `secrets` and `protocolSettings` are dropped
        // here: only identity fields cross into the result.
        return {storeId:typeof store.id==='string'?store.id:null,
          externalResourceId:typeof store.externalResourceId==='string'?
            store.externalResourceId:null,
          status:typeof store.status==='string'?store.status:null};
      }});
  },
  async verify(_args,ctx,before,applied){
    if(!applied.storeId)return {confirmed:null,storeId:null,
      note:'The create response named no store id the read endpoint can address'};
    const {client}=await readProvider(ctx);
    try{
      const store=await getStore(client,applied.storeId);
      return {confirmed:store.idReported,storeId:applied.storeId};
    }catch{return {confirmed:null,storeId:applied.storeId};}
  },
  async publicReceipt(_args,before,applied){
    return {storeId:applied.storeId,
      externalResourceId:applied.externalResourceId,name:before.name};
  }
});

/* blob store create */
const blobCreateProps={
  name:{type:'string',minLength:1,maxLength:70},
  region:{type:'string',enum:REGIONS},
  access:{type:'string',enum:['public','private']},
  projectId:idProp,
  ...flags
};
const blobStoreCreate=defineWrite({
  name:'vercel_storage_create_blob_store',risk:{spend:true},
  async before(args,ctx){
    flagsCheck(args,blobCreateProps);
    if(!safeText(args.name,70))throw new RefusalError('Unsafe Blob store name');
    const body={name:args.name,
      ...(args.region?{region:args.region}:{}),
      ...(args.access?{access:args.access}:{}),
      ...(args.projectId?{projectId:args.projectId}:{})};
    validateRequest('storage_blob_create',{body});
    const {account}=await readProvider(ctx);
    return {name:args.name,body,teamId:account.team_id};
  },
  async preview(_args,_ctx,before){
    return 'Create Blob store "'+before.name+'"'+
      (before.body.region?' in region '+before.body.region:'')+
      (before.body.access?' with '+before.body.access+' access':'')+
      '; storage and operations are billed beyond included usage ('+PRICING+')';
  },
  async production(){
    return {production:false,
      why:'A new empty store changes no production resource until a project connects to it'};
  },
  async spend(){
    return {cents:null,recurring:true,
      description:'Blob storage and operations are billed beyond included usage ('+PRICING+')'};
  },
  async targets(_args,before){
    return [{kind:'account',id:before.teamId,name:before.name}];
  },
  async apply(_args,ctx,before,requestKey){
    const provider=await writeProvider(ctx);
    await requirePreDispatch(async()=>{
      if(provider.account.team_id!==before.teamId)
        throw new TypeError('Team authority changed');
    });
    return provider.write('storage_blob_create',{body:before.body},
      {requestKey,tool:'vercel_storage_create_blob_store',shapeResult:row=>{
        const store=row?.store;
        if(!store||typeof store!=='object')
          throw new TypeError('Provider did not confirm the new Blob store');
        return {storeId:typeof store.id==='string'?store.id:null,
          region:typeof store.region==='string'?store.region:null,
          access:typeof store.access==='string'?store.access:null};
      }});
  },
  async verify(_args,ctx,before,applied){
    if(!applied.storeId)return {confirmed:null,storeId:null,
      note:'The create response named no store id the read endpoint can address'};
    const {client}=await readProvider(ctx);
    try{
      const store=await getStore(client,applied.storeId);
      return {confirmed:store.idReported,storeId:applied.storeId};
    }catch{return {confirmed:null,storeId:applied.storeId};}
  },
  async publicReceipt(_args,before,applied){
    return {storeId:applied.storeId,name:before.name,region:applied.region};
  }
});

/* blob store delete */
const blobDeleteProps={
  storeId:idProp,
  outsideApp:{type:'boolean'},
  ...flags
};
const blobStoreDelete=defineWrite({
  name:'vercel_storage_delete_blob_store',
  async before(args,ctx){
    flagsCheck(args,blobDeleteProps);
    if(typeof args.storeId!=='string'||!ANY_ID.test(args.storeId))
      throw new RefusalError('Invalid store identifier');
    const {client,account}=await readProvider(ctx);
    const store=await getStore(client,args.storeId);
    if(store.connectedProjectIds.length&&args.outsideApp!==true)
      throw new RefusalError('This store is connected to project(s) '+
        store.connectedProjectIds.join(', ')+
        '; deleting it is a store-level act, not one app\u2019s view — pass outsideApp: true to name it as such');
    validateRequest('storage_blob_delete',{path:{id:args.storeId}});
    return {storeId:args.storeId,store,teamId:account.team_id};
  },
  async preview(_args,_ctx,before){
    return 'Delete Blob store '+before.storeId+
      (before.store.fileCount!==null?' holding '+before.store.fileCount+' file(s)':'')+
      (before.store.connectedProjectIds.length?
        '; connected to project(s) '+before.store.connectedProjectIds.join(', '):'')+
      '; every file in the store is deleted; this cannot be undone';
  },
  async production(){
    return {production:false,
      why:'The store-level guard is the outsideApp naming; BATCH-B classes store deletion as destructive (D), not production-class'};
  },
  async targets(_args,before){
    return [{kind:'store',id:before.storeId,accountId:before.teamId,
      name:before.storeId}];
  },
  async apply(_args,ctx,before,requestKey){
    const provider=await writeProvider(ctx);
    await requirePreDispatch(async()=>{
      if(provider.account.team_id!==before.teamId)
        throw new TypeError('Team authority changed');
      const current=await getStore(providerAsClient(provider),before.storeId)
        .catch(()=>null);
      if(current&&current.connectedProjectIds.length&&
        !current.connectedProjectIds.every(id=>before.store.connectedProjectIds.includes(id)))
        throw new TypeError('Store connections changed after preview');
    });
    return provider.write('storage_blob_delete',{path:{id:before.storeId}},
      {requestKey,tool:'vercel_storage_delete_blob_store',shapeResult:row=>{
        if(row&&typeof row.id==='string'&&row.id!==before.storeId)
          throw new TypeError('Provider did not confirm the deleted store identity');
        return {storeId:before.storeId};
      }});
  },
  async verify(_args,ctx,before){
    const {client}=await readProvider(ctx);
    try{
      await client.request('storage_store_get',{path:{id:before.storeId}});
      return {confirmed:false,storeId:before.storeId};
    }catch(error){
      return {confirmed:error?.status===404?true:null,storeId:before.storeId};
    }
  },
  async publicReceipt(_args,before){
    return {storeId:before.storeId};
  }
});
function providerAsClient(provider){
  return {request:(id,params)=>provider.read(id,params)};
}

export const integrationsStorageWriteTools={
  tools:[
    {name:'vercel_integration_remove',writes:true,guardedWrite:true,
      area:'integrations',profiles:['full'],
      description:'Uninstall an integration; the preview lists its resources and connected projects, and production applies when projects are connected.',
      inputSchema:{type:'object',properties:removeProps,required:['id'],additionalProperties:false},
      writeContract:integrationRemove.writeContract,
      annotations:{readOnlyHint:false,destructiveHint:true,openWorldHint:true}},
    {name:'vercel_integration_connect_resource',writes:true,guardedWrite:true,
      area:'integrations',profiles:['full'],
      description:'Connect an integration resource to a project for chosen environments; production-class when production is targeted.',
      inputSchema:{type:'object',properties:connectProps,required:['configurationId','resourceId','project'],additionalProperties:false},
      writeContract:integrationConnect.writeContract,
      annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:true}},
    {name:'vercel_integration_create_store',writes:true,guardedWrite:true,
      area:'integrations',profiles:['full'],
      description:'Create a Marketplace store on a billing plan; the preview lists the plans with the provider\u2019s own price strings.',
      inputSchema:{type:'object',properties:createStoreProps,required:['configurationId','product','name'],additionalProperties:false},
      writeContract:integrationCreateStore.writeContract,
      annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:true}},
    {name:'vercel_storage_create_blob_store',writes:true,guardedWrite:true,
      area:'storage',profiles:['full'],
      description:'Create a Blob store; storage and operations are billed beyond included usage.',
      inputSchema:{type:'object',properties:blobCreateProps,required:['name'],additionalProperties:false},
      writeContract:blobStoreCreate.writeContract,
      annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:true}},
    {name:'vercel_storage_delete_blob_store',writes:true,guardedWrite:true,
      area:'storage',profiles:['full'],
      description:'Delete a Blob store and every file in it; a store connected to projects requires outsideApp to name the store-level act.',
      inputSchema:{type:'object',properties:blobDeleteProps,required:['storeId'],additionalProperties:false},
      writeContract:blobStoreDelete.writeContract,
      annotations:{readOnlyHint:false,destructiveHint:true,openWorldHint:true}}
  ],
  handlers:{
    vercel_integration_remove:bindGuardedWrite(integrationRemove,ctxFor,resultMapper),
    vercel_integration_connect_resource:bindGuardedWrite(integrationConnect,ctxFor,resultMapper),
    vercel_integration_create_store:bindGuardedWrite(integrationCreateStore,ctxFor,resultMapper),
    vercel_storage_create_blob_store:bindGuardedWrite(blobStoreCreate,ctxFor,resultMapper),
    vercel_storage_delete_blob_store:bindGuardedWrite(blobStoreDelete,ctxFor,resultMapper)
  }
};
