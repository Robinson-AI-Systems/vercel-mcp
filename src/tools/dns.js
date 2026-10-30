// N-2: DNS records and certificates. Every write is production (BATCH-N
// N1/B2: DNS carries the live site and email). Writes read the whole zone
// first, preview conflicts and before/after, and journal inverses
// (design N2). Certificate upload is NOT built: its documented body
// carries a private key (design N5) — guided only. Contract dossier:
// batch-n2-dossier-2026-10-30.md (audit goal workspace).
import {defineWrite,bindGuardedWrite,requirePreDispatch,RefusalError} from '../core/write.js';
import {compact} from '../core/util.js';
import {readProvider,writeProvider} from '../vercel/provider.js';
import {validateRequest} from '../vercel/openapi-validation.js';
import {checkProtected} from './self-guard.js';
import {checkApp} from './app-guard.js';
import {schema,respond} from './release-common.js';

const READ_PROFILES=['read_only','everyday','full'];
const EVERYDAY=['everyday','full'];
const FULL=['full'];
const REQUEST=/^[A-Za-z0-9_-]{8,128}$/;
const RECORD_ID=/^[A-Za-z0-9_-]{3,128}$/;
const CERT_ID=/^[A-Za-z0-9_-]{3,128}$/;
const DNS_TYPES=['A','AAAA','ALIAS','CAA','CNAME','HTTPS','MX','NS','SRV','TXT'];
// The catalog's create list (docs/TOOL-CATALOG.md, N-2 row). ALIAS and
// HTTPS records are readable and updatable by id, but the catalog does
// not contract creating them here.
const CREATE_TYPES=['A','AAAA','CNAME','MX','TXT','SRV','CAA','NS'];
const NAME_OK=/^$|^@$|^[A-Za-z0-9_](?:[A-Za-z0-9_.-]*[A-Za-z0-9_])?$/;

function exactArgs(args,allowed){
  if(!args||typeof args!=='object'||Array.isArray(args)||
    Object.keys(args).some(key=>!allowed.includes(key)))
    throw new RefusalError('Invalid DNS tool arguments');
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
function safeName(value){
  if(typeof value!=='string'||value.length>253||!NAME_OK.test(value)||
    /[\x00-\x1f\x7f]/.test(value))return null;
  return value==='@'?'':value;
}
function assertControl(args){
  if((args.confirm!==undefined&&typeof args.confirm!=='boolean')||
    (args.dryRun!==undefined&&typeof args.dryRun!=='boolean')||
    (args.requestKey!==undefined&&!REQUEST.test(args.requestKey)))
    throw new RefusalError('Invalid write control arguments');
}
function assertOutsideApp(args){
  if(args.outsideApp!==true)
    throw new RefusalError('DNS changes need outsideApp confirmation');
}
function assertFull(ctx){
  if(ctx.connection?.profile!=='full')throw new RefusalError('Full profile required');
}
function assertEveryday(ctx){
  if(!EVERYDAY.includes(ctx.connection?.profile))
    throw new RefusalError('Everyday or full profile required');
}
function context({db,connection,env,fetchImpl}){
  return {db,connection,env,fetchImpl,shape:compact,
    audit:entry=>db.recordChange(entry),replayStore:db.requestReplayStore(),
    guardProtected:targets=>checkProtected(targets,{db,connection,env}),
    guardApp:targets=>checkApp(targets,{db,connection,env})};
}
const out=result=>({isError:['refused_by_guard','outcome_unknown'].includes(result.status),
  content:[{type:'text',text:JSON.stringify(result)}]});
async function teamContext(ctx){
  const {client,account}=await readProvider(ctx);
  if(!['team','full'].includes(account.scope))
    throw new RefusalError('DNS and certificates are not available to a project-scoped connection');
  return {client,account};
}
// updateRecord's 200 carries the DNS type in recordType while its `type`
// is the record/record-sys discriminator; list rows and the get-by-id
// response carry the DNS type in `type`. One resolver for all three
// (dossier §3).
function dnsType(row){
  if(typeof row?.recordType==='string'&&DNS_TYPES.includes(row.recordType))
    return row.recordType;
  if(typeof row?.type==='string'&&DNS_TYPES.includes(row.type))return row.type;
  return null;
}
function recordSummary(row){
  if(!row||typeof row!=='object'||Array.isArray(row))
    throw new RefusalError('Invalid DNS record response');
  const type=dnsType(row);
  if(!type||typeof row.id!=='string'||!RECORD_ID.test(row.id)||
    typeof row.name!=='string'||row.name.length>253||
    typeof row.value!=='string'||row.value.length>4096||
    /[\x00-\x1f\x7f]/.test(row.value))
    throw new RefusalError('Invalid DNS record response');
  return {id:row.id,name:row.name,type,value:row.value,
    ttl:Number.isSafeInteger(row.ttl)?row.ttl:null,
    mxPriority:Number.isSafeInteger(row.mxPriority)?row.mxPriority:
      (Number.isSafeInteger(row.priority)?row.priority:null),
    comment:typeof row.comment==='string'?safeText(row.comment,500):null,
    creator:typeof row.creator==='string'?safeText(row.creator,128):null};
}
function recordLine(record){
  return record.type+' '+(record.name===''?'@':record.name)+' → '+record.value+
    (record.mxPriority!==null&&record.mxPriority!==undefined?
      ' (priority '+record.mxPriority+')':'')+
    (record.ttl!==null&&record.ttl!==undefined?' (TTL '+record.ttl+')':'');
}
// The whole zone, proven complete: the documented pagination cursor is
// a nullable timestamp number fed back as `since`. A page that cannot
// prove completeness refuses (design: incomplete zone refuses
// replacement — and every other write previews from this same read).
async function readZone(client,domain){
  const rows=[];let since;let previous;
  for(let page=0;page<100;page++){
    const reply=await client.request('dns_records_list',{path:{domain},
      query:{limit:'100',...(since!==undefined?{since:String(since)}:{})}});
    if(!reply||typeof reply!=='object'||Array.isArray(reply)||
      !Array.isArray(reply.records))
      throw new RefusalError('DNS zone response was not recognized');
    for(const row of reply.records)rows.push(recordSummary(row));
    if(rows.length>5000)throw new RefusalError('DNS zone is too large to prove complete');
    const next=reply.pagination?.next;
    if(next===null||next===undefined)return rows;
    if(!Number.isSafeInteger(next)||next<0||next===previous)
      throw new RefusalError('DNS zone pagination was not recognized');
    previous=next;since=next;
  }
  throw new RefusalError('DNS zone pagination did not terminate');
}
function conflictsFor(zone,{name,type,value}){
  const notes=[];
  const atName=zone.filter(record=>record.name===name);
  if(type==='MX'&&atName.some(record=>record.type==='MX'))
    notes.push('This name already has MX records; the new record joins '+
      'that one MX set (a name has a single MX set, ordered by priority)');
  if(type==='TXT'&&typeof value==='string'&&value.startsWith('v=spf1')&&
    atName.some(record=>record.type==='TXT'&&record.value.startsWith('v=spf1')))
    notes.push('This name already has an SPF (v=spf1) TXT record; a second '+
      'SPF record at one name breaks mail authentication — merge the values instead');
  if(atName.some(record=>record.type===type&&record.value===value))
    notes.push('An identical record already exists at this name');
  return notes;
}
function assertNoCnameClash(zone,{name,type},ignoreId=null){
  const others=zone.filter(record=>record.name===name&&record.id!==ignoreId);
  if(type==='CNAME'&&others.length)
    throw new RefusalError('A CNAME cannot share its name with other records; '+
      'this name already holds '+others.map(record=>record.type).join(', '));
  if(type!=='CNAME'&&others.some(record=>record.type==='CNAME'))
    throw new RefusalError('This name already holds a CNAME record; no other '+
      'record type can share the name');
}
function certSummary(row){
  if(!row||typeof row!=='object'||Array.isArray(row)||
    typeof row.id!=='string'||!CERT_ID.test(row.id)||
    !Array.isArray(row.cns)||typeof row.autoRenew!=='boolean'||
    !Number.isSafeInteger(row.createdAt)||!Number.isSafeInteger(row.expiresAt))
    throw new RefusalError('Invalid certificate response');
  // Exactly the documented fields (dossier §4.3): the contract carries
  // no issuer, so none is reported.
  return {id:row.id,
    cns:row.cns.slice(0,32).map(value=>safeHostname(value)),
    autoRenew:row.autoRenew,createdAt:row.createdAt,expiresAt:row.expiresAt};
}

/* -------------------------------- reads ------------------------------- */
const readHandlers={
  async vercel_dns_list(args,ctx){
    exactArgs(args,['domain','fields','detail']);
    const domain=safeDomain(args.domain);
    if(!domain)throw new RefusalError('Invalid domain');
    const {client}=await teamContext(ctx);
    const zone=await readZone(client,domain);
    return respond({domain,records:zone,shown:zone.length,complete:true});
  },
  async vercel_dns_get_record(args,ctx){
    exactArgs(args,['recordId','fields','detail']);
    if(typeof args.recordId!=='string'||!RECORD_ID.test(args.recordId))
      throw new RefusalError('Invalid record id');
    const {client}=await teamContext(ctx);
    const row=await client.request('dns_record_get',{path:{recordId:args.recordId}});
    const record=recordSummary(row);
    return respond({record,
      domain:typeof row?.domain==='string'?safeDomain(row.domain):null});
  },
  async vercel_cert_list(args,ctx){
    exactArgs(args,['fields','detail']);
    const {client}=await teamContext(ctx);
    const reply=await client.request('certs_list',{});
    if(!reply||typeof reply!=='object'||!Array.isArray(reply.certs)||
      !reply.pagination||typeof reply.pagination!=='object')
      throw new RefusalError('Certificate list response was not recognized');
    const certs=reply.certs.map(certSummary);
    const next=reply.pagination.next;
    if(next!==null&&next!==undefined&&!Number.isSafeInteger(next))
      throw new RefusalError('Certificate list pagination was not recognized');
    // getCerts documents no pagination request parameters, so a
    // continuation cannot be fetched through the contract: report the
    // page honestly instead of claiming a complete inventory.
    return respond({certificates:certs,shown:certs.length,
      total:Number.isSafeInteger(reply.pagination.count)?reply.pagination.count:certs.length,
      complete:next===null||next===undefined});
  }
};

/* ---------------------------- record writes ---------------------------- */
function safeSrv(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||
    Object.keys(value).some(key=>!['target','weight','port','priority'].includes(key)))
    throw new RefusalError('Invalid SRV fields');
  const target=safeHostname(value.target);
  const field=number=>Number.isSafeInteger(number)&&number>=0&&number<=65535?number:null;
  const weight=field(value.weight),port=field(value.port),priority=field(value.priority);
  if(!target||weight===null||port===null||priority===null)
    throw new RefusalError('Invalid SRV fields');
  return {target,weight,port,priority};
}
function safeTtl(value){
  if(value===undefined)return null;
  if(!Number.isSafeInteger(value)||value<60||value>2147483647)
    throw new RefusalError('TTL must be a whole number of seconds, at least 60');
  return value;
}
function safeComment(value){
  if(value===undefined)return null;
  const text=safeText(value,500);
  if(text===null)throw new RefusalError('Invalid record comment');
  return text;
}
// One record intent from caller arguments, shared by create and
// replace_zone so both enforce the same contract branches (dossier §2).
function recordIntent(source,{forCreate=true}={}){
  const type=source.type;
  if(typeof type!=='string'||!DNS_TYPES.includes(type))
    throw new RefusalError('Invalid DNS record type');
  if(forCreate&&!CREATE_TYPES.includes(type))
    throw new RefusalError('This tool creates only '+
      CREATE_TYPES.join(', ')+' records; '+type+' records are read and '+
      'updated by id, not created (catalog scope)');
  const name=safeName(source.name);
  if(name===null)throw new RefusalError('Invalid record name');
  const ttl=safeTtl(source.ttl);
  const comment=safeComment(source.comment);
  let value=null,srv=null,mxPriority=null;
  if(type==='SRV'){
    if(source.value!==undefined)
      throw new RefusalError('SRV records take srv fields, not a value');
    srv=safeSrv(source.srv);
  }else{
    if(typeof source.value!=='string'||!source.value.length||
      source.value.length>4096||/[\x00-\x1f\x7f]/.test(source.value))
      throw new RefusalError('A record value is required');
    value=source.value;
    if(type==='A'&&!/^\d{1,3}(\.\d{1,3}){3}$/.test(value))
      throw new RefusalError('An A record value must be an IPv4 address');
    if(type==='AAAA'&&(!/^[0-9a-fA-F:.]+$/.test(value)||!value.includes(':')))
      throw new RefusalError('An AAAA record value must be an IPv6 address');
    if((type==='CNAME'||type==='NS')&&!safeHostname(value))
      throw new RefusalError('The record value must be a hostname');
  }
  if(type==='MX'){
    if(!Number.isSafeInteger(source.mxPriority)||source.mxPriority<0||
      source.mxPriority>65535)
      throw new RefusalError('MX records need a priority from 0 to 65535');
    mxPriority=source.mxPriority;
  }else if(source.mxPriority!==undefined){
    throw new RefusalError('Only MX records take a priority');
  }
  // Every create branch — TXT included — carries `name` in its
  // documented required list (dossier §4.1); the body always sends it.
  const body={type,name,
    ...(type==='SRV'?{srv}:{value}),
    ...(type==='MX'?{mxPriority}:{}),
    ...(ttl!==null?{ttl}:{}),...(comment!==null?{comment}:{})};
  return {type,name,value,srv,mxPriority,ttl,comment,body};
}
function identityOf(record){
  return record.type+'|'+record.name+'|'+
    (record.type==='SRV'&&record.srv?
      [record.srv.priority,record.srv.weight,record.srv.port,record.srv.target].join(' '):
      record.value);
}
function zoneFingerprint(zone){
  return zone.map(record=>record.id+'='+identityOf(record)+
    '|'+(record.ttl??'')+'|'+(record.mxPriority??'')).sort().join(';');
}
async function createBefore(args,ctx){
  exactArgs(args,['domain','name','type','value','ttl','mxPriority','srv',
    'comment','outsideApp','confirm','dryRun','requestKey']);
  const domain=safeDomain(args.domain);
  if(!domain)throw new RefusalError('Invalid domain');
  assertOutsideApp(args);assertControl(args);assertEveryday(ctx);
  const intent=recordIntent(args);
  validateRequest('dns_record_create',{path:{domain},
    query:{teamId:'team_FAKE_validation'},body:intent.body});
  const {client,account}=await teamContext(ctx);
  const zone=await readZone(client,domain);
  assertNoCnameClash(zone,intent);
  return {domain,teamId:account.team_id,intent,zone,
    conflicts:conflictsFor(zone,intent)};
}
function intentLine(intent){
  return intent.type+' '+(intent.name===''?'@':intent.name)+' → '+
    (intent.type==='SRV'?
      [intent.srv.priority,intent.srv.weight,intent.srv.port,intent.srv.target].join(' '):
      intent.value)+
    (intent.mxPriority!==null?' (priority '+intent.mxPriority+')':'')+
    (intent.ttl!==null?' (TTL '+intent.ttl+')':'');
}
const createWrite=defineWrite({
  name:'vercel_dns_create_record',before:createBefore,
  async preview(_args,_ctx,before){
    return 'Add record '+intentLine(before.intent)+
      ' on '+before.domain+
      (before.conflicts.length?' — CHECK: '+before.conflicts.join('; '):'')+
      '. DNS is production: the record routes live site traffic and mail '+
      'as soon as it propagates.';
  },
  async production(){return {production:true,
    why:'A DNS record routes live site traffic and mail (B2)'};},
  async targets(_args,before){return [{kind:'account',id:before.teamId}];},
  async apply(args,ctx,before,requestKey){
    const provider=await writeProvider(ctx);
    await requirePreDispatch(async()=>{
      if(provider.account.team_id!==before.teamId||
        ctx.connection?.mode!=='production')
        throw new TypeError('DNS create requires an authorized production connection');
      const fresh=await createBefore(args,ctx);
      if(JSON.stringify(fresh.intent.body)!==JSON.stringify(before.intent.body)||
        zoneFingerprint(fresh.zone)!==zoneFingerprint(before.zone))
        throw new TypeError('DNS zone changed since confirmation');
    });
    return provider.write('dns_record_create',
      {path:{domain:before.domain},body:before.intent.body},
      {requestKey,tool:'vercel_dns_create_record',shapeResult:value=>{
        if(!value||typeof value!=='object'||Array.isArray(value))
          throw new TypeError('Vercel did not return the created record id');
        if(value.uid!==undefined&&typeof value.uid!=='string')
          throw new TypeError('Vercel did not return the created record id');
        return {recordId:value.uid??null};
      }});
  },
  async verify(_args,ctx,before,_providerResult){
    try{
      const {client,account}=await teamContext(ctx);
      if(account.team_id!==before.teamId)return {confirmed:null};
      const zone=await readZone(client,before.domain);
      const match=zone.find(record=>identityOf(record)===identityOf(before.intent)&&
        (before.intent.type!=='MX'||record.mxPriority===before.intent.mxPriority));
      return match?{confirmed:true,record:match}:
        {confirmed:false,reason:'The created record is not in the zone yet'};
    }catch{return {confirmed:null};}
  },
  async inverse(_args,before,providerResult){
    // Inverse payloads name the record value `recordValue`: the output
    // shaper hides any field literally named `value` in stored copies,
    // and Batch X must be able to re-create from the journal intact.
    return {undo:'Delete the created record',domain:before.domain,
      recordId:providerResult?.recordId??null,
      record:{type:before.intent.type,name:before.intent.name,
        recordValue:before.intent.value,srv:before.intent.srv,
        mxPriority:before.intent.mxPriority}};
  }
});
async function updateBefore(args,ctx){
  exactArgs(args,['domain','recordId','name','value','ttl','mxPriority','srv',
    'comment','outsideApp','confirm','dryRun','requestKey']);
  const domain=safeDomain(args.domain);
  if(!domain)throw new RefusalError('Invalid domain');
  if(typeof args.recordId!=='string'||!RECORD_ID.test(args.recordId))
    throw new RefusalError('Invalid record id');
  assertOutsideApp(args);assertControl(args);assertEveryday(ctx);
  const changes=['name','value','ttl','mxPriority','srv','comment']
    .filter(field=>args[field]!==undefined);
  if(!changes.length)throw new RefusalError('Nothing to change');
  const {client,account}=await teamContext(ctx);
  const zone=await readZone(client,domain);
  const current=zone.find(record=>record.id===args.recordId);
  if(!current)throw new RefusalError('Record is not in this domain zone');
  const body={};
  if(args.name!==undefined){
    const name=safeName(args.name);
    if(name===null)throw new RefusalError('Invalid record name');
    body.name=name;
  }
  if(args.value!==undefined){
    if(current.type==='SRV')
      throw new RefusalError('SRV records change through srv fields, not a value');
    if(typeof args.value!=='string'||!args.value.length||
      args.value.length>4096||/[\x00-\x1f\x7f]/.test(args.value))
      throw new RefusalError('Invalid record value');
    body.value=args.value;
  }
  if(args.ttl!==undefined)body.ttl=safeTtl(args.ttl);
  if(args.mxPriority!==undefined){
    if(current.type!=='MX')
      throw new RefusalError('Only MX records take a priority');
    if(!Number.isSafeInteger(args.mxPriority)||args.mxPriority<0||
      args.mxPriority>65535)
      throw new RefusalError('MX priority must be from 0 to 65535');
    body.mxPriority=args.mxPriority;
  }
  if(args.srv!==undefined){
    if(current.type!=='SRV')
      throw new RefusalError('Only SRV records take srv fields');
    body.srv=safeSrv(args.srv);
  }
  if(args.comment!==undefined)body.comment=safeComment(args.comment);
  validateRequest('dns_record_update',{path:{recordId:args.recordId},
    query:{teamId:'team_FAKE_validation'},body});
  assertNoCnameClash(zone,{name:body.name??current.name,type:current.type},
    current.id);
  return {domain,teamId:account.team_id,recordId:args.recordId,
    current,body,zone};
}
const updateWrite=defineWrite({
  name:'vercel_dns_update_record',before:updateBefore,
  async preview(_args,_ctx,before){
    const parts=Object.entries(before.body).map(([field,want])=>{
      const shown=field==='srv'?
        [want.priority,want.weight,want.port,want.target].join(' '):want;
      return field+' → '+shown;
    });
    return 'Change record '+recordLine(before.current)+' on '+before.domain+
      ': '+parts.join('; ')+
      '. DNS is production: the change routes live site traffic and mail.';
  },
  async production(){return {production:true,
    why:'A DNS record routes live site traffic and mail (B2)'};},
  async targets(_args,before){return [{kind:'account',id:before.teamId}];},
  async apply(args,ctx,before,requestKey){
    const provider=await writeProvider(ctx);
    await requirePreDispatch(async()=>{
      if(provider.account.team_id!==before.teamId||
        ctx.connection?.mode!=='production')
        throw new TypeError('DNS update requires an authorized production connection');
      const fresh=await updateBefore(args,ctx);
      if(JSON.stringify(fresh.body)!==JSON.stringify(before.body)||
        JSON.stringify(fresh.current)!==JSON.stringify(before.current))
        throw new TypeError('DNS record changed since confirmation');
    });
    return provider.write('dns_record_update',
      {path:{recordId:before.recordId},body:before.body},
      {requestKey,tool:'vercel_dns_update_record',shapeResult:value=>{
        return {record:recordSummary(value)};
      }});
  },
  async verify(_args,ctx,before){
    try{
      const {client,account}=await teamContext(ctx);
      if(account.team_id!==before.teamId)return {confirmed:null};
      const row=await client.request('dns_record_get',
        {path:{recordId:before.recordId}});
      const record=recordSummary(row);
      // The documented read shape composes an SRV record's value; the
      // srv fields themselves cannot be read back field-by-field, so
      // an srv change verifies as unknown rather than claimed.
      if(before.body.srv!==undefined)
        return {confirmed:null,record,
          reason:'SRV fields cannot be read back individually in the documented shape'};
      const matches=Object.entries(before.body)
        .every(([field,want])=>record[field]===want);
      return {confirmed:matches&&record.id===before.recordId,record};
    }catch{return {confirmed:null};}
  },
  async inverse(_args,before){
    return {undo:'Restore the previous record values',
      domain:before.domain,recordId:before.recordId,
      restore:{name:before.current.name,recordValue:before.current.value,
        ttl:before.current.ttl,mxPriority:before.current.mxPriority,
        comment:before.current.comment}};
  }
});
async function deleteBefore(args,ctx){
  exactArgs(args,['domain','recordId','outsideApp','confirm','dryRun','requestKey']);
  const domain=safeDomain(args.domain);
  if(!domain)throw new RefusalError('Invalid domain');
  if(typeof args.recordId!=='string'||!RECORD_ID.test(args.recordId))
    throw new RefusalError('Invalid record id');
  assertOutsideApp(args);assertControl(args);assertFull(ctx);
  const {client,account}=await teamContext(ctx);
  const zone=await readZone(client,domain);
  const current=zone.find(record=>record.id===args.recordId);
  if(!current)throw new RefusalError('Record is not in this domain zone');
  return {domain,teamId:account.team_id,recordId:args.recordId,current,zone};
}
const deleteWrite=defineWrite({
  name:'vercel_dns_delete_record',before:deleteBefore,
  async preview(_args,_ctx,before){
    return 'Delete record '+recordLine(before.current)+' from '+before.domain+
      (before.current.type==='MX'?
        ' — removing an MX record can stop mail delivery for this domain':'')+
      (before.current.type==='NS'?
        ' — removing an NS record delegates part of the zone away':'')+
      '. DNS is production: the removal affects live site traffic and mail.';
  },
  async production(){return {production:true,
    why:'Deleting a DNS record removes live site or mail routing (B2)'};},
  async targets(_args,before){return [{kind:'account',id:before.teamId}];},
  async apply(args,ctx,before,requestKey){
    const provider=await writeProvider(ctx);
    await requirePreDispatch(async()=>{
      if(provider.account.team_id!==before.teamId||
        ctx.connection?.mode!=='production')
        throw new TypeError('DNS delete requires an authorized production connection');
      const fresh=await deleteBefore(args,ctx);
      if(JSON.stringify(fresh.current)!==JSON.stringify(before.current))
        throw new TypeError('DNS record changed since confirmation');
    });
    return provider.write('dns_record_delete',
      {path:{domain:before.domain,recordId:before.recordId}},
      {requestKey,tool:'vercel_dns_delete_record',shapeResult:value=>{
        if(!value||typeof value!=='object'||Array.isArray(value))
          throw new TypeError('Vercel did not confirm the deletion');
        return {deleted:true};
      }});
  },
  async verify(_args,ctx,before){
    try{
      const {client,account}=await teamContext(ctx);
      if(account.team_id!==before.teamId)return {confirmed:null};
      const zone=await readZone(client,before.domain);
      return {confirmed:!zone.some(record=>record.id===before.recordId)};
    }catch{return {confirmed:null};}
  },
  async inverse(_args,before){
    // The exact re-create image (design test: a deleted MX record is
    // restored from this inverse byte-for-byte on the create contract).
    return {undo:'Re-create the deleted record',domain:before.domain,
      record:{type:before.current.type,name:before.current.name,
        recordValue:before.current.value,
        ...(before.current.mxPriority!==null?
          {mxPriority:before.current.mxPriority}:{}),
        ...(before.current.ttl!==null?{ttl:before.current.ttl}:{}),
        ...(before.current.comment!==null?
          {comment:before.current.comment}:{})}};
  }
});

/* ----------------------------- replace zone ---------------------------- */
// Dossier §4.2: the documented PUT for whole-zone replacement carries
// no request-body contract in the snapshot or the live reference, so
// this tool replaces the set by composing the documented create,
// update and delete operations. The preview lists every add, change
// and removal (design N2); verify re-reads the whole zone and reports
// the actual end state.
function diffZone(zone,desired){
  const existingByIdentity=new Map();
  for(const record of zone){
    const key=identityOf(record);
    if(existingByIdentity.has(key))
      throw new RefusalError('The current zone holds duplicate records '+
        'this tool cannot tell apart; tidy it with the record tools first');
    existingByIdentity.set(key,record);
  }
  const seen=new Set();
  const adds=[],changes=[],removals=[],keeps=[];
  for(const intent of desired){
    const key=identityOf(intent);
    if(seen.has(key))
      throw new RefusalError('The requested set lists the same record twice');
    seen.add(key);
    const current=existingByIdentity.get(key);
    if(!current){adds.push(intent);continue;}
    existingByIdentity.delete(key);
    const patch={};
    if(intent.ttl!==null&&intent.ttl!==current.ttl)patch.ttl=intent.ttl;
    if(intent.type==='MX'&&intent.mxPriority!==current.mxPriority)
      patch.mxPriority=intent.mxPriority;
    if(intent.comment!==null&&intent.comment!==current.comment)
      patch.comment=intent.comment;
    if(Object.keys(patch).length)changes.push({current,patch,intent});
    else keeps.push(current);
  }
  for(const record of existingByIdentity.values())removals.push(record);
  return {adds,changes,removals,keeps};
}
async function replaceBefore(args,ctx){
  exactArgs(args,['domain','records','outsideApp','confirm','dryRun','requestKey']);
  const domain=safeDomain(args.domain);
  if(!domain)throw new RefusalError('Invalid domain');
  assertOutsideApp(args);assertControl(args);assertFull(ctx);
  if(!Array.isArray(args.records)||!args.records.length||args.records.length>500)
    throw new RefusalError('records must be a list of 1 to 500 record intents');
  const desired=args.records.map(item=>{
    if(!item||typeof item!=='object'||Array.isArray(item)||
      Object.keys(item).some(key=>!['name','type','value','ttl','mxPriority','srv','comment'].includes(key)))
      throw new RefusalError('Invalid record intent in the replacement set');
    return recordIntent(item);
  });
  for(const intent of desired)
    validateRequest('dns_record_create',{path:{domain},
      query:{teamId:'team_FAKE_validation'},body:intent.body});
  // The resulting zone must itself be CNAME-clean.
  for(const intent of desired){
    const clash=desired.find(other=>other!==intent&&other.name===intent.name&&
      (intent.type==='CNAME'||other.type==='CNAME'));
    if(clash)
      throw new RefusalError('The requested set puts a CNAME beside other '+
        'records at the same name, which DNS forbids');
  }
  const {client,account}=await teamContext(ctx);
  const zone=await readZone(client,domain);
  const diff=diffZone(zone,desired);
  return {domain,teamId:account.team_id,zone,desired,diff};
}
const replaceWrite=defineWrite({
  name:'vercel_dns_replace_zone',before:replaceBefore,
  async preview(_args,_ctx,before){
    const {adds,changes,removals,keeps}=before.diff;
    const lines=['Replace the DNS zone of '+before.domain+' ('+before.zone.length+
      ' records now, '+before.desired.length+' requested):'];
    for(const record of removals)lines.push('REMOVE '+recordLine(record));
    for(const change of changes)
      lines.push('CHANGE '+recordLine(change.current)+' → '+
        Object.entries(change.patch).map(([k,v])=>k+' '+v).join(', '));
    for(const intent of adds)
      lines.push('ADD '+intentLine(intent));
    lines.push(keeps.length+' record(s) unchanged. Removals apply first so '+
      'a name can change type without a clash; the replacement applies '+
      'record by record over the documented operations, and the result '+
      'reports the zone as it actually stands afterwards. DNS is '+
      'production: this rewrites live site and mail routing.');
    return lines.join('\n');
  },
  async production(){return {production:true,
    why:'Replacing a DNS zone rewrites live site and mail routing (B2)'};},
  async targets(_args,before){return [{kind:'account',id:before.teamId}];},
  async apply(args,ctx,before,requestKey){
    const provider=await writeProvider(ctx);
    await requirePreDispatch(async()=>{
      if(provider.account.team_id!==before.teamId||
        ctx.connection?.mode!=='production')
        throw new TypeError('DNS zone replacement requires an authorized production connection');
      const fresh=await replaceBefore(args,ctx);
      if(zoneFingerprint(fresh.zone)!==zoneFingerprint(before.zone)||
        JSON.stringify(fresh.desired.map(d=>d.body))!==
          JSON.stringify(before.desired.map(d=>d.body)))
        throw new TypeError('DNS zone changed since confirmation');
    });
    const applied={removed:0,changed:0,added:0};
    for(const record of before.diff.removals){
      await provider.write('dns_record_delete',
        {path:{domain:before.domain,recordId:record.id}},
        {requestKey,tool:'vercel_dns_replace_zone',mutationId:'remove-'+record.id,
          shapeResult:value=>{
            if(!value||typeof value!=='object'||Array.isArray(value))
              throw new TypeError('Vercel did not confirm a zone removal');
            return {deleted:true};
          }});
      applied.removed++;
    }
    for(const change of before.diff.changes){
      validateRequest('dns_record_update',{path:{recordId:change.current.id},
        query:{teamId:'team_FAKE_validation'},body:change.patch});
      await provider.write('dns_record_update',
        {path:{recordId:change.current.id},body:change.patch},
        {requestKey,tool:'vercel_dns_replace_zone',mutationId:'change-'+change.current.id,
          shapeResult:value=>({record:recordSummary(value)})});
      applied.changed++;
    }
    let addIndex=0;
    for(const intent of before.diff.adds){
      addIndex++;
      await provider.write('dns_record_create',
        {path:{domain:before.domain},body:intent.body},
        {requestKey,tool:'vercel_dns_replace_zone',
          mutationId:'add-'+addIndex,
          shapeResult:value=>{
            if(!value||typeof value!=='object'||Array.isArray(value))
              throw new TypeError('Vercel did not return a created record id');
            return {recordId:value.uid??null};
          }});
      applied.added++;
    }
    return applied;
  },
  async verify(_args,ctx,before){
    try{
      const {client,account}=await teamContext(ctx);
      if(account.team_id!==before.teamId)return {confirmed:null};
      const zone=await readZone(client,before.domain);
      const remaining=diffZone(zone,before.desired);
      const pending=remaining.adds.length+remaining.changes.length+
        remaining.removals.length;
      return {confirmed:pending===0,
        remaining:{adds:remaining.adds.length,changes:remaining.changes.length,
          removals:remaining.removals.length}};
    }catch{return {confirmed:null};}
  },
  async inverse(_args,before){
    return {undo:'Restore the previous zone',domain:before.domain,
      records:before.zone.map(record=>({type:record.type,name:record.name,
        recordValue:record.value,mxPriority:record.mxPriority,ttl:record.ttl,
        comment:record.comment}))};
  },
  async publicReceipt(_args,before,providerResult){
    return {domain:before.domain,removed:providerResult.removed,
      changed:providerResult.changed,added:providerResult.added};
  }
});

/* --------------------------- certificate writes --------------------------- */
async function issueBefore(args,ctx){
  exactArgs(args,['cns','confirm','dryRun','requestKey']);
  assertControl(args);assertEveryday(ctx);
  if(!Array.isArray(args.cns)||!args.cns.length||args.cns.length>100)
    throw new RefusalError('cns must list 1 to 100 domain names');
  const cns=args.cns.map(value=>{
    const host=safeHostname(value);
    if(!host)throw new RefusalError('Invalid domain name in cns');
    return host;
  });
  if(new Set(cns).size!==cns.length)
    throw new RefusalError('cns lists a domain twice');
  validateRequest('cert_issue',{query:{teamId:'team_FAKE_validation'},body:{cns}});
  const {client,account}=await teamContext(ctx);
  const reply=await client.request('certs_list',{});
  const existing=Array.isArray(reply?.certs)?reply.certs.map(certSummary):[];
  const covering=existing.filter(cert=>
    cns.every(name=>cert.cns.includes(name)));
  return {cns,teamId:account.team_id,covering:covering.map(cert=>cert.id)};
}
const issueWrite=defineWrite({
  name:'vercel_cert_issue',before:issueBefore,
  async preview(_args,_ctx,before){
    return 'Ask Vercel to issue a certificate covering '+
      before.cns.join(', ')+
      (before.covering.length?' (an existing certificate already covers '+
        'these names; Vercel will re-issue or renew it)':
        ' (no current certificate covers all of these names)')+
      '. Certificates are production: they secure the live site.';
  },
  async production(){return {production:true,
    why:'A certificate secures live site traffic'};},
  async targets(_args,before){return [{kind:'account',id:before.teamId}];},
  async apply(args,ctx,before,requestKey){
    const provider=await writeProvider(ctx);
    await requirePreDispatch(async()=>{
      if(provider.account.team_id!==before.teamId||
        ctx.connection?.mode!=='production')
        throw new TypeError('Certificate issue requires an authorized production connection');
      const fresh=await issueBefore(args,ctx);
      if(JSON.stringify(fresh.cns)!==JSON.stringify(before.cns))
        throw new TypeError('Certificate request changed since confirmation');
    });
    return provider.write('cert_issue',{body:{cns:before.cns}},
      {requestKey,tool:'vercel_cert_issue',shapeResult:value=>{
        return {certificate:certSummary(value)};
      }});
  },
  async verify(_args,ctx,before,providerResult){
    try{
      const {client,account}=await teamContext(ctx);
      if(account.team_id!==before.teamId)return {confirmed:null};
      const row=await client.request('cert_get',
        {path:{id:providerResult.certificate.id}});
      const cert=certSummary(row);
      return {confirmed:before.cns.every(name=>cert.cns.includes(name)),
        certificate:cert};
    }catch{return {confirmed:null};}
  }
});
async function removeCertBefore(args,ctx){
  exactArgs(args,['certId','outsideApp','confirm','dryRun','requestKey']);
  if(typeof args.certId!=='string'||!CERT_ID.test(args.certId))
    throw new RefusalError('Invalid certificate id');
  assertOutsideApp(args);assertControl(args);assertFull(ctx);
  const {client,account}=await teamContext(ctx);
  const row=await client.request('cert_get',{path:{id:args.certId}});
  return {certId:args.certId,teamId:account.team_id,cert:certSummary(row)};
}
const removeCertWrite=defineWrite({
  name:'vercel_cert_remove',before:removeCertBefore,
  async preview(_args,_ctx,before){
    return 'Remove certificate '+before.certId+' covering '+
      before.cert.cns.join(', ')+' (expires '+
      new Date(before.cert.expiresAt).toISOString()+'). Sites using it '+
      'lose their certificate unless another covers the same names. '+
      'Certificates are production.';
  },
  async production(){return {production:true,
    why:'Removing a certificate can break live site HTTPS'};},
  async targets(_args,before){return [{kind:'account',id:before.teamId}];},
  async apply(args,ctx,before,requestKey){
    const provider=await writeProvider(ctx);
    await requirePreDispatch(async()=>{
      if(provider.account.team_id!==before.teamId||
        ctx.connection?.mode!=='production')
        throw new TypeError('Certificate removal requires an authorized production connection');
      const fresh=await removeCertBefore(args,ctx);
      if(fresh.cert.id!==before.cert.id||
        JSON.stringify(fresh.cert.cns)!==JSON.stringify(before.cert.cns))
        throw new TypeError('Certificate changed since confirmation');
    });
    return provider.write('cert_remove',{path:{id:before.certId}},
      {requestKey,tool:'vercel_cert_remove',shapeResult:value=>{
        if(!value||typeof value!=='object'||Array.isArray(value))
          throw new TypeError('Vercel did not confirm the certificate removal');
        return {removed:true};
      }});
  },
  async verify(_args,ctx,before){
    try{
      const {client,account}=await teamContext(ctx);
      if(account.team_id!==before.teamId)return {confirmed:null};
      try{
        await client.request('cert_get',{path:{id:before.certId}});
        return {confirmed:false};
      }catch(error){
        return {confirmed:error?.status===404?true:null};
      }
    }catch{return {confirmed:null};}
  },
  async inverse(_args,before){
    return {undo:'Re-issue a certificate for the same names',
      cns:before.cert.cns};
  }
});

/* ------------------------------- registry ------------------------------- */
const writeFlags={
  outsideApp:{type:'boolean'},confirm:{type:'boolean'},
  dryRun:{type:'boolean'},
  requestKey:{type:'string',pattern:REQUEST.source}};
export const dnsTools={
  tools:[
    {name:'vercel_dns_list',writes:false,profiles:READ_PROFILES,area:'dns',
      description:'List a domain\'s DNS records, proven complete across pagination',
      inputSchema:schema({domain:{type:'string'},fields:{type:'array'},detail:{type:'string'}},['domain'])},
    {name:'vercel_dns_get_record',writes:false,profiles:READ_PROFILES,area:'dns',
      description:'Get one DNS record by its id',
      inputSchema:schema({recordId:{type:'string'},fields:{type:'array'},detail:{type:'string'}},['recordId'])},
    {name:'vercel_dns_create_record',writes:true,guardedWrite:true,
      profiles:EVERYDAY,area:'dns',writeContract:createWrite.writeContract,
      description:'Add a DNS record; preview checks CNAME, MX and SPF conflicts',
      inputSchema:schema({domain:{type:'string'},name:{type:'string'},
        type:{type:'string',enum:CREATE_TYPES},value:{type:'string'},
        ttl:{type:'integer'},mxPriority:{type:'integer'},
        srv:{type:'object'},comment:{type:'string'},...writeFlags},
        ['domain','name','type','outsideApp']),
      annotations:{destructiveHint:false}},
    {name:'vercel_dns_update_record',writes:true,guardedWrite:true,
      profiles:EVERYDAY,area:'dns',writeContract:updateWrite.writeContract,
      description:'Change a DNS record, with before/after preview and read-back',
      inputSchema:schema({domain:{type:'string'},recordId:{type:'string'},
        name:{type:'string'},value:{type:'string'},ttl:{type:'integer'},
        mxPriority:{type:'integer'},srv:{type:'object'},
        comment:{type:'string'},...writeFlags},
        ['domain','recordId','outsideApp']),
      annotations:{destructiveHint:false}},
    {name:'vercel_dns_delete_record',writes:true,guardedWrite:true,
      profiles:FULL,area:'dns',writeContract:deleteWrite.writeContract,
      description:'Delete a DNS record; the journal keeps its exact re-create image',
      inputSchema:schema({domain:{type:'string'},recordId:{type:'string'},
        ...writeFlags},['domain','recordId','outsideApp']),
      annotations:{destructiveHint:true}},
    {name:'vercel_dns_replace_zone',writes:true,guardedWrite:true,
      profiles:FULL,area:'dns',writeContract:replaceWrite.writeContract,
      description:'Replace a domain\'s whole DNS record set; preview lists every add, change and removal',
      inputSchema:schema({domain:{type:'string'},
        records:{type:'array',items:{type:'object'},maxItems:500},
        ...writeFlags},['domain','records','outsideApp']),
      annotations:{destructiveHint:true}},
    {name:'vercel_cert_list',writes:false,profiles:READ_PROFILES,area:'certificates',
      description:'List certificates: domains covered, expiry, auto-renewing',
      inputSchema:schema({fields:{type:'array'},detail:{type:'string'}})},
    {name:'vercel_cert_issue',writes:true,guardedWrite:true,
      profiles:EVERYDAY,area:'certificates',writeContract:issueWrite.writeContract,
      description:'Issue a certificate for the named domains',
      inputSchema:schema({cns:{type:'array',items:{type:'string'},maxItems:100},
        confirm:{type:'boolean'},dryRun:{type:'boolean'},
        requestKey:{type:'string',pattern:REQUEST.source}},['cns']),
      annotations:{destructiveHint:false}},
    {name:'vercel_cert_remove',writes:true,guardedWrite:true,
      profiles:FULL,area:'certificates',writeContract:removeCertWrite.writeContract,
      description:'Remove a certificate by id, with absence read-back',
      inputSchema:schema({certId:{type:'string'},...writeFlags},
        ['certId','outsideApp']),
      annotations:{destructiveHint:true}}
  ],
  handlers:{...readHandlers,
    vercel_dns_create_record:bindGuardedWrite(createWrite,context,out),
    vercel_dns_update_record:bindGuardedWrite(updateWrite,context,out),
    vercel_dns_delete_record:bindGuardedWrite(deleteWrite,context,out),
    vercel_dns_replace_zone:bindGuardedWrite(replaceWrite,context,out),
    vercel_cert_issue:bindGuardedWrite(issueWrite,context,out),
    vercel_cert_remove:bindGuardedWrite(removeCertWrite,context,out)}
};
