// Expose only guarded proposals; authentication and mutations remain on owner setup.
import {ownerProposal,ownerWriteContext} from './owner-proposals.js';
const defaultRequest=ownerProposal('vercel_set_default_account','default');
const spendRequest=ownerProposal('vercel_set_spend_limit','spend');
const text=payload=>({isError:['refused_by_guard','outcome_unknown'].includes(payload.status),
  content:[{type:'text',text:JSON.stringify(payload)}]});
export const ownerTools={
  tools:[{
    name:'vercel_set_default_account',writes:true,localAdmin:true,profiles:['full'],
    description:'Propose a global default Vercel account; a separately authenticated owner must review and approve on setup.',
    inputSchema:{type:'object',properties:{
      account:{type:'string',minLength:3,maxLength:256},
      dryRun:{type:'boolean'},confirm:{type:'boolean'}
    },required:['account'],additionalProperties:false},
    annotations:{readOnlyHint:false,destructiveHint:false},
    writeContract:defaultRequest.writeContract
  },{
    name:'vercel_set_spend_limit',writes:true,localAdmin:true,profiles:['full'],
    description:'Propose an exact daily spending limit in integer USD cents; owner approval required, no purchase made.',
    inputSchema:{type:'object',properties:{
      limitCents:{type:'integer',minimum:0,maximum:2147483647},
      dryRun:{type:'boolean'},confirm:{type:'boolean'}
    },required:['limitCents'],additionalProperties:false},
    annotations:{readOnlyHint:false,destructiveHint:false},
    writeContract:spendRequest.writeContract
  }],
  handlers:{
    async vercel_set_default_account(args,{connection,db,env}){
      return text(await defaultRequest.run(args,ownerWriteContext({connection,db,env})));
    },
    async vercel_set_spend_limit(args,{connection,db,env}){
      return text(await spendRequest.run(args,ownerWriteContext({connection,db,env})));
    }
  }
};
