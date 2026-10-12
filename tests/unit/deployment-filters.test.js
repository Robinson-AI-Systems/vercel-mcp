import {describe,it,expect,vi,beforeEach} from 'vitest';
import {makeFakeVercel} from '../../test/helpers/fake-vercel.js';
import {deploymentReadTools} from '../../src/tools/deployments.js';
import {dispatchReadOnlyTool} from '../../src/core/mcp-server.js';
import {mergeNamespaces} from '../../src/core/registry.js';
import {loadToken} from '../../src/vercel/tokens.js';
vi.mock('../../src/vercel/tokens.js',async orig=>({...await orig(),loadToken:vi.fn()}));
const registry=mergeNamespaces([deploymentReadTools]);
const conn={account:'acct_ONE',profile:'read_only',mode:'preview',listing:'catalog'};
const db={getAccountCredential:async()=>({})};
const invoke=(a,f)=>dispatchReadOnlyTool({registry,name:'vercel_deploy_list',
  args:a,connection:conn,db,fetchImpl:f.fetch});
const parse=r=>JSON.parse(r.content[0].text);
const item=(overrides={})=>({uid:'dpl_FAKE101',projectId:'prj_ONE',readyState:'ERROR',
 target:'preview',created:1720000000000,meta:{githubCommitSha:'abcdef0123456789',
 githubCommitRef:'feature/diagnose'},...overrides});
describe('D-2 safe filtered deployment diagnostics',()=>{
 beforeEach(()=>{vi.clearAllMocks();loadToken.mockResolvedValue({token:'vcp_FAKE',
  account:{id:'acct_ONE',team_id:'team_ONE',scope:'project',project_id:'prj_ONE'}});});
 it('forwards pinned official selectors with stored project/team and preserves next page',async()=>{
   const fake=makeFakeVercel();
   fake.when('GET','/v7/deployments').resolves({deployments:[item()],
     pagination:{next:1720000000000}});
   const result=parse(await invoke({limit:3,state:'ERROR',target:'preview',
     branch:'feature/diagnose',sha:'abcdef0123456789',since:1710000000000},fake));
   expect(result).toMatchObject({count:1,project:'prj_ONE',next:1720000000000,
    filters:{state:'ERROR',target:'preview',branch:'feature/diagnose',
      sha:'abcdef0123456789',since:1710000000000}});
   expect(result.nextStep).toContain('same filters');
   expect(fake.calls[0].query).toMatchObject({teamId:'team_ONE',projectId:'prj_ONE',
     limit:'3',state:'ERROR',target:'preview',branch:'feature/diagnose',
     sha:'abcdef0123456789',since:'1710000000000'});
   fake.verify();
 });
 it('does not invent rows that violate the requested filter',async()=>{
  for(const change of [
    {readyState:'READY'},
    {projectId:'prj_OTHER'},
    {meta:{githubCommitSha:'fffffff',githubCommitRef:'feature/diagnose'}}
  ]){
   const fake=makeFakeVercel();
   fake.when('GET','/v7/deployments').resolves({deployments:[item(change)],
     pagination:{next:null}});
   const res=await invoke({state:'ERROR',sha:'abcdef0123456789'},fake);
   expect(res.isError).toBe(true);fake.verify();
  }
 });
 it('rejects invalid branch, SHA, state, time and cross-project data before provider access',async()=>{
   const fake=makeFakeVercel();
   for(const args of [
     {project:'prj_OTHER'}, {state:'FAILED'}, {target:'live'},
     {sha:'not-hex'}, {branch:'../secrets'}, {branch:'vcp_FAKE_secret'},
     {since:1720000000000,until:1710000000000},
     {since:-5},{state:'READY',teamId:'team_OTHER'}
   ])expect((await invoke(args,fake)).isError).toBe(true);
   expect(fake.calls).toHaveLength(0);
 });
 it('accepts an empty filtered page with truthful completion, no inferred deployment',async()=>{
   const fake=makeFakeVercel();
   fake.when('GET','/v7/deployments').resolves({deployments:[],pagination:{next:null}});
   const x=parse(await invoke({state:'ERROR'},fake));
   expect(x).toMatchObject({count:0,complete:true,next:null,filters:{state:'ERROR'}});
   fake.verify();
 });
});
