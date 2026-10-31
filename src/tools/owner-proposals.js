// MCP owner writes only PROPOSE an encrypted approval. The owner's own
// connection applies it through vercel_apply_owner_approval (AUD-AS);
// the setup page that used to perform the mutation was deleted by AUD-AV.
import { defineWrite, RefusalError } from '../core/write.js';
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
    throw new RefusalError('Invalid owner approval arguments');
  }
}
function centsText(cents) {
  return '$' + Math.floor(cents / 100) + '.' + String(cents % 100).padStart(2, '0');
}
const REMOVE_DEFAULT_GUARD = 'That account is the default for new connections while other accounts remain; ' +
  'choose a new default first (vercel_set_default_account, applied with vercel_apply_owner_approval), then propose the removal';
// AUD-AA: the removal plan, in plain words — the row, its posture and
// exactly what the cascade revokes or deletes, plus the disclosures
// the dossier's shape map requires (own connection, last account,
// production on). Counts are the facts read at proposal time; the
// atomic operation re-derives them under lock at approval time.
function removalPreview(facts, before) {
  if (!facts) return 'Request owner approval to remove the enrolled account ' + before.target;
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
  let text = 'Request owner approval to remove the enrolled account ' + facts.label +
    ' (' + before.target + '; ' + facts.scope + ' on team ' + facts.team_slug +
    '; token ending ' + facts.token_last4 + '). Removing it deletes the stored credential ' +
    'and revokes ' + plural(facts.live_tokens, 'active connection token', 'active connection tokens') +
    ' and ' + plural(facts.live_passes, 'pass', 'passes') + '; it deletes ' +
    plural(facts.pending_inputs, 'pending secret input', 'pending secret inputs') + ', ' +
    plural(facts.pending_secrets, 'pending one-time secret', 'pending one-time secrets') + ', ' +
    plural(facts.pending_codes, 'unconsumed sign-in code', 'unconsumed sign-in codes') + ' and ' +
    plural(facts.protections, 'account-scoped protection rule', 'account-scoped protection rules') +
    '. Audit history and purchase records are kept for 400 days.';
  if (facts.production_enabled) {
    text += ' Production is switched on for this account; it stops with the removal.';
  }
  if (before.target === before.account) {
    text += ' This is the account THIS connection is using: this connection stops working ' +
      'when the owner applies the removal.';
  }
  if (before.accountCount === 1) {
    text += ' It is the only connected account: the server will have no connected Vercel ' +
      'accounts until a token is enrolled through the sign-in flow.';
  }
  return text;
}
export function ownerProposal(name, action) {
  if (!['default','spend','revoke','remove'].includes(action)) throw new TypeError('Unsupported owner action');
  return defineWrite({
    name, approvalOnly: true,
    async before(args, {connection, db, env}) {
      const keys = action === 'default' || action === 'remove' ? ['account','confirm','dryRun'] :
        action === 'spend' ? ['limitCents','confirm','dryRun'] :
          ['connectionId','confirm','dryRun'];
      requireFields(args, keys);
      if (env?.VERCEL_ENV !== 'production' || connection?.profile !== 'full' ||
        !ACCOUNT.test(connection?.account || '')) throw new RefusalError('Owner request unavailable');
      const accounts = await db.listVercelAccounts();
      if (!accounts.some(row => row.id === connection.account)) throw new RefusalError('Unconfigured account');
      if (action === 'default') {
        if (!ACCOUNT.test(args.account || '') ||
          !accounts.some(row => row.id === args.account)) throw new RefusalError('Unknown account');
        return {account: connection.account, target: args.account};
      }
      if (action === 'remove') {
        if (!ACCOUNT.test(args.account || '')) throw new RefusalError('Unknown account');
        const target = accounts.find(row => row.id === args.account);
        if (!target) throw new RefusalError('Unknown account');
        // AUD-AA default guard: deleting the default row would
        // silently promote the next account in list order into the
        // new-connection default (owner-approvals mirrors this;
        // rmcp_owner_remove_account enforces it at approval time).
        if (target.is_default && accounts.length > 1) throw new RefusalError(REMOVE_DEFAULT_GUARD);
        return {account: connection.account, target: args.account, accountCount: accounts.length};
      }
      if (action === 'spend') {
        if (!Number.isInteger(args.limitCents) || args.limitCents < 0 ||
          args.limitCents > 2147483647) throw new RefusalError('Invalid cents');
        return {account: connection.account, cents: args.limitCents};
      }
      if (typeof args.connectionId !== 'string' || !REF.test(args.connectionId))
        throw new RefusalError('Invalid connector');
      const rows = await db.listAccountConnections({account:connection.account, limit:20});
      if (!rows.some(row => row.id === args.connectionId &&
        row.vercel_account === connection.account &&
        row.kind === 'connector' && !row.revoked_at)) throw new RefusalError('Stale connector');
      return {account: connection.account, target: args.connectionId};
    },
    async preview(_args, ctx, before) {
      if (action === 'remove') {
        const facts = typeof ctx?.db?.getAccountRemovalFacts === 'function' ?
          await ctx.db.getAccountRemovalFacts(before.target) : null;
        return removalPreview(facts, before);
      }
      return action === 'default' ? 'Request owner approval to set global default account to ' + before.target :
        action === 'spend' ? 'Request owner approval for ' + before.account +
          ' daily limit ' + centsText(before.cents) :
          'Request owner approval to revoke one exact connector on ' + before.account;
    },
    async production() { return {production:true, why:'Owner-account administration is live'}; },
    async targets(_args, before) {
      return action === 'revoke' ? [{kind:'token',id:before.target}] :
        [{kind:'account',id:action==='default'||action==='remove'?before.target:before.account}];
    },
    async apply(_args, {db, env, connection}, before) {
      const payload = action === 'default' || action === 'remove' ?
          {action,targetAccount:before.target} :
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
        (action === 'default' || action === 'remove' ? found.targetAccount === before.target :
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
