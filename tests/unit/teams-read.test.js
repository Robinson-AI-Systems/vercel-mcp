import {describe,it,expect,vi,beforeEach} from 'vitest';
import {makeFakeVercel} from '../../test/helpers/fake-vercel.js';
import {teamReadTools} from '../../src/tools/teams.js';
import {dispatchReadOnlyTool} from '../../src/core/mcp-server.js';
import {mergeNamespaces} from '../../src/core/registry.js';
import {loadToken} from '../../src/vercel/tokens.js';
vi.mock('../../src/vercel/tokens.js',async mod=>({...await mod(),loadToken:vi.fn()}));
const registry=mergeNamespaces([teamReadTools]);
const connection={account:'acct_TEAM',profile:'read_only',mode:'preview',listing:'catalog'};
const db={getAccountCredential:async()=>({})};
const team='team_ONE';
const invoke=(name,args,f)=>dispatchReadOnlyTool({registry,name,args,connection,db,fetchImpl:f.fetch});
const body=r=>JSON.parse(r.content[0].text);
const row={id:team,name:'Our Team',slug:'our-team',billing:{plan:'pro'},
  requireVerifiedCommits:true,hideIpAddresses:true,saml:{enforced:false,
    cert:'NEVER_EXPOSE'},inviteCode:'NEVER_EXPOSE'};
function provider(){
  const f=makeFakeVercel();
  f.when('GET','/v2/teams').resolves({teams:[row,
    {id:'team_OTHER',name:'PRIVATE_OTHER_TEAM'}],pagination:{next:null}});
  f.when('GET','/v2/teams/{teamId}').resolves(row);
  return f;
}
describe('O-1 team owner reads never escape a selected stored team',()=>{
 beforeEach(()=>{vi.clearAllMocks();loadToken.mockResolvedValue({token:'vcp_FAKE',
   account:{id:'acct_TEAM',team_id:team,scope:'team'}});});
 it('lists only the connected team, excludes other-team and credential-shaped details',async()=>{
   const f=provider();
   const result=body(await invoke('vercel_team_list',{},f));
   expect(result).toMatchObject({count:1,onlyConnectedTeam:true,
     teams:[{id:team,name:'Our Team',security:{requireVerifiedCommits:true}}]});
   expect(JSON.stringify(result)).not.toMatch(/PRIVATE_OTHER_TEAM|NEVER_EXPOSE|cert|inviteCode/);
   expect(f.calls[0]).toMatchObject({method:'GET',query:{limit:'100'}});
   expect(f.calls[0].query).not.toHaveProperty('teamId');
   f.verify();
 });
 it('GETs the exact server-held team and only exposes allowlisted security fields',async()=>{
   const f=provider();
   const result=body(await invoke('vercel_team_get',{},f));
   expect(result.team).toMatchObject({id:team,slug:'our-team',plan:'pro',
     security:{samlEnforced:false,hideIpAddresses:true}});
   expect(JSON.stringify(result)).not.toContain('NEVER_EXPOSE');
   expect(f.calls).toHaveLength(1);
   expect(f.calls[0]).toMatchObject({method:'GET',params:{teamId:team}});
   f.verify();
 });
 it('refuses cross-team result and missing or duplicate selected identity',async()=>{
   for(const reply of [{...row,id:'team_OTHER'},null]){
     const f=makeFakeVercel();
     f.when('GET','/v2/teams/{teamId}').resolves(reply);
     expect((await invoke('vercel_team_get',{},f)).isError).toBe(true);
   }
   const f=makeFakeVercel();
   f.when('GET','/v2/teams').resolves({teams:[row,row],pagination:{next:null}});
   expect((await invoke('vercel_team_list',{},f)).isError).toBe(true);
 });
 it('denies project-only connection and caller supplied team overrides before provider reads',async()=>{
   const f=provider();
   for(const args of [{teamId:'team_OTHER'},{limit:20},{project:'prj_OTHER'}])
     expect((await invoke('vercel_team_get',args,f)).isError).toBe(true);
   expect(f.calls).toHaveLength(0);
   loadToken.mockResolvedValueOnce({token:'vcp_FAKE',
     account:{id:'acct_TEAM',team_id:team,scope:'project',project_id:'prj_1'}});
   expect((await invoke('vercel_team_list',{},f)).isError).toBe(true);
   expect(f.calls).toHaveLength(0);
 });
 it('refuses unverified team inventory without claiming an empty account',async()=>{
   const f=makeFakeVercel();
   f.when('GET','/v2/teams').resolves({teams:[{id:'team_OTHER'}],pagination:{next:44}});
   expect((await invoke('vercel_team_list',{},f)).isError).toBe(true);
 });
});
