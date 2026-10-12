import {describe,it,expect,vi,beforeEach} from 'vitest';
import {makeFakeVercel} from '../../test/helpers/fake-vercel.js';
import {deploymentReadTools} from '../../src/tools/deployments.js';
import {dispatchReadOnlyTool} from '../../src/core/mcp-server.js';
import {mergeNamespaces} from '../../src/core/registry.js';
import {loadToken} from '../../src/vercel/tokens.js';
vi.mock('../../src/vercel/tokens.js',async original=>({...await original(),loadToken:vi.fn()}));
const registry=mergeNamespaces([deploymentReadTools]);
const connection={account:'acct_ALPHA',profile:'read_only',mode:'preview',listing:'catalog'};
const db={getAccountCredential:async()=>({})};
const parsed=res=>JSON.parse(res.content[0].text);
function token(scope='team'){return {token:'vcp_FAKE_token',account:{id:'acct_ALPHA',
  team_id:'team_ALPHA',scope,project_id:scope==='project'?'prj_ONE':null}};}
function call(name,args,fake,ctx=connection){
 return dispatchReadOnlyTool({registry,name,args,connection:ctx,db,fetchImpl:fake.fetch});
}
function deployment(projectId='prj_ONE'){
 return {uid:'dpl_ABC123',projectId,url:'preview.example.vercel.app',
   readyState:'READY',target:'preview',created:1700000000000,
   meta:{githubCommitSha:'abcd1234',githubCommitRef:'develop',
     token:'vcp_FAKE_must_hide'},alias:['safe.example.test'],
   user:{secret:'vcp_FAKE_must_hide'}};
}
describe('D-2 scoped Vercel deployment reads',()=>{
 beforeEach(()=>{vi.clearAllMocks();loadToken.mockResolvedValue(token());});
 it('lists a bounded provider page for an authenticated team and preserves the next cursor',async()=>{
   const fake=makeFakeVercel();
   fake.when('GET','/v7/deployments').resolves({deployments:[deployment()],
     pagination:{next:1700000000000}});
   const got=parsed(await call('vercel_deploy_list',{project:'prj_ONE',limit:3},fake));
   expect(got).toMatchObject({project:'prj_ONE',count:1,next:1700000000000,complete:false});
   expect(got.deployments[0]).toMatchObject({id:'dpl_ABC123',state:'READY',branch:'develop'});
   expect(JSON.stringify(got)).not.toContain('vcp_FAKE_must_hide');
   expect(fake.calls[0].query).toMatchObject({teamId:'team_ALPHA',projectId:'prj_ONE',limit:'3'});
   expect(fake.calls.every(x=>x.method==='GET')).toBe(true);
   fake.verify();
 });
 it('allows only the stored exact project for project-scoped credentials',async()=>{
   loadToken.mockResolvedValue(token('project'));
   const fake=makeFakeVercel();
   fake.when('GET','/v7/deployments').resolves({deployments:[deployment()],pagination:{next:null}});
   const good=parsed(await call('vercel_deploy_list',{},fake));
   expect(good.project).toBe('prj_ONE');
   const wrong=await call('vercel_deploy_list',{project:'prj_OTHER'},fake);
   expect(wrong.isError).toBe(true);
   expect(fake.calls).toHaveLength(1);
 });
 it('rejects provider cross-project and contradictory identities without projecting them',async()=>{
   const fake=makeFakeVercel();
   fake.when('GET','/v7/deployments').resolves({deployments:[deployment('prj_OTHER')],
     pagination:{next:null}});
   expect((await call('vercel_deploy_list',{project:'prj_ONE'},fake)).isError).toBe(true);
   fake.verify();
 });
 it('requires a finite, internally consistent page and refuses duplicate deployments',async()=>{
   for(const answer of [
     {deployments:[],pagination:{}},
     {deployments:[],pagination:{next:123,hasNext:false}},
     {deployments:[deployment(),deployment()],pagination:{next:null}}
   ]){
     const fake=makeFakeVercel();
     fake.when('GET','/v7/deployments').resolves(answer);
     const result=await call('vercel_deploy_list',{project:'prj_ONE'},fake);
     expect(result.isError).toBe(true);
     fake.verify();
   }
 });
 it('gets a deployment by ID or normalized HTTPS URL using identical independent project proof',async()=>{
   for(const locator of ['dpl_ABC123','https://preview.example.vercel.app/']){
     const fake=makeFakeVercel();
     fake.when('GET','/v13/deployments/{idOrUrl}').resolves(deployment());
     const res=parsed(await call('vercel_deploy_get',{deployment:locator,project:'prj_ONE'},fake));
     expect(res).toMatchObject({id:'dpl_ABC123',projectId:'prj_ONE',target:'preview',
       errorCode:null});
     expect(fake.calls[0].params.idOrUrl).toBe(locator.startsWith('https://')?
       'preview.example.vercel.app':locator);
     expect(fake.calls[0].query.teamId).toBe('team_ALPHA');
     expect(JSON.stringify(res)).not.toContain('vcp_FAKE_must_hide');
     fake.verify();
   }
 });
 it('refuses unsafe URLs and scope selectors before provider traffic',async()=>{
   const fake=makeFakeVercel();
   for(const args of [
     {deployment:'http://unsafe.example',project:'prj_ONE'},
     {deployment:'https://user:pass@host.example',project:'prj_ONE'},
     {deployment:'https://host.example/path',project:'prj_ONE'},
     {deployment:'dpl_ABC123',project:'../other'},
     {deployment:'dpl_ABC123',project:'prj_ONE',teamId:'team_OTHER'}
   ])expect((await call('vercel_deploy_get',args,fake)).isError).toBe(true);
   expect(fake.calls).toHaveLength(0);
 });
 it('refuses a team-wide list without a project and unknown request keys',async()=>{
   const fake=makeFakeVercel();
   expect((await call('vercel_deploy_list',{},fake)).isError).toBe(true);
   expect((await call('vercel_deploy_list',{project:'prj_ONE',cursor:'unsafe'},fake)).isError).toBe(true);
   expect(fake.calls).toHaveLength(0);
 });
});
