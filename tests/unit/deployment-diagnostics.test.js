import {describe,it,expect,vi,beforeEach} from 'vitest';
import {makeFakeVercel} from '../../test/helpers/fake-vercel.js';
import {deploymentReadTools} from '../../src/tools/deployments.js';
import {dispatchReadOnlyTool} from '../../src/core/mcp-server.js';
import {mergeNamespaces} from '../../src/core/registry.js';
import {loadToken} from '../../src/vercel/tokens.js';
vi.mock('../../src/vercel/tokens.js',async mod=>({...await mod(),loadToken:vi.fn()}));
const registry=mergeNamespaces([deploymentReadTools]);
const conn={account:'acct_1',profile:'read_only',listing:'catalog',mode:'preview'};
const db={getAccountCredential:async()=>({})};
const deploy='dpl_ABC123',project='prj_ONE';
const invoke=(name,args,f)=>dispatchReadOnlyTool({registry,name,args,connection:conn,db,fetchImpl:f.fetch});
const body=x=>JSON.parse(x.content[0].text);
const when=(f,which,data)=>{
  f.when('GET','/v13/deployments/{idOrUrl}').resolves({uid:deploy,projectId:project});
  f.when('GET',which==='logs'?'/v3/deployments/{idOrUrl}/events':
    '/v6/deployments/{id}/files').resolves(data);
};
describe('D-2 project-bound build diagnostics and file tree',()=>{
 beforeEach(()=>{vi.clearAllMocks();loadToken.mockResolvedValue({token:'vcp_FAKE',
   account:{id:'acct_1',team_id:'team_1',scope:'project',project_id:project}});});
 it('uses only safe pinned GETs and returns warnings/errors but no raw sensitive build text',async()=>{
   const f=makeFakeVercel();
   when(f,'logs',[
     {type:'command',payload:{text:'vcp_FAKE_secret'}},
     {type:'warning',payload:{text:'sk_live_not_for_results'}},
     {type:'error',payload:{text:'password=do-not-show',info:{step:'compile'}}}]);
   const x=body(await invoke('vercel_deploy_get_build_logs',{deployment:deploy},f));
   expect(x.tally).toEqual({error:1,warning:1,command:1,other:0});
   expect(x.firstError).toMatchObject({eventIndex:2,step:'compile'});
   expect(x.containsRawLogText).toBe(false);
   expect(JSON.stringify(x)).not.toMatch(/vcp_FAKE_secret|password=|sk_live_not_for_results/);
   expect(f.calls.map(x=>x.method)).toEqual(['GET','GET']);
   expect(f.calls[1].query).toMatchObject({limit:'100',follow:'0',teamId:'team_1'});
   f.verify();
 });
 it('keeps a 5000-event fixture under 8 KiB with explicit unknown pagination',async()=>{
   const f=makeFakeVercel();
   when(f,'logs',Array.from({length:5000},()=>({type:'command',
     payload:{text:'a'.repeat(500)}})));
   const x=body(await invoke('vercel_deploy_get_build_logs',{deployment:deploy},f));
   expect(x.scanned).toBe(5000);
   expect(x.complete).toBe(false);
   expect(Buffer.byteLength(JSON.stringify(x))).toBeLessThan(8192);
 });
 it('returns safe bounded paths without file contents or secret-shaped names',async()=>{
   const f=makeFakeVercel();
   when(f,'files',[{name:'public',type:'directory',children:[
     {name:'manifest.json',type:'file',uid:'a'.repeat(40),content:'NEVER_READ'},
     {name:'index.js',type:'file',uid:'b'.repeat(40)}]}]);
   const x=body(await invoke('vercel_deploy_list_files',{deployment:deploy},f));
   expect(x.files).toEqual([
     {path:'public',type:'directory',fileId:null},
     {path:'public/manifest.json',type:'file',fileId:'a'.repeat(40)},
     {path:'public/index.js',type:'file',fileId:'b'.repeat(40)}]);
   expect(JSON.stringify(x)).not.toContain('NEVER_READ');
   f.verify();
 });
 it('refuses changed deployment identity before any log/file request',async()=>{
   for(const op of ['vercel_deploy_get_build_logs','vercel_deploy_list_files']){
     const f=makeFakeVercel();
     f.when('GET','/v13/deployments/{idOrUrl}').resolves({uid:deploy,projectId:'prj_OTHER'});
     expect((await invoke(op,{deployment:deploy},f)).isError).toBe(true);
     expect(f.calls).toHaveLength(1);
   }
 });
 it('refuses invalid file paths, overdeep trees, unbounded provider structures',async()=>{
   for(const tree of [
     [{name:'../token',type:'file'}],
     [{name:'vcp_FAKE_key',type:'file'}],
     [{name:'safe',type:'directory',children:[{name:'child',type:'file',children:[{}]}]}]
   ]){
     const f=makeFakeVercel();when(f,'files',tree);
     expect((await invoke('vercel_deploy_list_files',{deployment:deploy},f)).isError).toBe(true);
   }
 });
 it('refuses changing the project or passing arbitrary query keys',async()=>{
   const f=makeFakeVercel();
   expect((await invoke('vercel_deploy_get_build_logs',{deployment:deploy,project:'prj_OTHER'},f)).isError).toBe(true);
   expect((await invoke('vercel_deploy_list_files',{deployment:deploy,follow:true},f)).isError).toBe(true);
   expect(f.calls).toHaveLength(0);
 });
});
