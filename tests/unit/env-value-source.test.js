import {beforeEach,describe,expect,it,vi} from 'vitest';
import {registry} from '../../src/tools/index.js';
import {dispatchReadOnlyTool} from '../../src/core/mcp-server.js';
import {makeFakeVercel} from '../../test/helpers/fake-vercel.js';
import {loadToken} from '../../src/vercel/tokens.js';
import {checkValueSource,secretLookingName,credentialShapedConfig,VALUE_REFUSALS}
  from '../../src/tools/env-value-source.js';
vi.mock('../../src/vercel/tokens.js',async old=>({...await old(),loadToken:vi.fn()}));

// ENV-PLAIN: plain non-secret Config values may be typed into the call; every
// other inline value is refused with an explained reason and remedy.
const project='prj_FAKE_PLAIN',id='env_FAKE_PLAIN01',key='NATIVE_GIT_WORKER_URL';
const url='https://desktop-fake.tailFAKE.ts.net';
// Built at run time so the repository secret scanner never sees a token shape.
const GH=(p)=>'gh'+p+'_FAKE'+'0'.repeat(36);
const connection={account:'acct_FAKE',profile:'full',mode:'preview',listing:'catalog'};
const token={token:'vcp_FAKE_plainvalue',account:{
  id:'acct_FAKE',scope:'project',project_id:project,team_id:'team_FAKE'}};
const row={id,projectId:project,key,type:'plain',target:['preview'],updatedAt:100,
  customEnvironmentIds:[],value:'https://old-fake.example.test'};
const update={project,key,mode:'update',id,expectedUpdatedAt:100,targets:['preview'],
  kind:'Config',value:url,confirm:true,requestKey:'plainUpdateFake_01'};
const parse=r=>JSON.parse(r.content[0].text);
function fixture(){
  const fake=makeFakeVercel(),audits=[],memo=new Map();
  const db={
    getAccountCredential:async()=>({}),listProtectedResources:async()=>[],
    recordChange:async r=>audits.push(r),
    requestReplayStore:()=>({
      claim:async({key:k})=>memo.has(k)?{state:'completed',result:memo.get(k)}:
        {state:'claimed',claimId:k},
      complete:async({key:k,result})=>{memo.set(k,result);},
      release:async()=>true
    })
  };
  fake.when('GET','/v9/projects/{idOrName}')
    .resolves({id:project,name:'fake-plain-project',hasDeployments:false});
  const call=(name,args)=>dispatchReadOnlyTool({registry,name,args,connection,db,
    fetchImpl:fake.fetch});
  return {fake,call,audits};
}

describe('ENV-PLAIN value source rules',()=>{
  it('accepts plain non-secret Config values, including public web addresses',()=>{
    for(const value of [url,'https://app.example.test/path?page=2&lang=en','true',
      'us-east-1','{"theme":"dark"}','line one\nline two'])
      expect(checkValueSource({key:'APP_SETTING',kind:'Config',value})).toMatchObject(
        {kind:'Config',source:'value'});
    expect(checkValueSource({key:'K',kind:'Secret',
      generate:{bytes:32,encoding:'hex'},targets:['preview']}).source).toBe('generate');
  });
  it('refuses credential-shaped Config values with the private-path remedy',()=>{
    for(const value of [
      GH('p'),GH('s'),
      'github_pat_FAKE000000000000','sk_live_FAKE0000','xoxb-FAKE-0000',
      '-----BEGIN FAKE KEY-----','https://user:pw@host.example.test/x',
      'redis://default:FAKEpw@cache.example.test:6379',
      'https://h.example.test/x?token=abc','https://h.example.test/x?api_key=abc',
      'https://h.example.test/x?a=1&X-Amz-Signature=abc',
      'https://h.example.test/x?sig=abc','https://h.example.test/x?password=abc',
      'https://h.example.test/x?client_secret=abc',
      'Zm9vYmFyRkFLRTAwMDAwMDAwMDAwMDAwMDAwMDAwMDAw',
      'deadbeefdeadbeefdeadbeefdeadbeef00'
    ]){
      expect(credentialShapedConfig(value)).toBe(true);
      expect(()=>checkValueSource({key:'APP_SETTING',kind:'Config',value}))
        .toThrow(VALUE_REFUSALS.credential);
    }
    expect(VALUE_REFUSALS.credential).toContain('generate');
    // The write core shows reasons up to 300 characters; batch adds 'KEY: '.
    for(const reason of Object.values(VALUE_REFUSALS))
      expect(reason.length).toBeLessThanOrEqual(240);
    expect(VALUE_REFUSALS.credential).toContain('Vercel dashboard');
  });
  it('judges secret-looking names, exempting address/ID suffixes and browser-public prefixes',()=>{
    for(const name of ['API_SECRET','GITHUB_TOKEN','DB_PASSWORD','BACKUP_PASSPHRASE',
      'PRIVATE_SIGNING','STRIPE_KEY','OPENAI_API_KEY','AWS_CREDENTIALS'])
      expect(secretLookingName(name)).toBe(true);
    for(const name of ['NATIVE_GIT_WORKER_URL','APP_ORIGIN','KEY_ID','TOKEN_HOST',
      'NEXT_PUBLIC_STRIPE_KEY','VITE_MAPS_KEY','MONKEY_MODE','KEYBOARD_LAYOUT','APP_NAME'])
      expect(secretLookingName(name)).toBe(false);
    expect(()=>checkValueSource({key:'API_SECRET',kind:'Config',value:'plain'}))
      .toThrow(VALUE_REFUSALS.secretName);
    // An exempt name is still checked by its value.
    expect(()=>checkValueSource({key:'DATABASE_URL',kind:'Config',
      value:'postgres://u:FAKEpw@localhost/x'})).toThrow(VALUE_REFUSALS.credential);
  });
  it('refuses typed Secret values, mixed sources, bad lengths and control characters with reasons',()=>{
    const cases=[
      [{key:'K',value:url},VALUE_REFUSALS.secretTyped],
      [{key:'K',kind:'Secret',value:url},VALUE_REFUSALS.secretTyped],
      [{key:'K',kind:'Config'},VALUE_REFUSALS.oneSource],
      [{key:'K',kind:'Config',value:url,generate:{bytes:32,encoding:'hex'}},VALUE_REFUSALS.oneSource],
      [{key:'K',kind:'Config',generate:{bytes:32,encoding:'hex'}},VALUE_REFUSALS.configGenerate],
      [{key:'K',kind:'Secret',generate:{bytes:16,encoding:'hex'}},VALUE_REFUSALS.generateShape],
      [{key:'K',kind:'Secret',generate:{bytes:32,encoding:'hex'},targets:['development']},
        VALUE_REFUSALS.secretDevelopment],
      [{key:'K',kind:'Config',value:''},VALUE_REFUSALS.length],
      [{key:'K',kind:'Config',value:'a'.repeat(65537)},VALUE_REFUSALS.length],
      [{key:'K',kind:'Config',value:'bad\u0000value'},VALUE_REFUSALS.control],
      [{key:'K',kind:'Config',value:'bad\u001bvalue'},VALUE_REFUSALS.control]
    ];
    for(const [item,reason] of cases)expect(()=>checkValueSource(item)).toThrow(reason);
    expect(VALUE_REFUSALS.secretTyped).toContain('kind "Config"');
  });
});

describe('ENV-PLAIN through the vercel_env_set and vercel_env_set_many doors',()=>{
  beforeEach(()=>{vi.clearAllMocks();loadToken.mockResolvedValue(token);});
  it('updates a Config web address from an inline value, verifies it and never echoes it',async()=>{
    const f=fixture();
    f.fake.when('GET','/v1/projects/{idOrName}/env/{id}')
      .resolves(row).resolves(row).resolves({...row,value:url,updatedAt:101});
    f.fake.when('PATCH','/v9/projects/{idOrName}/env/{id}').resolves({id,key});
    const out=parse(await f.call('vercel_env_set',update));
    expect(out).toMatchObject({status:'applied',confirmed:true});
    const patch=f.fake.calls.find(c=>c.method==='PATCH');
    expect(patch.body).toEqual({value:url,type:'plain',target:['preview']});
    expect(JSON.stringify(out)).not.toContain(url);
    expect(JSON.stringify(f.audits)).not.toContain(url);
  });
  it('previews the inline value change without writing, and keeps the value hidden',async()=>{
    const f=fixture();
    f.fake.when('GET','/v1/projects/{idOrName}/env/{id}').resolves(row);
    const out=parse(await f.call('vercel_env_set',{...update,confirm:undefined,dryRun:true}));
    expect(out.status).toBe('preview');
    expect(out.preview).toContain('Replace Config variable '+key);
    expect(JSON.stringify(out)).not.toContain(url);
    expect(f.fake.calls.every(c=>c.method==='GET')).toBe(true);
  });
  it('refuses each unsafe inline value with its named reason and sends nothing',async()=>{
    const cases=[
      [{...update,value:GH('p')},VALUE_REFUSALS.credential],
      [{...update,value:'https://u:p@host.example.test'},VALUE_REFUSALS.credential],
      [{...update,value:url+'/?token=abc'},VALUE_REFUSALS.credential],
      [{...update,kind:undefined},VALUE_REFUSALS.secretTyped],
      [{...update,kind:'Secret'},VALUE_REFUSALS.secretTyped],
      [{...update,key:'WORKER_TOKEN'},VALUE_REFUSALS.secretName],
      [{...update,value:'two\u0007bells'},VALUE_REFUSALS.control]
    ];
    for(const [args,reason] of cases){
      const f=fixture();
      f.fake.when('GET','/v1/projects/{idOrName}/env/{id}').resolves(row);
      const out=parse(await f.call('vercel_env_set',{...args,dryRun:true}));
      expect(out.status).toBe('refused_by_guard');
      expect(out.reason).toBe(reason);
      expect(JSON.stringify(out)).not.toContain('ghp_FAKE');
      expect(f.fake.calls.some(c=>c.method!=='GET')).toBe(false);
    }
  });
  it('applies the same rules per item in vercel_env_set_many, naming the item',async()=>{
    const f=fixture();
    const out=parse(await f.call('vercel_env_set_many',{project,dryRun:true,
      requestKey:'plainBatchFake_01',items:[
        {key:'APP_ORIGIN',targets:['preview'],kind:'Config',value:url},
        {key:'SERVICE_TOKEN',targets:['preview'],kind:'Config',value:'plain'}]}));
    expect(out.status).toBe('refused_by_guard');
    expect(out.reason).toBe('SERVICE_TOKEN: '+VALUE_REFUSALS.secretName);
    expect(f.fake.calls.some(c=>c.method!=='GET')).toBe(false);
    const ok=parse(await fixture().call('vercel_env_set_many',{project,dryRun:true,
      requestKey:'plainBatchFake_02',items:[
        {key:'APP_ORIGIN',targets:['preview'],kind:'Config',value:url},
        {key:'APP_REGION',targets:['preview'],kind:'Config',value:'us-east-1'}]}));
    expect(ok.status).toBe('preview');
  });
});
