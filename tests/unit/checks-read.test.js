import {describe,it,expect,vi,beforeEach} from 'vitest';
import {makeFakeVercel} from '../../test/helpers/fake-vercel.js';
import {checksReadTools} from '../../src/tools/checks.js';
import {dispatchReadOnlyTool} from '../../src/core/mcp-server.js';
import {mergeNamespaces} from '../../src/core/registry.js';
import {loadToken} from '../../src/vercel/tokens.js';
vi.mock('../../src/vercel/tokens.js',async original=>({...await original(),loadToken:vi.fn()}));
const registry=mergeNamespaces([checksReadTools]);
const ctx={account:'acct_1',mode:'preview',profile:'read_only',listing:'catalog'};
const db={getAccountCredential:async()=>({})};
const project='prj_ONE',deployment='dpl_ABC123',run='run_123';
const call=(tool,args,f)=>dispatchReadOnlyTool({registry,name:tool,args,connection:ctx,db,fetchImpl:f.fetch});
const parse=r=>JSON.parse(r.content[0].text);
const parent=f=>f.when('GET','/v13/deployments/{idOrUrl}')
  .resolves({uid:deployment,projectId:project});
describe('D-2c Checks V2 project and deployment bounded reads',()=>{
 beforeEach(()=>{vi.clearAllMocks();
   loadToken.mockResolvedValue({token:'vcp_FAKE_TOKEN',account:{
     id:'acct_1',team_id:'team_1',scope:'project',project_id:project}});
 });
 it('lists deployment check runs with safe statuses and no raw output or URLs',async()=>{
   const f=makeFakeVercel();parent(f);
   f.when('GET','/v2/deployments/{deploymentId}/check-runs').resolves({runs:[{
     id:run,projectId:project,deploymentId:deployment,name:'lint',status:'completed',
     conclusion:'success',output:{secret:'vcp_FAKE_NEVER_OUTPUT'},
     externalUrl:'https://example.test?token=vcp_FAKE'}]});
   const data=parse(await call('vercel_check_list_runs',{deployment},f));
   expect(data.items).toMatchObject([{id:run,status:'completed',conclusion:'success',
     outputAvailable:true}]);
   expect(data.completeness).toBe('unverified_provider_page');
   expect(JSON.stringify(data)).not.toContain('vcp_FAKE_NEVER_OUTPUT');
   expect(f.calls.map(x=>x.method)).toEqual(['GET','GET']);
   expect(f.calls[1].query.teamId).toBe('team_1');
   f.verify();
 });
 it('verifies exact run identifier and project before returning selected data',async()=>{
   const f=makeFakeVercel();parent(f);
   f.when('GET','/v2/deployments/{deploymentId}/check-runs/{checkRunId}')
     .resolves({id:run,projectId:project,deploymentId:deployment,
       status:'completed',conclusion:'failed',output:{password:'PRIVATE'}});
   const data=parse(await call('vercel_check_get_run',{deployment,run},f));
   expect(data.run).toMatchObject({id:run,conclusion:'failed'});
   expect(data.rawOutputIncluded).toBe(false);
   expect(JSON.stringify(data)).not.toContain('PRIVATE');
   expect(f.calls[1].params).toMatchObject({deploymentId:deployment,checkRunId:run});
   f.verify();
 });
 it('refuses a wrong run ID, an altered project, or changed provider deployment identity',async()=>{
   const f=makeFakeVercel();parent(f);
   f.when('GET','/v2/deployments/{deploymentId}/check-runs/{checkRunId}')
     .resolves({id:'run_OTHER',projectId:project,deploymentId:deployment});
   expect((await call('vercel_check_get_run',{deployment,run},f)).isError).toBe(true);
   const no=makeFakeVercel();no.when('GET','/v13/deployments/{idOrUrl}')
     .resolves({uid:deployment,projectId:'prj_OTHER'});
   expect((await call('vercel_check_list_runs',{deployment},no)).isError).toBe(true);
   expect(no.calls).toHaveLength(1);
 });
 it('independently binds configured project checks to a project-scoped credential',async()=>{
   const f=makeFakeVercel();
   f.when('GET','/v9/projects/{idOrName}').resolves({id:project});
   f.when('GET','/v2/projects/{projectIdOrName}/checks').resolves({
     availableNativeChecks:[],checks:[{id:'chk_1',projectId:project,
       name:'smoke',blocks:'deployment-start'}]});
   const data=parse(await call('vercel_check_list_project_checks',{},f));
   expect(data.items[0]).toMatchObject({id:'chk_1',name:'smoke'});
   expect(f.calls[1].params.projectIdOrName).toBe(project);
   expect(f.calls[1].query.teamId).toBe('team_1');
   expect((await call('vercel_check_list_project_checks',{project:'prj_OTHER'},f)).isError)
     .toBe(true);
   expect(f.calls).toHaveLength(2);
 });
 it('rejects mismatched project-check response rows and unknown request keys',async()=>{
   const f=makeFakeVercel();
   f.when('GET','/v9/projects/{idOrName}').resolves({id:project});
   f.when('GET','/v2/projects/{projectIdOrName}/checks').resolves({
     availableNativeChecks:[],checks:[{id:'chk_1',projectId:'prj_OTHER'}]});
   expect((await call('vercel_check_list_project_checks',{},f)).isError).toBe(true);
   const another=makeFakeVercel();
   expect((await call('vercel_check_list_runs',{deployment,teamId:'team_OTHER'},another))
     .isError).toBe(true);
   expect(another.calls).toHaveLength(0);
 });
});
