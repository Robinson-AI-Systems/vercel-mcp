// AUD-BM1: the BATCH-B §3 write-contract checks through the RTC HTTPS
// door (door #3) — R-2's frozen acceptance line ("write-contract helper
// through HTTPS (door #3); envelope and error codes per RTC §7").
//
// The §3 helper (tests/helpers/write-contract.js) asserts against the
// direct handler (door #1); other suites cover vercel_call (door #2).
// This suite reuses the helper's own fixture factory (sampleWrite — the
// same spec semantics and argument conventions) and binds its writes
// with defineWrite + bindGuardedWrite under the production output
// convention every shipped write tool uses (isError on refused_by_guard
// / outcome_unknown), in a fixture registry following
// tests/unit/rtc-write-passes.test.js. Every call enters through
// rtcDoor's invoke route with a write-capable pass as the credential,
// so pass authorization, the minted frozen connection, the shared
// dispatcher and the door's own response shaping are all in the path:
// the same §3 checks, a third door.
import {describe,it,expect,vi} from 'vitest';
import {rtcDoor} from '../../src/rtc/door.js';
import {defineWrite,bindGuardedWrite} from '../../src/core/write.js';
import {sampleWrite} from '../helpers/write-contract.js';
import {spendPreflight} from '../../src/vercel/spend.js';
const ACCOUNT='team_FAKE';
// The output mapper convention of the shipped write tools (e.g.
// src/tools/blob.js, src/tools/custom-environment-mutate.js): executor
// refusals and unknown outcomes are error results; previews,
// confirmations and applied results are not.
const output=result=>({isError:['refused_by_guard','outcome_unknown'].includes(result.status),
  content:[{type:'text',text:JSON.stringify(result)}]});
// The write context the door's dispatch hands the bound handler, wired
// the way the §3 helper wires its direct context: audits recorded,
// guards driven by the targets the fixture declares, a fixed clock so
// request keys are deterministic, the real zero-cost spend preflight.
const doorContext=({db,connection})=>({db,connection,
  shape:value=>JSON.parse(JSON.stringify(value)),
  now:()=>600000,
  audit:async entry=>{db.__audits.push(entry);},
  replayStore:db.requestReplayStore(),
  guardProtected:async targets=>targets.some(t=>t?.protected)?
    {blocked:true,reason:'Protected resource'}:{blocked:false},
  guardApp:async targets=>targets.some(t=>t?.appOwned)?
    {blocked:true,reason:'App-owned resource'}:{blocked:false},
  checkSpend:async(declaration,confirm)=>spendPreflight({
    declaration,confirm,spendLimitCents:0,spentTodayCents:0})});
function fixtureWrite(name,options={}){
  const f=sampleWrite(options);
  const write=defineWrite({...f.spec,name});
  return {provider:f.provider,write,writeContract:write.writeContract,
    handler:bindGuardedWrite(write,doorContext,output)};
}
// A write whose targets carry no project identity at all (a team-level
// target), or none whatsoever with {empty:true}: under a project-
// restricted pass its scope is unprovable and it must refuse.
function detachedWrite(){
  const provider=[];
  const write=defineWrite({name:'vercel_fixture_detached',
    before:async()=>({}),
    preview:async()=>'Change a target with no project identity',
    production:async()=>({production:false,why:'Fixture write'}),
    targets:async args=>args.empty?[]:[{kind:'team',id:'team_FAKE'}],
    apply:async()=>{provider.push('applied');return {done:true};},
    verify:async()=>({confirmed:true})});
  return {provider,write,writeContract:write.writeContract,
    handler:bindGuardedWrite(write,doorContext,output)};
}
function makeRegistry(){
  const plain=fixtureWrite('vercel_fixture_update');
  const unverifiable=fixtureWrite('vercel_fixture_unverifiable',{verifyUnknown:true});
  const spend=fixtureWrite('vercel_fixture_spend',{spend:true,cents:500});
  const spendOver=fixtureWrite('vercel_fixture_spend_over',{spend:true,cents:501});
  const access=fixtureWrite('vercel_fixture_access',{access:true});
  const detached=detachedWrite();
  const row=(name,w,description)=>({name,area:'fixture',
    profiles:['everyday','full'],writes:true,guardedWrite:true,
    writeContract:w.writeContract,description,
    inputSchema:{type:'object',properties:{},additionalProperties:true}});
  const registry={tools:[
    {name:'vercel_fixture_read',area:'server',
      profiles:['read_only','everyday','full'],writes:false,
      description:'Fixture read',
      inputSchema:{type:'object',properties:{},additionalProperties:true}},
    row('vercel_fixture_update',plain,'Fixture write'),
    row('vercel_fixture_unverifiable',unverifiable,'Fixture unverifiable write'),
    row('vercel_fixture_spend',spend,'Fixture priced write'),
    row('vercel_fixture_spend_over',spendOver,'Fixture priced write, one cent dearer'),
    row('vercel_fixture_access',access,'Fixture access-widening write'),
    row('vercel_fixture_detached',detached,'Fixture write with no project target')],
   handlers:{vercel_fixture_read:async()=>({content:[{type:'text',text:'{"ok":true}'}]}),
    vercel_fixture_update:plain.handler,
    vercel_fixture_unverifiable:unverifiable.handler,
    vercel_fixture_spend:spend.handler,
    vercel_fixture_spend_over:spendOver.handler,
    vercel_fixture_access:access.handler,
    vercel_fixture_detached:detached.handler}};
  return {registry,providers:{plain:plain.provider,
    unverifiable:unverifiable.provider,spend:spend.provider,
    spendOver:spendOver.provider,access:access.provider,
    detached:detached.provider}};
}
function writePass(overrides={}){
  return {id:'pass_aaaaaaaaaaaaaaaaaaaa',account:ACCOUNT,profile:'everyday',
    mode:'preview',areas:['server','fixture'],listing:'catalog',
    rateLimitPerMinute:60,allowWrites:true,spendLimitCents:500,
    projectIds:null,...overrides};
}
const READ_PASS={id:'pass_aaaaaaaaaaaaaaaaaaaa',account:ACCOUNT,
  profile:'read_only',mode:'preview',areas:['server','fixture'],
  listing:'catalog',rateLimitPerMinute:60};
function makeDoor(record,registry){
  const state={gone:null};
  const replays=new Map();
  const db={__audits:[],
    inspectRtcPass:vi.fn(async()=>state.gone??
      {status:'ok',...record,expiresAt:Date.now()+3600000}),
    authorizeRtcPass:vi.fn(async()=>state.gone??{status:'ok',...record}),
    requestReplayStore:()=>({claim:async({key})=>{
      if(replays.has(key))return replays.get(key);
      replays.set(key,{state:'pending'});return {state:'claimed',claimId:'claim_FAKE'};},
      complete:async({key,result})=>replays.set(key,{state:'completed',result}),
      release:async({key})=>replays.delete(key)})};
  return {door:rtcDoor({db,env:{},registry}),db,state};
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
// Production-mode responses arrive in the door's PRODUCTION
// presentation wrapper; unwrap it so assertions read the write's own
// result object on every mode.
const payload=r=>(r.result&&r.result.mode==='PRODUCTION'&&r.result.result)?
  r.result.result:r.result;
describe('AUD-BM1 — BATCH-B §3 write contract through the RTC HTTPS door',()=>{
  it('§3.1 dry run is preview-only: no provider call, a preview change-log row',async()=>{
    const {registry,providers}=makeRegistry();
    const {door:d,db}=makeDoor(writePass(),registry);
    const r=await invoke(d,'vercel_fixture_update',{name:'new',dryRun:true});
    expect(r.status).toBe(200);
    expect(payload(r).status).toBe('preview');
    expect(providers.plain).toHaveLength(0);
    expect(db.__audits).toHaveLength(1);
    expect(db.__audits[0]).toMatchObject({tool:'vercel_fixture_update',dryRun:true});
  });
  it('§3.2 without confirm nothing changes: needs_confirmation, no provider call, no row',async()=>{
    const {registry,providers}=makeRegistry();
    const {door:d,db}=makeDoor(writePass(),registry);
    const r=await invoke(d,'vercel_fixture_update',{name:'new'});
    expect(payload(r).status).toBe('needs_confirmation');
    expect(payload(r).preview).toMatch(/Change fixture to new/);
    expect(providers.plain).toHaveLength(0);
    expect(db.__audits).toHaveLength(0);
  });
  it('§3.3 confirm applies exactly once; the same request replays the stored result',async()=>{
    const {registry,providers}=makeRegistry();
    const {door:d,db}=makeDoor(writePass(),registry);
    const args={name:'new',confirm:true};
    const first=await invoke(d,'vercel_fixture_update',args);
    expect(payload(first).status).toBe('applied');
    expect(payload(first).confirmed).toBe(true);
    const second=await invoke(d,'vercel_fixture_update',args);
    expect(payload(second).confirmed).toBe(true);
    expect(payload(second).requestKey).toBe(payload(first).requestKey);
    expect(providers.plain).toHaveLength(1);
    expect(db.__audits).toHaveLength(1);
    expect(db.__audits[0]).toMatchObject({dryRun:false,
      requestKey:payload(first).requestKey});
  });
  it('§3.4 read-back mismatch is confirmed:false; an unreadable read-back is confirmed:null',async()=>{
    const {registry}=makeRegistry();
    const {door:d}=makeDoor(writePass(),registry);
    const mismatch=await invoke(d,'vercel_fixture_update',{confirm:true,mismatch:true});
    expect(payload(mismatch).status).toBe('applied');
    expect(payload(mismatch).confirmed).toBe(false);
    const unknown=await invoke(d,'vercel_fixture_unverifiable',{confirm:true});
    expect(payload(unknown).status).toBe('applied');
    expect(payload(unknown).confirmed).toBeNull();
  });
  it('§3.5 protected and app-owned targets refuse at the door as refusals, reasons intact',async()=>{
    const {registry,providers}=makeRegistry();
    const {door:d,db}=makeDoor(writePass(),registry);
    const protectedHit=await invoke(d,'vercel_fixture_update',{confirm:true,protected:true});
    expect(protectedHit.status).toBe(403);
    expect(protectedHit.error?.code).toBe('refused_by_guard');
    expect(JSON.stringify(protectedHit)).toContain('Protected resource');
    const appOwnedHit=await invoke(d,'vercel_fixture_update',{confirm:true,appOwned:true});
    expect(appOwnedHit.status).toBe(403);
    expect(appOwnedHit.error?.code).toBe('refused_by_guard');
    expect(JSON.stringify(appOwnedHit)).toContain('App-owned resource');
    expect(providers.plain).toHaveLength(0);
    expect(db.__audits).toHaveLength(0);
  });
  it('§3.6 production discipline: a preview pass refuses a live change; a production pass confirms, then applies as PRODUCTION',async()=>{
    const {registry,providers}=makeRegistry();
    const {door:previewDoor}=makeDoor(writePass(),registry);
    const refused=await invoke(previewDoor,'vercel_fixture_update',{live:true,confirm:true});
    expect(refused.status).toBe(403);
    expect(refused.error?.code).toBe('refused_by_guard');
    expect(JSON.stringify(refused)).toContain('preview connection');
    const {door:prodDoor}=makeDoor(writePass({mode:'production'}),registry);
    const ask=await invoke(prodDoor,'vercel_fixture_update',{live:true});
    expect(payload(ask).status).toBe('needs_confirmation');
    const done=await invoke(prodDoor,'vercel_fixture_update',{live:true,confirm:true});
    expect(payload(done).status).toBe('applied');
    expect(payload(done).mode).toBe('PRODUCTION');
    expect(providers.plain).toHaveLength(1);
  });
  it('§3.7 spend truth: the dollar line names the declaration and the ceiling; at-ceiling applies as a pass delegation; one cent over refuses naming the ceiling',async()=>{
    const {registry,providers}=makeRegistry();
    const {door:d,db}=makeDoor(writePass({spendLimitCents:500}),registry);
    // A decoy cents argument must not move the declared price.
    const preview=await invoke(d,'vercel_fixture_spend',{dryRun:true,cents:1});
    expect(payload(preview).moneyLine).toContain('$5.00 USD');
    expect(payload(preview).moneyLine).toContain('spend ceiling of $5.00');
    const atCeiling=await invoke(d,'vercel_fixture_spend',{confirm:true});
    expect(payload(atCeiling).status).toBe('applied');
    expect(payload(atCeiling).delegation).toMatchObject(
      {basis:'pass',ceilingCents:500,quotedCents:500});
    const spendRow=db.__audits.find(a=>a.tool==='vercel_fixture_spend'&&a.dryRun===false);
    expect(spendRow).toMatchObject({spendCents:500,
      delegation:{basis:'pass',ceilingCents:500,quotedCents:500}});
    const over=await invoke(d,'vercel_fixture_spend_over',{confirm:true});
    expect(over.status).toBe(403);
    expect(over.error?.code).toBe('refused_by_guard');
    expect(JSON.stringify(over)).toContain('exceeds the spend ceiling on this pass');
    expect(providers.spendOver).toHaveLength(0);
  });
  it('§3.8 access widening needs confirm, then applies; a read-only pass cannot write',async()=>{
    const {registry,providers}=makeRegistry();
    const {door:d}=makeDoor(writePass(),registry);
    expect(payload(await invoke(d,'vercel_fixture_access',{})).status)
      .toBe('needs_confirmation');
    expect(payload(await invoke(d,'vercel_fixture_access',{confirm:true})).status)
      .toBe('applied');
    expect(providers.access).toHaveLength(1);
    const {door:readDoor}=makeDoor(READ_PASS,registry);
    const refused=await invoke(readDoor,'vercel_fixture_update',{confirm:true});
    expect(refused.status).toBe(403);
    expect(refused.error?.code).toBe('outside_scope');
    expect(providers.plain).toHaveLength(0);
  });
  it('journal completeness: preview and applied rows share the request key; refusals write no row',async()=>{
    const {registry}=makeRegistry();
    const {door:d,db}=makeDoor(writePass(),registry);
    const preview=await invoke(d,'vercel_fixture_update',{name:'new',dryRun:true});
    const applied=await invoke(d,'vercel_fixture_update',{name:'new',confirm:true});
    expect(payload(applied).requestKey).toBe(payload(preview).requestKey);
    expect(db.__audits).toHaveLength(2);
    expect(db.__audits[0]).toMatchObject({dryRun:true,
      requestKey:payload(preview).requestKey});
    expect(db.__audits[1]).toMatchObject({dryRun:false,
      requestKey:payload(preview).requestKey});
    await invoke(d,'vercel_fixture_update',{confirm:true,protected:true});
    expect(db.__audits).toHaveLength(2);
  });
  it('negative: a write inside _batch refuses refused_by_guard; the batch stays read-only',async()=>{
    const {registry,providers}=makeRegistry();
    const {door:d}=makeDoor(writePass(),registry);
    const batch=await call(d,'batch','POST',{},{calls:[
      {name:'vercel_fixture_read',args:{}},
      {name:'vercel_fixture_update',args:{confirm:true}}]});
    expect(batch.status).toBe(403);
    expect(batch.error?.code).toBe('refused_by_guard');
    const reads=await call(d,'batch','POST',{},{calls:[
      {name:'vercel_fixture_read',args:{}}]});
    expect(reads.result.results[0].ok).toBe(true);
    expect(providers.plain).toHaveLength(0);
  });
  it('negative: a pass revoked mid-sequence refuses the next call; an expired pass refuses too',async()=>{
    const {registry,providers}=makeRegistry();
    const {door:d,state}=makeDoor(writePass(),registry);
    const first=await invoke(d,'vercel_fixture_update',{name:'one',confirm:true});
    expect(payload(first).status).toBe('applied');
    state.gone={status:'pass_revoked'};
    const afterRevoke=await invoke(d,'vercel_fixture_update',{name:'two',confirm:true});
    expect(afterRevoke.status).toBe(401);
    expect(afterRevoke.error?.code).toBe('pass_revoked');
    expect(providers.plain).toHaveLength(1);
    const expired=makeDoor(writePass(),registry);
    expired.state.gone={status:'pass_expired'};
    const afterExpiry=await invoke(expired.door,'vercel_fixture_update',{confirm:true});
    expect(afterExpiry.status).toBe(401);
    expect(afterExpiry.error?.code).toBe('pass_expired');
  });
  it('negative: project restriction — in-list applies; out-of-list and unresolvable targets refuse naming the restriction',async()=>{
    const {registry,providers}=makeRegistry();
    const {door:inDoor}=makeDoor(writePass({projectIds:['prj_FAKE']}),registry);
    const inside=await invoke(inDoor,'vercel_fixture_update',{confirm:true});
    expect(payload(inside).status).toBe('applied');
    const {door:outDoor}=makeDoor(writePass({projectIds:['prj_OTHER999']}),registry);
    const outside=await invoke(outDoor,'vercel_fixture_update',{confirm:true});
    expect(outside.status).toBe(403);
    expect(outside.error?.code).toBe('refused_by_guard');
    expect(JSON.stringify(outside)).toContain('restricted to specific projects');
    const {door:detachedDoor}=makeDoor(writePass({projectIds:['prj_FAKE']}),registry);
    const noProject=await invoke(detachedDoor,'vercel_fixture_detached',{confirm:true});
    expect(noProject.status).toBe(403);
    expect(noProject.error?.code).toBe('refused_by_guard');
    expect(JSON.stringify(noProject)).toContain('restricted to specific projects');
    const empty=await invoke(detachedDoor,'vercel_fixture_detached',{confirm:true,empty:true});
    expect(empty.status).toBe(403);
    expect(empty.error?.code).toBe('refused_by_guard');
    expect(providers.detached).toHaveLength(0);
  });
});
