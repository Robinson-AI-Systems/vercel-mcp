import {describe,it,expect,vi} from 'vitest';
import {randomBytes} from 'node:crypto';
import {rtcDoor} from '../../src/rtc/door.js';
const pass='rtc_pass_'+randomBytes(32).toString('base64url');
const a={account:'team_FAKE',id:'pass_FAKE',profile:'read_only',
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
 const db={authorizeRtcPass:vi.fn(async()=>({...a,status:'ok'})),
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
 it('requires pass format, rejects OAuth-looking values and stays account scoped',async()=>{
  const f=fixture();
  expect((await f.call('whoami','GET',{},undefined,'')).code).toBe(401);
  expect((await f.call('whoami','GET',{},undefined,'Bearer access_not_a_pass')).code).toBe(401);
  expect((await f.call('whoami')).body.result).toMatchObject({
    profile:'read_only',mode:'preview',areas:['server']});
  expect(f.db.authorizeRtcPass).toHaveBeenCalledOnce();
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
