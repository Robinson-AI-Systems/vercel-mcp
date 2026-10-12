import {describe,it,expect,vi} from 'vitest';
import {randomBytes} from 'node:crypto';
import {rtcDoor} from '../../src/rtc/door.js';
const pass='rtc_pass_'+randomBytes(32).toString('base64url');
const a={account:'team_FAKE',id:'pass_'+'a'.repeat(20),profile:'read_only',
 mode:'preview',listing:'catalog',areas:['server']};
const out=value=>({content:[{type:'text',text:JSON.stringify(value)}]});
function fixture(){
 const read=vi.fn(async()=>out({label:'safe'}));
 const mutate=vi.fn(async()=>out({status:'applied'}));
 const registry={tools:[
  {name:'vercel_fixture_read',writes:false,profiles:['read_only'],area:'server',
    description:'Read fixture',inputSchema:{type:'object',properties:{}}},
  {name:'vercel_fixture_write',writes:true,profiles:['full'],area:'server',
    description:'Mutate fixture',inputSchema:{type:'object',properties:{}}},
  {name:'vercel_hidden_read',writes:false,profiles:['read_only'],area:'secretarea',
    description:'Read hidden fixture',inputSchema:{type:'object',properties:{}}}
 ],handlers:{vercel_fixture_read:read,vercel_fixture_write:mutate,
   vercel_hidden_read:vi.fn(async()=>out({private:true}))}};
 const db={inspectRtcPass:vi.fn(async()=>({...a,status:'ok'})),
   authorizeRtcPass:vi.fn(async()=>({...a,status:'ok'})),
   putResult:vi.fn(),getResult:vi.fn(async()=>null)};
 const handler=rtcDoor({db,registry});
 const call=async(route,method='GET',query={},body,auth='Bearer '+pass)=>{
   const res={headers:{},code:0,status(n){this.code=n;return this;},
     setHeader(k,v){this.headers[k]=v;return this;},
     send(t){this.body=JSON.parse(t);return this;}};
   await handler({method,query,body,headers:{authorization:auth}},res,route);
   return res;
 };
 return {read,mutate,db,registry,call};
}
describe('RTC 1 read-only HTTPS door',()=>{
 it('rejects coerced Authorization headers before SQL quota use',async()=>{
  const f=fixture();
  for(const header of [['Bearer '+pass],{toString:()=>('Bearer '+pass)},
    123,'Bearer '+pass+', Bearer '+pass]){
    const response=await f.call('whoami','GET',{},undefined,header);
    expect(response.code).toBe(401);
  }
  expect(f.db.authorizeRtcPass).not.toHaveBeenCalled();
 });
 it('requires pass format, rejects OAuth-looking values and stays account scoped',async()=>{
  const f=fixture();
  expect((await f.call('whoami','GET',{},undefined,'')).code).toBe(401);
  expect((await f.call('whoami','GET',{},undefined,'Bearer access_not_a_pass')).code).toBe(401);
  expect((await f.call('whoami')).body.result).toMatchObject({
    profile:'read_only',mode:'preview',areas:['server']});
  expect(f.db.authorizeRtcPass).toHaveBeenCalledOnce();
 });
 it('TEST permits only service identity and denies all provider/area reads',async()=>{
  const f=fixture(),test={...a,mode:'test',areas:['server']};
  const identity=vi.fn(async()=>out({rtc:1,mode:'test',scope:'service_only',
    providerAccess:false}));
  f.registry.tools.push({name:'vercel_whoami',writes:false,area:'server',
    profiles:['read_only'],description:'Service identity',
    inputSchema:{type:'object',properties:{}}});
  f.registry.handlers.vercel_whoami=identity;
  f.db.inspectRtcPass.mockResolvedValue({...test,status:'ok'});
  f.db.authorizeRtcPass.mockResolvedValue({...test,status:'ok'});
  expect((await f.call('whoami')).body.result).toMatchObject({
    mode:'test',profile:'read_only',areas:['server']});
  expect((await f.call('list')).body.result.tools.map(x=>x.name))
    .toEqual(['vercel_whoami']);
  expect((await f.call('invoke','POST',{name:'vercel_whoami'},{})).code).toBe(200);
  for(const name of ['vercel_fixture_read','vercel_fixture_write','vercel_hidden_read'])
    expect((await f.call('invoke','POST',{name},{})).code).toBe(403);
  expect((await f.call('batch','POST',{}, {calls:[
    {name:'vercel_whoami',args:{}},{name:'vercel_fixture_read',args:{}}]})).code).toBe(403);
  expect(identity).toHaveBeenCalledOnce();
  expect(f.read).not.toHaveBeenCalled();
  expect(f.mutate).not.toHaveBeenCalled();
 });
 it('rejects TEST pass records forged with broader provider areas',async()=>{
  const f=fixture();
  f.db.authorizeRtcPass.mockResolvedValueOnce({...a,mode:'test',
    areas:['server','projects'],status:'ok'});
  expect((await f.call('whoami')).code).toBe(401);
  expect(f.read).not.toHaveBeenCalled();
 });
 it('keeps expired, revoked and DB rate-limit failures distinct',async()=>{
  const f=fixture();
  for(const [state,status] of [['pass_expired',401],['pass_revoked',401],['rate_limited',429]]){
   f.db.authorizeRtcPass.mockResolvedValueOnce({status:state});
   const result=await f.call('whoami');
   expect(result.code).toBe(status);
   expect(result.body.error.code).toBe(state);
   if(state==='rate_limited')expect(result.headers['Retry-After']).toBe('60');
  }
 });
 it('fails closed for untrusted or malformed SQL pass identity and scope',async()=>{
  for(const invalid of [
    {account:''},{account:'../team'},{id:'pass_FAKE'},
    {areas:['server','server']},{areas:['server','INVALID']},
    {areas:[{}]},{areas:[]},{listing:'unknown'},
    {profile:'full'},{mode:'production'}
  ]){
    const f=fixture();
    f.db.authorizeRtcPass.mockResolvedValueOnce({...a,...invalid,status:'ok'});
    const result=await f.call('invoke','POST',{name:'vercel_fixture_read'},{});
    expect(result.code).toBe(401);
    expect(result.body.error.code).toBe('permission');
    expect(f.read).not.toHaveBeenCalled();
  }
 });
 it('denies ambiguous duplicate RTC declarations, even if one advertises read-only',async()=>{
  const f=fixture();
  const duplicate={name:'vercel_fixture_read',writes:true,
    profiles:['read_only'],area:'server',description:'Unsafe duplicate',
    inputSchema:{type:'object',properties:{}}};
  f.registry.tools.push(duplicate);
  expect((await f.call('list')).body.result.tools.map(x=>x.name))
    .not.toContain('vercel_fixture_read');
  expect((await f.call('describe','GET',{name:'vercel_fixture_read'})).code).toBe(403);
  expect((await f.call('invoke','POST',{name:'vercel_fixture_read'},{})).code).toBe(403);
  expect((await f.call('batch','POST',{},
    {calls:[{name:'vercel_fixture_read',args:{}}]})).code).toBe(403);
  expect(f.read).not.toHaveBeenCalled();
 });
 it('never invokes contradictory nominal reads through RTC list, direct or batch',async()=>{
  const f=fixture();
  const variants=[{writeContract:{production:true,spend:true}},
    {annotations:{destructiveHint:true}},{localAdmin:true},{guardedWrite:true}];
  for(let i=0;i<variants.length;i++){
    const name='vercel_unsafe_'+i;
    const handler=vi.fn(async()=>out({changed:true}));
    f.registry.tools.push({name,writes:false,
      profiles:['read_only','everyday','full'],area:'server',
      description:'Inconsistent safety metadata',inputSchema:{type:'object',properties:{}},
      ...variants[i]});
    f.registry.handlers[name]=handler;
    expect((await f.call('list')).body.result.tools.map(x=>x.name)).not.toContain(name);
    expect((await f.call('describe','GET',{name})).code).toBe(403);
    expect((await f.call('invoke','POST',{name},{})).code).toBe(403);
    expect((await f.call('batch','POST',{}, {calls:[{name,args:{}}]})).code).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  }
 });
 it('discovers only allowed read tools and hides all mutating metadata',async()=>{
  const f=fixture();
  const list=await f.call('list','GET',{listing:'catalog',limit:'100'});
  expect(list.code).toBe(200);
  expect(list.body.result.tools.map(t=>t.name)).toEqual(['vercel_fixture_read']);
  expect((await f.call('describe','GET',{name:'vercel_fixture_read'})).body.result)
    .toMatchObject({writes:false,area:'server'});
  expect((await f.call('describe','GET',{name:'vercel_fixture_write'})).code).toBe(403);
  expect((await f.call('describe','GET',{name:'vercel_hidden_read'})).code).toBe(403);
 });
 it('follows real next-page cursors without repeating or exposing hidden tools',async()=>{
  const f=fixture();
  for(let i=0;i<12;i++){
    const name='vercel_page_'+i;
    f.registry.tools.push({name,writes:false,profiles:['read_only'],area:'server',
      description:'Discover page fixture '+i,inputSchema:{type:'object',properties:{}}});
    f.registry.handlers[name]=f.read;
  }
  const names=[];
  let cursor=null,seen=0,expectCount=null;
  do {
    const q={limit:'4',...(cursor===null?{}:{cursor:String(cursor)})};
    const response=await f.call('list','GET',q);
    expect(response.code).toBe(200);
    const {tools,count,next}=response.body.result;
    if(expectCount===null)expectCount=count;
    expect(count).toBe(expectCount);
    expect(tools.length).toBeLessThanOrEqual(4);
    names.push(...tools.map(t=>t.name));
    seen++;expect(seen).toBeLessThan(10);
    cursor=next;
  }while(cursor!==null);
  expect(names.length).toBe(13);
  expect(new Set(names).size).toBe(13);
  expect(names).not.toContain('vercel_fixture_write');
  expect(names).not.toContain('vercel_hidden_read');
  for(const bad of ['-1','01','1e3','1.5','100000',[]]){
    const result=await f.call('list','GET',{limit:'4',cursor:bad});
    expect(result.code).toBe(400);
  }
  const scoped=await f.call('list','GET',{area:'secretarea'});
  expect(scoped.body.result).toMatchObject({count:0,next:null,tools:[]});
 });
 it('streams a large catalog through byte-safe pages without lost tools or duplicates',async()=>{
  const f=fixture();
  for(let i=0;i<55;i++){
    const name='vercel_bounded_page_'+i;
    f.registry.tools.push({name,writes:false,profiles:['read_only'],
      area:'server',description:'Tool with a valid large descriptor '+String(i).padEnd(120,'x'),
      inputSchema:{type:'object',properties:{filter:{type:'string',
        description:'Optional metadata '+String(i).padEnd(160,'y')}}}});
    f.registry.handlers[name]=f.read;
  }
  const seen=[],count=56;let cursor=0,pages=0;
  while(true){
    const response=await f.call('list','GET',{limit:'100',cursor:String(cursor)});
    expect(response.code).toBe(200);
    expect(Buffer.byteLength(JSON.stringify(response.body),'utf8')).toBeLessThanOrEqual(8192);
    const page=response.body.result;
    expect(page.count).toBe(count);
    expect(page.tools.length).toBeGreaterThan(0);
    seen.push(...page.tools.map(t=>t.name));
    pages++;
    if(page.next===null)break;
    expect(page.next).toBe(cursor+page.tools.length);
    cursor=page.next;
    expect(pages).toBeLessThan(20);
  }
  expect(pages).toBeGreaterThan(1);
  expect(seen.length).toBe(count);
  expect(new Set(seen).size).toBe(count);
  expect((await f.call('describe','GET',{name:'vercel_bounded_page_54'})).code).toBe(200);
  expect(f.read).not.toHaveBeenCalled();
 });
 it('refuses a single oversized descriptor rather than bypassing the 8KiB limit',async()=>{
  const f=fixture(),name='vercel_oversize_schema';
  f.registry.tools.push({name,writes:false,profiles:['read_only'],area:'server',
    inputSchema:{type:'object',properties:Object.fromEntries(
      Array.from({length:150},(_,i)=>['field_'+i,{type:'string',
        description:'Safe metadata description '.repeat(4)}]))}});
  f.registry.handlers[name]=f.read;
  expect((await f.call('list','GET',{q:name})).code).toBe(400);
  expect((await f.call('describe','GET',{name})).code).toBe(400);
  expect((await f.call('list','GET',{q:'vercel_fixture_read'})).code).toBe(200);
  expect(f.read).not.toHaveBeenCalled();
 });
 it('rejects prototype-bearing, credential-like and over-deep nested RTC arguments',async()=>{
  const f=fixture();
  const malicious=[];
  for(const key of ['__proto__','constructor','prototype'])
    malicious.push(JSON.parse('{"nested":{"'+key+'":{"owner":true}}}'));
  malicious.push({nested:{input:'vcp_FAKE_sensitive_credential'}});
  malicious.push({nested:{input:'%2576cp_FAKE_credential'}});
  let tooDeep={value:'safe'};
  for(let i=0;i<24;i++)tooDeep={child:tooDeep};
  malicious.push(tooDeep);
  for(const args of malicious){
    const direct=await f.call('invoke','POST',{name:'vercel_fixture_read'},args);
    expect(direct.code).toBe(400);
    expect(direct.body.error.code).toBe('invalid_args');
    const batch=await f.call('batch','POST',{},
      {calls:[{name:'vercel_fixture_read',args}]});
    expect(batch.code).toBe(400);
    expect(batch.body.error.code).toBe('invalid_args');
  }
  expect(f.read).not.toHaveBeenCalled();
  expect(f.db.authorizeRtcPass).toHaveBeenCalledTimes(malicious.length);
  // Direct requests debit one validated pass unit; invalid batches never do.
  expect(f.db.inspectRtcPass).toHaveBeenCalledTimes(malicious.length);
 });
 it('preserves legitimate nested read inputs after recursive inspection',async()=>{
  const f=fixture();
  const args={filter:{project:'prj_FAKE',tags:['testing','safe']},
    fields:'label',detail:'full'};
  const reply=await f.call('invoke','POST',{name:'vercel_fixture_read'},args);
  expect(reply.code).toBe(200);
  expect(reply.body.result).toEqual({label:'safe'});
  expect(f.read).toHaveBeenCalledWith(
    {filter:{project:'prj_FAKE',tags:['testing','safe']}},expect.any(Object));
 });
 it('rejects malformed HTTPS arguments as invalid_args without invoking any tool',async()=>{
  const f=fixture();
  const badInvoke=await f.call('invoke','POST',{name:'vercel_fixture_read'},
    {fields:[1,2]});
  expect(badInvoke.code).toBe(400);
  expect(badInvoke.body.error.code).toBe('invalid_args');
  const badBatch=await f.call('batch','POST',{},
    {calls:[{name:'vercel_fixture_read',args:{fields:[1]}}]});
  expect(badBatch.code).toBe(400);
  expect(badBatch.body.error.code).toBe('invalid_args');
  expect(f.read).not.toHaveBeenCalled();
 });
 it('returns only sanitized plain text from direct and batched RTC reads',async()=>{
  const f=fixture();
  f.read.mockResolvedValue({content:[{type:'text',
    text:'unstructured vcp_FAKE_credential returned by provider'}]});
  const direct=await f.call('invoke','POST',{name:'vercel_fixture_read'},{});
  expect(direct.code).toBe(200);
  expect(direct.body.result).toBe('[hidden]');
  const batch=await f.call('batch','POST',{},
    {calls:[{name:'vercel_fixture_read',args:{}}]});
  expect(batch.code).toBe(200);
  expect(batch.body.result.results).toEqual(['[hidden]']);
  expect(JSON.stringify(direct.body)+JSON.stringify(batch.body)).not.toContain('vcp_FAKE');
 });
 it('uses the MCP dispatcher, forbidding write and cross-area invocation',async()=>{
  const f=fixture();
  expect((await f.call('invoke','POST',{name:'vercel_fixture_read'},{})).body.result)
    .toEqual({label:'safe'});
  expect((await f.call('invoke','POST',{name:'vercel_fixture_write'},{confirm:true})).code)
    .toBe(403);
  expect((await f.call('invoke','POST',{name:'vercel_hidden_read'},{})).code)
    .toBe(403);
  expect(f.read).toHaveBeenCalledOnce();
  expect(f.mutate).not.toHaveBeenCalled();
 });
 it('atomically reserves one rate-limit unit for each batched provider read',async()=>{
  const f=fixture();
  const args={calls:Array.from({length:3},()=>({name:'vercel_fixture_read',args:{}}))};
  const accepted=await f.call('batch','POST',{},args);
  expect(accepted.code).toBe(200);
  expect(f.db.authorizeRtcPass).toHaveBeenLastCalledWith(pass,3);
  expect(f.read).toHaveBeenCalledTimes(3);
  f.db.authorizeRtcPass.mockResolvedValueOnce({status:'rate_limited'});
  const denied=await f.call('batch','POST',{},args);
  expect(denied.code).toBe(429);
  expect(denied.body.error.code).toBe('rate_limited');
  expect(f.read).toHaveBeenCalledTimes(3);
  expect(f.db.authorizeRtcPass).toHaveBeenLastCalledWith(pass,3);
  const invalid=await f.call('batch','POST',{}, {calls:Array.from({length:11},()=>({name:'vercel_fixture_read'}))});
  expect(invalid.code).toBe(400);
  expect(f.db.authorizeRtcPass).toHaveBeenCalledTimes(2);
 });
 it('denies invalid and forbidden batches without debiting the shared quota',async()=>{
  const f=fixture();
  const cases=[
    [{args:{}}],
    [{name:'vercel_fixture_write',args:{}}],
    [{name:'vercel_hidden_read',args:{}}],
    [{name:'vercel_fixture_read',args:{fields:[2]}}]
  ];
  for(const calls of cases){
    const response=await f.call('batch','POST',{}, {calls});
    expect([400,403]).toContain(response.code);
  }
  expect(f.db.inspectRtcPass).toHaveBeenCalledTimes(cases.length);
  expect(f.db.authorizeRtcPass).not.toHaveBeenCalled();
  expect(f.read).not.toHaveBeenCalled();
 });
 it('refuses malformed repeated limit selectors before numeric coercion',async()=>{
  const f=fixture();
  for(const limit of [['4'],['4','4'],{first:'4'}]){
    const response=await f.call('list','GET',{limit});
    expect(response.code).toBe(400);
    expect(response.body.error.code).toBe('invalid_args');
  }
 });
 it('refuses remaining batch reads after an owner revokes the pass',async()=>{
  const f=fixture();
  f.read.mockImplementation(async()=>{
    f.db.inspectRtcPass.mockResolvedValue({status:'pass_revoked'});
    return out({label:'first-only'});
  });
  const response=await f.call('batch','POST',{}, {calls:[
    {name:'vercel_fixture_read',args:{}},{name:'vercel_fixture_read',args:{}},
    {name:'vercel_fixture_read',args:{}}]});
  expect(response.code).toBe(401);
  expect(response.body.error.code).toBe('pass_revoked');
  expect(f.db.authorizeRtcPass).toHaveBeenCalledOnce();
  expect(f.read).toHaveBeenCalledTimes(1);
  expect(f.db.putResult).not.toHaveBeenCalled();
 });
 it('refuses a mutated or expired pass scope between batch items',async()=>{
  for(const final of [{status:'pass_expired'}, {...a,status:'ok',areas:['other']}]){
    const f=fixture();
    f.read.mockImplementation(async()=>{
      f.db.inspectRtcPass.mockResolvedValue(final);
      return out({label:'first-only'});
    });
    const response=await f.call('batch','POST',{}, {calls:[
      {name:'vercel_fixture_read',args:{}},{name:'vercel_fixture_read',args:{}}]});
    expect(response.code).toBe(401);
    expect(f.read).toHaveBeenCalledTimes(1);
  }
 });
 it('executes only the preflighted immutable batch, not later request-object mutations',async()=>{
  const f=fixture(),body={calls:[{name:'vercel_fixture_read',args:{tag:'original'}}]};
  f.db.authorizeRtcPass.mockImplementationOnce(async()=>{
    body.calls[0].name='vercel_fixture_write';
    body.calls[0].args={confirm:true};
    return {...a,status:'ok'};
  });
  const response=await f.call('batch','POST',{},body);
  expect(response.code).toBe(200);
  expect(response.body.result.results).toEqual([{label:'safe'}]);
  expect(f.read).toHaveBeenCalledWith({tag:'original'},expect.any(Object));
  expect(f.mutate).not.toHaveBeenCalled();
 });
 it('stores a combined batch exceeding 8KB under the calling pass, then pages it',async()=>{
  const f=fixture(),handle='res_'+'f'.repeat(32);
  f.read.mockResolvedValue(out({label:'x'.repeat(1000)}));
  f.db.putResult.mockResolvedValue({handle,expiresAt:'2026-10-13T12:00:00.000Z'});
  const calls=Array.from({length:10},()=>({name:'vercel_fixture_read',args:{}}));
  const response=await f.call('batch','POST',{}, {calls});
  expect(response.code).toBe(200);
  expect(response.body.result).toMatchObject({status:'stored',handle,count:10});
  expect(Buffer.byteLength(JSON.stringify(response.body))).toBeLessThanOrEqual(8192);
  expect(f.db.putResult).toHaveBeenCalledWith({
    account:'team_FAKE',owner:expect.stringMatching(/^resown_[a-f0-9]{64}$/),
    summary:'Read-only RTC batch: 10 result(s)',body:expect.any(Array)});
  expect(f.db.putResult.mock.calls[0][0].body).toHaveLength(10);
  f.db.getResult.mockResolvedValue({body:f.db.putResult.mock.calls[0][0].body,
    summary:'Read-only RTC batch: 10 result(s)'});
  const page=await f.call('result','GET',{handle,page:'1',limit:'2',fields:'label'});
  expect(page.code).toBe(200);
  expect(page.body.result).toMatchObject({page:1,limit:2,count:10,next:2});
  expect(page.body.result.records).toHaveLength(2);
  expect(Buffer.byteLength(JSON.stringify(page.body))).toBeLessThanOrEqual(8192);
 });
 it('refuses oversize batches when secure storage is absent or returns an invalid handle',async()=>{
  const f=fixture();
  f.read.mockResolvedValue(out({label:'y'.repeat(1000)}));
  const calls=Array.from({length:10},()=>({name:'vercel_fixture_read',args:{}}));
  f.db.putResult.mockResolvedValueOnce(null);
  const denied=await f.call('batch','POST',{}, {calls});
  expect(denied.code).toBe(503);
  f.db.putResult.mockResolvedValueOnce({handle:'unscoped',expiresAt:'bad'});
  const malformed=await f.call('batch','POST',{}, {calls});
  expect(malformed.code).toBe(503);
 });
 it('preflights every batch member before any read can run',async()=>{
  const f=fixture();
  const denied=await f.call('batch','POST',{},{
    calls:[{name:'vercel_fixture_read',args:{}},{name:'vercel_fixture_write',args:{confirm:true}}]});
  expect(denied.code).toBe(403);expect(f.read).not.toHaveBeenCalled();
  const many=await f.call('batch','POST',{},{
    calls:Array.from({length:11},()=>({name:'vercel_fixture_read',args:{}}))});
  expect(many.body.error.code).toBe('invalid_args');
  const ok=await f.call('batch','POST',{},{
    calls:[{name:'vercel_fixture_read',args:{}},{name:'vercel_fixture_read',args:{}}]});
  expect(ok.body.result.results).toEqual([{label:'safe'},{label:'safe'}]);
 });
 it('pages stored handle records, projects safe fields and never exceeds 8KB',async()=>{
  const f=fixture(),handle='res_'+'a'.repeat(32);
  const rows=Array.from({length:45},(_,i)=>({id:i,label:'row-'+i,token:'must_be_removed'}));
  f.db.getResult.mockResolvedValue({body:{rows},summary:'Test set'});
  const a=await f.call('result','GET',{handle,page:'0',limit:'20',fields:'id,label'});
  expect(a.code).toBe(200);
  expect(a.body.result).toMatchObject({page:0,limit:20,count:45,hasMore:true,next:1});
  expect(a.body.result.records).toHaveLength(20);
  expect(a.body.result.records[0]).toEqual({id:0,label:'row-0'});
  const b=await f.call('result','GET',{handle,page:'2',limit:'20'});
  expect(b.body.result).toMatchObject({page:2,count:45,hasMore:false,next:null});
  expect(b.body.result.records).toHaveLength(5);
  expect(JSON.stringify(b.body)).not.toContain('must_be_removed');
  for(const bad of [{page:['0']},{page:'-1'},{limit:'0'},{limit:'21'},
    {detail:'write'},{fields:['id']},{unrelated:'1'}]){
    const fail=await f.call('result','GET',{handle,...bad});
    expect(fail.code).toBe(400);
  }
  f.db.getResult.mockResolvedValue({body:[{content:'x'.repeat(9000)}],summary:'Big'});
  expect((await f.call('result','GET',{handle,page:'0'})).code).toBe(400);
  expect((await f.call('result','GET',{handle,fields:'id'})).code).toBe(200);
 });
 it('isolates result handles to the original pass-derived owner',async()=>{
  const f=fixture();
  f.db.getResult.mockResolvedValue({body:{message:'saved fixture'},summary:'Fixture'});
  const result=await f.call('result','GET',{handle:'res_'+'a'.repeat(32)});
  expect(result.code).toBe(200);
  expect(f.db.getResult).toHaveBeenCalledWith({
   account:'team_FAKE',handle:'res_'+'a'.repeat(32),
   owner:expect.stringMatching(/^resown_[a-f0-9]{64}$/)});
  f.db.getResult.mockResolvedValue(null);
  expect((await f.call('result','GET',{handle:'res_'+'a'.repeat(32)})).code).toBe(404);
 });
});
