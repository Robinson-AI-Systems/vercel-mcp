// A direct MCP owner operation proposes a pass; it never issues a bearer.
import {defineWrite} from '../core/write.js';
import {ownerWriteContext} from './owner-proposals.js';
import {passScope,requestPass,inspectPassRequest} from '../vercel/pass-requests.js';
const props={mode:{type:'string',enum:['preview','test']},hours:{type:'integer',minimum:1,maximum:720},
  areas:{type:'array',minItems:1,maxItems:12,items:{type:'string',maxLength:48},uniqueItems:true},
  confirm:{type:'boolean'},dryRun:{type:'boolean'},requestKey:{type:'string',pattern:'^[a-zA-Z0-9_-]{8,128}$'}};
const known=registry=>['server',...new Set(registry.tools.filter(t=>t.writes===false).map(t=>t.area).filter(Boolean))];
const proposal=defineWrite({
 name:'vercel_create_pass',approvalOnly:true,
 async before(args,ctx){
   if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).some(k=>!Object.hasOwn(props,k))||
     ['confirm','dryRun'].some(k=>args[k]!==undefined&&typeof args[k]!=='boolean')||
     args.requestKey!==undefined&&(typeof args.requestKey!=='string'||!/^[a-zA-Z0-9_-]{8,128}$/.test(args.requestKey))||
     ctx.env?.VERCEL_ENV!=='production'||ctx.connection?.profile!=='full')throw new TypeError('Owner pass proposal unavailable');
   const account=ctx.connection.account;
   if(!(await ctx.db.listVercelAccounts()).some(x=>x.id===account))throw new TypeError('Configured account required');
   return {account,scope:passScope(Object.fromEntries(['mode','hours','areas'].filter(k=>args[k]!==undefined).map(k=>[k,args[k]])),known(ctx.registry))};
 },
 async preview(_args,_ctx,before){
   return 'Request owner approval for '+before.scope.hours+'-hour read-only '+before.scope.mode+
     ' pass on '+before.account+'; areas: '+before.scope.areas.join(', ')+
     '; zero spending and no writes; TEST is service identity only. No bearer issued until owner reviews and reenters passphrase on setup.';
 },
 async production(){return {production:true,why:'Owner credential administration'};},
 async targets(_args,before){return [{kind:'account',id:before.account}];},
 async apply(_args,ctx,before){return requestPass({db:ctx.db,env:ctx.env,account:before.account,scope:before.scope});},
 async verify(_args,ctx,before,issued){
   const saved=await inspectPassRequest({db:ctx.db,env:ctx.env,account:before.account,
     reference:issued.reference,knownAreas:known(ctx.registry)});
   return {confirmed:saved?.account===before.account&&
     JSON.stringify(saved.areas)===JSON.stringify(before.scope.areas)&&
     saved.hours===before.scope.hours&&saved.mode===before.scope.mode};
 }
});
export const passProposalTools={tools:[{
 name:'vercel_create_pass',writes:true,localAdmin:true,profiles:['full'],
 description:'Propose an exact read-only pass; owner review and fresh passphrase required. No bearer, spending, or writes granted by the proposal.',
 inputSchema:{type:'object',properties:props,additionalProperties:false},writeContract:proposal.writeContract,
 annotations:{readOnlyHint:false,destructiveHint:false}
}],handlers:{async vercel_create_pass(args,{db,env,connection,registry}){
 const result=await proposal.run(args,{...ownerWriteContext({db,env,connection}),registry});
 return {isError:['refused_by_guard','outcome_unknown'].includes(result.status),content:[{type:'text',text:JSON.stringify(result)}]};
}}};
