// E-3: finish the store workflow with one-time owner token delivery and
// version-pinned backup restore. No token or provider snapshot value enters MCP.
import {defineWrite,bindGuardedWrite,requirePreDispatch} from '../core/write.js';
import {encryptSecret} from '../core/secret-box.js';
import {oneTimeSecrets} from '../core/one-time-secrets.js';
import {credentialLike} from '../core/util.js';
import {writeProvider} from '../vercel/provider.js';
import {STORE,SLUG,KEY,safeLabel,exact,strictArgs,schema} from './globalconfig-common.js';
import {store,allItems,targets,classification,context} from './globalconfig-mutate.js';

const ID=/^[A-Za-z0-9_-]{3,128}$/;
const VERSION=/^[A-Za-z0-9_.-]{3,128}$/;
const REV={type:'integer',minimum:1};
const PROPS={
  id:{type:'string',pattern:STORE.source},
  expectedSlug:{type:'string',pattern:SLUG.source},
  expectedUpdatedAt:REV,
  label:{type:'string',minLength:1,maxLength:52},
  versionId:{type:'string',pattern:VERSION.source},
  beforeTime:{type:'string',pattern:'^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z
  outsideApp:{type:'boolean',const:true},
  confirm:{type:'boolean'},dryRun:{type:'boolean'},
  requestKey:{type:'string',pattern:'^[A-Za-z0-9_-]{8,128}$'}
};
const controls=['id','expectedSlug','expectedUpdatedAt','outsideApp','confirm','dryRun','requestKey'];
const tokenFields=[...controls,'label'];
const restoreFields=[...controls,'versionId','beforeTime'];
function controlsValid(a,keys){
  strictArgs(a,keys);
  if(!STORE.test(a.id??'')||!SLUG.test(a.expectedSlug??'')||
    !Number.isSafeInteger(a.expectedUpdatedAt)||a.expectedUpdatedAt<1||
    a.outsideApp!==true||
    a.confirm!==undefined&&typeof a.confirm!=='boolean'||
    a.dryRun!==undefined&&typeof a.dryRun!=='boolean'||
    a.requestKey!==undefined&&!/^[A-Za-z0-9_-]{8,128}$/.test(a.requestKey))
    throw new TypeError('Exact current store revision and outside-app intent required');
}
function secretReady(ctx){
  if(typeof ctx.db?.insertOneTimeSecret!=='function'||
    typeof ctx.db?.consumeOneTimeSecret!=='function')
    throw new TypeError('Encrypted one-time owner delivery is unavailable');
  // Fail before provider POST if the owner vault encryption key is missing.
  encryptSecret('probe','globalconfig:preflight',ctx.env);
}
function rawTokens(page){
  const rows=Array.isArray(page)?page:page?.tokens??page?.data;
  if(!Array.isArray(rows)||rows.length>100||page?.pagination?.next)
    throw new TypeError('Cannot safely inspect store token metadata');
  return rows.map(r=>{
    if(!r||typeof r!=='object'||!ID.test(r.id??'')||
      safeLabel(r.label,52)===null)
      throw new TypeError('Unverified read token identity');
    // Vercel GET can include bearer values: retain ONLY safe identity/label.
    return {id:r.id,label:r.label};
  });
}
async function tokenState(a,ctx){
  controlsValid(a,tokenFields);
  if(safeLabel(a.label,52)===null||credentialLike(a.label)||
    ctx.connection?.profile!=='full')
    throw new TypeError('Full profile and a safe token label are required');
  secretReady(ctx);
  const {client,account,row}=await store(ctx,a);
  const rows=rawTokens(await client.request('global_config_tokens',
    {path:{edgeConfigId:row.id}}));
  if(rows.some(t=>t.label===a.label)||
    new Set(rows.map(t=>t.id)).size!==rows.length)
    throw new TypeError('Duplicate read token label or provider token ID');
  return {id:row.id,slug:row.slug,teamId:account.team_id,
    label:a.label,updatedAt:row.updatedAt,projects:[...row.projects].sort(),
    itemCount:row.itemCount,tokenIds:rows.map(t=>t.id).sort()};
}
function tokenUnchanged(before,now){
  return before.teamId===now.teamId&&before.id===now.id&&
    before.slug===now.slug&&before.updatedAt===now.updatedAt&&
    before.label===now.label&&before.itemCount===now.itemCount&&
    JSON.stringify(before.projects)===JSON.stringify(now.projects)&&
    JSON.stringify(before.tokenIds)===JSON.stringify(now.tokenIds);
}
function receivedToken(raw,label){
  const id=raw?.id??raw?.tokenId??raw?.token?.id;
  const value=typeof raw?.token==='string'?raw.token:
    raw?.token?.value??raw?.value;
  if(!ID.test(id??'')||raw.label!==undefined&&raw.label!==label||
    typeof value!=='string'||value.length<20||value.length>4096||
    !credentialLike(value))
    throw new TypeError('Provider token response cannot be delivered securely');
  return {id,value};
}
const createToken=defineWrite({
  name:'vercel_globalconfig_create_token',oneTimeDelivery:true,secretOut:true,
  risk:{access:true},
  before:tokenState,
  async preview(_a,_ctx,b){
    return 'Create one read-only token '+b.label+' for Global Config '+b.slug+
      ' ('+b.id+'), connected to '+b.projects.length+
      ' projects; token never enters chat and is revealed ONCE on owner setup';
  },
  production:classification,
  async targets(_a,b){return targets(b);},
  async access(_a,b){return {widens:true,who:'Holder of newly issued bearer',
    what:'Read Global Config '+b.id+' from linked and future consumers'};},
  async apply(a,ctx,b,requestKey){
    const provider=await writeProvider(ctx);
    await requirePreDispatch(async()=>{
      if(provider.account.team_id!==b.teamId)throw new TypeError('Selected team changed');
      secretReady(ctx);
      const state=await tokenState(a,ctx);
      if(!tokenUnchanged(b,state))
        throw new TypeError('Store or existing token set changed before creation');
    });
    return provider.write('global_config_create_token',
      {path:{edgeConfigId:b.id},body:{label:b.label}},
      {requestKey,tool:'vercel_globalconfig_create_token',
        shapeResult:async raw=>{
          const issued=receivedToken(raw,b.label);
          const once=await oneTimeSecrets({db:ctx.db,env:ctx.env}).issue({
            account:ctx.connection.account,kind:'global_config_read_token',
            label:'Global Config '+b.id+' token '+b.label,
            value:issued.value,ttlMs:600000
          });
          return {id:issued.id,ownerRevealRef:once.id,
            expiresAt:once.expiresAt};
        }});
  },
  async verify(_a,ctx,b,result){
    if(!ID.test(result?.id??''))return {confirmed:null};
    try{
      const {client,account,row}=await exact(ctx,b.id);
      if(account.team_id!==b.teamId||row.slug!==b.slug||
        JSON.stringify([...row.projects].sort())!==JSON.stringify(b.projects))
        return {confirmed:null};
      const rows=rawTokens(await client.request('global_config_tokens',
        {path:{edgeConfigId:b.id}}));
      return {confirmed:rows.some(x=>x.id===result.id&&x.label===b.label)};
    }catch{return {confirmed:null};}
  }
});
function backupVersion(raw,id,storeId){
  const version=raw?.id??raw?.versionId??raw?.version;
  if(version!==id||raw?.edgeConfigId!=null&&raw.edgeConfigId!==storeId)
    throw new TypeError('Wrong Global Config backup version or store');
  const items=allItems(raw?.data?.items?raw.data:raw);
  if(Object.keys(items).length>100)
    throw new TypeError('Backup is too large for an independently proven preview');
  for(const [key,value] of Object.entries(items)){
    if(!KEY.test(key)||credentialLike(key)||
      value===undefined||JSON.stringify(value)===undefined||
      Buffer.byteLength(JSON.stringify(value))>8192)
      throw new TypeError('Backup item is unsafe to restore');
  }
  return items;
}
// An optional timestamp selector is never converted into "latest" by guessing.
// The authoritative API must supply a complete, bounded backup inventory.
function timestamp(value){
  if(typeof value==='number'&&Number.isSafeInteger(value)&&value>=1e11&&
    value<=4102444800000)return value;
  if(typeof value!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value))
    throw new TypeError('Backup timestamp must be an exact UTC instant');
  const millis=Date.parse(value);
  if(!Number.isSafeInteger(millis)||new Date(millis).toISOString()!==value||
    millis<1e11||millis>4102444800000)
    throw new TypeError('Backup timestamp unverified');
  return millis;
}
async function newestBefore(client,id,instant){
  const raw=await client.request('global_config_backups',{
    path:{edgeConfigId:id},query:{limit:50}});
  const rows=Array.isArray(raw)?raw:raw?.backups??raw?.data;
  if(!Array.isArray(rows)||rows.length>50||
    !raw?.pagination||raw.pagination.next!==null)
    throw new TypeError('Backup inventory is incomplete; select an exact version');
  const seen=new Set(),parsed=rows.map(row=>{
    const version=row?.id??row?.versionId??row?.version;
    if(!VERSION.test(version??'')||seen.has(version))
      throw new TypeError('Unverified or duplicated backup identity');
    seen.add(version);
    if(row.edgeConfigId!=null&&row.edgeConfigId!==id)
      throw new TypeError('Backup belongs to a different store');
    return {version,at:timestamp(row.createdAt)};
  });
  const eligible=parsed.filter(x=>x.at<instant).sort((a,b)=>b.at-a.at);
  if(!eligible.length)throw new TypeError('No backup existed before requested UTC instant');
  if(eligible.length>1&&eligible[0].at===eligible[1].at)
    throw new TypeError('Newest backup timestamp is ambiguous');
  return eligible[0].version;
}
async function chosenBackup(a,client,storeId){
  const hasVersion=a.versionId!==undefined,hasTime=a.beforeTime!==undefined;
  if(hasVersion===hasTime)
    throw new TypeError('Choose exactly one backup version ID or UTC beforeTime');
  if(hasVersion){
    if(!VERSION.test(a.versionId??''))throw new TypeError('Invalid exact backup ID');
    return a.versionId;
  }
  const until=timestamp(a.beforeTime);
  if(until>Date.now())
    throw new TypeError('Cannot select a future backup cutoff');
  return newestBefore(client,storeId,until);
}

function describeDiff(from,to){
  const before=Object.keys(from),after=Object.keys(to);
  return {
    create:after.filter(k=>!Object.hasOwn(from,k)).sort(),
    remove:before.filter(k=>!Object.hasOwn(to,k)).sort(),
    update:after.filter(k=>Object.hasOwn(from,k)&&
      JSON.stringify(from[k])!==JSON.stringify(to[k])).sort()
  };
}
async function restoreState(a,ctx){
  controlsValid(a,restoreFields);

  const {client,account,row}=await store(ctx,a);
  const versionId=await chosenBackup(a,client,row.id);
  const path={edgeConfigId:row.id,edgeConfigBackupVersionId:versionId};
  const [now,backup]=await Promise.all([
    client.request('global_config_items',{path:{edgeConfigId:row.id}}),
    client.request('global_config_backup_get',{path})
  ]);
  const current=allItems(now),saved=backupVersion(backup,versionId,row.id);
  if(Object.keys(current).length!==row.itemCount)
    throw new TypeError('Store item inventory did not match declared item count');
  const diff=describeDiff(current,saved);
  if(!Object.values(diff).some(x=>x.length))
    throw new TypeError('Backup is already identical; no restore needed');
  return {id:row.id,slug:row.slug,teamId:account.team_id,
    updatedAt:row.updatedAt,itemCount:row.itemCount,
    projects:[...row.projects].sort(),versionId,
    backupItemCount:Object.keys(saved).length,diff};
}
function restoreUnchanged(b,after){
  return b.id===after.id&&b.slug===after.slug&&
    b.teamId===after.teamId&&b.updatedAt===after.updatedAt&&
    b.versionId===after.versionId&&b.itemCount===after.itemCount&&
    b.backupItemCount===after.backupItemCount&&
    JSON.stringify(b.projects)===JSON.stringify(after.projects)&&
    JSON.stringify(b.diff)===JSON.stringify(after.diff);
}
const restore=defineWrite({
  name:'vercel_globalconfig_restore_backup',
  before:restoreState,
  async preview(a,_ctx,b){
    const d=b.diff;
    return 'Restore resolved Global Config backup '+b.versionId+
      (a.beforeTime?' (newest before '+a.beforeTime+')':'')+' to '+b.slug+
      ' ('+b.id+') with '+b.backupItemCount+' items. Create ['+
      d.create.join(', ')+']; update ['+d.update.join(', ')+
      ']; remove ['+d.remove.join(', ')+']. Item values hidden. Linked projects: '+
      b.projects.join(', ')+'; changes can affect live consumers immediately';
  },
  production:classification,
  async targets(_a,b){return targets(b);},
  async apply(a,ctx,b,requestKey){
    const provider=await writeProvider(ctx);
    await requirePreDispatch(async()=>{
      if(provider.account.team_id!==b.teamId)
        throw new TypeError('Selected account changed');
      const fresh=await restoreState(a,ctx);
      if(!restoreUnchanged(b,fresh))
        throw new TypeError('Restore version, store or diff changed after preview');
    });
    return provider.write('global_config_restore_backup',
      {path:{edgeConfigId:b.id,edgeConfigBackupVersionId:b.versionId}},
      {requestKey,tool:'vercel_globalconfig_restore_backup',
        shapeResult:()=>({id:b.id,versionId:b.versionId})});
  },
  async verify(_a,ctx,b){
    try{
      const {client,account,row}=await exact(ctx,b.id);
      if(account.team_id!==b.teamId||row.slug!==b.slug||
        row.updatedAt<=b.updatedAt||
        JSON.stringify([...row.projects].sort())!==JSON.stringify(b.projects))
        return {confirmed:null};
      const path={edgeConfigId:b.id,edgeConfigBackupVersionId:b.versionId};
      const [current,backup]=await Promise.all([
        client.request('global_config_items',{path:{edgeConfigId:b.id}}),
        client.request('global_config_backup_get',{path})
      ]);
      const a=allItems(current),v=backupVersion(backup,b.versionId,b.id);
      return {confirmed:Object.keys(a).length===Object.keys(v).length&&
        Object.keys(a).every(k=>Object.hasOwn(v,k)&&
          JSON.stringify(a[k])===JSON.stringify(v[k]))};
    }catch{return {confirmed:null};}
  }
});
const out=r=>({isError:['refused_by_guard','outcome_unknown'].includes(r.status),
  content:[{type:'text',text:JSON.stringify(r)}]});
export const globalConfigRemainingTools={
  tools:[
    {name:'vercel_globalconfig_create_token',writes:true,guardedWrite:true,
      profiles:['full'],area:'env',
      description:'Issue one guarded read token; only an encrypted, one-time owner setup reference appears in chat.',
      inputSchema:schema(Object.fromEntries(tokenFields.map(k=>[k,PROPS[k]])),
        ['id','expectedSlug','expectedUpdatedAt','label','outsideApp']),
      writeContract:createToken.writeContract,
      annotations:{readOnlyHint:false,destructiveHint:false}},
    {name:'vercel_globalconfig_restore_backup',writes:true,guardedWrite:true,
      profiles:['everyday','full'],area:'env',
      description:'Version-pinned Global Config restore after exact item-key diff and live-project classification.',
      inputSchema:schema(Object.fromEntries(restoreFields.map(k=>[k,PROPS[k]])),
        ['id','expectedSlug','expectedUpdatedAt','versionId','outsideApp']),
      writeContract:restore.writeContract,
      annotations:{readOnlyHint:false,destructiveHint:true}}
  ],
  handlers:{
    vercel_globalconfig_create_token:bindGuardedWrite(createToken,context,out),
    vercel_globalconfig_restore_backup:bindGuardedWrite(restore,context,out)
  }
};
},
  outsideApp:{type:'boolean',const:true},
  confirm:{type:'boolean'},dryRun:{type:'boolean'},
  requestKey:{type:'string',pattern:'^[A-Za-z0-9_-]{8,128}$'}
};
const controls=['id','expectedSlug','expectedUpdatedAt','outsideApp','confirm','dryRun','requestKey'];
const tokenFields=[...controls,'label'];
const restoreFields=[...controls,'versionId','beforeTime'];
function controlsValid(a,keys){
  strictArgs(a,keys);
  if(!STORE.test(a.id??'')||!SLUG.test(a.expectedSlug??'')||
    !Number.isSafeInteger(a.expectedUpdatedAt)||a.expectedUpdatedAt<1||
    a.outsideApp!==true||
    a.confirm!==undefined&&typeof a.confirm!=='boolean'||
    a.dryRun!==undefined&&typeof a.dryRun!=='boolean'||
    a.requestKey!==undefined&&!/^[A-Za-z0-9_-]{8,128}$/.test(a.requestKey))
    throw new TypeError('Exact current store revision and outside-app intent required');
}
function secretReady(ctx){
  if(typeof ctx.db?.insertOneTimeSecret!=='function'||
    typeof ctx.db?.consumeOneTimeSecret!=='function')
    throw new TypeError('Encrypted one-time owner delivery is unavailable');
  // Fail before provider POST if the owner vault encryption key is missing.
  encryptSecret('probe','globalconfig:preflight',ctx.env);
}
function rawTokens(page){
  const rows=Array.isArray(page)?page:page?.tokens??page?.data;
  if(!Array.isArray(rows)||rows.length>100||page?.pagination?.next)
    throw new TypeError('Cannot safely inspect store token metadata');
  return rows.map(r=>{
    if(!r||typeof r!=='object'||!ID.test(r.id??'')||
      safeLabel(r.label,52)===null)
      throw new TypeError('Unverified read token identity');
    // Vercel GET can include bearer values: retain ONLY safe identity/label.
    return {id:r.id,label:r.label};
  });
}
async function tokenState(a,ctx){
  controlsValid(a,tokenFields);
  if(safeLabel(a.label,52)===null||credentialLike(a.label)||
    ctx.connection?.profile!=='full')
    throw new TypeError('Full profile and a safe token label are required');
  secretReady(ctx);
  const {client,account,row}=await store(ctx,a);
  const rows=rawTokens(await client.request('global_config_tokens',
    {path:{edgeConfigId:row.id}}));
  if(rows.some(t=>t.label===a.label)||
    new Set(rows.map(t=>t.id)).size!==rows.length)
    throw new TypeError('Duplicate read token label or provider token ID');
  return {id:row.id,slug:row.slug,teamId:account.team_id,
    label:a.label,updatedAt:row.updatedAt,projects:[...row.projects].sort(),
    itemCount:row.itemCount,tokenIds:rows.map(t=>t.id).sort()};
}
function tokenUnchanged(before,now){
  return before.teamId===now.teamId&&before.id===now.id&&
    before.slug===now.slug&&before.updatedAt===now.updatedAt&&
    before.label===now.label&&before.itemCount===now.itemCount&&
    JSON.stringify(before.projects)===JSON.stringify(now.projects)&&
    JSON.stringify(before.tokenIds)===JSON.stringify(now.tokenIds);
}
function receivedToken(raw,label){
  const id=raw?.id??raw?.tokenId??raw?.token?.id;
  const value=typeof raw?.token==='string'?raw.token:
    raw?.token?.value??raw?.value;
  if(!ID.test(id??'')||raw.label!==undefined&&raw.label!==label||
    typeof value!=='string'||value.length<20||value.length>4096||
    !credentialLike(value))
    throw new TypeError('Provider token response cannot be delivered securely');
  return {id,value};
}
const createToken=defineWrite({
  name:'vercel_globalconfig_create_token',oneTimeDelivery:true,secretOut:true,
  risk:{access:true},
  before:tokenState,
  async preview(_a,_ctx,b){
    return 'Create one read-only token '+b.label+' for Global Config '+b.slug+
      ' ('+b.id+'), connected to '+b.projects.length+
      ' projects; token never enters chat and is revealed ONCE on owner setup';
  },
  production:classification,
  async targets(_a,b){return targets(b);},
  async access(_a,b){return {widens:true,who:'Holder of newly issued bearer',
    what:'Read Global Config '+b.id+' from linked and future consumers'};},
  async apply(a,ctx,b,requestKey){
    const provider=await writeProvider(ctx);
    await requirePreDispatch(async()=>{
      if(provider.account.team_id!==b.teamId)throw new TypeError('Selected team changed');
      secretReady(ctx);
      const state=await tokenState(a,ctx);
      if(!tokenUnchanged(b,state))
        throw new TypeError('Store or existing token set changed before creation');
    });
    return provider.write('global_config_create_token',
      {path:{edgeConfigId:b.id},body:{label:b.label}},
      {requestKey,tool:'vercel_globalconfig_create_token',
        shapeResult:async raw=>{
          const issued=receivedToken(raw,b.label);
          const once=await oneTimeSecrets({db:ctx.db,env:ctx.env}).issue({
            account:ctx.connection.account,kind:'global_config_read_token',
            label:'Global Config '+b.id+' token '+b.label,
            value:issued.value,ttlMs:600000
          });
          return {id:issued.id,ownerRevealRef:once.id,
            expiresAt:once.expiresAt};
        }});
  },
  async verify(_a,ctx,b,result){
    if(!ID.test(result?.id??''))return {confirmed:null};
    try{
      const {client,account,row}=await exact(ctx,b.id);
      if(account.team_id!==b.teamId||row.slug!==b.slug||
        JSON.stringify([...row.projects].sort())!==JSON.stringify(b.projects))
        return {confirmed:null};
      const rows=rawTokens(await client.request('global_config_tokens',
        {path:{edgeConfigId:b.id}}));
      return {confirmed:rows.some(x=>x.id===result.id&&x.label===b.label)};
    }catch{return {confirmed:null};}
  }
});
function backupVersion(raw,id,storeId){
  const version=raw?.id??raw?.versionId??raw?.version;
  if(version!==id||raw?.edgeConfigId!=null&&raw.edgeConfigId!==storeId)
    throw new TypeError('Wrong Global Config backup version or store');
  const items=allItems(raw?.data?.items?raw.data:raw);
  if(Object.keys(items).length>100)
    throw new TypeError('Backup is too large for an independently proven preview');
  for(const [key,value] of Object.entries(items)){
    if(!KEY.test(key)||credentialLike(key)||
      value===undefined||JSON.stringify(value)===undefined||
      Buffer.byteLength(JSON.stringify(value))>8192)
      throw new TypeError('Backup item is unsafe to restore');
  }
  return items;
}
function describeDiff(from,to){
  const before=Object.keys(from),after=Object.keys(to);
  return {
    create:after.filter(k=>!Object.hasOwn(from,k)).sort(),
    remove:before.filter(k=>!Object.hasOwn(to,k)).sort(),
    update:after.filter(k=>Object.hasOwn(from,k)&&
      JSON.stringify(from[k])!==JSON.stringify(to[k])).sort()
  };
}
async function restoreState(a,ctx){
  controlsValid(a,restoreFields);
  if(!VERSION.test(a.versionId??''))throw new TypeError('Exact backup version ID required');
  const {client,account,row}=await store(ctx,a);
  const path={edgeConfigId:row.id,edgeConfigBackupVersionId:a.versionId};
  const [now,backup]=await Promise.all([
    client.request('global_config_items',{path:{edgeConfigId:row.id}}),
    client.request('global_config_backup_get',{path})
  ]);
  const current=allItems(now),saved=backupVersion(backup,a.versionId,row.id);
  if(Object.keys(current).length!==row.itemCount)
    throw new TypeError('Store item inventory did not match declared item count');
  const diff=describeDiff(current,saved);
  if(!Object.values(diff).some(x=>x.length))
    throw new TypeError('Backup is already identical; no restore needed');
  return {id:row.id,slug:row.slug,teamId:account.team_id,
    updatedAt:row.updatedAt,itemCount:row.itemCount,
    projects:[...row.projects].sort(),versionId:a.versionId,
    backupItemCount:Object.keys(saved).length,diff};
}
function restoreUnchanged(b,after){
  return b.id===after.id&&b.slug===after.slug&&
    b.teamId===after.teamId&&b.updatedAt===after.updatedAt&&
    b.versionId===after.versionId&&b.itemCount===after.itemCount&&
    b.backupItemCount===after.backupItemCount&&
    JSON.stringify(b.projects)===JSON.stringify(after.projects)&&
    JSON.stringify(b.diff)===JSON.stringify(after.diff);
}
const restore=defineWrite({
  name:'vercel_globalconfig_restore_backup',
  before:restoreState,
  async preview(_a,_ctx,b){
    const d=b.diff;
    return 'Restore exact Global Config backup '+b.versionId+' to '+b.slug+
      ' ('+b.id+') with '+b.backupItemCount+' items. Create ['+
      d.create.join(', ')+']; update ['+d.update.join(', ')+
      ']; remove ['+d.remove.join(', ')+']. Item values hidden. Linked projects: '+
      b.projects.join(', ')+'; changes can affect live consumers immediately';
  },
  production:classification,
  async targets(_a,b){return targets(b);},
  async apply(a,ctx,b,requestKey){
    const provider=await writeProvider(ctx);
    await requirePreDispatch(async()=>{
      if(provider.account.team_id!==b.teamId)
        throw new TypeError('Selected account changed');
      const fresh=await restoreState(a,ctx);
      if(!restoreUnchanged(b,fresh))
        throw new TypeError('Restore version, store or diff changed after preview');
    });
    return provider.write('global_config_restore_backup',
      {path:{edgeConfigId:b.id,edgeConfigBackupVersionId:b.versionId}},
      {requestKey,tool:'vercel_globalconfig_restore_backup',
        shapeResult:()=>({id:b.id,versionId:b.versionId})});
  },
  async verify(_a,ctx,b){
    try{
      const {client,account,row}=await exact(ctx,b.id);
      if(account.team_id!==b.teamId||row.slug!==b.slug||
        row.updatedAt<=b.updatedAt||
        JSON.stringify([...row.projects].sort())!==JSON.stringify(b.projects))
        return {confirmed:null};
      const path={edgeConfigId:b.id,edgeConfigBackupVersionId:b.versionId};
      const [current,backup]=await Promise.all([
        client.request('global_config_items',{path:{edgeConfigId:b.id}}),
        client.request('global_config_backup_get',{path})
      ]);
      const a=allItems(current),v=backupVersion(backup,b.versionId,b.id);
      return {confirmed:Object.keys(a).length===Object.keys(v).length&&
        Object.keys(a).every(k=>Object.hasOwn(v,k)&&
          JSON.stringify(a[k])===JSON.stringify(v[k]))};
    }catch{return {confirmed:null};}
  }
});
const out=r=>({isError:['refused_by_guard','outcome_unknown'].includes(r.status),
  content:[{type:'text',text:JSON.stringify(r)}]});
export const globalConfigRemainingTools={
  tools:[
    {name:'vercel_globalconfig_create_token',writes:true,guardedWrite:true,
      profiles:['full'],area:'env',
      description:'Issue one guarded read token; only an encrypted, one-time owner setup reference appears in chat.',
      inputSchema:schema(Object.fromEntries(tokenFields.map(k=>[k,PROPS[k]])),
        ['id','expectedSlug','expectedUpdatedAt','label','outsideApp']),
      writeContract:createToken.writeContract,
      annotations:{readOnlyHint:false,destructiveHint:false}},
    {name:'vercel_globalconfig_restore_backup',writes:true,guardedWrite:true,
      profiles:['everyday','full'],area:'env',
      description:'Version-pinned Global Config restore after exact item-key diff and live-project classification.',
      inputSchema:schema(Object.fromEntries(restoreFields.map(k=>[k,PROPS[k]])),
        ['id','expectedSlug','expectedUpdatedAt','versionId','outsideApp']),
      writeContract:restore.writeContract,
      annotations:{readOnlyHint:false,destructiveHint:true}}
  ],
  handlers:{
    vercel_globalconfig_create_token:bindGuardedWrite(createToken,context,out),
    vercel_globalconfig_restore_backup:bindGuardedWrite(restore,context,out)
  }
};
