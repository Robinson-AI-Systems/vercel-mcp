import {beforeEach,describe,expect,it,vi} from 'vitest';
import {registry} from '../../src/tools/index.js';
import {dispatchReadOnlyTool} from '../../src/core/mcp-server.js';
import {makeFakeVercel} from '../../test/helpers/fake-vercel.js';
import {loadToken} from '../../src/vercel/tokens.js';
import {pendingInputs} from '../../src/core/pending-inputs.js';

vi.mock('../../src/vercel/tokens.js',async importOriginal=>{
  const actual=await importOriginal();
  return {...actual,loadToken:vi.fn()};
});
const ENV={TOKEN_ENCRYPTION_KEY:'00'.repeat(32)};
const production={account:'acct_FAKE',mode:'production',profile:'full',
  listing:'catalog',kind:'connector'};
const account={id:'acct_FAKE',team_id:'team_FAKE',scope:'team',project_id:null};
const domain='example.com';
const CONTACT={firstName:'ContactSecretFirst',lastName:'ContactSecretLast',
  email:'contact-secret@example.com',phone:'+13035550199',
  address1:'999 Secret Lane',city:'Greeley',state:'CO',zip:'80631',
  country:'US'};
const CONTACT_ID='123e4567-e89b-12d3-a456-426614174011';
const AUTH_ID='123e4567-e89b-12d3-a456-426614174012';
const AUTH_CODE='PLANTED-AUTH-CODE-9876';
const OUT_CODE='PLANTED-OUT-CODE-4321';
const price={years:1,purchasePrice:11.25,renewalPrice:11.25,transferPrice:11.25};
const schemaReply={type:'object',properties:{firstName:{},lastName:{},
  email:{},phone:{},address1:{},city:{},state:{},zip:{},country:{}}};
function fixture(){
  const fake=makeFakeVercel(),audits=[],replay=new Map(),
    pending=new Map(),oneTime=new Map();
  const db={
    getAccountCredential:async()=>({}),listProtectedResources:async()=>[],
    recordChange:async entry=>{audits.push(entry);},
    getPurchasePolicy:async()=>({grantRequired:false,budgetCents:null}),
    getTodaySpendCents:async()=>0,
    getVercelAccountSafe:async()=>({id:'acct_FAKE',spend_limit_cents:100000}),
    insertPendingInput:async row=>{pending.set(row.id,row);},
    consumePendingInput:async({id,account:acct,kind})=>{
      const row=pending.get(id);
      if(!row||row.account!==acct||row.kind!==kind)return null;
      pending.delete(id);
      return {ciphertext:row.ciphertext,vercel_account:row.account,
        kind:row.kind,id:row.id};
    },
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
  // The ciphertext is bound to the id submit mints — always use that id.
  const seed=async(kind,value)=>{
    const {id}=await pendingInputs({db,env:ENV}).submit({account:'acct_FAKE',
      kind,label:'x',value});
    return id;
  };
  const surfaces=()=>JSON.stringify({audits,replay:[...replay.values()],
    result:undefined});
  return {fake,audits,replay,oneTime,call,seed,surfaces};
}
const value=result=>JSON.parse(result.content[0].text);
beforeEach(()=>{loadToken.mockResolvedValue({token:'vcp_FAKE',account});});

describe('N-3 registrar secrets (planted-secret scans)',()=>{
  it('transfer-in consumes the auth code and contact from the vault; neither leaks to result, journal or replay',async()=>{
    const f=fixture();
    const contactId=await f.seed('registrar_contact',JSON.stringify(CONTACT));
    const authId=await f.seed('transfer_auth_code',AUTH_CODE);
    f.fake.when('GET','/v1/registrar/domains/{domain}/price')
      .resolves(price).resolves(price);
    f.fake.when('GET','/v1/registrar/domains/{domain}/contact-info/schema')
      .resolves(schemaReply).resolves(schemaReply);
    f.fake.when('POST','/v1/registrar/domains/{domain}/transfer')
      .resolves({orderId:'ord_FAKE3',_links:{}});
    f.fake.when('GET','/v1/registrar/orders/{orderId}')
      .resolves({orderId:'ord_FAKE3',status:'completed',domains:[{
        domainName:domain,purchaseType:'transfer',autoRenew:true,years:1,
        status:'completed',price:11.25}]});
    const result=await f.call('vercel_registrar_transfer_in',
      {domain,autoRenew:true,contactInputId:contactId,
        authCodeInputId:authId,outsideApp:true,confirm:true,
        requestKey:'reg-transfer-test-1'});
    const parsed=value(result);
    expect(parsed).toMatchObject({status:'applied',confirmed:true});
    const post=f.fake.calls.find(x=>x.path.includes('/transfer'));
    expect(post.body.authCode).toBe(AUTH_CODE);
    expect(post.body.contactInformation.email).toBe(CONTACT.email);
    expect(post.body.expectedPrice).toBe(11.25);
    const scan=JSON.stringify(parsed)+f.surfaces();
    for(const planted of [AUTH_CODE,CONTACT.email,CONTACT.address1,
      CONTACT.firstName,CONTACT.phone])
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
  it('a burned or missing contact input refuses before any charge call',async()=>{
    const f=fixture();
    f.fake.when('POST','/v1/registrar/domains/search')
      .resolves({results:[{domain,available:true,years:1,price:11.25,
        renewalPrice:11.25,premium:false}]});
    f.fake.when('GET','/v1/registrar/domains/{domain}/price').resolves(price);
    f.fake.when('GET','/v1/registrar/domains/{domain}/contact-info/schema')
      .resolves(schemaReply);
    const result=value(await f.call('vercel_registrar_buy',
      {domain,autoRenew:true,contactInputId:CONTACT_ID,outsideApp:true,
        confirm:true,requestKey:'reg-buy-nocontact'},production));
    // Consumption happens inside the pre-dispatch check, so the refusal
    // carries the executor's generic pre-dispatch text — what matters is
    // the status and that no charge call was dispatched.
    expect(result.status).toBe('refused_by_guard');
    expect(f.fake.calls.filter(x=>x.path.includes('/buy'))).toHaveLength(0);
    f.fake.verify();
  });
});
