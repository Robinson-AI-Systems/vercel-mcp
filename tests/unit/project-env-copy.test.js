import {beforeEach,describe,expect,it,vi} from 'vitest';
import {registry} from '../../src/tools/index.js';
import {dispatchReadOnlyTool,listMcpTools} from '../../src/core/mcp-server.js';
import {makeFakeVercel} from '../../test/helpers/fake-vercel.js';
import {loadToken} from '../../src/vercel/tokens.js';
vi.mock('../../src/vercel/tokens.js',async old=>({...await old(),loadToken:vi.fn()}));

const project='prj_FAKE_COPY',sourceId='env_FAKE_SOURCE',destId='env_FAKE_DEST';
const value='PUBLIC_SAFE_CONFIG_COPY_FAKE';
const source={id:sourceId,projectId:project,key:'FEATURE_ENDPOINT',
  type:'plain',target:['preview'],updatedAt:100,value,customEnvironmentIds:[]};
const destination={id:destId,projectId:project,key:'FEATURE_ENDPOINT',
  type:'plain',target:['development'],updatedAt:200,value,customEnvironmentIds:[]};
const args={project,sourceId,sourceKey:'FEATURE_ENDPOINT',sourceUpdatedAt:100,
  sourceTarget:'preview',destinationKey:'FEATURE_ENDPOINT',
  destinationTarget:'development',confirm:true,requestKey:'copyConfigFAKE01'};
const conn={account:'acct_FAKE',profile:'full',mode:'preview',listing:'catalog'};
const token={token:'vcp_FAKE_copy',account:{
  id:'acct_FAKE',team_id:'team_FAKE',scope:'project',project_id:project}};
const parse=r=>JSON.parse(r.content[0].text);
function fixture(){
  const fake=makeFakeVercel(),audit=[],memo=new Map();
  const db={getAccountCredential:async()=>({}),listProtectedResources:async()=>[],
    recordChange:async row=>audit.push(row),requestReplayStore:()=>({
      claim:async({key})=>memo.has(key)?{state:'completed',result:memo.get(key)}:
        {state:'claimed',claimId:key},
      complete:async({key,result})=>{memo.set(key,result);},
      release:async()=>true
    })};
  const call=(a=args,c=conn)=>dispatchReadOnlyTool({
    registry,name:'vercel_env_copy',args:a,db,connection:c,fetchImpl:fake.fetch
  });
  fake.when('GET','/v9/projects/{idOrName}').resolves({id:project,name:'fake'});
  return {fake,call,db,audit,memo};
}
describe('E-1 server-side Config-only copy',()=>{
  beforeEach(()=>{vi.clearAllMocks();loadToken.mockResolvedValue(token);});
  it('registers write contract and excludes read-only connections',()=>{
    const tool=registry.tools.find(t=>t.name==='vercel_env_copy');
    expect(tool).toMatchObject({writes:true,guardedWrite:true,
      writeContract:{production:true,targets:true,secretIn:true}});
    expect(listMcpTools(registry,{...conn,profile:'read_only'})
      .some(t=>t.name==='vercel_env_copy')).toBe(false);
  });
  it('copies Config between targets without ever leaking plaintext, with independent equality verification',async()=>{
    const f=fixture();
    f.fake.when('GET','/v1/projects/{idOrName}/env/{id}')
      .resolves(source).resolves(source).resolves(source).resolves(destination);
    f.fake.when('POST','/v10/projects/{idOrName}/env')
      .resolves({created:{id:destId,key:'FEATURE_ENDPOINT',value:'DO_NOT_LEAK'},failed:[]});
    const result=parse(await f.call());
    expect(result).toMatchObject({status:'applied',mode:'PREVIEW',confirmed:true});
    const post=f.fake.calls.find(x=>x.method==='POST');
    expect(post.query.teamId).toBe('team_FAKE');
    expect(post.body).toEqual({key:'FEATURE_ENDPOINT',value,type:'plain',target:['development']});
    expect(JSON.stringify(result)).not.toContain(value);
    expect(JSON.stringify(f.audit)).not.toContain(value);
    expect(JSON.stringify(f.memo.entries())).not.toContain(value);
    expect(JSON.stringify(result)).not.toContain('DO_NOT_LEAK');
    f.fake.verify();
  });
  it('treats provider partial success as outcome unknown without leaking error payloads',async()=>{
    const f=fixture();
    f.fake.when('GET','/v1/projects/{idOrName}/env/{id}')
      .resolves(source).resolves(source);
    f.fake.when('POST','/v10/projects/{idOrName}/env')
      .resolves({created:{id:destId,key:'FEATURE_ENDPOINT'},
        failed:[{error:{value:'CANARY_FAKE_PRIVATE'}}]});
    const out=parse(await f.call());
    expect(out).toMatchObject({status:'outcome_unknown',confirmed:null});
    expect(JSON.stringify(out)).not.toContain('CANARY_FAKE_PRIVATE');
  });
  it('rejects any source that is Secret, branch-specific, credential-like or production-linked',async()=>{
    for(const invalid of [
      {...source,type:'sensitive'},{...source,visibility:'secret'},
      {...source,gitBranch:'feature/branch'},
      {...source,target:['preview','production']},
      {...source,value:['sk','live','FAKESECRETKEY'].join('_')},
      {...source,value:null},
      {...source,customEnvironmentIds:['env_other']}
    ]){
      const f=fixture();
      f.fake.when('GET','/v1/projects/{idOrName}/env/{id}').resolves(invalid);
      const out=parse(await f.call());
      expect(out).toMatchObject({status:'refused_by_guard'});
      expect(f.fake.calls.some(c=>c.method==='POST')).toBe(false);
    }
  });
  it('does not dispatch when source changed after preview',async()=>{
    const f=fixture();
    f.fake.when('GET','/v1/projects/{idOrName}/env/{id}')
      .resolves(source).resolves({...source,updatedAt:101});
    const out=parse(await f.call());
    expect(out).toMatchObject({status:'refused_by_guard'});
    expect(f.fake.calls.some(c=>c.method==='POST')).toBe(false);
  });
  it('requires checked production mode for production destination',async()=>{
    const f=fixture();
    f.fake.when('GET','/v1/projects/{idOrName}/env/{id}').resolves(source);
    expect(parse(await f.call({...args,destinationTarget:'production'})))
      .toMatchObject({status:'refused_by_guard'});
    expect(f.fake.calls.some(c=>c.method==='POST')).toBe(false);
  });
  it('refuses nonsensical, foreign, duplicate and unknown selectors',async()=>{
    for(const bad of [
      {...args,project:'prj_OTHER'},
      {...args,destinationTarget:'preview'},
      {...args,sourceTarget:'production'},
      {...args,sourceId:'../unsafe'},
      {...args,sourceUpdatedAt:0},
      {...args,teamId:'team_OTHER'},
      {...args,destinationKey:'BAD=NAME'},
      {...args,sourceId:destId,sourceKey:destination.key,sourceUpdatedAt:100}
    ]){
      const f=fixture();
      const r=await f.call(bad);
      expect(r.isError||parse(r).status==='refused_by_guard').toBe(true);
      expect(f.fake.calls.some(c=>c.method==='POST')).toBe(false);
    }
  });
  it('copies an exact preview branch Config to a distinct preview branch without disclosing values',async()=>{
    const f=fixture();
    const from={...source,gitBranch:'feature/source'};
    const to={...destination,target:['preview'],gitBranch:'feature/destination'};
    const branchArgs={...args,sourceGitBranch:'feature/source',
      destinationTarget:'preview',destinationGitBranch:'feature/destination'};
    f.fake.when('GET','/v1/projects/{idOrName}/env/{id}')
      .resolves(from).resolves(from).resolves(from).resolves(to);
    f.fake.when('POST','/v10/projects/{idOrName}/env')
      .resolves({created:{id:destId,key:'FEATURE_ENDPOINT'},failed:[]});
    const out=parse(await f.call(branchArgs));
    expect(out).toMatchObject({status:'applied',confirmed:true});
    const post=f.fake.calls.find(c=>c.method==='POST');
    expect(post.body).toEqual({key:'FEATURE_ENDPOINT',value,type:'plain',
      target:['preview'],gitBranch:'feature/destination'});
    expect(JSON.stringify([out,f.audit,[...f.memo.values()]])).not.toContain(value);
    f.fake.verify();
  });
  it('refuses branch scope drift, malformed paths and incompatible targets before POST',async()=>{
    for(const bad of [
      {...args,sourceGitBranch:'feature/missing'},
      {...args,sourceGitBranch:'../unsafe'},
      {...args,destinationGitBranch:'feature/dest'},
      {...args,destinationTarget:'preview',destinationGitBranch:'feature/../../escape'},
      {...args,destinationTarget:'preview',destinationGitBranch:'/leading'},
      {...args,destinationTarget:'preview',destinationGitBranch:'trailing/'},
      {...args,sourceGitBranch:'feature/source',sourceTarget:'development'}
    ]){
      const f=fixture();
      f.fake.when('GET','/v1/projects/{idOrName}/env/{id}').resolves(source);
      const out=parse(await f.call(bad));
      expect(out).toMatchObject({status:'refused_by_guard'});
      expect(f.fake.calls.some(c=>c.method==='POST')).toBe(false);
    }
  });
  it('refuses a changed branch between preview and dispatch',async()=>{
    const f=fixture();
    const good={...source,gitBranch:'feature/main'};
    f.fake.when('GET','/v1/projects/{idOrName}/env/{id}')
      .resolves(good).resolves({...good,gitBranch:'feature/changed'});
    const out=parse(await f.call({...args,sourceGitBranch:'feature/main'}));
    expect(out).toMatchObject({status:'refused_by_guard'});
    expect(f.fake.calls.some(c=>c.method==='POST')).toBe(false);
  });
  it('does not confirm a copied preview variable if the provider lost its branch binding',async()=>{
    const f=fixture();
    f.fake.when('GET','/v1/projects/{idOrName}/env/{id}')
      .resolves(source).resolves(source).resolves(source)
      .resolves({...destination,target:['preview'],gitBranch:'feature/wrong'});
    f.fake.when('POST','/v10/projects/{idOrName}/env')
      .resolves({created:{id:destId,key:'FEATURE_ENDPOINT'},failed:[]});
    const out=parse(await f.call({...args,destinationTarget:'preview',
      destinationGitBranch:'feature/right'}));
    expect(out).toMatchObject({status:'applied',confirmed:false});
    expect(JSON.stringify(out)).not.toContain(value);
  });
  it('previews without submitting the source value',async()=>{
    for(const mode of [{dryRun:true,confirm:false},{confirm:false}]){
      const f=fixture();
      f.fake.when('GET','/v1/projects/{idOrName}/env/{id}').resolves(source);
      const out=parse(await f.call({...args,...mode}));
      expect(out.status).toBe(mode.dryRun?'preview':'needs_confirmation');
      expect(JSON.stringify(out)).not.toContain(value);
      expect(f.fake.calls.some(c=>c.method==='POST')).toBe(false);
    }
  });
});
