// A direct MCP owner operation proposes a pass; it never issues a bearer.
import {defineWrite, RefusalError } from '../core/write.js';
import {ownerWriteContext} from './owner-proposals.js';
import {passScope,writePassScope,requestPass,inspectPassRequest} from '../vercel/pass-requests.js';
const props={mode:{type:'string',enum:['preview','test','production']},hours:{type:'integer',minimum:1,maximum:720},
  areas:{type:'array',minItems:1,maxItems:12,items:{type:'string',maxLength:48},uniqueItems:true},
  rateLimitPerMinute:{type:'integer',minimum:1,maximum:600},
  writes:{type:'boolean'},profile:{type:'string',enum:['everyday','full']},
  spendLimitCents:{type:'integer',minimum:0,maximum:2147483647},
  projectIds:{type:'array',minItems:1,maxItems:50,items:{type:'string',maxLength:128},uniqueItems:true},
  confirm:{type:'boolean'},dryRun:{type:'boolean'},requestKey:{type:'string',pattern:'^[a-zA-Z0-9_-]{8,128}$'}};
const known=registry=>['server',...new Set(registry.tools.filter(t=>t.writes===false).map(t=>t.area).filter(Boolean))];
const knownAll=registry=>['server',...new Set(registry.tools.map(t=>t.area).filter(Boolean))];
const proposal=defineWrite({
 name:'vercel_create_pass',approvalOnly:true,
 async before(args,ctx){
   if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).some(k=>!Object.hasOwn(props,k))||
     ['confirm','dryRun','writes'].some(k=>args[k]!==undefined&&typeof args[k]!=='boolean')||
     args.requestKey!==undefined&&(typeof args.requestKey!=='string'||!/^[a-zA-Z0-9_-]{8,128}$/.test(args.requestKey))||
     ctx.env?.VERCEL_ENV!=='production'||ctx.connection?.profile!=='full')throw new RefusalError('Owner pass proposal unavailable');
   const account=ctx.connection.account;
   if(!(await ctx.db.listVercelAccounts()).some(x=>x.id===account))throw new RefusalError('Configured account required');
   const pick=keys=>Object.fromEntries(keys.filter(k=>args[k]!==undefined).map(k=>[k,args[k]]));
   // R-1W: the write form is a distinct scope, validated against every tool
   // area; write-only arguments on a read proposal refuse rather than
   // being silently dropped.
   if(args.writes===true)
     return {account,scope:writePassScope(pick(['writes','profile','mode','hours','areas','rateLimitPerMinute','spendLimitCents','projectIds']),knownAll(ctx.registry))};
   if(args.profile!==undefined||args.spendLimitCents!==undefined||args.projectIds!==undefined)
     throw new RefusalError('Owner pass proposal unavailable');
   return {account,scope:passScope(pick(['mode','hours','areas','rateLimitPerMinute']),known(ctx.registry))};
 },
 async preview(_args,_ctx,before){
   if(before.scope.writes===true)
     return 'Request owner approval for '+before.scope.hours+'-hour write-capable '+before.scope.mode+
       ' pass ('+before.scope.profile+' profile) on '+before.account+'; areas: '+before.scope.areas.join(', ')+
       '; max '+before.scope.rateLimitPerMinute+' calls/minute; spend ceiling '+
       (before.scope.spendLimitCents===0?'$0.00 (spending refused)':'$'+(before.scope.spendLimitCents/100).toFixed(2))+
       '; projects: '+(before.scope.projectIds?before.scope.projectIds.join(', '):'no restriction')+
       '. No bearer issued until owner reviews and reenters passphrase on setup.';
   return 'Request owner approval for '+before.scope.hours+'-hour read-only '+before.scope.mode+
     ' pass on '+before.account+'; areas: '+before.scope.areas.join(', ')+
     '; max '+before.scope.rateLimitPerMinute+' calls/minute; zero spending and no writes; TEST is service identity only. No bearer issued until owner reviews and reenters passphrase on setup.';
 },
 async production(){return {production:true,why:'Owner credential administration'};},
 async targets(_args,before){return [{kind:'account',id:before.account}];},
 async apply(_args,ctx,before){return requestPass({db:ctx.db,env:ctx.env,account:before.account,scope:before.scope});},
 async verify(_args,ctx,before,issued){
   const saved=await inspectPassRequest({db:ctx.db,env:ctx.env,account:before.account,
     reference:issued.reference,knownAreas:known(ctx.registry),knownWriteAreas:knownAll(ctx.registry)});
   if(before.scope.writes===true)
     return {confirmed:saved?.version===2&&saved.account===before.account&&
       saved.profile===before.scope.profile&&
       JSON.stringify(saved.areas)===JSON.stringify(before.scope.areas)&&
       saved.hours===before.scope.hours&&saved.mode===before.scope.mode&&
       saved.rateLimitPerMinute===before.scope.rateLimitPerMinute&&
       saved.spendLimitCents===before.scope.spendLimitCents&&
       JSON.stringify(saved.projectIds)===JSON.stringify(before.scope.projectIds)};
   return {confirmed:saved?.account===before.account&&
     JSON.stringify(saved.areas)===JSON.stringify(before.scope.areas)&&
     saved.hours===before.scope.hours&&saved.mode===before.scope.mode&&
     saved.rateLimitPerMinute===before.scope.rateLimitPerMinute};
 }
});
export const passProposalTools={tools:[{
 name:'vercel_create_pass',writes:true,localAdmin:true,profiles:['full'],
 description:'Propose an exact RTC pass: read-only, or write-capable with a profile, spend ceiling and optional project restriction. Owner review and passphrase required.',
 inputSchema:{type:'object',properties:props,additionalProperties:false},writeContract:proposal.writeContract,
 annotations:{readOnlyHint:false,destructiveHint:false}
}],handlers:{async vercel_create_pass(args,{db,env,connection,registry}){
 const result=await proposal.run(args,{...ownerWriteContext({db,env,connection}),registry});
 return {isError:['refused_by_guard','outcome_unknown'].includes(result.status),content:[{type:'text',text:JSON.stringify(result)}]};
}}};
