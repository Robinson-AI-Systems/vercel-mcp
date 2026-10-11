// MCP owner writes only PROPOSE an encrypted approval. The separate owner
// setup page authenticates Chris and performs any account mutation.
import { defineWrite } from '../core/write.js';
import { compact } from '../core/util.js';
import { checkProtected } from './self-guard.js';
import { checkApp } from './app-guard.js';
import { requestOwnerAccountChange, inspectOwnerAccountChange } from '../vercel/owner-approvals.js';

const REF = /^conn_[a-f0-9]{20}$/;
const ACCOUNT = /^[a-zA-Z0-9_/-]{3,256}$/;
function requireFields(args, allowed) {
  if (!args || typeof args !== 'object' || Array.isArray(args) ||
    Object.keys(args).some(k => !allowed.includes(k)) ||
    (args.confirm !== undefined && typeof args.confirm !== 'boolean') ||
    (args.dryRun !== undefined && typeof args.dryRun !== 'boolean')) {
    throw new TypeError('Invalid owner approval arguments');
  }
}
function centsText(cents) {
  return '$' + Math.floor(cents / 100) + '.' + String(cents % 100).padStart(2, '0');
}
export function ownerProposal(name, action) {
  if (!['default','spend','revoke'].includes(action)) throw new TypeError('Unsupported owner action');
  return defineWrite({
    name, approvalOnly: true,
    async before(args, {connection, db, env}) {
      const keys = action === 'default' ? ['account','confirm','dryRun'] :
        action === 'spend' ? ['limitCents','confirm','dryRun'] :
          ['connectionId','confirm','dryRun'];
      requireFields(args, keys);
      if (env?.VERCEL_ENV !== 'production' || connection?.profile !== 'full' ||
        !ACCOUNT.test(connection?.account || '')) throw new TypeError('Owner request unavailable');
      const accounts = await db.listVercelAccounts();
      if (!accounts.some(row => row.id === connection.account)) throw new TypeError('Unconfigured account');
      if (action === 'default') {
        if (!ACCOUNT.test(args.account || '') ||
          !accounts.some(row => row.id === args.account)) throw new TypeError('Unknown account');
        return {account: connection.account, target: args.account};
      }
      if (action === 'spend') {
        if (!Number.isInteger(args.limitCents) || args.limitCents < 0 ||
          args.limitCents > 2147483647) throw new TypeError('Invalid cents');
        return {account: connection.account, cents: args.limitCents};
      }
      if (typeof args.connectionId !== 'string' || !REF.test(args.connectionId))
        throw new TypeError('Invalid connector');
      const rows = await db.listAccountConnections({account:connection.account, limit:20});
      if (!rows.some(row => row.id === args.connectionId &&
        row.vercel_account === connection.account &&
        row.kind === 'connector' && !row.revoked_at)) throw new TypeError('Stale connector');
      return {account: connection.account, target: args.connectionId};
    },
    async preview(_args, _ctx, before) {
      return action === 'default' ? 'Request owner approval to set global default account to ' + before.target :
        action === 'spend' ? 'Request owner approval for ' + before.account +
          ' daily limit ' + centsText(before.cents) :
          'Request owner approval to revoke one exact connector on ' + before.account;
    },
    async production() { return {production:true, why:'Owner-account administration is live'}; },
    async targets(_args, before) {
      return action === 'revoke' ? [{kind:'token',id:before.target}] :
        [{kind:'account',id:action==='default'?before.target:before.account}];
    },
    async apply(_args, {db, env, connection}, before) {
      const payload = action === 'default' ? {action,targetAccount:before.target} :
        action === 'spend' ? {action,limitCents:before.cents} :
          {action,connectionRef:before.target};
      return requestOwnerAccountChange({db,env,connection,args:{...payload,confirm:true}});
    },
    async verify(_args, {db,env}, before, issued) {
      if (issued?.status !== 'awaiting_owner_approval' ||
        typeof issued.reference !== 'string') return {confirmed:null};
      const found = await inspectOwnerAccountChange({
        db,env,account:before.account,reference:issued.reference
      });
      const confirmed = found?.issuerAccount === before.account &&
        found.action === action &&
        (action === 'default' ? found.targetAccount === before.target :
          action === 'spend' ? found.limitCents === before.cents :
            found.connectionRef === before.target);
      return {confirmed:confirmed === true};
    }
  });
}
export function ownerWriteContext({connection,db,env}) {
  return {
    connection,db,env,shape:compact,
    guardProtected:targets=>checkProtected(targets,{db,connection,env}),
    guardApp:targets=>checkApp(targets,{db,connection,env}),
    audit:entry=>db.recordChange(entry),
    replayStore:db.requestReplayStore()
  };
}
