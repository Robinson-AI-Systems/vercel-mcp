import {beforeEach,describe,expect,it,vi} from 'vitest';
import {registry} from '../../src/tools/index.js';
import {dispatchReadOnlyTool} from '../../src/core/mcp-server.js';
import {makeFakeVercel,vercelError} from '../../test/helpers/fake-vercel.js';
import {loadToken} from '../../src/vercel/tokens.js';
import {pendingInputs} from '../../src/core/pending-inputs.js';

vi.mock('../../src/vercel/tokens.js',async importOriginal=>{
  const actual=await importOriginal();
  return {...actual,loadToken:vi.fn()};
});
const ENV={TOKEN_ENCRYPTION_KEY:'00'.repeat(32)};
const production={account:'acct_FAKE',mode:'production',profile:'full',
  listing:'catalog',kind:'connector'};
const preview={...production,mode:'preview'};
const delegated={...production,kind:'pass'};
const account={id:'acct_FAKE',team_id:'team_FAKE',scope:'team',project_id:null};
const domain='example.com';
const CONTACT={firstName:'FAKE',lastName:'Person',email:'fake@example.com',
  phone:'+13035550123',address1:'1 Fake Street',city:'Greeley',state:'CO',
  zip:'80631',country:'US'};
const CONTACT_ID='123e4567-e89b-12d3-a456-426614174001';
const price=(over={})=>({years:1,purchasePrice:11.25,renewalPrice:11.25,
  transferPrice:11.25,...over});
const searchHit={results:[{domain,available:true,years:1,price:11.25,
  renewalPrice:11.25,premium:false}]};
const schemaReply={type:'object',properties:{firstName:{},lastName:{},
  email:{},phone:{},address1:{},city:{},state:{},zip:{},country:{}}};
const order=(over={})=>({orderId:'ord_FAKE1',status:'completed',
  domains:[{domainName:domain,purchaseType:'purchase',autoRenew:true,
    years:1,status:'completed',price:11.25}],...over});
const domainReply=(over={})=>({domain:{name:domain,teamId:'team_FAKE',
  nameservers:['ns1.vercel-dns.com','ns2.vercel-dns.com'],autoRenew:false,
  expiresAt:1798761600000,verified:true,serviceType:'external',...over}});
function fixture({withIntents=true}={}){
  const fake=makeFakeVercel(),audits=[],replay=new Map(),
    pending=new Map(),oneTime=new Map(),intents=new Map();
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
  if(withIntents){
    // Mirrors the executor's binding: it passes {account, operation,
    // requestKey, fingerprint, priceCents, pricingSource} and needs
    // {reference, status, expiresAt} back.
    db.requestPurchaseIntent=async(binding)=>{
      const reference='poi_FAKE_'+binding.requestKey;
      const row={...binding,reference,status:'pending',
        expiresAt:new Date(Date.now()+600000).toISOString()};
      intents.set(reference,row);
      return row;
    };
    db.getPurchaseIntent=async({reference})=>intents.get(reference)??null;
    db.consumePurchaseIntent=async({reference})=>{
      const row=intents.get(reference);
      if(!row||row.status!=='approved')return false;
      row.status='consumed';return true;
    };
  }
  const call=(name,args,connection=production)=>
    dispatchReadOnlyTool({registry,name,args,connection,db,
      fetchImpl:fake.fetch,env:ENV});
  // The ciphertext is bound to the id submit mints — always use that id.
  const seedContact=async(value=JSON.stringify(CONTACT))=>{
    const {id}=await pendingInputs({db,env:ENV}).submit({account:'acct_FAKE',
      kind:'registrar_contact',label:'registrant',value});
    return id;
  };
  return {fake,audits,replay,intents,call,seedContact,db};
}
const value=result=>JSON.parse(result.content[0].text);
function queueBuy(f,priceReply=price()){
  f.fake.when('POST','/v1/registrar/domains/search')
    .resolves(searchHit).resolves(searchHit);
  f.fake.when('GET','/v1/registrar/domains/{domain}/price')
    .resolves(priceReply).resolves(priceReply);
  f.fake.when('GET','/v1/registrar/domains/{domain}/contact-info/schema')
    .resolves(schemaReply).resolves(schemaReply);
}
beforeEach(()=>{loadToken.mockResolvedValue({token:'vcp_FAKE',account});});

describe('N-3 registrar',()=>{
  it('registers nine registrar tools with catalog profiles and write contracts',()=>{
    const names=registry.tools.map(t=>t.name);
    for(const name of ['vercel_registrar_search','vercel_registrar_get_price',
      'vercel_registrar_get_status','vercel_registrar_buy',
      'vercel_registrar_renew','vercel_registrar_set_auto_renew',
      'vercel_registrar_transfer_in','vercel_registrar_get_auth_code',
      'vercel_registrar_update_nameservers'])
      expect(names).toContain(name);
    const byName=n=>registry.tools.find(t=>t.name===n);
    expect(byName('vercel_registrar_search').writes).toBe(false);
    expect(byName('vercel_registrar_buy').writeContract).toMatchObject(
      {spend:true,secretIn:false});
    expect(byName('vercel_registrar_transfer_in').writeContract)
      .toMatchObject({spend:true,secretIn:true});
    expect(byName('vercel_registrar_get_auth_code').writeContract)
      .toMatchObject({secretOut:true});
    expect(byName('vercel_registrar_buy').profiles).toEqual(['full']);
  });
  it('searches exact names and shapes both availability branches',async()=>{
    const f=fixture();
    f.fake.when('POST','/v1/registrar/domains/search').resolves({results:[
      {domain,available:true,years:1,price:11.25,renewalPrice:11.25,premium:false},
      {domain:'taken.com',available:false}]});
    const result=value(await f.call('vercel_registrar_search',
      {domains:[domain,'taken.com']}));
    expect(result.results).toEqual([
      {domain,available:true,years:1,priceCents:1125,renewalPriceCents:1125,
        premium:false},
      {domain:'taken.com',available:false}]);
    f.fake.verify();
  });
  it('quotes domain, TLD and bulk prices in exact cents (string form too)',async()=>{
    const f=fixture();
    f.fake.when('GET','/v1/registrar/domains/{domain}/price')
      .resolves(price({purchasePrice:'11.25'}));
    f.fake.when('GET','/v1/registrar/tlds/{tld}/price').resolves(price());
    f.fake.when('POST','/v1/registrar/domains/price')
      .resolves({results:[{domain,...price()}]});
    const one=value(await f.call('vercel_registrar_get_price',{domain,years:1}));
    expect(one).toMatchObject({purchase:1125,renewal:1125,transfer:1125});
    const tld=value(await f.call('vercel_registrar_get_price',{tld:'com'}));
    expect(tld.purchase).toBe(1125);
    const bulk=value(await f.call('vercel_registrar_get_price',
      {domains:[domain]}));
    expect(bulk.results[0]).toMatchObject({domain,purchase:1125});
    f.fake.verify();
  });
  it('previews a buy with the dollar line from the 1125-cent quote',async()=>{
    const f=fixture();queueBuy(f);
    const result=value(await f.call('vercel_registrar_buy',
      {domain,autoRenew:true,contactInputId:CONTACT_ID,outsideApp:true,
        dryRun:true},production));
    expect(result.status).toBe('preview');
    expect(result.preview).toContain('$11.25');
    expect(result.preview).toContain('firstName');
    expect(result.preview).not.toContain('FAKE-AUTH');
    expect(f.fake.calls.filter(x=>x.path.includes('/buy'))).toHaveLength(0);
    f.fake.verify();
  });
  it('buys at the quote: expectedPrice byte-exact, contact from the vault, order read back',async()=>{
    const f=fixture();const contactId=await f.seedContact();queueBuy(f);
    f.fake.when('POST','/v1/registrar/domains/{domain}/buy')
      .resolves({orderId:'ord_FAKE1',_links:{}});
    f.fake.when('GET','/v1/registrar/orders/{orderId}').resolves(order());
    const result=value(await f.call('vercel_registrar_buy',
      {domain,autoRenew:true,contactInputId:contactId,outsideApp:true,
        confirm:true,requestKey:'reg-buy-test-0001'},production));
    expect(result).toMatchObject({status:'applied',confirmed:true,
      receipt:{domain,orderId:'ord_FAKE1',totalCents:1125}});
    const post=f.fake.calls.find(x=>x.path.includes('/buy'));
    expect(post.body).toEqual({years:1,expectedPrice:11.25,autoRenew:true,
      contactInformation:CONTACT});
    expect(JSON.stringify(f.audits)).not.toContain('1 Fake Street');
    f.fake.verify();
  });
  it('refuses a buy when the quote drifts between preview and dispatch',async()=>{
    const f=fixture();await f.seedContact();
    f.fake.when('POST','/v1/registrar/domains/search')
      .resolves(searchHit).resolves(searchHit);
    f.fake.when('GET','/v1/registrar/domains/{domain}/price')
      .resolves(price()).resolves(price({purchasePrice:12.00,
        renewalPrice:12.00,transferPrice:12.00}));
    f.fake.when('GET','/v1/registrar/domains/{domain}/contact-info/schema')
      .resolves(schemaReply).resolves(schemaReply);
    const result=value(await f.call('vercel_registrar_buy',
      {domain,autoRenew:true,contactInputId:CONTACT_ID,outsideApp:true,
        confirm:true,requestKey:'reg-buy-drift-001'},production));
    expect(result.status).toBe('refused_by_guard');
    expect(f.fake.calls.filter(x=>x.path.includes('/buy'))).toHaveLength(0);
    f.fake.verify();
  });
  it('a definitive provider price rejection surfaces its code in the failure detail',async()=>{
    const f=fixture();const contactId=await f.seedContact();queueBuy(f);
    f.fake.when('POST','/v1/registrar/domains/{domain}/buy')
      .rejects(400,vercelError(400,'expected_price_mismatch'));
    const result=value(await f.call('vercel_registrar_buy',
      {domain,autoRenew:false,contactInputId:contactId,outsideApp:true,
        confirm:true,requestKey:'reg-buy-mismatch1'},production));
    // The provider answered and refused (no order exists), but the
    // guarded executor reports every post-claim apply failure as
    // outcome_unknown (AUD-H); the failure detail names the provider
    // code and leg. The common drift case is refused pre-dispatch by
    // the apply-time re-quote (previous test).
    expect(result.status).toBe('outcome_unknown');
    expect(result.failure).toMatchObject({code:'expected_price_mismatch',
      status:400,leg:'registrar_buy'});
    f.fake.verify();
  });
  it('a delegated connection without a quote-bound purchase intent parks for owner approval',async()=>{
    const f=fixture();await f.seedContact();queueBuy(f);
    const result=value(await f.call('vercel_registrar_buy',
      {domain,autoRenew:true,contactInputId:CONTACT_ID,outsideApp:true,
        confirm:true,requestKey:'reg-buy-deleg-001'},delegated));
    expect(result.status).toBe('awaiting_owner_approval');
    expect(f.intents.size).toBe(1);
    expect(f.fake.calls.filter(x=>x.path.includes('/buy'))).toHaveLength(0);
    f.fake.verify();
  });
  it('renews at the renewal quote without contact, and reads the order back',async()=>{
    const f=fixture();
    f.fake.when('GET','/v5/domains/{domain}').resolves(domainReply());
    f.fake.when('GET','/v1/registrar/domains/{domain}/price')
      .resolves(price()).resolves(price());
    f.fake.when('GET','/v1/registrar/domains/{domain}/contact-info/schema')
      .resolves(schemaReply).resolves(schemaReply);
    f.fake.when('POST','/v1/registrar/domains/{domain}/renew')
      .resolves({orderId:'ord_FAKE2',_links:{}});
    f.fake.when('GET','/v1/registrar/orders/{orderId}')
      .resolves(order({orderId:'ord_FAKE2',domains:[{domainName:domain,
        purchaseType:'renewal',autoRenew:false,years:1,status:'completed',
        price:11.25}]}));
    const result=value(await f.call('vercel_registrar_renew',
      {domain,outsideApp:true,confirm:true,requestKey:'reg-renew-test-01'},
      production));
    expect(result).toMatchObject({status:'applied',confirmed:true});
    const post=f.fake.calls.find(x=>x.path.includes('/renew'));
    expect(post.body).toEqual({years:1,expectedPrice:11.25});
    f.fake.verify();
  });
  it('auto-renew OFF warns of the expiry date through the $0 path; ON declares recurring spend',async()=>{
    const f=fixture();
    f.fake.when('GET','/v5/domains/{domain}')
      .resolves(domainReply({autoRenew:true})).resolves(domainReply({autoRenew:true}))
      .resolves(domainReply({autoRenew:true})).resolves(domainReply({autoRenew:true}));
    f.fake.when('GET','/v1/registrar/domains/{domain}/price')
      .resolves(price()).resolves(price()).resolves(price()).resolves(price());
    const off=value(await f.call('vercel_registrar_set_auto_renew',
      {domain,autoRenew:false,outsideApp:true,dryRun:true},production));
    expect(off.preview).toMatch(/will expire on 2027-01-01/);
    const g=fixture();
    g.fake.when('GET','/v5/domains/{domain}').resolves(domainReply());
    g.fake.when('GET','/v1/registrar/domains/{domain}/price').resolves(price());
    const on=value(await g.call('vercel_registrar_set_auto_renew',
      {domain,autoRenew:true,outsideApp:true,dryRun:true},production));
    expect(on.preview).toMatch(/will charge the renewal price \(\$11\.25 USD\/yr\)/);
    expect(JSON.stringify(on)).toMatch(/auto-renewal/i);
    f.fake.verify();g.fake.verify();
  });
  it('applies auto-renew and nameserver changes with read-back proof',async()=>{
    const f=fixture();
    f.fake.when('GET','/v5/domains/{domain}')
      .resolves(domainReply({autoRenew:false}))
      .resolves(domainReply({autoRenew:false}))
      .resolves(domainReply({autoRenew:true}));
    f.fake.when('GET','/v1/registrar/domains/{domain}/price')
      .resolves(price()).resolves(price());
    f.fake.when('PATCH','/v1/registrar/domains/{domain}/auto-renew')
      .resolves({});
    const on=value(await f.call('vercel_registrar_set_auto_renew',
      {domain,autoRenew:true,outsideApp:true,confirm:true,
        requestKey:'reg-autorenew-001'},production));
    expect(on).toMatchObject({status:'applied',confirmed:true});
    const g=fixture();
    g.fake.when('GET','/v5/domains/{domain}')
      .resolves(domainReply())
      .resolves(domainReply({nameservers:['ns1.exampledns.net','ns2.exampledns.net']}));
    g.fake.when('PATCH','/v1/registrar/domains/{domain}/nameservers')
      .resolves({});
    const ns=value(await g.call('vercel_registrar_update_nameservers',
      {domain,nameservers:['ns1.exampledns.net','ns2.exampledns.net'],
        outsideApp:true,confirm:true,requestKey:'reg-nameservers-1'},
      production));
    expect(ns).toMatchObject({status:'applied',confirmed:true});
    const patch=g.fake.calls.find(x=>x.method==='PATCH');
    expect(patch.body).toEqual({nameservers:['ns1.exampledns.net',
      'ns2.exampledns.net']});
    f.fake.verify();g.fake.verify();
  });
  it('reads order, transfer and verification status through the one status tool',async()=>{
    const f=fixture();
    f.fake.when('GET','/v1/registrar/orders/{orderId}').resolves(order());
    f.fake.when('GET','/v1/registrar/domains/{domain}/transfer')
      .resolves({status:'pending_transfer'});
    f.fake.when('GET','/v1/registrar/domains/{domain}/contact-verification')
      .resolves({verified:false,verifyBy:1798761600000,email:'fake@example.com'});
    const o=value(await f.call('vercel_registrar_get_status',
      {orderId:'ord_FAKE1'}));
    expect(o.domains[0]).toMatchObject({domainName:domain,priceCents:1125});
    const t=value(await f.call('vercel_registrar_get_status',
      {domain,kind:'transfer'}));
    expect(t).toMatchObject({status:'pending_transfer'});
    const v=value(await f.call('vercel_registrar_get_status',
      {domain,kind:'verification'}));
    expect(v).toMatchObject({verified:false});
    f.fake.verify();
  });
  it('refuses every write on a preview connection and below full profile',async()=>{
    const f=fixture();queueBuy(f);
    const onPreview=value(await f.call('vercel_registrar_buy',
      {domain,autoRenew:true,contactInputId:CONTACT_ID,outsideApp:true,
        confirm:true,requestKey:'reg-buy-preview-1'},preview));
    expect(onPreview.status).toBe('refused_by_guard');
    expect(onPreview.reason).toMatch(/preview connection/i);
    const below=await f.call('vercel_registrar_buy',
      {domain,autoRenew:true,contactInputId:CONTACT_ID,outsideApp:true,
        confirm:true,requestKey:'reg-buy-below-001'},
      {...production,profile:'everyday'});
    expect(below.isError).toBe(true);
    expect(f.fake.calls.filter(x=>x.path.includes('/buy'))).toHaveLength(0);
  });
});
