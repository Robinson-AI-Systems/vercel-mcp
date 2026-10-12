// O-1a: only the encrypted, server-selected team's public, field-projected metadata.
// Project-only credentials cannot enumerate the broader team's security profile.
import {readProvider} from '../vercel/provider.js';
import {credentialLike} from '../core/util.js';
const PROFILES=['read_only','everyday','full'];
const schema={type:'object',properties:{},additionalProperties:false};
const text=value=>({content:[{type:'text',text:JSON.stringify(value)}]});
const TEAM_ID=/^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/;
function noArgs(args){
  if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).length)
    throw new TypeError('Team profile reads do not accept caller-supplied identifiers');
}
function safe(value,max=128){
  return typeof value==='string'&&value.length>0&&value.length<=max&&
    !/[\x00-\x1f\x7f]/.test(value)&&!credentialLike(value)?value:null;
}
function boolean(value){return typeof value==='boolean'?value:null;}
function identity(row,teamId){
  if(!row||typeof row!=='object'||Array.isArray(row)||
    row.id!==teamId||!TEAM_ID.test(row.id))
    throw new TypeError('Vercel team identity could not be verified');
}
function projectTeam(row,teamId){
  identity(row,teamId);
  return {id:teamId,name:safe(row.name,128),slug:safe(row.slug,128),
    description:safe(row.description,500),plan:safe(row.billing?.plan??row.plan,40),
    security:{
      samlEnforced:boolean(row.saml?.enforced),
      hideIpAddresses:boolean(row.hideIpAddresses),
      hideIpAddressesInLogDrains:boolean(row.hideIpAddressesInLogDrains),
      requireVerifiedCommits:boolean(row.requireVerifiedCommits),
      defaultDeploymentProtectionConfigured:row.defaultDeploymentProtection==null?null:
        typeof row.defaultDeploymentProtection==='object'&&!Array.isArray(row.defaultDeploymentProtection),
      remoteCaching:boolean(row.remoteCaching)
    },
    note:'Selected connected team only; all unlisted provider fields and security secrets withheld'};
}
async function selected(ctx){
  const {client,account}=await readProvider(ctx);
  if(!['team','full'].includes(account.scope)||!TEAM_ID.test(account.team_id))
    throw new TypeError('Team profile requires a team-scoped connection');
  return {client,teamId:account.team_id};
}
export const teamReadTools={
  tools:[
    {name:'vercel_team_list',writes:false,area:'teams',profiles:PROFILES,
      description:'List the selected connected team, never another team or security secrets.',
      inputSchema:schema,annotations:{readOnlyHint:true}},
    {name:'vercel_team_get',writes:false,area:'teams',profiles:PROFILES,
      description:'Inspect safely projected profile and security flags for the selected connected Vercel team.',
      inputSchema:schema,annotations:{readOnlyHint:true}}
  ],
  handlers:{
    async vercel_team_list(args,ctx){
      noArgs(args);
      const {client,teamId}=await selected(ctx);
      const page=await client.request('teams_list',{query:{limit:100}});
      if(!Array.isArray(page?.teams)||page.teams.length>100)
        throw new TypeError('Vercel team inventory unavailable');
      const team=page.teams.find(row=>row?.id===teamId);
      if(!team)throw new TypeError('Connected team was not verified on the bounded provider page');
      if(page.teams.filter(row=>row?.id===teamId).length!==1)
        throw new TypeError('Duplicate connected team identity');
      return text({teams:[projectTeam(team,teamId)],count:1,
        onlyConnectedTeam:true,providerPageComplete:page.pagination?.next===null});
    },
    async vercel_team_get(args,ctx){
      noArgs(args);
      const {client,teamId}=await selected(ctx);
      const row=await client.request('teams_get',{path:{teamId}});
      return text({team:projectTeam(row,teamId),onlyConnectedTeam:true});
    }
  }
};
