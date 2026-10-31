// Approval-request envelopes, not owner permission. No Vercel or account mutation here.
// An OAuth profile merely proposes; the independently signed-in owner must apply.
import { oneTimeSecrets } from '../core/one-time-secrets.js';
import { decryptSecret } from '../core/secret-box.js';

const KIND = 'owner_account_change';
const ACTIONS = new Set(['default','spend','revoke','remove']);
const IDS = /^[a-zA-Z0-9_/-]{3,256}$/;
const REF = /^conn_[a-f0-9]{20}$/;
const allowed = new Set(['action','targetAccount','connectionRef','limitCents','confirm','dryRun']);
function denied(reason) {
  return {status:'refused_by_guard',confirmed:false,reason};
}
function format(action, account, target, amount, row = null) {
  if(action==='default') return 'Propose changing the default account to '+target;
  if(action==='revoke') return 'Propose revoking one OAuth connector on '+account;
  if(action==='remove') return 'Propose removing the enrolled account '+
    (row ? row.label+' ('+target+'; '+row.scope+'; token ending '+row.token_last4+')' : target)+
    ' — its stored credential, connections, passes and account-scoped settings are removed with it';
  return 'Propose setting '+account+' daily spend limit to $'+
    Math.floor(amount/100)+'.'+String(amount%100).padStart(2,'0');
}
export async function requestOwnerAccountChange({
  db, env=process.env, connection, args, now=()=>Date.now()
}) {
  if (!connection || connection.profile!=='full' || !IDS.test(connection.account||'') ||
      !['preview','production'].includes(connection.mode) || env.VERCEL_ENV!=='production') {
    return denied('Full-profile connection to the production server is required to propose an owner change');
  }
  if (!args || typeof args!=='object' || Array.isArray(args) ||
    Object.keys(args).some(k=>!allowed.has(k)) || !ACTIONS.has(args.action)) {
    return denied('Invalid owner-change request');
  }
  const {action}=args;
  if (args.confirm!==undefined && typeof args.confirm!=='boolean' ||
      args.dryRun!==undefined && typeof args.dryRun!=='boolean') {
    return denied('Invalid confirmation or preview flag');
  }
  const configured = await db.listVercelAccounts();
  if (!configured.some(row => row.id === connection.account)) {
    return denied('Current account is not configured');
  }
  let target=null, amount=null, targetRow=null;
  if(action==='default') {
    if(!IDS.test(args.targetAccount||'') ||
        args.connectionRef!==undefined || args.limitCents!==undefined) {
      return denied('An existing target account is required');
    }
    if(!configured.some(row=>row.id===args.targetAccount)) return denied('Target account is not configured');
    target=args.targetAccount;
  } else if(action==='remove') {
    if(!IDS.test(args.targetAccount||'') ||
        args.connectionRef!==undefined || args.limitCents!==undefined) {
      return denied('An existing target account is required');
    }
    targetRow=configured.find(row=>row.id===args.targetAccount) ?? null;
    if(!targetRow) return denied('Target account is not configured');
    // AUD-AA default guard (mirrored inside rmcp_owner_remove_account
    // for approval-time truth): deleting the default row would
    // silently promote the next account in list order into the
    // new-connection default. The remedy is one owner act away.
    if(targetRow.is_default && configured.length>1) {
      return denied('That account is the default for new connections while other accounts remain; '+
        'choose a new default first (vercel_set_default_account, applied with vercel_apply_owner_approval), then propose the removal');
    }
    target=args.targetAccount;
  } else if(action==='spend') {
    if(args.targetAccount!==undefined || args.connectionRef!==undefined ||
      !Number.isInteger(args.limitCents) || args.limitCents<0 || args.limitCents>2147483647) {
      return denied('Exact limit cents must be an integer in the supported range');
    }
    amount=args.limitCents;
  } else {
    if(args.targetAccount!==undefined || args.limitCents!==undefined ||
      typeof args.connectionRef!=='string' || !REF.test(args.connectionRef)) {
      return denied('Exact current connector reference is required');
    }
    const rows=await db.listAccountConnections({account:connection.account,limit:20});
    if(!rows.some(row=>row.id===args.connectionRef && row.vercel_account===connection.account &&
      row.kind==='connector' && !row.revoked_at)) return denied('Connector is missing, stale or not in this account');
    target=args.connectionRef;
  }
  const account=connection.account;
  const summary=format(action,account,target,amount,targetRow);
  if (args.dryRun===true) return {status:'preview',dryRun:true,preview:summary,
    ownerApprovalRequired:true};
  if(args.confirm!==true) return {status:'needs_confirmation',confirmed:false,
    preview:summary,ownerApprovalRequired:true};
  const payload={version:1,issuerAccount:account,action,targetAccount:action==='default'||action==='remove'?target:null,
    connectionRef:action==='revoke'?target:null,limitCents:amount};
  const receipt=await oneTimeSecrets({db,env,now}).issue({
    account,kind:KIND,label:'Owner account change approval',value:JSON.stringify(payload),
    ttlMs:600000
  });
  await db.recordChange({account,mode:connection.mode,tool:'vercel_owner_account_change_request',
    summary:'Owner approval requested for '+action+' (not applied)',dryRun:true,
    production:false,requestKey:receipt.id});
  return {status:'awaiting_owner_approval',confirmed:false,
    reference:receipt.id,expiresAt:receipt.expiresAt,
    preview:summary,ownerApprovalRequired:true};
}

function validateOwnerEnvelope(payload,account) {
  if(!payload || payload.version!==1 || payload.issuerAccount!==account ||
    !ACTIONS.has(payload.action)) return null;
  if(payload.action==='default' && IDS.test(payload.targetAccount||'') &&
    payload.connectionRef===null && payload.limitCents===null) return payload;
  if(payload.action==='remove' && IDS.test(payload.targetAccount||'') &&
    payload.connectionRef===null && payload.limitCents===null) return payload;
  if(payload.action==='spend' && payload.targetAccount===null &&
    payload.connectionRef===null && Number.isInteger(payload.limitCents) &&
    payload.limitCents>=0 && payload.limitCents<=2147483647) return payload;
  if(payload.action==='revoke' && payload.targetAccount===null &&
    payload.limitCents===null && REF.test(payload.connectionRef||'')) return payload;
  return null;
}
function decode(value,account) {
  try {return validateOwnerEnvelope(JSON.parse(value),account);}catch{return null;}
}
/** Read-only preview; only authenticated owner setup should call this. */
export async function inspectOwnerAccountChange({db,env=process.env,account,reference}) {
  if(!IDS.test(account||'') || typeof reference!=='string' ||
    !/^[0-9a-f-]{36}$/.test(reference) ||
    typeof db.getOwnerApprovalRequest!=='function') return null;
  const row=await db.getOwnerApprovalRequest({account,reference});
  if(!row || row.kind!==KIND || row.vercel_account!==account) return null;
  let value;
  try {
    value=decryptSecret(row.ciphertext,'once:'+account+':'+KIND+':'+reference,env);
  } catch {return null;}
  return decode(value,account);
}
/** Single-use consumption is distinct from inspection and never applies a mutation. */
export async function consumeOwnerAccountChange({db,env=process.env,account,reference,now=()=>Date.now()}) {
  if(!IDS.test(account||'') || typeof reference!=='string' ||
    !/^[0-9a-f-]{36}$/.test(reference)) return null;
  const receipt=await oneTimeSecrets({db,env,now}).reveal({id:reference,account});
  if(receipt?.kind!==KIND) return null;
  return decode(receipt.value,account);
}

/**
 * Database-only application of an already independently approved request.
 * This function is NOT an MCP handler or an owner authenticator. Its two
 * callers each complete their own owner proof first: owner setup (session,
 * CSRF, fresh passphrase, confirm) and vercel_apply_owner_approval (AUD-AS:
 * the owner's own connector-kind connection, confirm) — both after one-use
 * reference consumption and an inspect/compare of the exact envelope. Every
 * DB method performs its own atomic audit and independent read-back; never
 * claim success on an ambiguous result.
 */
export async function applyApprovedOwnerAccountChange({db,request}) {
  if(!request || !validateOwnerEnvelope(request,request.issuerAccount))
    return {status:'refused',confirmed:false};
  if(!db || typeof db.listVercelAccounts!=='function')
    return {status:'refused',confirmed:false};
  const accounts=await db.listVercelAccounts();
  if(!accounts.some(row=>row.id===request.issuerAccount))
    return {status:'refused',confirmed:false};
  let ok=false;
  if(request.action==='default'){
    if(!accounts.some(row=>row.id===request.targetAccount) ||
      typeof db.setDefaultOwnerAccount!=='function')
      return {status:'refused',confirmed:false};
    ok=await db.setDefaultOwnerAccount(request.targetAccount);
  } else if(request.action==='spend'){
    if(typeof db.setOwnerSpendLimit!=='function')
      return {status:'refused',confirmed:false};
    ok=await db.setOwnerSpendLimit(request.issuerAccount,request.limitCents);
  } else if(request.action==='revoke'){
    if(typeof db.revokeOwnerConnection!=='function')
      return {status:'refused',confirmed:false};
    ok=await db.revokeOwnerConnection({
      account:request.issuerAccount,connectionId:request.connectionRef
    });
  } else if(request.action==='remove'){
    // AUD-AA: the target must still be the configured row the owner
    // reviewed; the db operation re-derives every guard under lock.
    if(!accounts.some(row=>row.id===request.targetAccount) ||
      typeof db.removeOwnerAccount!=='function')
      return {status:'refused',confirmed:false};
    ok=(await db.removeOwnerAccount(request.targetAccount))==='removed';
  }
  return {status:ok===true?'applied':'unverified',confirmed:ok===true,
    action:request.action};
}
