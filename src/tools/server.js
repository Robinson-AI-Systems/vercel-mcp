// Account-information tools: strict read-only, never return credentials.
import { recheckStoredToken } from '../vercel/tokens.js';
import {prepareResult} from '../core/result-rules.js';
const PROFILES = ['read_only', 'everyday', 'full'];
const asText = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });
function safe(row) {
  return { id: row.id, team: row.team_slug, label: row.label,
    scope: row.scope, project: row.project_name || null,
    productionEnabled: Boolean(row.production_enabled),
    lastFour: row.token_last4 || null, tokenExpiresAt: row.token_expires_at || null };
}
export const serverTools = {
  tools: [
    { name: 'vercel_whoami',
      description: 'Show your Vercel team, account scope, connection profile and safe token metadata.',
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
        'Vercel token expired; rotate it using the authenticated owner setup page.' :
        daysLeft <= 14 ? 'Vercel token expires within ' + daysLeft +
          ' days; verify renewal through owner setup.' : null;
      return asText({ account: safe(row), mode: connection.mode,
        profile: connection.profile, listing: connection.listing,
        spendLimitCents: Number(row.spend_limit_cents || 0), spentTodayCents: spent,
        tokenWarning });
    },
    async vercel_list_accounts(args, { connection, db }) {
      // A connector is bound to one Vercel account. The owner setup page,
      // not an arbitrary OAuth connection, can enumerate every configured team.
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
