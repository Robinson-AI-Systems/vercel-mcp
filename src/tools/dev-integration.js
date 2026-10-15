// V-3: purely observational integration check for an authorized preview run.
// Never claim production configuration or unverified provider pagination is READY.
import {ownerRun,base,schema,reply,assertInput,safeText}
  from './dev-observe-common.js';
const ENV=/^[A-Z_][A-Z0-9_]{0,127}$/;
const ITEM=/^[A-Za-z0-9_.-]{1,100}$/;
const CRON=/^\/[A-Za-z0-9_/-]{1,119}$/;
const HOST=/^[a-z0-9][a-z0-9-]{3,96}\.vercel\.app$/;
const fields={...base,envNames:{type:'object',properties:{
  preview:{type:'array',items:{type:'string',pattern:ENV.source},maxItems:25},
  development:{type:'array',items:{type:'string',pattern:ENV.source},maxItems:25}
},additionalProperties:false},domains:{type:'array',items:{type:'string',pattern:HOST.source},maxItems:10},
  crons:{type:'array',items:{type:'string',maxLength:120},maxItems:10},
  nodeVersion:{type:'string',maxLength:40},
  framework:{type:'string',maxLength:60},
  protection:{type:'string',enum:['any','vercel-auth','standard']},
  needsBypass:{type:'boolean'},
  integrations:{type:'array',items:{type:'string',pattern:ITEM.source},maxItems:20}};
delete fields.deployment;
const nested=schema(fields,['project','runId']);
const inputSchema=schema({spec:nested},['spec']);
function exactSpec(a){
  if(!a||typeof a!=='object'||Array.isArray(a)||
     Object.keys(a).length!==1||!a.spec||
     typeof a.spec!=='object'||Array.isArray(a.spec))throw new TypeError('Exact integration spec required');
  const s=a.spec;
  assertInput(s,Object.keys(fields),nested.required);
  const checks=[
    [s.envNames, ['preview','development']],
    [s.domains,['domain']], [s.crons,['cron']], [s.integrations,['integration']]
  ];
  for(const [obj,keys] of checks){
    if(obj===undefined)continue;
    if(!obj||typeof obj!=='object'||Array.isArray(obj)!==(!['preview','development'].includes(keys[0])))
      throw new TypeError('Invalid typed integration inventory request');
    if(Array.isArray(obj)&&obj.length>25)throw new TypeError('Inventory size exceeded');
    if(!Array.isArray(obj)&&Object.keys(obj).some(k=>!keys.includes(k)))
      throw new TypeError('Production environment targets are prohibited for preview inspection');
  }
  for(const field of ['preview','development']){
    const names=s.envNames?.[field];
    if(names!==undefined&&(!Array.isArray(names)||names.length>25||
       names.some(x=>typeof x!=='string'||!ENV.test(x))||
       new Set(names).size!==names.length))
      throw new TypeError('Invalid preview/development variable names');
  }
  if(s.domains!==undefined&&(!Array.isArray(s.domains)||
     s.domains.some(x=>typeof x!=='string'||!HOST.test(x)||
       !x.startsWith('rtc-'+s.runId.replaceAll('_','-')+'-'))||
     new Set(s.domains).size!==s.domains.length))
    throw new TypeError('Only declared preview-space domains may be inspected');
  for(const k of ['crons','integrations']){
    const list=s[k];
    if(list!==undefined&&(!Array.isArray(list)||list.length>20||
       list.some(x=>typeof x!=='string'||!(k==='crons'?CRON:ITEM).test(x))||new Set(list).size!==list.length))
      throw new TypeError('Invalid bounded integration names');
  }
  if(!(s.envNames?.preview?.length||s.envNames?.development?.length||
    s.domains?.length||s.crons?.length||s.integrations?.length||
    s.nodeVersion!==undefined||s.framework!==undefined||
    s.protection!==undefined||s.needsBypass===true))
    throw new TypeError('Declare at least one preview integration requirement');
  if(s.nodeVersion!==undefined&&(typeof s.nodeVersion!=='string'||s.nodeVersion.length>40)||
     s.framework!==undefined&&(typeof s.framework!=='string'||s.framework.length>60)||
     s.protection!==undefined&&!['any','vercel-auth','standard'].includes(s.protection)||
     s.needsBypass!==undefined&&typeof s.needsBypass!=='boolean')
    throw new TypeError('Invalid expected preview compatibility');
  return s;
}
function completePage(x,field,max=100){
  if(!Array.isArray(x?.[field])||x[field].length>max||
     !x.pagination||x.pagination.next!==null||
     x.pagination.count!==x[field].length||
     x.pagination.hasNext===true||x.pagination.hasMore===true)
    return null;
  return x[field];
}
function row(type,name,status,reason,fix){
  return {type,name,status,reason,fix};
}
function compare(expected,actual){
  return actual==null?'unverified':expected===actual?'ok':'missing';
}
export const devIntegrationTools={
  tools:[{name:'vercel_dev_check_integration',area:'developer',writes:false,
    profiles:['read_only','everyday','full'],
    description:'Check typed preview integration prerequisites without touching production, secret values or provider settings.',
    inputSchema,annotations:{readOnlyHint:true}}],
  handlers:{
    async vercel_dev_check_integration(args,ctx){
      const s=exactSpec(args);
      const b=await ownerRun(ctx,s);
      const result=[];
      const needsEnv=(s.envNames?.preview?.length??0)+(s.envNames?.development?.length??0)>0;
      const needsDomain=Boolean(s.domains?.length);
      const [environment,domain]=await Promise.all([
        needsEnv?b.client.request('project_env_list',
          {path:{idOrName:s.project},query:{decrypt:'false'}}):Promise.resolve(null),
        needsDomain?b.client.request('projects_domains_list',
          {path:{idOrName:s.project}}):Promise.resolve(null)
      ]);
      const envRows=needsEnv?completePage(environment,'envs',500):[];
      const domainRows=needsDomain?completePage(domain,'domains',100):[];
      for(const kind of ['preview','development']){
        for(const key of s.envNames?.[kind]??[]){
          const actual=envRows?.find(x=>x?.key===key&&
            (Array.isArray(x.target)?x.target:[x.target]).includes(kind));
          result.push(row('env:'+kind,key,envRows===null?'unverified':actual?'ok':'missing',
            envRows===null?'Vercel did not prove a complete variable inventory':
              actual?'Variable name exists; value never inspected':'Required name was not observed',
            'Use the owner-approved env workflow for this target; never copy values into chat'));
        }
      }
      for(const host of s.domains??[]){
        const found=domainRows?.find(x=>(x.name??x.domain)===host);
        result.push(row('preview-domain',host,domainRows===null?'unverified':found?'ok':'missing',
          domainRows===null?'Domain inventory not complete':found?'Provider listed the preview host':'Preview hostname not observed',
          'Use an explicitly authorized preview alias tool, not a live domain operation'));
      }
      const cronDefs=b.raw.crons?.definitions;
      for(const path of s.crons??[]){
        // Cron schedules execute in production, not on previews. The build
        // configuration may be observed but can never prove preview execution.
        result.push(row('cron-config',path,Array.isArray(cronDefs)?'not_applicable':'unverified',
          'Vercel cron jobs do not execute on preview deployments',
          'Verify the route using a separate preview smoke fetch, not a production cron trigger'));
      }
      if(s.framework!==undefined){
        const actual=typeof b.raw.framework==='string'?b.raw.framework:null;
        result.push(row('framework',s.framework,compare(s.framework,actual),
          actual===null?'Provider framework setting unavailable':'Observed project framework preset',
          'Change framework only through the separate guarded project settings workflow'));
      }
      if(s.nodeVersion!==undefined){
        const actual=typeof b.raw.nodeVersion==='string'?b.raw.nodeVersion:null;
        result.push(row('node-version',s.nodeVersion,compare(s.nodeVersion,actual),
          actual===null?'Provider runtime setting unavailable':'Observed project Node version',
          'Review package engines and the guarded preview-compatible project setting'));
      }
      if(s.protection!==undefined&&s.protection!=='any'){
        const actual=typeof b.raw.ssoProtection==='string'?b.raw.ssoProtection:null;
        result.push(row('protection',s.protection,compare(s.protection,actual),
          actual===null?'Provider protection state is not fully attested':'Observed protection setting',
          'Use owner setup to review access and authentication; no implicit protection changes'));
      }
      if(s.needsBypass===true){
        const objs=await ctx.db.listDevRunObjects({account:ctx.connection.account,id:s.runId});
        const recorded=objs.some(x=>x.object_type==='bypass'&&
          x.project_id===s.project&&x.status==='active');
        const providerProof=b.raw.protectionBypass&&typeof b.raw.protectionBypass==='object';
        result.push(row('automation-bypass','owner-managed',recorded&&providerProof?'ok':'unverified',
          'Bypass presence is checked by metadata only; the private credential is never returned',
          'Request a scoped one-time bypass through the authenticated owner setup path'));
      }
      for(const name of s.integrations??[]){
        result.push(row('integration',safeText(name,100),'unverified',
          'Project details do not authoritatively prove third-party integration authorization',
          'Inspect the named integration through its own authorized provider connection'));
      }
      const ready=result.every(x=>x.status==='ok'||x.status==='not_applicable');
      return reply({runId:s.runId,project:s.project,ready,
        rows:result,checked:result.length,unverified:result.filter(x=>x.status==='unverified').length,
        containsValues:false,modified:false,
        note:'Read-only preview configuration observation; does not activate production or authorize changes'});
    }
  }
};
