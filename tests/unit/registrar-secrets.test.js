import {beforeEach,describe,expect,it,vi} from 'vitest';
import {registry} from '../../src/tools/index.js';
import {dispatchReadOnlyTool} from '../../src/core/mcp-server.js';
import {makeFakeVercel} from '../../test/helpers/fake-vercel.js';
import {loadToken} from '../../src/vercel/tokens.js';

vi.mock('../../src/vercel/tokens.js',async importOriginal=>{
  const actual=await importOriginal();
  return {...actual,loadToken:vi.fn()};
});
const ENV={TOKEN_ENCRYPTION_KEY:'00'.repeat(32)};
const production={account:'acct_FAKE',mode:'production',profile:'full',
  listing:'catalog',kind:'connector'};
const account={id:'acct_FAKE',team_id:'team_FAKE',scope:'team',project_id:null};
const domain='example.com';
const CONTACT_ID='123e4567-e89b-12d3-a456-426614174011';
const AUTH_ID='123e4567-e89b-12d3-a456-426614174012';
const AUTH_CODE='PLANTED-AUTH-CODE-9876';
const OUT_CODE='PLANTED-OUT-CODE-4321';
function fixture(){
  const fake=makeFakeVercel(),audits=[],replay=new Map(),
    oneTime=new Map();
  const db={
    getAccountCredential:async()=>({}),listProtectedResources:async()=>[],
    recordChange:async entry=>{audits.push(entry);},
    getPurchasePolicy:async()=>({grantRequired:false,budgetCents:null}),
    getTodaySpendCents:async()=>0,
    getVercelAccountSafe:async()=>({id:'acct_FAKE',spend_limit_cents:100000}),
    insertOneTimeSecret:async row=>{oneTime.set(row.id,row);},
    consumeOneTimeSecret:async({id})=>{
      const row=oneTime.get(id);if(!row)return null;oneTime.delete(id);
      return {...row,vercel_account:row.account};
    },
    requestReplayStore:()=>({
      claim:async({key})=>{
        if(replay.has(key))return replay.get(key);
        replay.set(key,{state:'pending'});return {state:'claimed',claimId:'c1'};
      },
      complete:async({key,result})=>{replay.set(key,{state:'completed',result});},
      release:async({key})=>{replay.delete(key);}
    })};
  const call=(name,args,connection=production)=>
    dispatchReadOnlyTool({registry,name,args,connection,db,
      fetchImpl:fake.fetch,env:ENV});
  const surfaces=()=>JSON.stringify({audits,replay:[...replay.values()],
    result:undefined});
  return {fake,audits,replay,oneTime,call,surfaces};
}
const value=result=>JSON.parse(result.content[0].text);
beforeEach(()=>{loadToken.mockResolvedValue({token:'vcp_FAKE',account});});

describe('N-3 registrar secrets (planted-secret scans)',()=>{
  it('transfer-in refuses outright (AUD-AV, D9): no vault remains to consume, and nothing leaks',async()=>{
    const f=fixture();
    const result=await f.call('vercel_registrar_transfer_in',
      {domain,autoRenew:true,contactInputId:CONTACT_ID,
        authCodeInputId:AUTH_ID,outsideApp:true,confirm:true,
        requestKey:'reg-transfer-test-1'});
    const parsed=value(result);
    expect(parsed.status).toBe('refused_by_guard');
    expect(parsed.reason).toMatch(/Vercel dashboard/);
    expect(f.fake.calls).toHaveLength(0);
    const scan=JSON.stringify(parsed)+f.surfaces();
    for(const planted of [AUTH_CODE,'contact-secret@example.com',
      '999 Secret Lane','ContactSecretFirst','+13035550199'])
      expect(scan).not.toContain(planted);
    f.fake.verify();
  });
  it('transfer-in refuses a direct authCode argument outright',async()=>{
    const f=fixture();
    const result=await f.call('vercel_registrar_transfer_in',
      {domain,autoRenew:true,contactInputId:CONTACT_ID,
        authCodeInputId:AUTH_ID,authCode:AUTH_CODE,outsideApp:true,
        confirm:true,requestKey:'reg-transfer-bad-1'});
    const parsed=value(result);
    expect(parsed.status).toBe('refused_by_guard');
    expect(parsed.reason).toMatch(/invalid registrar tool arguments/i);
    expect(f.fake.calls).toHaveLength(0);
  });
  it('get_auth_code delivers only a one-time reveal reference; the code appears nowhere else',async()=>{
    const f=fixture();
    f.fake.when('GET','/v5/domains/{domain}')
      .resolves({domain:{name:domain,teamId:'team_FAKE',
        nameservers:['ns1.vercel-dns.com'],autoRenew:false,
        expiresAt:1798761600000,verified:true,serviceType:'external'}});
    f.fake.when('GET','/v1/registrar/domains/{domain}/auth-code')
      .resolves({authCode:OUT_CODE}).resolves({authCode:OUT_CODE});
    const result=await f.call('vercel_registrar_get_auth_code',
      {domain,outsideApp:true,confirm:true,requestKey:'reg-authcode-001'});
    const parsed=value(result);
    expect(parsed).toMatchObject({status:'applied',confirmed:true});
    expect(parsed.receipt?.ownerRevealRef ??
      parsed.ownerRevealRef).toBeTruthy();
    const revealRef=parsed.receipt?.ownerRevealRef ?? parsed.ownerRevealRef;
    expect(f.oneTime.has(revealRef)).toBe(true);
    const scan=JSON.stringify(parsed)+f.surfaces();
    expect(scan).not.toContain(OUT_CODE);
    f.fake.verify();
  });
  it('a buy refuses before any provider call now that the contact path is removed',async()=>{
    const f=fixture();
    const result=value(await f.call('vercel_registrar_buy',
      {domain,autoRenew:true,contactInputId:CONTACT_ID,outsideApp:true,
        confirm:true,requestKey:'reg-buy-nocontact'},production));
    expect(result.status).toBe('refused_by_guard');
    expect(result.reason).toMatch(/can no longer be completed here/);
    expect(f.fake.calls).toHaveLength(0);
    f.fake.verify();
  });
});
