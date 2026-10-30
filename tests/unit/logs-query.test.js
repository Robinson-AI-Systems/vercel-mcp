import {describe,it,expect,vi,beforeEach} from 'vitest';
import {makeFakeVercel,vercelError} from '../../test/helpers/fake-vercel.js';
import {logsAnalyticsReadTools} from '../../src/tools/logs-analytics.js';
import {loadToken} from '../../src/vercel/tokens.js';
vi.mock('../../src/vercel/tokens.js',async m=>({...await m(),loadToken:vi.fn()}));
const account={id:'acct_1',team_id:'team_SEAT',scope:'team'};
const conn={account:account.id,profile:'read_only',mode:'preview',listing:'catalog'};
const project={id:'prj_FAKE1',name:'demo'};
function fixture(){
  const api=makeFakeVercel(),audit=[];
  const db={getAccountCredential:async()=>({}),
    listProtectedResources:async()=>[],
    recordChange:async row=>audit.push(row),
    requestReplayStore:()=>({claim:async()=>({state:'claimed',claimId:'FAKE'}),
      complete:async()=>{},release:async()=>{}})};
  const ctx={db,connection:conn,fetchImpl:api.fetch,env:{VERCEL_ENV:'production'}};
  return {api,audit,
    query:(args)=>logsAnalyticsReadTools.handlers.vercel_logs_query(args,ctx),
    errors:(args)=>logsAnalyticsReadTools.handlers.vercel_logs_errors_summary(args,ctx),
    pageviews:(args)=>logsAnalyticsReadTools.handlers.vercel_analytics_pageviews(args,ctx)};
}
const read=r=>JSON.parse(r.content[0].text);
describe('M-1 logs query reads',()=>{
 beforeEach(()=>{vi.clearAllMocks();
   loadToken.mockResolvedValue({token:'vcp_FAKE',account});});

 it('queries team scope by default with a one-hour window and shapes rows to scalars',async()=>{
   const f=fixture();
   f.api.when('POST','/v2/observability/query').resolves({data:[
     {requestPath:'/api/x',httpStatus:500,nested:{deep:1}},
     {requestPath:'/ok',httpStatus:200,note:'token '+'vcp_'+'x'.repeat(24)}]});
   const r=read(await f.query({metric:'vercel.request.count'}));
   expect(r.scope).toEqual({ownerId:'team_SEAT'});
   expect(r.rows).toEqual([{requestPath:'/api/x',httpStatus:500},
     {requestPath:'/ok',httpStatus:200}]);
   expect(r.truncated).toBe(false);
   const body=f.api.calls[0].body;
   expect(body.metric).toBe('vercel.request.count');
   expect(Date.parse(body.endTime)-Date.parse(body.startTime)).toBe(3600000);
   expect(body.limit).toBe(50);
   f.api.verify();
 });
 it('narrows scope to a resolved project and reports truncation honestly',async()=>{
   const f=fixture();
   f.api.when('GET','/v9/projects/{idOrName}').resolves(project);
   const many=Array.from({length:60},(_,i)=>({requestPath:'/r'+i,count:i}));
   f.api.when('POST','/v2/observability/query').resolves({rows:many});
   const r=read(await f.query({metric:'vercel.request.count',project:'demo'}));
   expect(r.scope).toEqual({projectId:'prj_FAKE1'});
   expect(r.rowCount).toBe(50);
   expect(r.providerRows).toBe(60);
   expect(r.truncated).toBe(true);
   f.api.verify();
 });
 it('says so when the provider returns no row array',async()=>{
   const f=fixture();
   f.api.when('POST','/v2/observability/query').resolves({unexpected:true});
   const r=read(await f.query({metric:'vercel.request.count'}));
   expect(r.rows).toEqual([]);
   expect(r.providerRows).toBeNull();
   expect(r.shapeNote).toMatch(/no row array/);
   f.api.verify();
 });
 it('refuses an over-long window and an unknown metric shape before dispatch',async()=>{
   const f=fixture();
   await expect(f.query({metric:'vercel.request.count',windowMinutes:10081}))
     .rejects.toThrow(/between 1 and 10080/);
   await expect(f.query({metric:'not a metric'})).rejects.toThrow(/metric id/);
   await expect(f.query({metric:'vercel.request.count',bogus:1}))
     .rejects.toThrow(/Unsupported logs query selector/);
   expect(f.api.calls).toHaveLength(0);
 });
 it('summarizes errors with only the fields the provider actually supplied',async()=>{
   const f=fixture();
   f.api.when('GET','/v9/projects/{idOrName}').resolves(project);
   f.api.when('POST','/v2/observability/query').resolves({data:[
     {errorCode:'ERR_SMALL',count:2},
     {errorCode:'ERR_BIG',count:9,errorMessage:'Boom',firstSeen:'2026-10-30T00:00:00.000Z',
       lastSeen:'2026-10-30T01:00:00.000Z',requestId:'req_FAKE1'}]});
   const r=read(await f.errors({project:'demo'}));
   expect(r.errors[0]).toEqual({errorCode:'ERR_BIG',message:'Boom',count:9,
     firstSeen:'2026-10-30T00:00:00.000Z',lastSeen:'2026-10-30T01:00:00.000Z',
     exampleRequestId:'req_FAKE1'});
   expect(r.errors[1]).toEqual({errorCode:'ERR_SMALL',message:null,count:2,
     firstSeen:null,lastSeen:null,exampleRequestId:null});
   expect(r.fieldsPresent).toEqual(['message','count','firstSeen','lastSeen','exampleRequestId']);
   const body=f.api.calls.find(c=>c.method==='POST').body;
   expect(body).toMatchObject({metric:'vercel.function_invocation.count',
     filter:'errorCode:*',groupBy:['errorCode'],scope:{projectId:'prj_FAKE1'}});
   f.api.verify();
 });
 it('pageviews passes the contract dimensions and names the measures returned',async()=>{
   const f=fixture();
   f.api.when('GET','/v1/query/web-analytics/visits/aggregate').resolves({
     data:[{requestPath:'/pricing',pageviews:41,visitors:30},
       {requestPath:'/about',pageviews:7,secret:'vcp_'+'y'.repeat(24)}],
     query:{},version:1});
   const r=read(await f.pageviews({project:'demo'}));
   expect(r.rows).toEqual([{requestPath:'/pricing',pageviews:41,visitors:30},
     {requestPath:'/about',pageviews:7}]);
   expect(r.measures).toEqual(['pageviews','visitors']);
   const call=f.api.calls[0];
   expect(call.query.projectId).toBe('demo');
   expect(call.query.by).toBe('requestPath');
   expect(Number(call.query.limit)).toBe(25);
   expect(Number(call.query.until)-Number(call.query.since)).toBe(7*24*3600000);
   f.api.verify();
 });
 it('pageviews refuses two time dimensions and unknown dimensions',async()=>{
   const f=fixture();
   await expect(f.pageviews({project:'demo',by:['day','month']}))
     .rejects.toThrow(/at most one time dimension/);
   await expect(f.pageviews({project:'demo',by:['planet']}))
     .rejects.toThrow(/documented Web Analytics dimensions/);
   expect(f.api.calls).toHaveLength(0);
 });
 it('a missing project refuses with the reason, not a generic error',async()=>{
   const f=fixture();
   f.api.when('GET','/v9/projects/{idOrName}').rejects(404,vercelError(404,'not_found'));
   await expect(f.errors({project:'ghost'})).rejects.toThrow(/Project was not found/);
   f.api.verify();
 });
});
