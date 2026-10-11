// Expose only guarded proposals; authentication and mutations remain on owner setup.
import {ownerProposal,ownerWriteContext} from './owner-proposals.js';
const defaultRequest=ownerProposal('vercel_set_default_account','default');
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
  }],
  handlers:{
    async vercel_set_default_account(args,{connection,db,env}){
      return text(await defaultRequest.run(args,ownerWriteContext({connection,db,env})));
    }
  }
};
