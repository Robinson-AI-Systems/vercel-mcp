// E-3: bounded selected-team Global Config metadata and safe item reads.
import {selected,exact,listRows,safeItems,output,schema,strictArgs,STORE} from './globalconfig-common.js';
const profile=['read_only','everyday','full'];
export const globalConfigReadTools={
  tools:[
    {name:'vercel_globalconfig_list',writes:false,area:'env',profiles:profile,
      description:'Bounded selected-team Global Config stores, optional proven links and counts, no token data.',
      inputSchema:schema({}),annotations:{readOnlyHint:true}},
    {name:'vercel_globalconfig_list_items',writes:false,area:'env',profiles:profile,
      description:'Inspect safe configuration items of one exact store; credential-shaped values are redacted.',
      inputSchema:schema({id:{type:'string',pattern:STORE.source}},['id']),
      annotations:{readOnlyHint:true}}
  ],
  handlers:{
    async vercel_globalconfig_list(args,ctx){
      strictArgs(args,[]);
      const {client,account}=await selected(ctx,true);
      const page=await client.request('global_config_list');
      const state=listRows(page,account.team_id);
      return output({teamScoped:true,items:state.rows.slice(0,20),
        shown:Math.min(20,state.rows.length),complete:state.complete&&
        state.rows.length<=20,capped:state.rows.length>20,
        next:state.next,hasTokens:false,
        note:'No read token or secret returned; unknown project links are shown as null'});
    },
    async vercel_globalconfig_list_items(args,ctx){
      strictArgs(args,['id']);
      const {client,row}=await exact(ctx,args.id);
      const raw=await client.request('global_config_items',{
        path:{edgeConfigId:row.id}});
      return output({store:row.id,...safeItems(raw),hasTokens:false});
    }
  }
};
