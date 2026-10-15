// D-4: bounded alias and last-promotion observability for selected projects.
import {projectContext,releaseAliases,respond,schema,exactArgs,safeAlias,ALIASID} from './release-common.js';
const profiles=['read_only','everyday','full'];
export const releaseReadTools={
  tools:[
    {name:'vercel_deploy_list_promote_aliases',writes:false,area:'releases',
      profiles,
      description:'Show only safely projected alias routing status for the latest project promote.',
      inputSchema:schema({project:{type:'string'}},['project']),
      annotations:{readOnlyHint:true}},
    {name:'vercel_alias_list',writes:false,area:'releases',profiles,
      description:'Bounded project-owned alias names and exact deployment mappings with verified completeness.',
      inputSchema:schema({project:{type:'string'}},['project']),
      annotations:{readOnlyHint:true}},
    {name:'vercel_alias_get',writes:false,area:'releases',profiles,
      description:'Read an exact alias or domain and independently prove selected-project ownership.',
      inputSchema:schema({project:{type:'string'},alias:{type:'string'}},
        ['project','alias']),annotations:{readOnlyHint:true}}
  ],
  handlers:{
    async vercel_alias_list(args,ctx){
      exactArgs(args,['project']);
      const {client,project}=await projectContext(args,ctx);
      const page=await client.request('release_aliases_list',
        {query:{projectId:project,limit:100}});
      const aliases=releaseAliases(page,project);
      return respond({project,aliases:aliases.slice(0,20),
        shown:Math.min(20,aliases.length),capped:aliases.length>20,
        complete:aliases.length<=20,hasSecrets:false});
    },
    async vercel_alias_get(args,ctx){
      exactArgs(args,['project','alias']);
      if(!ALIASID.test(args.alias??'')&&!safeAlias(args.alias))
        throw new TypeError('Invalid exact alias identifier');
      const {client,project}=await projectContext(args,ctx);
      const row=await client.request('release_alias_get',
        {path:{idOrAlias:args.alias},query:{projectId:project}});
      const aliases=releaseAliases({aliases:[row],pagination:{next:null}},project);
      if(aliases.length!==1||![
        aliases[0].id,aliases[0].domain
      ].includes(args.alias))throw new TypeError('Alias identity drift');
      return respond({project,alias:aliases[0],hasSecrets:false});
    },
    async vercel_deploy_list_promote_aliases(args,ctx){
      exactArgs(args,['project']);
      const {client,project}=await projectContext(args,ctx);
      const page=await client.request('release_promote_aliases',
        {path:{projectId:project},query:{limit:100}});
      const source=Array.isArray(page)?page:page?.aliases??page?.data;
      if(!Array.isArray(source)||source.length>100)
        throw new TypeError('Current promote status cannot be read');
      const seen=new Set();
      const rows=source.map(row=>{
        const domain=safeAlias(row?.alias??row?.domain??row?.name);
        if(row?.projectId!=null&&row.projectId!==project||seen.has(domain))
          throw new TypeError('Promotion alias owner or identity unverified');
        seen.add(domain);
        return {domain,status:typeof row.status==='string'&&
          ['pending','failed','assigned','ready','success'].includes(row.status)?
          row.status:null};
      });
      return respond({project,aliases:rows.slice(0,20),
        complete:false,shown:Math.min(rows.length,20),
        note:'Latest promotion status is a bounded snapshot, not final traffic confirmation'});
    }
  }
};
