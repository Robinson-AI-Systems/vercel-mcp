// Approval-request envelopes, not owner permission. No Vercel or account mutation here.
// An OAuth profile merely proposes; the independently signed-in owner must apply.
import { oneTimeSecrets } from '../core/one-time-secrets.js';

const KIND = 'owner_account_change';
const ACTIONS = new Set(['default','spend','revoke']);
const IDS = /^[a-zA-Z0-9_/-]{3,256}$/;
const REF = /^conn_[a-f0-9]{20}$/;
const allowed = new Set(['action','targetAccount','connectionRef','limitCents','confirm','dryRun']);
function denied(reason) {
  return {status:'refused_by_guard',confirmed:false,reason};
}
function format(action, account, target, amount) {
  if(action==='default') return 'Propose changing the default account to '+target;
  if(action==='revoke') return 'Propose revoking one OAuth connector on '+account;
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
  let target=null, amount=null;
  if(action==='default') {
    if(!IDS.test(args.targetAccount||'') ||
        args.connectionRef!==undefined || args.limitCents!==undefined) {
      return denied('An existing target account is required');
    }
    if(!configured.some(row=>row.id===args.targetAccount)) return denied('Target account is not configured');
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
  const summary=format(action,account,target,amount);
  if (args.dryRun===true) return {status:'preview',dryRun:true,preview:summary,
    ownerApprovalRequired:true};
  if(args.confirm!==true) return {status:'needs_confirmation',confirmed:false,
    preview:summary,ownerApprovalRequired:true};
  const payload={version:1,issuerAccount:account,action,targetAccount:action==='default'?target:null,
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
export async function consumeOwnerAccountChange({db,env=process.env,account,reference,now=()=>Date.now()}) {
  if(!IDS.test(account||'') || typeof reference!=='string' ||
      !/^[0-9a-f-]{36}$/.test(reference)) return null;
  const receipt=await oneTimeSecrets({db,env,now}).reveal({id:reference,account});
  if(receipt?.kind!==KIND) return null;
  let payload;
  try {payload=JSON.parse(receipt.value);} catch {return null;}
  if(!payload || payload.version!==1 || payload.issuerAccount!==account ||
      !ACTIONS.has(payload.action)) return null;
  if(payload.action==='default' && IDS.test(payload.targetAccount||'') &&
      payload.connectionRef===null && payload.limitCents===null) return payload;
  if(payload.action==='spend' && payload.targetAccount===null &&
      payload.connectionRef===null && Number.isInteger(payload.limitCents) &&
      payload.limitCents>=0 && payload.limitCents<=2147483647) return payload;
  if(payload.action==='revoke' && payload.targetAccount===null &&
      payload.limitCents===null && REF.test(payload.connectionRef||'')) return payload;
  return null;
}
