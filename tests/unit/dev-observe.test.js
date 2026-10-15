import {beforeEach,describe,it,expect,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {registry} from '../../src/tools/index.js';
import {dispatchReadOnlyTool} from '../../src/core/mcp-server.js';
import {makeFakeVercel} from '../../test/helpers/fake-vercel.js';
import {loadToken} from '../../src/vercel/tokens.js';
import {lookup} from 'node:dns/promises';
import {encryptSecret} from '../../src/core/secret-box.js';
import {BUILD_RULES,diagnoseBuildText} from '../../src/dev/build-failures.js';
import {publicAddress,pinnedHttpsGet,publicHost} from '../../src/tools/dev-preview-fetch.js';
vi.mock('../../src/vercel/tokens.js',async orig=>({...await orig(),loadToken:vi.fn()}));
vi.mock('node:dns/promises',()=>({lookup:vi.fn()}));
const account='acct_FAKE_DEV3',team='team_FAKE_DEV3';
const project='prj_FAKE_DEV3',deployment='dpl_FAKE_DEV3_PREVIEW';
const runId='run_20261015_aabbcc11';
const host='rtc-preview-demo.vercel.app';
const conn={account,profile:'read_only',mode:'preview',listing:'catalog'};
const env={TOKEN_ENCRYPTION_KEY:'12'.repeat(32)};
const parse=x=>JSON.parse(x.content?.[0]?.text??'{}');
const event=(created,id,text,type='stdout')=>({created,type,
  payload:{id,created,date:created,deploymentId:deployment,
    serial:String(created),text}});
function fixture(extraObjects=[],projectOverrides={}){
  const fake=makeFakeVercel(),requests=[],audit=[];
  const objects=[{object_type:'deployment',object_id:deployment,
    project_id:project,status:'active',detail:{target:'preview'}},...extraObjects];
  const db={
    getAccountCredential:async()=>({}),
    listProtectedResources:async()=>[],
    getDevRun:async({id,account:a})=>id===runId&&a===account?
      {id,status:'active'}:null,
    listDevRunObjects:async({id,account:a})=>id===runId&&a===account?
      structuredClone(objects):[],
    recordChange:async o=>audit.push(o)
  };
  const row={id:project,name:'rtc-preview-demo',accountId:team,
    framework:'nextjs',nodeVersion:'22.x',crons:{definitions:[]},
    ...projectOverrides};
  fake.when('GET','/v9/projects/{idOrName}').resolves(row);
  fake.when('GET','/v13/deployments/{idOrUrl}').resolves({
    uid:deployment,projectId:project,target:'preview',url:host,readyState:'READY'});
  const defaultFetch=async(input,options={})=>{
    const url=String(input);
    if(url.startsWith('https://'+host+'/')){
      requests.push({url,options});
      return new Response('synthetic preview body',{status:200,
        headers:{'content-type':'text/plain','x-vercel-cache':'MISS'}});
    }
    return fake.fetch(input,options);
  };
  const call=(name,args={},connection=conn,fetchImpl=defaultFetch)=>dispatchReadOnlyTool({
    registry,name,args,connection,db,env,fetchImpl
  });
  return {fake,call,db,row,objects,audit,requests,defaultFetch};
}
describe('V-3 preview-only observation and diagnostics',()=>{
  beforeEach(()=>{
    vi.clearAllMocks();
    loadToken.mockResolvedValue({token:'vcp_FAKE_READ3',
      account:{id:account,scope:'team',team_id:team}});
    lookup.mockResolvedValue([{address:'8.8.8.8',family:4}]);
  });
  it('matches each documented build diagnostic rule against realistic synthetic errors',()=>{
    const examples={
      'missing-env':'Environment variable DATABASE_URL is not set',
      'node-version':'Unsupported Node engine version 99.x',
      'lockfile':'lockfile out of date with package.json',
      'install':'npm ERR! package resolution',
      'typescript-lint':'TS2322: Type assignment failed',
      memory:'JavaScript heap out of memory',
      'command-missing':'sh: next: command not found',
      'ignored-build':'Ignored build step returned skip',
      framework:'Could not detect framework',
      'file-limit':'File size limit reached'
    };
    expect(BUILD_RULES.map(r=>r.id)).toEqual(Object.keys(examples));
    for(const [id,message] of Object.entries(examples))
      expect(diagnoseBuildText(message).rule).toBe(id);
    expect(diagnoseBuildText('unclassifiable synthetic error').rule).toBe('unknown');
  });
  it('tails only newly observed provider events with a signed account-bound cursor',async()=>{
    const f=fixture();
    f.fake.when('GET','/v3/deployments/{idOrUrl}/events')
      .resolves([event(1000,'evt_a','hello preview build')])
      .resolves([event(1000,'evt_a','hello preview build'),
        event(2000,'evt_b','TOKEN=do-not-show')]);
    const first=parse(await f.call('vercel_dev_tail_logs',
      {runId,project,deployment,source:'build',limit:5}));
    expect(first.lines).toHaveLength(1);
    expect(first.lines[0].message).toBe('hello preview build');
    expect(typeof first.cursor).toBe('string');
    expect(first.complete).toBe(false);
    const second=parse(await f.call('vercel_dev_tail_logs',
      {runId,project,deployment,source:'build',limit:5,cursor:first.cursor}));
    expect(second.lines).toHaveLength(1);
    expect(second.lines[0].created).toBe(2000);
    expect(second.lines[0].message).toBe('[hidden]');
    expect(JSON.stringify(second)).not.toContain('do-not-show');
    f.fake.verify();
  });
  it('refuses tampered or foreign continuation before making provider calls',async()=>{
    const f=fixture();
    const out=await f.call('vercel_dev_tail_logs',{
      runId,project,deployment,cursor:'a'.repeat(60)+'.'+'x'.repeat(43)});
    expect(out.isError).toBe(true);
    expect(f.fake.calls).toHaveLength(0);
  });
  it('classifies a preview build failure without echoing provider error text',async()=>{
    const f=fixture();
    f.fake.when('GET','/v3/deployments/{idOrUrl}/events')
      .resolves([event(1234,'evt_failure','TS2322: Private issue','stderr')]);
    const out=parse(await f.call('vercel_dev_diagnose_build',{runId,project,deployment}));
    expect(out).toMatchObject({state:'failure_detected',rule:'typescript-lint',complete:false});
    expect(out.fix).toMatch(/typecheck/);
    f.fake.verify();
  });
  it('refuses any production connection before looking up a provider project',async()=>{
    const f=fixture();
    for(const name of ['vercel_dev_tail_logs','vercel_dev_diagnose_build',
      'vercel_dev_fetch_preview']){
      const extra=name==='vercel_dev_fetch_preview'?{paths:['/']}:{};
      const out=await f.call(name,{runId,project,deployment,...extra},
        {...conn,mode:'production'});
      expect(out.isError).toBe(true);
    }
    expect(f.fake.calls).toHaveLength(0);
  });
  it('enforces public-only IP classifications independent of DNS resolver',()=>{
    for(const ip of ['127.0.0.1','10.2.3.4','172.19.1.2','192.168.1.1',
      '169.254.169.254','100.100.1.2','::1','fc00::1','::ffff:127.0.0.1',
      '2001:db8::1'])expect(publicAddress(ip)).toBe(false);
    expect(publicAddress('8.8.8.8')).toBe(true);
    expect(publicAddress('2606:4700::1111')).toBe(true);
  });
  it('pins the verified public IP on the native HTTPS socket and preserves TLS hostname',async()=>{
    let observed;
    const requestImpl=(url,options,callback)=>{
      observed={url,options};
      const req=new EventEmitter();
      req.setTimeout=()=>{};
      req.end=()=>{
        const response=new PassThrough();
        response.statusCode=200;
        response.headers={'content-type':'text/plain'};
        callback(response);
        response.end('pinned synthetic success');
      };
      req.destroy=error=>req.emit('error',error);
      return req;
    };
    const url=new URL('https://'+host+'/health');
    const r=await pinnedHttpsGet(url,{address:'8.8.8.8',family:4,requestImpl});
    expect(r).toMatchObject({status:200,sample:'pinned synthetic success',truncated:false});
    expect(observed.url.hostname).toBe(host);
    expect(observed.options.agent).toBe(false);
    expect(observed.options.method).toBe('GET');
    observed.options.lookup(host,{},(error,address,family)=>{
      expect(error).toBe(null);
      expect(address).toBe('8.8.8.8');
      expect(family).toBe(4);
    });
  });
  it('rejects DNS rebinding addresses before creating any TLS socket',async()=>{
    let called=false;
    expect(()=>pinnedHttpsGet(new URL('https://'+host+'/'),
      {address:'127.0.0.1',family:4,requestImpl:()=>{
        called=true;throw new Error('must never connect');
      }})).toThrow(/Unverified outbound/);
    expect(called).toBe(false);
    lookup.mockResolvedValue([{address:'8.8.8.8',family:4},
      {address:'127.0.0.1',family:4}]);
    await expect(publicHost(host)).rejects.toThrow(/private, mixed/);
  });
  it('rejects a server-side HTTPS redirect without reading or following the target',async()=>{
    const requestImpl=(_url,_options,callback)=>{
      const req=new EventEmitter();
      req.setTimeout=()=>{};
      req.end=()=>{
        const res=new PassThrough();
        res.statusCode=302;
        res.headers={location:'http://127.0.0.1/metadata'};
        callback(res);
      };
      req.destroy=error=>req.emit('error',error);
      return req;
    };
    await expect(pinnedHttpsGet(new URL('https://'+host+'/'),
      {address:'8.8.8.8',family:4,requestImpl}))
      .rejects.toThrow(/redirect refused/);
  });
  it('fetches an exact owned public preview path with encrypted bypass strictly in process',async()=>{
    const secret='cdef0123456789abcdef0123456789ab';
    const id='byp_'+createHash('sha256').update(secret).digest('hex').slice(0,32);
    const ciphertext=encryptSecret(secret,'dev-bypass:'+runId+':'+id,env);
    const f=fixture([{object_type:'bypass',object_id:id,project_id:project,
      status:'active',detail:{ciphertext}}]);
    const out=parse(await f.call('vercel_dev_fetch_preview',{
      runId,project,deployment,paths:['/','/api/health'],bypassId:id}));
    expect(out).toMatchObject({complete:true,bypassUsed:true,bypassValueReturned:false});
    expect(out.results.map(x=>x.status)).toEqual([200,200]);
    expect(f.requests).toHaveLength(2);
    expect(f.requests[0].options.redirect).toBe('manual');
    expect(f.requests[0].options.headers['x-vercel-protection-bypass']).toBe(secret);
    expect(JSON.stringify(out)).not.toContain(secret);
    f.fake.verify();
  });
  it('denies private DNS or redirected previews and rejects unsafe paths',async()=>{
    const f=fixture();
    lookup.mockResolvedValue([{address:'127.0.0.1',family:4}]);
    const privateResult=await f.call('vercel_dev_fetch_preview',
      {runId,project,deployment,paths:['/']});
    expect(privateResult.isError).toBe(true);
    expect(f.requests).toHaveLength(0);
    lookup.mockResolvedValue([{address:'8.8.8.8',family:4}]);
    const bad=await f.call('vercel_dev_fetch_preview',
      {runId,project,deployment,paths:['/../internal']});
    expect(bad.isError).toBe(true);
    const redirected=async(input,opts)=>{
      if(String(input).startsWith('https://'+host+'/'))
        return new Response(null,{status:302,headers:{location:'http://127.0.0.1/'}});
      return f.fake.fetch(input,opts);
    };
    const result=parse(await f.call('vercel_dev_fetch_preview',
      {runId,project,deployment,paths:['/']},conn,redirected));
    expect(result.complete).toBe(false);
    expect(result.results[0].status).toBe(null);
    f.fake.verify();
  });
  it('checks only preview metadata with honest unverified provider integration findings',async()=>{
    const f=fixture();
    f.fake.when('GET','/v10/projects/{idOrName}/env').resolves({
      envs:[{id:'env_fake',key:'PREVIEW_DB',target:['preview'],
        value:'must-not-return'}],pagination:{next:null,count:1}});
    const out=parse(await f.call('vercel_dev_check_integration',{
      spec:{runId,project,envNames:{preview:['PREVIEW_DB']},
        framework:'nextjs',nodeVersion:'22.x',integrations:['stripe']}}));
    expect(out.ready).toBe(false);
    expect(out.rows.find(x=>x.type==='env:preview').status).toBe('ok');
    expect(out.rows.find(x=>x.type==='integration').status).toBe('unverified');
    expect(JSON.stringify(out)).not.toContain('must-not-return');
    f.fake.verify();
  });
  it('refuses production environment expectations without touching Vercel',async()=>{
    const f=fixture();
    const x=await f.call('vercel_dev_check_integration',{
      spec:{runId,project,envNames:{production:['LIVE_DB']}}});
    expect(x.isError).toBe(true);
    expect(f.fake.calls).toHaveLength(0);
  });
});
