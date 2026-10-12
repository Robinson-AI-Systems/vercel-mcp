import {describe,it,expect,vi,beforeEach,afterEach} from 'vitest';
import {makeFakeVercel} from '../../test/helpers/fake-vercel.js';
import {deploymentReadTools} from '../../src/tools/deployments.js';
import {dispatchReadOnlyTool} from '../../src/core/mcp-server.js';
import {mergeNamespaces} from '../../src/core/registry.js';
import {loadToken} from '../../src/vercel/tokens.js';
vi.mock('../../src/vercel/tokens.js',async original=>({...await original(),loadToken:vi.fn()}));
const registry=mergeNamespaces([deploymentReadTools]);
const conn={account:'acct_1',profile:'read_only',listing:'catalog',mode:'preview'};
const db={getAccountCredential:async()=>({})};
const read=(args,f)=>dispatchReadOnlyTool({registry,name:'vercel_deploy_wait',
  args,connection:conn,db,fetchImpl:f.fetch});
const output=x=>JSON.parse(x.content[0].text);
function fake(states){
 const f=makeFakeVercel();
 const api=f.when('GET','/v13/deployments/{idOrUrl}');
 for(const state of states)api.resolves({uid:'dpl_ABC123',projectId:'prj_ONE',readyState:state});
 return f;
}
describe('D-2 bounded deployment waiting',()=>{
 beforeEach(()=>{vi.clearAllMocks();loadToken.mockResolvedValue({token:'vcp_FAKE_token',
   account:{id:'acct_1',team_id:'team_1',scope:'project',project_id:'prj_ONE'}});});
 afterEach(()=>vi.useRealTimers());
 it.each(['READY','ERROR','CANCELED'])('reports verified terminal %s without any write',async state=>{
   const f=fake([state]);
   const got=output(await read({deployment:'dpl_ABC123',waitSeconds:0},f));
   expect(got).toMatchObject({state,done:true,successful:state==='READY',
     polls:1,next:null,project:'prj_ONE'});
   expect(f.calls).toHaveLength(1);
   expect(f.calls[0].method).toBe('GET');
   f.verify();
 });
 it('does not mistake BUILDING or an unknown status for completion',async()=>{
   const f=fake(['BUILDING']);
   const got=output(await read({deployment:'dpl_ABC123',waitSeconds:0},f));
   expect(got).toMatchObject({state:'BUILDING',done:false,successful:false,polls:1});
   expect(got.next).toContain('vercel_deploy_wait');
 });
 it('refuses cross-project identity and forbidden options before a second read',async()=>{
   const f=makeFakeVercel();
   f.when('GET','/v13/deployments/{idOrUrl}').resolves({
     uid:'dpl_ABC123',projectId:'prj_OTHER',readyState:'READY'});
   expect((await read({deployment:'dpl_ABC123',waitSeconds:0},f)).isError).toBe(true);
   for(const args of [
     {deployment:'dpl_ABC123',project:'prj_OTHER'},
     {deployment:'dpl_ABC123',waitSeconds:45},
     {deployment:'dpl_ABC123',waitSeconds:-1},
     {deployment:'dpl_ABC123',confirm:true},
     {deployment:'wrong'}
   ])expect((await read(args,f)).isError).toBe(true);
   expect(f.calls).toHaveLength(1);
 });
 it('observes a transition with independent verified GETs and bounded polls',async()=>{
   vi.useFakeTimers();
   const f=fake(['BUILDING','READY']);
   const pending=read({deployment:'dpl_ABC123',waitSeconds:4},f);
   await vi.advanceTimersByTimeAsync(1500);
   const got=output(await pending);
   expect(got).toMatchObject({state:'READY',done:true,successful:true,polls:2});
   expect(f.calls).toHaveLength(2);
   expect(f.calls.every(c=>c.query.teamId==='team_1')).toBe(true);
   f.verify();
 });
});
