// Account-information tools: strict read-only, never return credentials.
import { recheckStoredToken } from '../vercel/tokens.js';
import { tokenExpiryPosture } from '../vercel/token-expiry.js';
import { boxReport, accountLayerText, flipReport } from '../vercel/box.js';
import {prepareResult} from '../core/result-rules.js';
const PROFILES = ['read_only', 'everyday', 'full'];
const asText = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });
function safe(row) {
  return { id: row.id, team: row.team_slug, label: row.label,
    scope: row.scope, project: row.project_name || null,
    productionEnabled: Boolean(row.production_enabled),
    lastFour: row.token_last4 || null, tokenExpiresAt: row.token_expires_at || null,
    tokenNoExpiry: Boolean(row.token_no_expiry) };
}
export const serverTools = {
  tools: [
    { name: 'vercel_whoami',
      description: 'Show your Vercel team, account scope, declared and probed reach, connection profile and safe token metadata.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true }, writes: false, profiles: PROFILES },
    { name: 'vercel_list_accounts',
      description: 'List configured Vercel teams and project accounts without exposing credentials.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true }, writes: false, profiles: PROFILES },
    { name: 'vercel_check_token',
      description: 'Safely recheck stored Vercel token read access; does not prove write permissions.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true }, writes: false, profiles: PROFILES },
    { name: 'vercel_set_working_box',
      description: 'Flip this connection\'s working mode (preview or production) inside its granted ceiling; effective next call. Beyond-ceiling asks name their rung.',
      inputSchema: { type: 'object', properties: {
        mode: { type: 'string', enum: ['preview', 'production'] },
        confirm: { type: 'boolean' }, dryRun: { type: 'boolean' }
      }, required: ['mode'], additionalProperties: false },
      annotations: { readOnlyHint: false, destructiveHint: false },
      writeContract: { production: true, targets: true }, writes: true, localAdmin: true, profiles: ['full'] },
    { name: 'vercel_set_read_only',
      description: 'Flip this connection\'s own read-only switch on or off, effective the next call; while on, every write through this connection refuses.',
      inputSchema: { type: 'object', properties: {
        readOnly: { type: 'boolean' },
        confirm: { type: 'boolean' }, dryRun: { type: 'boolean' }
      }, required: ['readOnly'], additionalProperties: false },
      annotations: { readOnlyHint: false, destructiveHint: false },
      writeContract: { production: true, targets: true }, writes: true, localAdmin: true, profiles: ['full'] },
    { name:'vercel_get_result',writes:false,profiles:PROFILES,
      description:'Read a page of a stored large result; only the original authenticated bearer can access it.',
      inputSchema:{type:'object',properties:{
        handle:{type:'string',pattern:'^res_[a-f0-9]{32}$'},
        page:{type:'integer',minimum:0,maximum:10000},
        fields:{type:'string',maxLength:800}
      },required:['handle'],additionalProperties:false},
      annotations:{readOnlyHint:true}
    }
  ],
  handlers: {
    async vercel_get_result(args,{connection,db}){
      if(!args || typeof args!=='object' || Array.isArray(args) ||
        Object.keys(args).some(k=>!['handle','page','fields'].includes(k)) ||
        typeof args.handle!=='string' || !/^res_[a-f0-9]{32}$/.test(args.handle) ||
        (args.page!==undefined && (!Number.isInteger(args.page) || args.page<0 || args.page>10000)) ||
        typeof connection?.resultOwner!=='string' || typeof db?.getResult!=='function')
        return {isError:true,content:[{type:'text',text:'Result unavailable or invalid request'}]};
      const stored=await db.getResult({
        account:connection.account,owner:connection.resultOwner,handle:args.handle
      });
      if(!stored)return {isError:true,content:[{type:'text',text:'Result expired or not available to this connection'}]};
      const raw=stored.body;
      const all=Array.isArray(raw)?raw:Array.isArray(raw?.rows)?raw.rows:[raw];
      const page=args.page??0,offset=page*20;
      const slice=all.slice(offset,offset+20);
      const {result,unknownFields}=prepareResult(slice,{detail:'full',fields:args.fields});
      const payload={handle:args.handle,page,count:all.length,hasMore:offset+20<all.length,
        summary:stored.summary,records:result,unknownFields};
      // Avoid a second unbounded result or a recursive handle for a giant row.
      if(Buffer.byteLength(JSON.stringify(payload),'utf8')>7000)
        return {isError:true,content:[{type:'text',
          text:'Stored page exceeds safe display size; select fewer fields'}]};
      return asText(payload);
    },
    async vercel_whoami(_args, { connection, db }) {
      // The TEST pass reports real service identity without account metadata,
      // Vercel credentials, production assets or provider API access.
      if(connection?.mode==='test')
        return asText({rtc:1,service:'robinson-vercel-mcp',mode:'test',
          scope:'service_only',providerAccess:false});
      const accounts = await db.listVercelAccounts();
      const row = accounts.find(account => account.id === connection.account);
      if (!row) return { isError: true,
        content: [{ type: 'text', text: 'No Vercel account is connected' }] };
      const spent = typeof db.getTodaySpendCents === 'function'
        ? await db.getTodaySpendCents(row.id) : null;
      const expiry = row.token_expires_at && new Date(row.token_expires_at).getTime();
      const daysLeft = Number.isFinite(expiry) ? Math.ceil((expiry - Date.now()) / 86400000) : null;
      const tokenWarning = daysLeft === null ? null : daysLeft <= 0 ?
        'Vercel token expired; rotate it through the enrollment step of the sign-in flow.' :
        daysLeft <= 14 ? 'Vercel token expires within ' + daysLeft +
          ' days; verify renewal through the enrollment step of the sign-in flow.' : null;
      // AUD-E (D-E/VMCP-003/IN-04): the explicit four-state posture beside
      // the unchanged warning. A null date with no attestation is 'unknown'
      // ("expiry not recorded for this token") — never owner's choice.
      const posture = tokenExpiryPosture(row);
      // AUD-I S3: the declared box beside the probed one, the
      // account-layer consequence (A-12) and the flip picture (A-10),
      // all rendered from the stored enrollment record.
      const box = boxReport(row);
      // AUD-AQ: the read-only switch beside mode/profile, and the flip
      // named in the flip picture — a fresh agent reading whoami alone
      // can state the posture and the way back (A-10 cold relay).
      const readOnly = connection.readOnly === true;
      return asText({ account: safe(row), mode: connection.mode,
        profile: connection.profile, listing: connection.listing,
        readOnly,
        spendLimitCents: Number(row.spend_limit_cents || 0), spentTodayCents: spent,
        purchaseBudgetCents: row.purchase_budget_cents ?? null,
        purchaseGrantRequired: Boolean(row.purchase_grant_required),
        expiresAt: posture.expiresAt, expiresAtLocal: posture.expiresAtLocal,
        daysLeft: posture.daysLeft, expiryPosture: posture.posture,
        expiryPostureText: posture.label,
        tokenWarning, box,
        accountLayer: accountLayerText(box),
        workingBoxChanges: { ...flipReport(box),
          readOnlySwitch: readOnly ?
            'on — this connection can read but not change anything; the switch is yours, flip it off with vercel_set_read_only, effective the next call' :
            'off — this connection writes as its profile allows; flip it on with vercel_set_read_only to make this connection read-only, effective the next call' } });
    },
    async vercel_list_accounts(args, { connection, db }) {
      // A connector is bound to one Vercel account. Only the owner's own
      // connection can enumerate every configured team.
      if (!args || typeof args !== 'object' || Array.isArray(args) ||
          Object.keys(args).length !== 0) {
        return { isError: true, content: [{ type: 'text', text: 'This tool takes no arguments' }] };
      }
      if (typeof connection?.account !== 'string' || !connection.account ||
          typeof db.getVercelAccountSafe !== 'function') {
        throw new Error('Authenticated account lookup unavailable');
      }
      const account = await db.getVercelAccountSafe(connection.account);
      if (!account) return { isError: true, content: [{ type: 'text',
        text: 'No Vercel account is connected' }] };
      return asText({ accounts: [safe(account)], count: 1 });
    },
    async vercel_set_working_box(args, { connection, db, env = process.env }) {
      // AUD-I S4: the working-box flip, under the product's write
      // contract (plan with dryRun, apply with confirm — the
      // production tools' shape). In-ceiling flips are instant and
      // journaled like the read-only flip (AUD-BB); the credential
      // is untouched.
      // A-10 cold relay: the flip applies to the NEXT call — this
      // call finishes under the mode it started with, because the
      // connection's context is fixed at auth.
      if (!args || typeof args !== 'object' || Array.isArray(args) ||
          Object.keys(args).some(k => !['mode', 'confirm', 'dryRun'].includes(k)) ||
          !['preview', 'production'].includes(args.mode) ||
          (args.confirm !== undefined && typeof args.confirm !== 'boolean') ||
          (args.dryRun !== undefined && typeof args.dryRun !== 'boolean')) {
        return { isError: true, content: [{ type: 'text', text: 'Invalid working-box request' }] };
      }
      if (typeof connection?.account !== 'string' || typeof connection?.connectionId !== 'string' ||
          typeof db?.setOwnConnectionMode !== 'function') {
        throw new Error('Connection flip unavailable');
      }
      if (connection.mode === args.mode) {
        return asText({ flipped: false, mode: connection.mode,
          note: 'This connection already works in ' + args.mode + ' mode; nothing to flip.' });
      }
      if (args.mode === 'production') {
        // The ceiling has two rungs above this flip; name the one
        // that owns a refusal instead of a bare no (IN-18/A-12 form).
        const accounts = await db.listVercelAccounts();
        const row = accounts.find(account => account.id === connection.account);
        if (!row) return { isError: true,
          content: [{ type: 'text', text: 'No Vercel account is connected' }] };
        if (!row.production_enabled) {
          return asText({ flipped: false, refused: 'production_switch_off',
            rung: 'The account\'s production switch is off. That switch belongs to the account owner (their own setting, never a ceremony): vercel_enable_production flips it with the owner\'s approval, and this flip then succeeds instantly.' });
        }
        if (env.VERCEL_ENV !== 'production') {
          return asText({ flipped: false, refused: 'preview_deployment',
            rung: 'This server is a preview deployment; production mode exists only on the production deployment of this service. Connect there to work in production mode.' });
        }
      }
      if (args.dryRun === true) {
        return asText({ status: 'planned', flipped: false, from: connection.mode, to: args.mode,
          effective: 'next call',
          note: 'On confirm, this connection flips to ' + args.mode + ' from your next call; this call finishes under ' + connection.mode + '.' });
      }
      if (args.confirm !== true) {
        return { isError: true, content: [{ type: 'text', text: JSON.stringify({
          status: 'refused_by_guard', confirmed: false,
          reason: 'Preview this flip with dryRun: true, or apply it with confirm: true' }) }] };
      }
      const result = await db.setOwnConnectionMode({
        account: connection.account, connectionId: connection.connectionId, mode: args.mode
      });
      if (!result) return { isError: true,
        content: [{ type: 'text', text: 'Connection unavailable for a mode flip' }] };
      // AUD-BB: journaled like the read-only flip (AUD-AQ), so the
      // flip reads back through vercel_recent_changes; journaling
      // never changes the flip's outcome. Only an actual change
      // journals — a same-state result (a stale-context ask the db
      // already satisfies) writes no degenerate row.
      if (result.from !== result.to && typeof db?.recordChange === 'function') {
        try {
          await db.recordChange({
            account: connection.account, mode: connection.mode, tool: 'vercel_set_working_box',
            summary: 'Working-box mode flipped ' + result.from + ' to ' + result.to +
              ' on this connection',
            dryRun: false, production: connection.mode === 'production'
          });
        } catch { /* the flip stands */ }
      }
      return asText({ flipped: true, from: result.from, to: result.to,
        effective: 'next call',
        note: 'This call finishes under ' + result.from + '; your next call runs under ' + result.to + '.' });
    },
    async vercel_set_read_only(args, { connection, db }) {
      // AUD-AQ: the read-only end-user switch, under the same
      // plan/confirm contract as the working-box flip. The switch is
      // the connection's own safety dial (IN-09 one layer down): it
      // flips only the caller's own connection, never another, and
      // takes effect on the NEXT call — this call finishes under
      // the posture it started with, because the connection's
      // context is fixed at auth (the S4 precedent).
      if (!args || typeof args !== 'object' || Array.isArray(args) ||
          Object.keys(args).some(k => !['readOnly', 'confirm', 'dryRun'].includes(k)) ||
          typeof args.readOnly !== 'boolean' ||
          (args.confirm !== undefined && typeof args.confirm !== 'boolean') ||
          (args.dryRun !== undefined && typeof args.dryRun !== 'boolean')) {
        return { isError: true, content: [{ type: 'text', text: 'Invalid read-only switch request' }] };
      }
      if (typeof connection?.account !== 'string' || typeof connection?.connectionId !== 'string' ||
          typeof db?.setOwnConnectionReadOnly !== 'function') {
        throw new Error('Read-only switch unavailable');
      }
      const current = connection.readOnly === true;
      if (current === args.readOnly) {
        return asText({ flipped: false, readOnly: current,
          note: 'This connection\'s read-only switch is already ' + (current ? 'on' : 'off') + '; nothing to flip.' });
      }
      if (args.dryRun === true) {
        return asText({ status: 'planned', flipped: false, from: current, to: args.readOnly,
          effective: 'next call',
          note: 'On confirm, this connection\'s read-only switch flips ' + (args.readOnly ? 'on' : 'off') +
            ' from your next call; this call finishes with the switch ' + (current ? 'on' : 'off') + '.' });
      }
      if (args.confirm !== true) {
        return { isError: true, content: [{ type: 'text', text: JSON.stringify({
          status: 'refused_by_guard', confirmed: false,
          reason: 'Preview this flip with dryRun: true, or apply it with confirm: true' }) }] };
      }
      const result = await db.setOwnConnectionReadOnly({
        account: connection.account, connectionId: connection.connectionId, readOnly: args.readOnly
      });
      if (!result) return { isError: true,
        content: [{ type: 'text', text: 'Connection unavailable for a read-only flip' }] };
      // Journaled like every other connection change, so the flip
      // reads back through vercel_recent_changes; journaling never
      // changes the flip's outcome.
      if (typeof db?.recordChange === 'function') {
        try {
          await db.recordChange({
            account: connection.account, mode: connection.mode, tool: 'vercel_set_read_only',
            summary: 'Read-only switch flipped ' + (result.from ? 'on' : 'off') +
              ' to ' + (result.to ? 'on' : 'off') + ' on this connection',
            dryRun: false, production: connection.mode === 'production'
          });
        } catch { /* the flip stands */ }
      }
      return asText({ flipped: true, from: result.from, to: result.to,
        effective: 'next call',
        note: 'This call finishes with the switch ' + (result.from ? 'on' : 'off') +
          '; your next call runs with it ' + (result.to ? 'on' : 'off') + '.' });
    },
    async vercel_check_token(args, { connection, db, env, fetchImpl }) {
      // The MCP dispatcher does not currently enforce argument schemas itself.
      // Reject every caller-supplied token, account selector and privilege flag.
      if (!args || typeof args !== 'object' || Array.isArray(args) ||
          Object.keys(args).length !== 0) {
        return { isError: true, content: [{ type: 'text', text: 'This tool takes no arguments' }] };
      }
      if (typeof connection?.account !== 'string') throw new Error('Connection account unavailable');
      return asText(await recheckStoredToken({
        db, accountId: connection.account, env, fetchImpl
      }));
    }
  }
};
