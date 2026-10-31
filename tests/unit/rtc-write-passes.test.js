// R-1W: write-capable RTC passes at the door (BATCH-R amendment, 2026-10-30).
// The fixture write tools are REAL guarded writes (defineWrite +
// bindGuardedWrite): a write-shaped row alone must never become visible.
import {describe,it,expect,vi} from 'vitest';
import {rtcDoor} from '../../src/rtc/door.js';
import {defineWrite,bindGuardedWrite} from '../../src/core/write.js';
import {dispatchReadOnlyTool} from '../../src/core/mcp-server.js';
const ACCOUNT='team_FAKE';
const applied=[];
const fixtureContext=({db,connection,env,fetchImpl})=>({db,connection,env,fetchImpl,
  shape:x=>x,audit:async()=>{},replayStore:db.requestReplayStore(),
  guardProtected:async()=>({blocked:false}),guardApp:async()=>({blocked:false}),
  checkSpend:async d=>d.cents===0?{allowed:true,spentTodayCents:0}:
    {allowed:false,reason:'fixture spend gate'}});
const output=x=>({isError:['refused_by_guard','outcome_unknown'].includes(x.status),
  content:[{type:'text',text:JSON.stringify(x)}]});
function makeWrite(name,{spend=null,project='prj_FAKEONE'}={}){
  const spec={name,
    async before(){return {project};},
    async preview(){return 'Fixture write preview for '+name;},
    async production(){return {production:false,why:'Fixture write'};},
    async targets(){return [{kind:'project',id:project}];},
    async apply(_args,ctx){applied.push({name,delegation:ctx.purchaseDelegation??null});return {done:true};},
    async verify(){return {confirmed:true};}};
  if(spend){spec.risk={spend:true};spec.spend=async()=>spend;}
  const write=defineWrite(spec);
  return {write,handler:bindGuardedWrite(write,fixtureContext,output)};
}
const plain=makeWrite('vercel_fixture_write');
const priced=makeWrite('vercel_fixture_buy',{spend:{cents:300,recurring:false,description:'Fixture purchase'}});
const pricey=makeWrite('vercel_fixture_pricey',{spend:{cents:600,recurring:false,description:'Fixture purchase'}});
const recurring=makeWrite('vercel_fixture_sub',{spend:{cents:300,recurring:true,description:'Fixture subscription'}});
const unpriced=makeWrite('vercel_fixture_metered',{spend:{cents:null,recurring:false,description:'Fixture metered usage'}});
const WRITE_TOOLS=[
 {name:'vercel_fixture_write',area:'fixture',profiles:['everyday','full'],writes:true,guardedWrite:true,writeContract:plain.write.writeContract,description:'Fixture write',inputSchema:{type:'object',properties:{},additionalProperties:true}},
 {name:'vercel_fixture_buy',area:'fixture',profiles:['everyday','full'],writes:true,guardedWrite:true,writeContract:priced.write.writeContract,description:'Fixture priced write',inputSchema:{type:'object',properties:{},additionalProperties:true}},
 {name:'vercel_fixture_pricey',area:'fixture',profiles:['everyday','full'],writes:true,guardedWrite:true,writeContract:pricey.write.writeContract,description:'Fixture pricey write',inputSchema:{type:'object',properties:{},additionalProperties:true}},
 {name:'vercel_fixture_sub',area:'fixture',profiles:['everyday','full'],writes:true,guardedWrite:true,writeContract:recurring.write.writeContract,description:'Fixture recurring write',inputSchema:{type:'object',properties:{},additionalProperties:true}},
 {name:'vercel_fixture_metered',area:'fixture',profiles:['everyday','full'],writes:true,guardedWrite:true,writeContract:unpriced.write.writeContract,description:'Fixture metered write',inputSchema:{type:'object',properties:{},additionalProperties:true}},
 // Right shape, wrong authority: marked writes but NOT a guarded write.
 {name:'vercel_fixture_forged',area:'fixture',profiles:['everyday','full'],writes:true,description:'Forged write row',inputSchema:{type:'object',properties:{},additionalProperties:true}}];
const registry={tools:[
 {name:'vercel_fixture_read',area:'server',profiles:['read_only','everyday','full'],writes:false,description:'Fixture read',inputSchema:{type:'object',properties:{},additionalProperties:true}},
 ...WRITE_TOOLS],
 handlers:{vercel_fixture_read:async()=>({content:[{type:'text',text:'{"ok":true}'}]}),
  vercel_fixture_write:plain.handler,vercel_fixture_buy:priced.handler,
  vercel_fixture_pricey:pricey.handler,vercel_fixture_sub:recurring.handler,
  vercel_fixture_metered:unpriced.handler,
  vercel_fixture_forged:async()=>({content:[{type:'text',text:'{"ok":true}'}]})}};
function passRecord(overrides={}){
  return {id:'pass_aaaaaaaaaaaaaaaaaaaa',account:ACCOUNT,profile:'everyday',
    mode:'preview',areas:['server','fixture'],listing:'catalog',rateLimitPerMinute:60,
    allowWrites:true,spendLimitCents:500,projectIds:null,...overrides};
}
function door(record){
  const replays=new Map();
  const db={inspectRtcPass:vi.fn(async()=>({status:'ok',...record,expiresAt:Date.now()+3600000})),
    authorizeRtcPass:vi.fn(async()=>({status:'ok',...record})),
    requestReplayStore:()=>({claim:async({key})=>{
      if(replays.has(key))return replays.get(key);
      replays.set(key,{state:'pending'});return {state:'claimed',claimId:'FAKE'};},
      complete:async({key,result})=>replays.set(key,{state:'completed',result}),
      release:async({key})=>replays.delete(key)})};
  return rtcDoor({db,env:{},registry});
}
const PASS_TOKEN='rtc_pass_'+'A'.repeat(43);
async function call(d,route,method='GET',query={},body){
  const r={headers:{},code:0,body:null,
    status(n){this.code=n;return this;},
    setHeader(k,v){this.headers[k]=v;return this;},
    send(t){this.body=JSON.parse(t);return this;}};
  await d({method,query,body,headers:{authorization:'Bearer '+PASS_TOKEN}},r,route);
  return {status:r.code,...(r.body||{})};
}
const invoke=(d,name,args={})=>call(d,'invoke','POST',{name},args);
describe('R-1W write-capable passes at the RTC door',()=>{
  it('lists and describes guarded writes for a write pass; a read pass never sees them',async()=>{
    applied.length=0;
    const writeDoor=door(passRecord());
    const tools=await call(writeDoor,'list');
    expect(tools.result.tools.map(t=>t.name)).toContain('vercel_fixture_write');
    expect(tools.result.tools.map(t=>t.name)).not.toContain('vercel_fixture_forged');
    const described=await call(writeDoor,'describe','GET',{name:'vercel_fixture_write'});
    expect(described.result.name).toBe('vercel_fixture_write');
    const readDoor=door({id:'pass_aaaaaaaaaaaaaaaaaaaa',account:ACCOUNT,profile:'read_only',
      mode:'preview',areas:['server','fixture'],listing:'catalog',rateLimitPerMinute:60});
    const readTools=await call(readDoor,'list');
    expect(readTools.result.tools.map(t=>t.name)).not.toContain('vercel_fixture_write');
    expect((await call(readDoor,'describe','GET',{name:'vercel_fixture_write'})).error?.code)
      .toBe('outside_scope');
    // AUD-BG (2026-10-31): invoke of an existing write tool by a pass
    // that cannot write is refused_by_guard (the frozen RTC 1
    // conformance suite's passes.read_only expectation); describe
    // above keeps outside_scope, and nothing is applied either way.
    expect((await invoke(readDoor,'vercel_fixture_write',{confirm:true})).error?.code)
      .toBe('refused_by_guard');
    expect(applied).toEqual([]);
  });
  it('runs a write through the shared executor: preview, confirmation, apply',async()=>{
    applied.length=0;
    const d=door(passRecord());
    expect((await invoke(d,'vercel_fixture_write',{dryRun:true})).result.preview).toMatch(/Fixture write preview/);
    expect((await invoke(d,'vercel_fixture_write',{})).result.status).toBe('needs_confirmation');
    expect(applied).toEqual([]);
    const done=await invoke(d,'vercel_fixture_write',{confirm:true});
    expect(done.result.status).toBe('applied');
    expect(applied.map(x=>x.name)).toEqual(['vercel_fixture_write']);
  });
  it('delegates a fixed price within the ceiling and journals the pass basis',async()=>{
    applied.length=0;
    const d=door(passRecord({spendLimitCents:500}));
    const done=await invoke(d,'vercel_fixture_buy',{confirm:true});
    expect(done.result.status).toBe('applied');
    expect(done.result.delegation).toMatchObject({basis:'pass',ceilingCents:500,quotedCents:300});
    expect(applied[0].delegation).toMatchObject({basis:'pass',operation:'vercel_fixture_buy'});
  });
  it('never applies spend over the ceiling, recurring spend, unquantified spend or any spend at a zero ceiling',async()=>{
    applied.length=0;
    const d=door(passRecord({spendLimitCents:500}));
    for(const name of ['vercel_fixture_pricey','vercel_fixture_sub','vercel_fixture_metered']){
      const refused=await invoke(d,name,{confirm:true});
      expect(refused.result?.status).not.toBe('applied');
      expect(refused.error?.code).toBeTruthy();
    }
    const zero=door(passRecord({spendLimitCents:0}));
    expect((await invoke(zero,'vercel_fixture_buy',{confirm:true})).result?.status).not.toBe('applied');
    expect(applied).toEqual([]);
  });
  it('enforces the project restriction at the executor seam',async()=>{
    applied.length=0;
    const restricted=door(passRecord({projectIds:['prj_OTHER999']}));
    const refused=await invoke(restricted,'vercel_fixture_write',{confirm:true});
    expect(refused.result?.status).not.toBe('applied');
    expect(refused.error?.code).toBeTruthy();
    const allowed=door(passRecord({projectIds:['prj_FAKEONE']}));
    expect((await invoke(allowed,'vercel_fixture_write',{confirm:true})).result.status).toBe('applied');
    expect(applied.map(x=>x.name)).toEqual(['vercel_fixture_write']);
  });
  it('keeps the batch route read-only even for a write pass',async()=>{
    const d=door(passRecord());
    const batch=await call(d,'batch','POST',{},{calls:[
      {name:'vercel_fixture_read',args:{}},{name:'vercel_fixture_write',args:{confirm:true}}]});
    expect(batch.error?.code).toBe('refused_by_guard');
    const reads=await call(d,'batch','POST',{},{calls:[{name:'vercel_fixture_read',args:{}}]});
    expect(reads.result.results[0].ok).toBe(true);
  });
  it('reports write capability on whoami; the read whoami shape is unchanged',async()=>{
    const me=await call(door(passRecord({spendLimitCents:250})),'whoami');
    expect(me.result).toMatchObject({profile:'everyday',writes:true,spendLimitCents:250,projectIds:null});
    const readDoor=door({id:'pass_aaaaaaaaaaaaaaaaaaaa',account:ACCOUNT,profile:'read_only',
      mode:'preview',areas:['server'],listing:'catalog',rateLimitPerMinute:60});
    const readMe=await call(readDoor,'whoami');
    expect(readMe.result).toEqual({profile:'read_only',mode:'preview',listing:'catalog',
      areas:['server'],rateLimitPerMinute:60});
  });
  it('hides full-only writes from an everyday pass',async()=>{
    const d=door(passRecord({profile:'everyday'}));
    const fullOnly={...WRITE_TOOLS[0],name:'vercel_fixture_admin',profiles:['full']};
    const reg={tools:[...registry.tools,fullOnly],
      handlers:{...registry.handlers,vercel_fixture_admin:plain.handler}};
    const replays=new Map();
    const db={inspectRtcPass:vi.fn(async()=>({status:'ok',...passRecord(),expiresAt:Date.now()+3600000})),
      authorizeRtcPass:vi.fn(async()=>({status:'ok',...passRecord()})),
      requestReplayStore:()=>({claim:async({key})=>{replays.set(key,{state:'pending'});return {state:'claimed',claimId:'FAKE'};},
        complete:async()=>{},release:async()=>{}})};
    const d2=rtcDoor({db,env:{},registry:reg});
    const tools=await call(d2,'list');
    expect(tools.result.tools.map(t=>t.name)).not.toContain('vercel_fixture_admin');
    expect(d).toBeTruthy();
  });
});
describe('R-1W pass seams at the shared dispatcher (the connection the door mints)',()=>{
  const db={requestReplayStore:()=>{const m=new Map();return {
    claim:async({key})=>{if(m.has(key))return m.get(key);m.set(key,{state:'pending'});
      return {state:'claimed',claimId:'FAKE'};},
    complete:async({key,result})=>m.set(key,{state:'completed',result}),release:async()=>{}};}};
  const connection=(overrides={})=>Object.freeze({account:ACCOUNT,profile:'everyday',
    mode:'preview',listing:'catalog',clientId:'pass_aaaaaaaaaaaaaaaaaaaa',kind:'pass',
    passAllowWrites:true,passSpendLimitCents:500,passProjectIds:null,...overrides});
  const run=async(name,conn,args={confirm:true})=>{
    const r=await dispatchReadOnlyTool({registry,name,args,connection:conn,db,env:{}});
    return JSON.parse(r.content[0].text);
  };
  it('names the ceiling, the delegation rule and the project restriction in its refusals',async()=>{
    applied.length=0;
    expect((await run('vercel_fixture_pricey',connection())).reason)
      .toMatch(/exceeds the spend ceiling on this pass/);
    expect((await run('vercel_fixture_sub',connection())).reason)
      .toMatch(/Recurring or unquantified spend cannot be delegated to a pass/);
    expect((await run('vercel_fixture_metered',connection())).reason)
      .toMatch(/Recurring or unquantified spend cannot be delegated to a pass/);
    expect((await run('vercel_fixture_write',connection({passProjectIds:['prj_OTHER999']}))).reason)
      .toMatch(/restricted to specific projects/);
    expect(applied).toEqual([]);
  });
  it('refuses a claimed write pass whose ceiling was never minted',async()=>{
    const malformed=Object.freeze({account:ACCOUNT,profile:'everyday',mode:'preview',
      listing:'catalog',clientId:'pass_aaaaaaaaaaaaaaaaaaaa',kind:'pass',
      passAllowWrites:true});
    expect((await run('vercel_fixture_buy',malformed)).reason)
      .toMatch(/Pass spend authority cannot be verified/);
  });
  it('still lets a write pass run a genuinely free write through the zero-cost path',async()=>{
    applied.length=0;
    const done=await run('vercel_fixture_write',connection({passSpendLimitCents:0}));
    expect(done.status).toBe('applied');
    expect(applied.map(x=>x.name)).toEqual(['vercel_fixture_write']);
  });
});
