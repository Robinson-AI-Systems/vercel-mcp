// N-3: domain registrar. Quote → confirm for every purchase (design
// N4): the preview prices from a fresh quote, the executor re-quotes
// before dispatch and refuses drift, and apply sends expectedPrice in
// dollars so the provider independently refuses a changed price.
// Registrant contact and transfer auth codes arrive ONLY through the
// setup-page pending-input vault, consumed inside apply (design N5;
// dossier §4.2); the transfer-out auth code leaves ONLY through the
// one-time-secret page. Contract dossier:
// batch-n3-dossier-2026-10-30.md (audit goal workspace).
import {createHash} from 'node:crypto';
import {defineWrite,bindGuardedWrite,requirePreDispatch,RefusalError} from '../core/write.js';
import {compact} from '../core/util.js';
import {readProvider,writeProvider} from '../vercel/provider.js';
import {validateRequest} from '../vercel/openapi-validation.js';
import {accountSpendGuard,usd} from '../vercel/spend.js';
import {pendingInputs} from '../core/pending-inputs.js';
import {oneTimeSecrets} from '../core/one-time-secrets.js';
import {checkProtected} from './self-guard.js';
import {checkApp} from './app-guard.js';
import {schema,respond} from './release-common.js';

// A definitive provider rejection (the provider answered and refused; no
// order exists) is rethrown with its leg annotated so the executor's
// failure detail names the provider code on the outcome_unknown result —
// the guarded executor deliberately reports every post-claim apply failure
// that way (AUD-H). The common price-drift case never reaches here: apply
// re-quotes inside the pre-dispatch check and refuses before dispatch.
function providerRejection(error,leg){
  if(error&&typeof error==='object'&&typeof error.code==='string'&&
    Number.isSafeInteger(error.status))
    return Object.assign(error,{leg});
  return error;
}
const READ_PROFILES=['read_only','everyday','full'];
const FULL=['full'];
const REQUEST=/^[A-Za-z0-9_-]{8,128}$/;
const INPUT_ID=/^[A-Za-z0-9-]{36}$/;
const ORDER_ID=/^[A-Za-z0-9_-]{3,128}$/;
const TRANSFER_STATUSES=['canceled','canceled_pending_refund','completed',
  'created','failed','pending','pending_insert','pending_new_auth_code',
  'pending_transfer','pending_unlock','pending_registry_unlock','rejected',
  'submitting_transfer'];
const ORDER_ROW_STATUSES=['pending','completed','failed','refunded','refund-failed'];

function exactArgs(args,allowed){
  if(!args||typeof args!=='object'||Array.isArray(args)||
    Object.keys(args).some(key=>!allowed.includes(key)))
    throw new RefusalError('Invalid registrar tool arguments');
}
const safeText=(value,max=256)=>typeof value==='string'&&value.length<=max&&
  !/[\x00-\x1f\x7f]/.test(value)?value:null;
function safeHostname(value){
  if(typeof value!=='string'||value.length>253||
    /[/?#@:\s\\]/.test(value)||!/^[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(value))
    return null;
  return value;
}
function safeDomain(value){
  const host=safeHostname(value);
  if(!host||!host.includes('.'))return null;
  return host;
}
function assertControl(args){
  if((args.confirm!==undefined&&typeof args.confirm!=='boolean')||
    (args.dryRun!==undefined&&typeof args.dryRun!=='boolean')||
    (args.requestKey!==undefined&&!REQUEST.test(args.requestKey)))
    throw new RefusalError('Invalid write control arguments');
}
function assertOutsideApp(args){
  if(args.outsideApp!==true)
    throw new RefusalError('Registrar changes need outsideApp confirmation');
}
function assertFull(ctx){
  if(ctx.connection?.profile!=='full')throw new RefusalError('Full profile required');
}
function context({db,connection,env,fetchImpl}){
  return {db,connection,env,fetchImpl,shape:compact,
    audit:entry=>db.recordChange(entry),replayStore:db.requestReplayStore(),
    guardProtected:targets=>checkProtected(targets,{db,connection,env}),
    guardApp:targets=>checkApp(targets,{db,connection,env}),
    // The real daily-limit guard (the universal.js composition), so the
    // $0 advisory path and policy surfaces see registrar spend exactly
    // like every other spend tool (dossier §5).
    checkSpend:accountSpendGuard({db,account:connection.account})};
}
const out=result=>({isError:['refused_by_guard','outcome_unknown'].includes(result.status),
  content:[{type:'text',text:JSON.stringify(result)}]});
async function teamContext(ctx){
  const {client,account}=await readProvider(ctx);
  if(!['team','full'].includes(account.scope))
    throw new RefusalError('The registrar is not available to a project-scoped connection');
  return {client,account};
}
const fp=value=>createHash('sha256').update(value).digest('hex');

/* ------------------------------- money -------------------------------- */
// Documented prices are USD dollars as number|string (dossier §2).
// Internal money is integer cents, converted exactly: a price that
// cannot be represented in whole cents refuses rather than rounding.
function priceToCents(value){
  let text;
  if(typeof value==='number'){
    if(!Number.isFinite(value)||value<0)return null;
    text=String(value);
  }else if(typeof value==='string'){text=value.trim();}
  else return null;
  const match=/^(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if(!match)return null;
  const cents=Number(match[1])*100+Number((match[2]??'').padEnd(2,'0'));
  return Number.isSafeInteger(cents)?cents:null;
}
const centsToDollars=cents=>cents/100;
function priceRow(reply){
  if(!reply||typeof reply!=='object'||Array.isArray(reply)||
    !Number.isSafeInteger(reply.years)||reply.years<1||reply.years>100)
    throw new RefusalError('Invalid price response');
  const purchase=priceToCents(reply.purchasePrice);
  const renewal=priceToCents(reply.renewalPrice);
  const transfer=priceToCents(reply.transferPrice);
  if(purchase===null||renewal===null||transfer===null)
    throw new RefusalError('The quoted price cannot be represented exactly in cents');
  return {years:reply.years,purchase,renewal,transfer};
}
async function quoteFor(client,domain,years){
  const reply=await client.request('registrar_domain_price',
    {path:{domain},query:{years}});
  const quote=priceRow(reply);
  if(quote.years!==years)
    throw new RefusalError('The provider quoted a different period than requested');
  return quote;
}
function safeYears(value){
  if(value===undefined)return 1;
  if(!Number.isSafeInteger(value)||value<1||value>10)
    throw new RefusalError('Years must be a whole number from 1 to 10');
  return value;
}

/* ------------------------------ contact ------------------------------- */
const CONTACT_REQUIRED=['firstName','lastName','email','phone','address1',
  'city','state','zip','country'];
const CONTACT_OPTIONAL=['address2','companyName','fax'];
const E164=/^\+[1-9]\d{6,14}$/;
function parseContact(text){
  if(typeof text!=='string'||text.length>8192)
    throw new RefusalError('The stored registrant contact is missing or unreadable');
  let contact;
  try{contact=JSON.parse(text);}
  catch{throw new RefusalError('The stored registrant contact is not valid JSON');}
  if(!contact||typeof contact!=='object'||Array.isArray(contact))
    throw new RefusalError('The stored registrant contact is not an object');
  const allowed=[...CONTACT_REQUIRED,...CONTACT_OPTIONAL,'additional'];
  if(Object.keys(contact).some(key=>!allowed.includes(key)))
    throw new RefusalError('The stored registrant contact carries fields the provider does not accept');
  for(const field of CONTACT_REQUIRED){
    const value=contact[field];
    if(typeof value!=='string'||value.trim().length===0||value.length>256||
      /[\x00-\x1f\x7f]/.test(value))
      throw new RefusalError('The stored registrant contact is missing a valid '+field);
  }
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email))
    throw new RefusalError('The stored registrant contact email is not valid');
  if(!E164.test(contact.phone))
    throw new RefusalError('The stored registrant contact phone must be in international (+country) format');
  if(!/^[A-Z]{2}$/.test(contact.country))
    throw new RefusalError('The stored registrant contact country must be a two-letter country code');
  for(const field of CONTACT_OPTIONAL){
    if(contact[field]!==undefined&&
      (typeof contact[field]!=='string'||contact[field].length>256||
        /[\x00-\x1f\x7f]/.test(contact[field])))
      throw new RefusalError('The stored registrant contact field '+field+' is not valid');
  }
  if(contact.fax!==undefined&&contact.fax!==''&&!E164.test(contact.fax))
    throw new RefusalError('The stored registrant contact fax must be in international (+country) format');
  if(contact.additional!==undefined&&
    (!contact.additional||typeof contact.additional!=='object'||
      Array.isArray(contact.additional)))
    throw new RefusalError('The stored registrant contact additional data is not an object');
  return contact;
}
async function contactFieldNames(client,domain){
  const reply=await client.request('registrar_contact_schema',{path:{domain}});
  if(!reply||typeof reply!=='object'||Array.isArray(reply))
    throw new RefusalError('Invalid contact schema response');
  const properties=reply.properties&&typeof reply.properties==='object'&&
    !Array.isArray(reply.properties)?Object.keys(reply.properties):[];
  return properties.filter(name=>/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name)).sort();
}
async function availabilityFor(client,domain){
  const reply=await client.request('registrar_search',{body:{domains:[domain]}});
  if(!reply||!Array.isArray(reply.results)||reply.results.length!==1)
    throw new RefusalError('Invalid availability response');
  const row=reply.results[0];
  if(!row||row.domain!==domain||typeof row.available!=='boolean')
    throw new RefusalError('Invalid availability response');
  return row.available;
}
async function domainRow(client,domain){
  const reply=await client.request('domains_get',{path:{domain}});
  const row=reply?.domain;
  if(!row||typeof row!=='object'||Array.isArray(row))
    throw new RefusalError('Invalid domain response');
  return {name:safeDomain(row.name)??domain,
    nameservers:Array.isArray(row.nameservers)?
      row.nameservers.slice(0,8).map(value=>safeHostname(value)):null,
    autoRenew:typeof row.autoRenew==='boolean'?row.autoRenew:null,
    expiresAt:Number.isSafeInteger(row.expiresAt)?row.expiresAt:null};
}
async function orderRow(client,orderId,domain){
  const reply=await client.request('registrar_order',{path:{orderId}});
  if(!reply||typeof reply!=='object'||Array.isArray(reply)||
    typeof reply.orderId!=='string'||!Array.isArray(reply.domains))
    throw new RefusalError('Invalid order response');
  const row=reply.domains.find(entry=>entry&&entry.domainName===domain);
  if(!row)return null;
  return {domainName:row.domainName,
    purchaseType:safeText(row.purchaseType,32),
    status:ORDER_ROW_STATUSES.includes(row.status)?row.status:null,
    priceCents:priceToCents(row.price),
    autoRenew:typeof row.autoRenew==='boolean'?row.autoRenew:null,
    years:Number.isSafeInteger(row.years)?row.years:null};
}

/* -------------------------------- reads ------------------------------- */
const readHandlers={
  async vercel_registrar_search(args,ctx){
    exactArgs(args,['domains','fields','detail']);
    if(!Array.isArray(args.domains)||args.domains.length<1||args.domains.length>200)
      throw new RefusalError('Give between 1 and 200 exact domain names to check');
    const domains=args.domains.map(value=>{
      const domain=safeDomain(value);
      if(!domain)throw new RefusalError('Invalid domain name in the search list');
      return domain;
    });
    const {client}=await teamContext(ctx);
    const reply=await client.request('registrar_search',{body:{domains}});
    if(!reply||!Array.isArray(reply.results))
      throw new RefusalError('Invalid search response');
    const results=reply.results.map(row=>{
      if(!row||typeof row.domain!=='string'||typeof row.available!=='boolean')
        throw new RefusalError('Invalid search response');
      if(!row.available)return {domain:row.domain,available:false};
      return {domain:row.domain,available:true,
        years:Number.isSafeInteger(row.years)?row.years:null,
        priceCents:priceToCents(row.price),
        renewalPriceCents:priceToCents(row.renewalPrice),
        premium:typeof row.premium==='boolean'?row.premium:null};
    });
    return respond({results});
  },
  async vercel_registrar_get_price(args,ctx){
    exactArgs(args,['domain','tld','domains','years','fields','detail']);
    const years=safeYears(args.years);
    const given=['domain','tld','domains'].filter(key=>args[key]!==undefined);
    if(given.length!==1)
      throw new RefusalError('Give exactly one of domain, tld or domains');
    const {client}=await teamContext(ctx);
    if(args.domain!==undefined){
      const domain=safeDomain(args.domain);
      if(!domain)throw new RefusalError('Invalid domain');
      return respond({domain,...await quoteFor(client,domain,years),
        kind:'domain'});
    }
    if(args.tld!==undefined){
      if(typeof args.tld!=='string'||!/^[a-z]{2,24}$/.test(args.tld))
        throw new RefusalError('Invalid TLD');
      const reply=await client.request('registrar_tld_price',
        {path:{tld:args.tld},query:{years}});
      return respond({tld:args.tld,...priceRow(reply),kind:'tld'});
    }
    if(!Array.isArray(args.domains)||args.domains.length<1||args.domains.length>50)
      throw new RefusalError('Give between 1 and 50 domains for a bulk price');
    const domains=args.domains.map(value=>{
      const domain=safeDomain(value);
      if(!domain)throw new RefusalError('Invalid domain name in the bulk list');
      return domain;
    });
    const reply=await client.request('registrar_bulk_price',
      {body:{domains,years}});
    if(!reply||!Array.isArray(reply.results))
      throw new RefusalError('Invalid bulk price response');
    const results=reply.results.map(row=>{
      if(!row||typeof row.domain!=='string')
        throw new RefusalError('Invalid bulk price response');
      return {domain:row.domain,...priceRow(row)};
    });
    return respond({results,kind:'bulk'});
  },
  async vercel_registrar_get_status(args,ctx){
    exactArgs(args,['orderId','domain','kind','fields','detail']);
    const {client}=await teamContext(ctx);
    if(args.orderId!==undefined){
      if(args.domain!==undefined||args.kind!==undefined)
        throw new RefusalError('Give either an order id or a domain and kind');
      if(typeof args.orderId!=='string'||!ORDER_ID.test(args.orderId))
        throw new RefusalError('Invalid order id');
      const reply=await client.request('registrar_order',
        {path:{orderId:args.orderId}});
      if(!reply||typeof reply!=='object'||Array.isArray(reply)||
        typeof reply.orderId!=='string'||!Array.isArray(reply.domains)||
        typeof reply.status!=='string')
        throw new RefusalError('Invalid order response');
      return respond({orderId:reply.orderId,
        status:safeText(reply.status,64),
        domains:reply.domains.map(row=>({
          domainName:safeText(row?.domainName,253),
          purchaseType:safeText(row?.purchaseType,32),
          status:ORDER_ROW_STATUSES.includes(row?.status)?row.status:null,
          priceCents:priceToCents(row?.price),
          autoRenew:typeof row?.autoRenew==='boolean'?row.autoRenew:null,
          years:Number.isSafeInteger(row?.years)?row.years:null,
          error:safeText(row?.error,256)}))});
    }
    const domain=safeDomain(args.domain);
    if(!domain)throw new RefusalError('Invalid domain');
    if(args.kind==='transfer'){
      const reply=await client.request('registrar_transfer_status',
        {path:{domain}});
      if(!reply||!TRANSFER_STATUSES.includes(reply.status))
        throw new RefusalError('Invalid transfer status response');
      return respond({domain,kind:'transfer',status:reply.status});
    }
    if(args.kind==='verification'){
      const reply=await client.request('registrar_contact_verification',
        {path:{domain}});
      if(!reply||typeof reply!=='object'||typeof reply.verified!=='boolean')
        throw new RefusalError('Invalid verification response');
      return respond({domain,kind:'verification',verified:reply.verified,
        verifyBy:Number.isSafeInteger(reply.verifyBy)?reply.verifyBy:null,
        email:safeText(reply.email,256)});
    }
    throw new RefusalError("Kind must be 'transfer' or 'verification' with a domain");
  }
};

/* ------------------------------- writes ------------------------------- */
function purchaseBefore(kind){
  return async function before(args,ctx){
    exactArgs(args,kind==='buy'?['domain','years','autoRenew','contactInputId',
        'outsideApp','confirm','dryRun','requestKey']:
      kind==='renew'?['domain','years','contactInputId','outsideApp',
        'confirm','dryRun','requestKey']:
      ['domain','years','autoRenew','contactInputId','authCodeInputId',
        'outsideApp','confirm','dryRun','requestKey']);
    assertControl(args);assertOutsideApp(args);assertFull(ctx);
    if(kind!=='renew'&&
      (typeof args.contactInputId!=='string'||!INPUT_ID.test(args.contactInputId)))
      throw new RefusalError('A registrant contact input id from the setup page is required');
    if(kind==='renew'&&args.contactInputId!==undefined&&
      (typeof args.contactInputId!=='string'||!INPUT_ID.test(args.contactInputId)))
      throw new RefusalError('Invalid registrant contact input id');
    if(kind==='transfer'&&
      (typeof args.authCodeInputId!=='string'||!INPUT_ID.test(args.authCodeInputId)))
      throw new RefusalError('A transfer auth code input id from the setup page is required');
    const domain=safeDomain(args.domain);
    if(!domain)throw new RefusalError('Invalid domain');
    const years=safeYears(args.years);
    if(kind!=='renew'&&typeof args.autoRenew!=='boolean')
      throw new RefusalError('Say whether auto-renew is on or off');
    const {client,account}=await teamContext(ctx);
    if(kind==='buy'&&!await availabilityFor(client,domain))
      throw new RefusalError('That domain is not available for purchase');
    if(kind==='renew'){
      try{await domainRow(client,domain);}
      catch{throw new RefusalError('That domain is not registered on this team');}
    }
    const quote=await quoteFor(client,domain,years);
    const contactFields=await contactFieldNames(client,domain);
    return {domain,teamId:account.team_id,years,
      autoRenew:kind==='renew'?null:args.autoRenew,quote,contactFields};
  };
}
const QUOTE_LEG={buy:'purchase',renew:'renewal',transfer:'transfer'};
const SPEND_TEXT={buy:'Domain purchase',renew:'Domain renewal',
  transfer:'Domain transfer-in'};
const ORDER_TYPE={buy:'purchase',renew:'renewal',transfer:'transfer'};
function purchaseWrite(kind){
  const name={buy:'vercel_registrar_buy',renew:'vercel_registrar_renew',
    transfer:'vercel_registrar_transfer_in'}[kind];
  const op={buy:'registrar_buy',renew:'registrar_renew',
    transfer:'registrar_transfer_in'}[kind];
  return defineWrite({
    name,risk:{spend:true},secretIn:kind==='transfer',
    before:purchaseBefore(kind),
    async spend(args,_ctx,before){
      return {cents:before.quote[QUOTE_LEG[kind]],recurring:false,
        description:SPEND_TEXT[kind]};
    },
    async preview(args,_ctx,before){
      const leg=QUOTE_LEG[kind];
      const verb={buy:'Buy',renew:'Renew',transfer:'Transfer in'}[kind];
      return verb+' '+before.domain+' for '+before.years+
        (before.years===1?' year':' years')+' — '+usd(before.quote[leg])+
        ' total (renewal '+usd(before.quote.renewal)+'/yr'+
        (kind==='buy'?', transfer '+usd(before.quote.transfer):'')+').'+
        (before.autoRenew===null?'':' Auto-renew '+
          (before.autoRenew?'ON — it will renew at the renewal price.':
            'OFF — it will expire at the end of the term.'))+
        ' The registrant contact is taken once from the setup-page vault'+
        ' (fields the provider will receive: '+
        (before.contactFields.join(', ')||'per the provider schema')+
        '); its values are never shown here. A completed order cannot '+
        'be undone here.';
    },
    async production(){return {production:true,
      why:'A registrar order charges the account and changes domain ownership state (B2)'};},
    async targets(_args,before){return [{kind:'account',id:before.teamId}];},
    async apply(args,ctx,before,requestKey){
      const provider=await writeProvider(ctx);
      const leg=QUOTE_LEG[kind];
      let contact=null,authCode=null;
      // Everything before the provider call is a pre-dispatch check: the
      // team/mode recheck, a FRESH re-quote (price drift refuses here,
      // before any charge), the one-time input consumption and the body
      // validation. A refusal from this block dispatched nothing.
      await requirePreDispatch(async()=>{
        if(provider.account.team_id!==before.teamId||
          ctx.connection?.mode!=='production')
          throw new TypeError('Registrar purchase requires an authorized production connection');
        const fresh=await quoteFor({request:(id,p)=>provider.read(id,p)},
          before.domain,before.years);
        if(fresh[leg]!==before.quote[leg])
          throw new RefusalError('The price changed since the quote, so nothing was charged. Run the quote again and confirm the new price.');
        if(kind!=='renew'||args.contactInputId!==undefined){
          contact=parseContact(await pendingInputs({db:ctx.db,env:ctx.env})
            .consume({id:args.contactInputId,account:ctx.connection.account,
              kind:'registrar_contact'}));
        }
        if(kind==='transfer'){
          authCode=await pendingInputs({db:ctx.db,env:ctx.env})
            .consume({id:args.authCodeInputId,account:ctx.connection.account,
              kind:'transfer_auth_code'});
          if(typeof authCode!=='string'||authCode.length===0||
            authCode.length>256||/[\x00-\x1f\x7f]/.test(authCode))
            throw new RefusalError('The stored transfer auth code is missing or already used. Paste it again on the setup page.');
        }
      });
      const body={years:before.years,
        expectedPrice:centsToDollars(before.quote[leg]),
        ...(kind!=='renew'?{autoRenew:before.autoRenew}:{}),
        ...(kind==='transfer'?{authCode}:{}),
        ...(contact?{contactInformation:contact}:{})};
      validateRequest(op,{path:{domain:before.domain},
        query:{teamId:'team_FAKE_validation'},body});
      try{
        return await provider.write(op,{path:{domain:before.domain},body},
          {requestKey,tool:name,shapeResult:value=>{
            if(!value||typeof value!=='object'||Array.isArray(value)||
              typeof value.orderId!=='string'||!ORDER_ID.test(value.orderId))
              throw new TypeError('Vercel did not return the order id');
            return {orderId:value.orderId};
          }});
      }catch(error){throw providerRejection(error,op);}
    },
    async verify(_args,ctx,before,providerResult){
      try{
        const {client,account}=await teamContext(ctx);
        if(account.team_id!==before.teamId)return {confirmed:null};
        const row=await orderRow(client,providerResult.orderId,before.domain);
        if(!row)return {confirmed:null};
        return {confirmed:row.status!=='failed'&&
          row.priceCents===before.quote[QUOTE_LEG[kind]]&&
          row.purchaseType===ORDER_TYPE[kind]};
      }catch{return {confirmed:null};}
    },
    async publicReceipt(_args,before,providerResult){
      return {domain:before.domain,orderId:providerResult.orderId,
        years:before.years,totalCents:before.quote[QUOTE_LEG[kind]]};
    }
  });
}
const buyWrite=purchaseWrite('buy');
const renewWrite=purchaseWrite('renew');
const transferWrite=purchaseWrite('transfer');

const autoRenewWrite=defineWrite({
  name:'vercel_registrar_set_auto_renew',risk:{spend:true},
  async before(args,ctx){
    exactArgs(args,['domain','autoRenew','outsideApp','confirm','dryRun',
      'requestKey']);
    assertControl(args);assertOutsideApp(args);assertFull(ctx);
    const domain=safeDomain(args.domain);
    if(!domain)throw new RefusalError('Invalid domain');
    if(typeof args.autoRenew!=='boolean')
      throw new RefusalError('Say whether auto-renew is on or off');
    const {client,account}=await teamContext(ctx);
    let current;
    try{current=await domainRow(client,domain);}
    catch{throw new RefusalError('That domain is not registered on this team');}
    const quote=await quoteFor(client,domain,1);
    return {domain,teamId:account.team_id,current,quote,
      autoRenew:args.autoRenew};
  },
  async spend(args,_ctx,_before){
    return args.autoRenew?
      {cents:null,recurring:true,description:'Domain auto-renewal'}:
      {cents:0,recurring:false,description:'Domain auto-renewal'};
  },
  async preview(_args,_ctx,before){
    if(before.autoRenew)
      return 'Turn auto-renew ON for '+before.domain+': Vercel will '+
        'charge the renewal price ('+usd(before.quote.renewal)+'/yr) '+
        'when the domain renews'+
        (before.current.expiresAt?
          ' (current term ends '+new Date(before.current.expiresAt)
            .toISOString().slice(0,10)+')':'')+'.';
    return 'Turn auto-renew OFF for '+before.domain+': WARNING — the '+
      'domain will expire'+(before.current.expiresAt?
        ' on '+new Date(before.current.expiresAt).toISOString().slice(0,10):'')+
      ' and stop resolving unless it is renewed by hand before then.';
  },
  async production(){return {production:true,
    why:'Auto-renew controls a future charge and the domain expiry (B2)'};},
  async targets(_args,before){return [{kind:'account',id:before.teamId}];},
  async apply(args,ctx,before,requestKey){
    const provider=await writeProvider(ctx);
    await requirePreDispatch(async()=>{
      if(provider.account.team_id!==before.teamId||
        ctx.connection?.mode!=='production')
        throw new TypeError('Auto-renew changes require an authorized production connection');
    });
    const body={autoRenew:before.autoRenew};
    validateRequest('registrar_auto_renew',{path:{domain:before.domain},
      query:{teamId:'team_FAKE_validation'},body});
    try{
      return await provider.write('registrar_auto_renew',
        {path:{domain:before.domain},body},
        {requestKey,tool:'vercel_registrar_set_auto_renew',
          shapeResult:value=>{
            if(value!==undefined&&
              (!value||typeof value!=='object'||Array.isArray(value)))
              throw new TypeError('Invalid auto-renew response');
            return {};
          }});
    }catch(error){throw providerRejection(error,'registrar_auto_renew');}
  },
  async verify(_args,ctx,before){
    try{
      const {client,account}=await teamContext(ctx);
      if(account.team_id!==before.teamId)return {confirmed:null};
      const current=await domainRow(client,before.domain);
      if(current.autoRenew===null)return {confirmed:null};
      return {confirmed:current.autoRenew===before.autoRenew};
    }catch{return {confirmed:null};}
  },
  async inverse(_args,before){
    if(before.current.autoRenew===null)return null;
    return {undo:'Restore the previous auto-renew setting',
      tool:'vercel_registrar_set_auto_renew',outsideApp:true,
      domain:before.domain,autoRenew:before.current.autoRenew};
  }
});

const NAMESERVER_SET=values=>values.map(v=>v.toLowerCase().replace(/\.$/,''))
  .sort().join('|');
const nameserversWrite=defineWrite({
  name:'vercel_registrar_update_nameservers',
  async before(args,ctx){
    exactArgs(args,['domain','nameservers','outsideApp','confirm','dryRun',
      'requestKey']);
    assertControl(args);assertOutsideApp(args);assertFull(ctx);
    const domain=safeDomain(args.domain);
    if(!domain)throw new RefusalError('Invalid domain');
    if(!Array.isArray(args.nameservers)||args.nameservers.length<2||
      args.nameservers.length>8)
      throw new RefusalError('Give between 2 and 8 nameservers');
    const nameservers=args.nameservers.map(value=>{
      const host=safeHostname(typeof value==='string'?
        value.replace(/\.$/,''):value);
      if(!host)throw new RefusalError('Invalid nameserver hostname');
      return host;
    });
    if(new Set(nameservers.map(v=>v.toLowerCase())).size!==nameservers.length)
      throw new RefusalError('Nameservers must be unique');
    const {client,account}=await teamContext(ctx);
    let current;
    try{current=await domainRow(client,domain);}
    catch{throw new RefusalError('That domain is not registered on this team');}
    return {domain,teamId:account.team_id,current,nameservers};
  },
  async preview(_args,_ctx,before){
    return 'Point '+before.domain+' at new nameservers. Now: '+
      (before.current.nameservers?.join(', ')||'provider default')+
      '. After: '+before.nameservers.join(', ')+
      '. Nameserver changes steer the live site and mail as they propagate.';
  },
  async production(){return {production:true,
    why:'Nameservers steer live site traffic and mail (B2)'};},
  async targets(_args,before){return [{kind:'account',id:before.teamId}];},
  async apply(args,ctx,before,requestKey){
    const provider=await writeProvider(ctx);
    await requirePreDispatch(async()=>{
      if(provider.account.team_id!==before.teamId||
        ctx.connection?.mode!=='production')
        throw new TypeError('Nameserver changes require an authorized production connection');
    });
    const body={nameservers:before.nameservers};
    validateRequest('registrar_nameservers',{path:{domain:before.domain},
      query:{teamId:'team_FAKE_validation'},body});
    try{
      return await provider.write('registrar_nameservers',
        {path:{domain:before.domain},body},
        {requestKey,tool:'vercel_registrar_update_nameservers',
          shapeResult:value=>{
            if(value!==undefined&&
              (!value||typeof value!=='object'||Array.isArray(value)))
              throw new TypeError('Invalid nameservers response');
            return {};
          }});
    }catch(error){throw providerRejection(error,'registrar_nameservers');}
  },
  async verify(_args,ctx,before){
    try{
      const {client,account}=await teamContext(ctx);
      if(account.team_id!==before.teamId)return {confirmed:null};
      const current=await domainRow(client,before.domain);
      if(!Array.isArray(current.nameservers))return {confirmed:null};
      return {confirmed:NAMESERVER_SET(current.nameservers)===
        NAMESERVER_SET(before.nameservers)};
    }catch{return {confirmed:null};}
  },
  async inverse(_args,before){
    if(!Array.isArray(before.current.nameservers))return null;
    return {undo:'Restore the previous nameservers',
      tool:'vercel_registrar_update_nameservers',outsideApp:true,
      domain:before.domain,
      nameservers:before.current.nameservers};
  }
});

const authCodeWrite=defineWrite({
  name:'vercel_registrar_get_auth_code',secretOut:true,oneTimeDelivery:true,
  async before(args,ctx){
    exactArgs(args,['domain','outsideApp','confirm','dryRun','requestKey']);
    assertControl(args);assertOutsideApp(args);assertFull(ctx);
    const domain=safeDomain(args.domain);
    if(!domain)throw new RefusalError('Invalid domain');
    const {client,account}=await teamContext(ctx);
    try{await domainRow(client,domain);}
    catch{throw new RefusalError('That domain is not registered on this team');}
    return {domain,teamId:account.team_id};
  },
  async preview(_args,_ctx,before){
    return 'Read the transfer auth code for '+before.domain+
      '. The code itself is delivered once, on the owner one-time page — '+
      'it never appears in this result, the journal or a replay.';
  },
  async production(){return {production:true,
    why:'A transfer auth code can move the domain to another registrar (B2)'};},
  async targets(_args,before){return [{kind:'account',id:before.teamId}];},
  async apply(args,ctx,before,_requestKey){
    const provider=await writeProvider(ctx);
    await requirePreDispatch(async()=>{
      if(provider.account.team_id!==before.teamId||
        ctx.connection?.mode!=='production')
        throw new TypeError('Auth code reads require an authorized production connection');
    });
    let reply;
    try{reply=await provider.read('registrar_auth_code',
      {path:{domain:before.domain}});}
    catch(error){throw providerRejection(error,'registrar_auth_code');}
    if(!reply||typeof reply.authCode!=='string'||
      reply.authCode.length===0||reply.authCode.length>256)
      throw new TypeError('Vercel did not return the auth code');
    const receipt=await oneTimeSecrets({db:ctx.db,env:ctx.env}).issue({
      account:ctx.connection.account,kind:'registrar_auth_code',
      label:before.domain,value:reply.authCode});
    return {ownerRevealRef:receipt.id,expiresAt:receipt.expiresAt,
      fingerprint:fp(reply.authCode)};
  },
  async verify(_args,ctx,before,providerResult){
    try{
      const {client,account}=await teamContext(ctx);
      if(account.team_id!==before.teamId)return {confirmed:null};
      const reply=await client.request('registrar_auth_code',
        {path:{domain:before.domain}});
      if(!reply||typeof reply.authCode!=='string')return {confirmed:null};
      return {confirmed:fp(reply.authCode)===providerResult.fingerprint};
    }catch{return {confirmed:null};}
  },
  async publicReceipt(_args,before){
    return {domain:before.domain,delivery:'one-time page'};
  }
});

/* ------------------------------ registry ------------------------------ */
const writeFlags={
  outsideApp:{type:'boolean'},confirm:{type:'boolean'},
  dryRun:{type:'boolean'},
  requestKey:{type:'string',pattern:REQUEST.source}};
export const registrarTools={
  tools:[
    {name:'vercel_registrar_search',writes:false,profiles:READ_PROFILES,
      area:'registrar',
      description:'Check exact domain names: availability, price and renewal price',
      inputSchema:schema({domains:{type:'array',items:{type:'string'}},
        fields:{type:'array'},detail:{type:'string'}},['domains'])},
    {name:'vercel_registrar_get_price',writes:false,profiles:READ_PROFILES,
      area:'registrar',
      description:'Quote purchase, renewal and transfer prices for a domain, a TLD or a bulk list',
      inputSchema:schema({domain:{type:'string'},tld:{type:'string'},
        domains:{type:'array',items:{type:'string'}},
        years:{type:'integer'},fields:{type:'array'},
        detail:{type:'string'}})},
    {name:'vercel_registrar_get_status',writes:false,profiles:READ_PROFILES,
      area:'registrar',
      description:"Read an order's, a transfer's or contact verification's status",
      inputSchema:schema({orderId:{type:'string'},domain:{type:'string'},
        kind:{type:'string',enum:['transfer','verification']},
        fields:{type:'array'},detail:{type:'string'}})},
    {name:'vercel_registrar_buy',writes:true,guardedWrite:true,
      profiles:FULL,area:'registrar',writeContract:buyWrite.writeContract,
      description:'Buy a domain at the quoted price; contact comes from the setup-page vault',
      inputSchema:schema({domain:{type:'string'},years:{type:'integer'},
        autoRenew:{type:'boolean'},contactInputId:{type:'string'},
        ...writeFlags},['domain','autoRenew','contactInputId','outsideApp']),
      annotations:{destructiveHint:false}},
    {name:'vercel_registrar_renew',writes:true,guardedWrite:true,
      profiles:FULL,area:'registrar',writeContract:renewWrite.writeContract,
      description:'Renew a domain at the quoted renewal price',
      inputSchema:schema({domain:{type:'string'},years:{type:'integer'},
        contactInputId:{type:'string'},...writeFlags},
        ['domain','outsideApp']),
      annotations:{destructiveHint:false}},
    {name:'vercel_registrar_set_auto_renew',writes:true,guardedWrite:true,
      profiles:FULL,area:'registrar',
      writeContract:autoRenewWrite.writeContract,
      description:'Turn domain auto-renew on (future renewal charge) or off (expiry warning)',
      inputSchema:schema({domain:{type:'string'},
        autoRenew:{type:'boolean'},...writeFlags},
        ['domain','autoRenew','outsideApp']),
      annotations:{destructiveHint:false}},
    {name:'vercel_registrar_transfer_in',writes:true,guardedWrite:true,
      profiles:FULL,area:'registrar',
      writeContract:transferWrite.writeContract,
      description:'Transfer a domain in at the quoted transfer price; auth code from the vault',
      inputSchema:schema({domain:{type:'string'},years:{type:'integer'},
        autoRenew:{type:'boolean'},contactInputId:{type:'string'},
        authCodeInputId:{type:'string'},...writeFlags},
        ['domain','autoRenew','contactInputId','authCodeInputId','outsideApp']),
      annotations:{destructiveHint:false}},
    {name:'vercel_registrar_get_auth_code',writes:true,guardedWrite:true,
      profiles:FULL,area:'registrar',
      writeContract:authCodeWrite.writeContract,
      description:'Read the transfer auth code; delivered once on the owner one-time page',
      inputSchema:schema({domain:{type:'string'},...writeFlags},
        ['domain','outsideApp']),
      annotations:{destructiveHint:false}},
    {name:'vercel_registrar_update_nameservers',writes:true,guardedWrite:true,
      profiles:FULL,area:'registrar',
      writeContract:nameserversWrite.writeContract,
      description:"Replace a domain's nameservers, with read-back",
      inputSchema:schema({domain:{type:'string'},
        nameservers:{type:'array',items:{type:'string'},maxItems:8},
        ...writeFlags},['domain','nameservers','outsideApp']),
      annotations:{destructiveHint:true}}
  ],
  handlers:{...readHandlers,
    vercel_registrar_buy:bindGuardedWrite(buyWrite,context,out),
    vercel_registrar_renew:bindGuardedWrite(renewWrite,context,out),
    vercel_registrar_set_auto_renew:bindGuardedWrite(autoRenewWrite,context,out),
    vercel_registrar_transfer_in:bindGuardedWrite(transferWrite,context,out),
    vercel_registrar_get_auth_code:bindGuardedWrite(authCodeWrite,context,out),
    vercel_registrar_update_nameservers:bindGuardedWrite(nameserversWrite,context,out)}
};
