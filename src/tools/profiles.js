// P-1 (BATCH-P): project profile reads. A profile says which apps manage
// parts of their own Vercel setup and what each owns, so the server can
// defer to the app instead of fighting it. Profiles are local data —
// these reads never call the provider and never block.
import { activeProfiles, profileOf } from './app-guard.js';
const PROFILES = ['read_only', 'everyday', 'full'];
const text = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });
const ID = /^[a-z0-9][a-z0-9-]{1,60}$/;
function rows(ctx) {
  if (!ctx?.db?.listKnownApps || !ctx?.connection?.account) {
    throw new TypeError('App profile data is unavailable');
  }
  return ctx.db.listKnownApps(ctx.connection.account);
}
function summary(row) {
  const p = profileOf(row);
  return {
    id: p.id, name: p.name, status: row.status ?? p.status ?? 'active',
    projects: p.projects ?? [],
    productionBranch: p.production_branch ?? null,
    releaseRule: p.release_rule ?? 'promote',
    nodeVersion: p.node_version ?? null,
    framework: p.framework ?? null,
    ownedDomains: p.owned_domains ?? [],
    ownedStores: p.owned_stores ?? [],
    managedEnvCount: Array.isArray(p.managed_env) ? p.managed_env.length : 0,
    expectedCronsCount: Array.isArray(p.expected_crons) ? p.expected_crons.length : 0,
    costTargetCents: p.cost_target_cents ?? null
  };
}
function noArgs(args) {
  if (!args || typeof args !== 'object' || Array.isArray(args) ||
    Object.keys(args).length) {
    throw new TypeError('Profile list takes no arguments');
  }
}
export const profileReadTools = {
  tools: [
    { name: 'vercel_profile_list', writes: false, area: 'profiles',
      profiles: PROFILES,
      description: 'List project profiles: which apps manage their own Vercel resources, what each owns, and its release rule.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true } },
    { name: 'vercel_profile_get', writes: false, area: 'profiles',
      profiles: PROFILES,
      description: 'Read one project profile in full: owned variables, domains and DNS records, stores, release rule, crons and no-preview branches.',
      inputSchema: { type: 'object',
        properties: { app: { type: 'string' } },
        required: ['app'], additionalProperties: false },
      annotations: { readOnlyHint: true } }
  ],
  handlers: {
    async vercel_profile_list(args, ctx) {
      noArgs(args);
      const all = await rows(ctx);
      const profiles = activeProfiles(all).map(({ row }) => summary(row));
      const drafts = all.filter(r => (r.status ?? 'active') === 'draft')
        .map(row => summary(row));
      return text({ profiles, drafts, count: profiles.length,
        note: 'Profiles are data: they name what each app owns so writes elsewhere defer to it. Reads are never blocked by a profile.' });
    },
    async vercel_profile_get(args, ctx) {
      if (!args || typeof args !== 'object' || Array.isArray(args) ||
        Object.keys(args).some(k => k !== 'app') ||
        typeof args.app !== 'string' || !ID.test(args.app)) {
        throw new TypeError('Profile get takes one profile id (app)');
      }
      const all = await rows(ctx);
      const found = all.find(r => profileOf(r)?.id === args.app);
      if (!found) {
        throw new TypeError('No project profile named ' + args.app +
          ' is recorded for this account');
      }
      const p = profileOf(found);
      return text({ profile: p, status: found.status ?? 'active',
        source: found.source ?? null,
        accountScope: found.account === null ? 'every account' : 'this account',
        updatedAt: found.updatedAt ?? null });
    }
  }
};
