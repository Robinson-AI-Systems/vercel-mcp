import {describe,it,expect,beforeEach,vi} from 'vitest';
import {registry} from '../../src/tools/index.js';
import {dispatchReadOnlyTool,listMcpTools} from '../../src/core/mcp-server.js';
import {makeFakeVercel} from '../../test/helpers/fake-vercel.js';
import {loadToken} from '../../src/vercel/tokens.js';
import {validateRequest} from '../../src/vercel/openapi-validation.js';
import {checkTargets} from '../../src/tools/self-guard.js';
vi.mock('../../src/vercel/tokens.js',async orig=>({...await orig(),loadToken:vi.fn()}));

const project='prj_FAKE_SHARED',team='team_FAKE',id='env_FAKE_SHARED_1';
const row={id,key:'MY_FAKE_FLAG',type:'plain',ownerId:team,
  projectId:[project],target:['preview'],updatedAt:100,
  customEnvironmentIds:[],value:'FAKE_PRIVATE_PREVIOUS'};
const token={token:'vcp_FAKE_shared',account:{
  id:'acct_FAKE',scope:'team',team_id:team}};
const conn={account:'acct_FAKE',profile:'full',mode:'preview',listing:'catalog'};
const setCreate={mode:'create',project,key:'SHARED_NEW',kind:'Secret',
  generate:{bytes:32,encoding:'base64url'},outsideApp:true,confirm:true,
  requestKey:'sharedCreateFake01'};
const setUpdate={mode:'update',project,key:row.key,id,kind:'Config',
  expectedUpdatedAt:100,value:'FAKE_NEW_PUBLIC',outsideApp:true,confirm:true,
  requestKey:'sharedUpdateFake01'};
const unlink={mode:'unlink',project,id,expectedKey:row.key,expectedKind:'Config',
  expectedUpdatedAt:100,outsideApp:true,confirm:true,requestKey:'sharedUnlinkFake01'};
const remove={mode:'delete',id,expectedKey:row.key,expectedKind:'Config',
  expectedUpdatedAt:100,outsideApp:true,confirm:true,requestKey:'sharedDeleteFake01'};
const parse=r=>JSON.parse(r.content[0].text);
function fixture(first=[row]){
  const fake=makeFakeVercel(),audits=[],memo=new Map(),claimed=new Set();
  const db={getAccountCredential:async()=>({}),listProtectedResources:async()=>[],
    recordChange:async r=>audits.push(r),requestReplayStore:()=>({
      claim:async({key})=>{
        if(memo.has(key))return {state:'completed',result:memo.get(key)};
        if(claimed.has(key))return {state:'pending'};
        claimed.add(key);return {state:'claimed',claimId:key};
      },
      release:async({key})=>{claimed.delete(key);return true;},
      complete:async({key,result})=>{claimed.delete(key);memo.set(key,result);}
    })};
  loadToken.mockResolvedValue(token);
  fake.when('GET','/v9/projects/{idOrName}')
    .resolves({id:project,accountId:team,name:'fake-shared'});
  fake.when('GET','/v1/env').resolves({data:first,pagination:{next:null}});
  const call=(name,args,c=conn)=>dispatchReadOnlyTool({
    registry,name,args,db,connection:c,fetchImpl:fake.fetch
  });
  return {call,db,fake,memo,audits};
}
function mutations(f){return f.fake.calls.filter(x=>['POST','PATCH','DELETE'].includes(x.method));}
describe('E-2 selected-team shared variable lifecycle',()=>{
  beforeEach(()=>vi.clearAllMocks());
  it('pins all documented outgoing methods, path and body schemas; only allowed profiles',()=>{
    const tools=['vercel_shared_env_set','vercel_shared_env_delete'];
    for(const name of tools){
      expect(registry.tools.find(t=>t.name===name))
        .toMatchObject({writes:true,guardedWrite:true,
          writeContract:{production:true,targets:true}});
      expect(listMcpTools(registry,{...conn,profile:'read_only'})
        .some(x=>x.name===name)).toBe(false);
    }
    expect(listMcpTools(registry,{...conn,profile:'everyday'})
      .some(x=>x.name==='vercel_shared_env_delete')).toBe(false);
    expect(validateRequest('shared_env_create',{query:{teamId:team},
      body:{evs:[{key:'A',value:'B'}],type:'encrypted',
        target:['preview'],projectId:[project]}})).toBe(true);
    expect(validateRequest('shared_env_update',{query:{teamId:team},
      body:{updates:{[id]:{value:'FAKE'}}}})).toBe(true);
    expect(validateRequest('shared_env_delete',{query:{teamId:team},
      body:{ids:[id]}})).toBe(true);
    expect(validateRequest('shared_env_unlink',{path:{id,projectId:project},
      query:{teamId:team}})).toBe(true);
  });
  it('creates a team variable linked only to selected preview project, never exposing a secret',async()=>{
    const f=fixture([]);
    const created={...row,id:'env_FAKE_SHARED_NEW',key:'SHARED_NEW',
      type:'encrypted',value:'vcp_FAKE_SHOULD_NEVER_LEAK'};
    f.fake.when('POST','/v1/env').resolves({created:[created],failed:[]});
    f.fake.when('GET','/v1/env')
      .resolves({data:[],pagination:{next:null}})
      .resolves({data:[],pagination:{next:null}})
      .resolves({data:[created],pagination:{next:null}});
    const out=parse(await f.call('vercel_shared_env_set',setCreate));
    expect(out).toMatchObject({status:'applied',confirmed:null});
    expect(mutations(f)).toHaveLength(1);
    const post=mutations(f)[0];
    expect(post).toMatchObject({method:'POST',path:'/v1/env',query:{teamId:team}});
    expect(post.body).toMatchObject({evs:[{key:'SHARED_NEW'}],
      type:'encrypted',target:['preview'],projectId:[project]});
    expect(post.body.evs[0].value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify(out)+JSON.stringify(f.audits)).not.toContain(post.body.evs[0].value);
    expect(JSON.stringify(out)+JSON.stringify(f.audits)).not.toContain('vcp_FAKE_SHOULD_NEVER_LEAK');
    expect(f.memo.size).toBe(2);
  });
  it('replaces one revision-checked preview-only Config without leaking response bytes',async()=>{
    const f=fixture();
    const revised={...row,updatedAt:101,value:'vcp_FAKE_PRIVATE_RESULT'};
    f.fake.when('PATCH','/v1/env')
      .resolves({updated:[revised],failed:[]});
    f.fake.when('GET','/v1/env')
      .resolves({data:[row],pagination:{next:null}})
      .resolves({data:[row],pagination:{next:null}})
      .resolves({data:[revised],pagination:{next:null}});
    const out=parse(await f.call('vercel_shared_env_set',setUpdate));
    expect(out).toMatchObject({status:'applied',confirmed:null});
    expect(mutations(f)).toHaveLength(1);
    expect(mutations(f)[0]).toMatchObject({method:'PATCH',path:'/v1/env',
      body:{updates:{[id]:{value:'FAKE_NEW_PUBLIC'}}}});
    expect(JSON.stringify(out)+JSON.stringify(f.audits)).not.toContain('vcp_FAKE_PRIVATE_RESULT');
  });
  it('unlinks one preview project by exact variable ID and independently proves it',async()=>{
    const f=fixture();
    f.fake.when('PATCH','/v1/env/{id}/unlink/{projectId}').resolves({id});
    f.fake.when('GET','/v1/env')
      .resolves({data:[row],pagination:{next:null}})
      .resolves({data:[row],pagination:{next:null}})
      .resolves({data:[{...row,projectId:[],updatedAt:101}],pagination:{next:null}});
    const out=parse(await f.call('vercel_shared_env_delete',unlink));
    expect(out).toMatchObject({status:'applied',confirmed:true});
    expect(mutations(f)).toHaveLength(1);
    expect(mutations(f)[0]).toMatchObject({method:'PATCH',query:{teamId:team},
      path:'/v1/env/'+id+'/unlink/'+project});
    expect(mutations(f)[0].body).toBeUndefined();
  });
  it('deletes a linkless variable by exact ID while proving complete team absence',async()=>{
    const original={...row,projectId:[]};
    const f=fixture([original]);
    f.fake.when('DELETE','/v1/env').resolves({deleted:[id],failed:[]});
    f.fake.when('GET','/v1/env')
      .resolves({data:[original],pagination:{next:null}})
      .resolves({data:[original],pagination:{next:null}})
      .resolves({data:[],pagination:{next:null}});
    const out=parse(await f.call('vercel_shared_env_delete',remove));
    expect(out).toMatchObject({status:'applied',confirmed:true});
    expect(mutations(f)).toHaveLength(1);
    expect(mutations(f)[0]).toMatchObject({method:'DELETE',body:{ids:[id]},
      path:'/v1/env'});
  });
  it('denies real production or custom links, incomplete pagination and unlinked delete while linked',async()=>{
    const samples=[
      [{...row,target:['production']}],
      [{...row,target:['preview','production']}],
      [{...row,customEnvironmentIds:['env_FAKE_CUSTOM']}],
      [{...row,customEnvironmentIds:undefined}],
      [{...row,updatedAt:101}],
      [{...row,projectId:['prj_FAKE_OTHER']}]
    ];
    for(const sample of samples){
      const f=fixture(sample);
      expect(parse(await f.call('vercel_shared_env_set',setUpdate)).status)
        .toBe('refused_by_guard');
      expect(mutations(f)).toHaveLength(0);
    }
    const linked=fixture();
    expect(parse(await linked.call('vercel_shared_env_delete',remove)).status)
      .toBe('refused_by_guard');
    const incomplete=fixture();
    incomplete.fake.when('GET','/v1/env')
      .resolves({data:[row],pagination:{next:123}});
    expect(parse(await incomplete.call('vercel_shared_env_set',setUpdate)).status)
      .toBe('refused_by_guard');
    expect(mutations(incomplete)).toHaveLength(0);
  });
  it('refuses stale revision, duplicate key, foreign project, scope and untrusted arguments',async()=>{
    for(const a of [
      {...setCreate,project:'prj_FAKE_OTHER'},
      {...setCreate,value:'sk_live_FAKE'},
      {...setCreate,outsideApp:false},
      {...setCreate,targets:['production']},
      {...setCreate,kind:'Config'},
      {...setCreate,generate:{bytes:16,encoding:'hex'}}
    ]){
      const f=fixture([]);
      expect(parse(await f.call('vercel_shared_env_set',a)).status)
        .toBe('refused_by_guard');
      expect(mutations(f)).toHaveLength(0);
    }
    const f=fixture([{...row,key:'SHARED_NEW'}]);
    expect(parse(await f.call('vercel_shared_env_set',setCreate)).status)
      .toBe('refused_by_guard');
    loadToken.mockResolvedValue({...token,account:{...token.account,scope:'project',
      project_id:project}});
    expect(parse(await f.call('vercel_shared_env_set',setCreate)).status)
      .toBe('refused_by_guard');
  });
  it('dry runs, absent confirmation and explicit protected team/project/shared variable refuse mutations',async()=>{
    for(const name of ['vercel_shared_env_set','vercel_shared_env_delete']){
      const args=name==='vercel_shared_env_set'?setUpdate:unlink;
      for(const option of [{confirm:false},{confirm:false,dryRun:true}]){
        const f=fixture();
        const out=parse(await f.call(name,{...args,...option}));
        expect(out.status).toBe(option.dryRun?'preview':'needs_confirmation');
        expect(mutations(f)).toHaveLength(0);
      }
      for(const protectedId of [team,project,id]){
        const f=fixture();
        f.db.listProtectedResources=async()=>[{match:protectedId,note:'protected'}];
        expect(parse(await f.call(name,args)).status).toBe('refused_by_guard');
        expect(mutations(f)).toHaveLength(0);
      }
      const f=fixture();
      const res=await f.call(name,args,{...conn,profile:'read_only'});
      expect(res.isError||parse(res).status==='refused_by_guard').toBe(true);
      expect(mutations(f)).toHaveLength(0);
    }
    expect(checkTargets([{kind:'shared_env',id,accountId:team}],[]))
      .toEqual({blocked:false});
    expect(checkTargets([{kind:'shared_env',id}],[]).blocked).toBe(true);
    expect(checkTargets([{kind:'shared_env',id,accountId:team}],[{match:id}]).blocked)
      .toBe(true);
  });
  it('fails closed on a concurrent metadata revision before dispatch',async()=>{
    const f=fixture();
    f.fake.when('GET','/v1/env')
      .resolves({data:[row],pagination:{next:null}})
      .resolves({data:[{...row,updatedAt:101}],pagination:{next:null}});
    const out=parse(await f.call('vercel_shared_env_set',setUpdate));
    expect(out).toMatchObject({status:'refused_by_guard'});
    expect(mutations(f)).toHaveLength(0);
  });
  it('does not claim confirmation for bad provider identity or missing owner visibility',async()=>{
    const f=fixture([]);
    f.fake.when('POST','/v1/env')
      .resolves({created:[{...row,key:'OTHER'}],failed:[]});
    expect(parse(await f.call('vercel_shared_env_set',setCreate)).status)
      .not.toBe('applied');
    const r=fixture([]);
    r.fake.when('POST','/v1/env')
      .resolves({created:[{...row,id:'env_FAKE_SHARED_NEW',key:'SHARED_NEW'}],failed:[]});
    r.fake.when('GET','/v1/env')
      .resolves({data:[],pagination:{next:null}})
      .resolves({data:[],pagination:{next:null}})
      .resolves({data:[{...row,id:'env_FAKE_SHARED_NEW',key:'SHARED_NEW',
        type:'encrypted',projectId:[project]}],pagination:{next:123}});
    expect(parse(await r.call('vercel_shared_env_set',setCreate)))
      .toMatchObject({status:'applied',confirmed:null});
  });
});
