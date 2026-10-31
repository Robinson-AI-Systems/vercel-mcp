// Read-only account observability. Never read credential ciphertext or token hashes.
import { findSettingGuide } from '../data/dashboard-map.js';
const READ_PROFILES = ['read_only','everyday','full'];
const textResult = payload => ({ content: [{ type: 'text', text: JSON.stringify(payload) }] });
const opts = properties => ({ type: 'object', properties, additionalProperties: false });
const limitArg = { type: 'integer', minimum: 1, maximum: 20 };
export const observabilityTools = {
  tools: [
    { name: 'vercel_list_connections', writes: false, profiles: READ_PROFILES,
      description: 'List scoped connector (OAuth) connection metadata and expiration without showing tokens or hashes.',
      inputSchema: opts({ includeRevoked: { type:'boolean' }, limit: limitArg }),
      annotations: { readOnlyHint: true } },
    { name: 'vercel_recent_changes', writes: false, profiles: READ_PROFILES,
      description: 'Show bounded, account-scoped audit changes; preview simulations stay hidden unless requested.',
      inputSchema: opts({ tool: {type:'string'}, projectId:{type:'string'},
        mode:{type:'string',enum:['preview','production']}, since:{type:'string'},
        includePreviews:{type:'boolean'}, limit: limitArg }),
      annotations: { readOnlyHint: true } },
    { name: 'vercel_where_is_setting', writes: false, profiles: READ_PROFILES,
      description: 'Give dashboard directions and a verification method for settings without a safe API.',
      inputSchema: { ...opts({setting:{type:'string',minLength:2,maxLength:120}}),
        required:['setting'] }, annotations: { readOnlyHint: true } }
  ],
  handlers: {
    async vercel_list_connections(args, {connection,db}) {
      if (typeof db.listAccountConnections !== 'function') throw new Error('Account read unavailable');
      const rows = await db.listAccountConnections({
        account: connection.account, includeRevoked: args.includeRevoked === true,
        limit: args.limit ?? 20
      });
      return textResult({ account: connection.account, count: rows.length,
        moreMayExist: rows.length === (args.limit ?? 20),
        connections: rows.map(row => ({
          id: row.id, clientId:row.client_id || null,
          mode:row.mode, profile:row.profile, listing:row.listing, kind:row.kind,
          createdAt:row.created_at, lastUsedAt:row.last_used_at,
          expiresAt:row.expires_at, revokedAt:row.revoked_at
        })) });
    },
    async vercel_recent_changes(args, {connection,db}) {
      if (typeof db.listRecentChanges !== 'function') throw new Error('Audit read unavailable');
      const rows = await db.listRecentChanges({
        account: connection.account, tool: args.tool ?? null,
        projectId: args.projectId ?? null, mode: args.mode ?? null,
        since: args.since ?? null, includePreviews: args.includePreviews === true,
        limit: args.limit ?? 20
      });
      return textResult({ account: connection.account, count: rows.length,
        previewsIncluded: args.includePreviews === true,
        changes: rows.map(row => ({
          id:row.id, at:row.at, tool:row.tool, mode:row.mode,
          projectId:row.project_id, summary:row.summary, dryRun:row.dry_run,
          production:row.production, spendCents:row.spend_cents
        })) });
    },
    async vercel_where_is_setting(args) {
      return textResult(findSettingGuide(args.setting));
    }
  }
};
