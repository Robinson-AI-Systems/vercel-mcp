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
// AUD-AB: vercel_team_get alone accepts one optional identifier. Absent (or
// undefined) keeps the O-1 selected-team read byte-identical; a different id
// is an account-layer read gated on the stored scope in the handler.
function requestedTeamId(args){
  if(!args||typeof args!=='object'||Array.isArray(args)||
    Object.keys(args).some(key=>key!=='teamId'))
    throw new TypeError('Team get accepts only an optional teamId');
  if(args.teamId===undefined)return null;
  if(typeof args.teamId!=='string'||!TEAM_ID.test(args.teamId))
    throw new TypeError('Invalid team identifier');
  return args.teamId;
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
  return {client,account,teamId:account.team_id};
}
export const teamReadTools={
  tools:[
    {name:'vercel_team_list',writes:false,area:'teams',profiles:PROFILES,
      description:'List the selected connected team, never another team or security secrets.',
      inputSchema:schema,annotations:{readOnlyHint:true}},
    {name:'vercel_team_get',writes:false,area:'teams',profiles:PROFILES,
      description:'Inspect safely projected profile and security flags for the selected connected Vercel team.',
      inputSchema:{type:'object',properties:{teamId:{type:'string'}},additionalProperties:false},
      annotations:{readOnlyHint:true}},
    {name:'vercel_account_teams',writes:false,area:'teams',profiles:PROFILES,
      description:'List every team an account-wide credential can see, safely projected, with the selected team marked.',
      inputSchema:schema,annotations:{readOnlyHint:true}}
  ],
  handlers:{
    async vercel_team_list(args,ctx){
      noArgs(args);
      const {client,teamId}=await selected(ctx);
      const page=await client.request('teams_list_unscoped',{query:{limit:100}});
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
      const requested=requestedTeamId(args);
      const {client,account,teamId}=await selected(ctx);
      const target=requested??teamId;
      if(target!==teamId&&account.scope!=='full')
        throw new TypeError('Reading another team requires an account-wide (Full Account) connection');
      const row=await client.request('teams_get',{path:{teamId:target}});
      const team=projectTeam(row,target);
      if(target!==teamId)
        team.note='Account-wide read of a team other than the selected one; all unlisted provider fields and security secrets withheld';
      return text({team,onlyConnectedTeam:target===teamId});
    },
    // AUD-AB: the cross-team read A-13 needs, fixed at the root without
    // breaking O-1 — vercel_team_list stays seat-bound for narrow seats;
    // this sibling read is the account layer's own surface (IN-16).
    async vercel_account_teams(args,ctx){
      noArgs(args);
      const {client,account,teamId}=await selected(ctx);
      if(account.scope!=='full')
        throw new TypeError('Listing every team is an account-layer read; this seat cannot reach the account layer');
      const page=await client.request('teams_list_unscoped',{query:{limit:100}});
      if(!Array.isArray(page?.teams)||page.teams.length>100)
        throw new TypeError('Vercel team inventory unavailable');
      const seen=new Set();
      for(const row of page.teams){
        if(!row||typeof row.id!=='string'||!TEAM_ID.test(row.id)||seen.has(row.id))
          throw new TypeError('Vercel team inventory could not be verified');
        seen.add(row.id);
      }
      if(page.teams.filter(row=>row.id===teamId).length!==1)
        throw new TypeError('Connected team was not verified on the bounded provider page');
      const teams=page.teams.map(row=>({...projectTeam(row,row.id),
        selected:row.id===teamId,
        note:'Account-wide team list; all unlisted provider fields and security secrets withheld'}));
      return text({teams,count:teams.length,
        providerPageComplete:page.pagination?.next===null});
    }
  }
};
