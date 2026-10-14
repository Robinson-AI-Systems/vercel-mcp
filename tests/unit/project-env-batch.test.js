import {beforeEach,describe,expect,it,vi} from 'vitest';
import {registry} from '../../src/tools/index.js';
import {dispatchReadOnlyTool,listMcpTools} from '../../src/core/mcp-server.js';
import {makeFakeVercel} from '../../test/helpers/fake-vercel.js';
import {loadToken} from '../../src/vercel/tokens.js';
vi.mock('../../src/vercel/tokens.js',async old=>({...await old(),loadToken:vi.fn()}));

const project='prj_FAKE_BATCH',idA='env_FAKE_BATCH_A',idB='env_FAKE_BATCH_B';
const nameA='FIRST_PUBLIC',nameB='SECOND_PUBLIC',valueA='SAFE_FAKE_FIRST',valueB='SAFE_FAKE_SECOND';
const rowA={id:idA,key:nameA,projectId:project,type:'plain',
  target:['preview'],updatedAt:100,value:valueA,customEnvironmentIds:[]};
const rowB={id:idB,key:nameB,projectId:project,type:'plain',
  target:['preview'],updatedAt:200,value:valueB,customEnvironmentIds:[]};
const items=[{key:nameA,kind:'Config',targets:['preview'],value:valueA},
  {key:nameB,kind:'Config',targets:['preview'],value:valueB}];
const ids=[{id:idA,expectedKey:nameA,expectedUpdatedAt:100},
  {id:idB,expectedKey:nameB,expectedUpdatedAt:200}];
const args={project,items,confirm:true,requestKey:'createBatchFake01'};
const delArgs={project,items:ids,confirm:true,outsideApp:true,
  requestKey:'deleteBatchFake01'};
const token={token:'vcp_FAKE_batch',account:{
  id:'acct_FAKE',team_id:'team_FAKE',scope:'project',project_id:project}};
const conn={account:'acct_FAKE',profile:'full',mode:'preview',listing:'catalog'};
const parse=x=>JSON.parse(x.content[0].text);
function fixture(){
  const fake=makeFakeVercel(),memo=new Map(),audit=[];
  const db={getAccountCredential:async()=>({}),listProtectedResources:async()=>[],
    recordChange:async r=>audit.push(r),requestReplayStore:()=>({
      claim:async({key})=>memo.has(key)?{state:'completed',result:memo.get(key)}:
        {state:'claimed',claimId:key},
      complete:async({key,result})=>{memo.set(key,result);},
      release:async()=>true
    })};
  fake.when('GET','/v9/projects/{idOrName}').resolves({id:project,name:'fake'});
  const call=(name,input,c=conn)=>dispatchReadOnlyTool({
    registry,name,args:input,db,connection:c,fetchImpl:fake.fetch
  });
  return {fake,db,memo,audit,call};
}
describe('E-1 bounded provider create/delete batches',()=>{
  beforeEach(()=>{vi.clearAllMocks();loadToken.mockResolvedValue(token);});
  it('exposes guarded creation and full-profile deletion, never read-only',()=>{
    for(const name of ['vercel_env_set_many','vercel_env_delete_many']){
      const t=registry.tools.find(x=>x.name===name);
      expect(t).toMatchObject({writes:true,guardedWrite:true,
        writeContract:{production:true,targets:true}});
      expect(listMcpTools(registry,{...conn,profile:'read_only'})
        .some(x=>x.name===name)).toBe(false);
    }
    expect(listMcpTools(registry,{...conn,profile:'everyday'})
      .some(x=>x.name==='vercel_env_delete_many')).toBe(false);
  });
  it('creates two Config variables in one POST and independently checks both without leaking values',async()=>{
    const f=fixture();
    f.fake.when('POST','/v10/projects/{idOrName}/env')
      .resolves({created:[{id:idA,key:nameA},{id:idB,key:nameB}],failed:[]});
    f.fake.when('GET','/v1/projects/{idOrName}/env/{id}')
      .resolves(rowA).resolves(rowB);
    const out=parse(await f.call('vercel_env_set_many',args));
    expect(out).toMatchObject({status:'applied',mode:'PREVIEW',confirmed:true});
    const post=f.fake.calls.filter(c=>c.method==='POST');
    expect(post).toHaveLength(1);
    expect(post[0].query.teamId).toBe('team_FAKE');
    expect(post[0].body).toEqual(items.map(i=>({
      key:i.key,value:i.value,type:'plain',target:['preview']})));
    expect(JSON.stringify(out)).not.toContain(valueA);
    expect(JSON.stringify(out)).not.toContain(valueB);
    expect(JSON.stringify(f.audit)).not.toContain(valueA);
    expect(JSON.stringify(f.audit)).not.toContain(valueB);
    f.fake.verify();
  });
  it('creates cryptographically generated Secret in batch without claiming value readback',async()=>{
    const f=fixture();
    const secretItem={key:'SECRET_PREVIEW',targets:['preview'],kind:'Secret',
      generate:{bytes:32,encoding:'base64url'}};
    f.fake.when('POST','/v10/projects/{idOrName}/env')
      .resolves({created:[{id:idA,key:nameA},{id:idB,key:'SECRET_PREVIEW'}],failed:[]});
    f.fake.when('GET','/v1/projects/{idOrName}/env/{id}')
      .resolves(rowA).resolves({...rowB,key:'SECRET_PREVIEW',type:'sensitive'});
    const out=parse(await f.call('vercel_env_set_many',{
      ...args,items:[items[0],secretItem]}));
    expect(out).toMatchObject({status:'applied',confirmed:null});
    const post=f.fake.calls.find(c=>c.method==='POST');
    expect(post.body[1].type).toBe('sensitive');
    expect(post.body[1].value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify(out)).not.toContain(post.body[1].value);
  });
  it('rejects provider partial creation as unknown rather than reporting clean success',async()=>{
    const f=fixture();
    f.fake.when('POST','/v10/projects/{idOrName}/env')
      .resolves({created:[{id:idA,key:nameA}],
        failed:[{error:{value:'FAKE_CANARY_PRIVATE'}}]});
    const out=parse(await f.call('vercel_env_set_many',args));
    expect(out).toMatchObject({status:'outcome_unknown',confirmed:null});
    expect(JSON.stringify(out)).not.toContain('FAKE_CANARY_PRIVATE');
    expect(f.fake.calls.filter(c=>c.method==='POST')).toHaveLength(1);
  });
  it('deletes exact nonproduction IDs in one batch and proves each is absent',async()=>{
    const f=fixture();
    f.fake.when('GET','/v1/projects/{idOrName}/env/{id}')
      .resolves(rowA).resolves(rowB).resolves(rowA).resolves(rowB)
      .rejects(404).rejects(404);
    f.fake.when('DELETE','/v1/projects/{idOrName}/env')
      .resolves({deleted:2,ids:[idB,idA]});
    const out=parse(await f.call('vercel_env_delete_many',delArgs));
    expect(out).toMatchObject({status:'applied',mode:'PREVIEW',confirmed:true});
    const del=f.fake.calls.filter(c=>c.method==='DELETE');
    expect(del).toHaveLength(1);
    expect(del[0].body).toEqual({ids:[idA,idB]});
    expect(del[0].query.teamId).toBe('team_FAKE');
    f.fake.verify();
  });
  it('handles partial provider deletion as an unknown outcome, never silently succeeding',async()=>{
    const f=fixture();
    f.fake.when('GET','/v1/projects/{idOrName}/env/{id}')
      .resolves(rowA).resolves(rowB).resolves(rowA).resolves(rowB);
    f.fake.when('DELETE','/v1/projects/{idOrName}/env')
      .resolves({deleted:1,ids:[idA]});
    expect(parse(await f.call('vercel_env_delete_many',delArgs)))
      .toMatchObject({status:'outcome_unknown',confirmed:null});
    expect(f.fake.calls.filter(c=>c.method==='DELETE')).toHaveLength(1);
  });
  it('refuses mutated ID/revision before irreversible provider dispatch',async()=>{
    const f=fixture();
    f.fake.when('GET','/v1/projects/{idOrName}/env/{id}')
      .resolves(rowA).resolves(rowB).resolves(rowA)
      .resolves({...rowB,updatedAt:201});
    expect(parse(await f.call('vercel_env_delete_many',delArgs)))
      .toMatchObject({status:'refused_by_guard'});
    expect(f.fake.calls.some(c=>c.method==='DELETE')).toBe(false);
  });
  it('production target, bad keys and duplicate IDs never dispatch writes',async()=>{
    const invalidCreate=[
      {...args,items:[items[0],items[0]]},
      {...args,items:[]},
      {...args,items:[items[0],{...items[1],key:'BAD=NAME'}]},
      {...args,items:[items[0],{...items[1],targets:['production']}]},
      {...args,items:[items[0],{...items[1],kind:'Secret'}]}
    ];
    for(const input of invalidCreate){
      const f=fixture();
      const r=await f.call('vercel_env_set_many',input);
      expect(r.isError||parse(r).status==='refused_by_guard').toBe(true);
      expect(f.fake.calls.some(c=>c.method==='POST')).toBe(false);
    }
    const badDelete=[
      {...delArgs,items:[ids[0],ids[0]]},
      {...delArgs,outsideApp:false},
      {...delArgs,items:[]}
    ];
    for(const input of badDelete){
      const f=fixture();
      const r=await f.call('vercel_env_delete_many',input);
      expect(r.isError||parse(r).status==='refused_by_guard').toBe(true);
      expect(f.fake.calls.some(c=>c.method==='DELETE')).toBe(false);
    }
  });
  it('dry-run and no-confirm never dispatch batch writes',async()=>{
    for(const changes of [{dryRun:true,confirm:false},{confirm:false}]){
      const f=fixture();
      const r=parse(await f.call('vercel_env_set_many',{...args,...changes}));
      expect(r.status).toBe(changes.dryRun?'preview':'needs_confirmation');
      expect(f.fake.calls.some(c=>c.method==='POST')).toBe(false);
    }
  });
});
