// Database schema and the only SQL entry point for Robinson Vercel MCP.
// Additive by design: schema initialization never drops or rewrites existing data.
import { neon } from '@neondatabase/serverless';
import { hashToken } from './core/oauth.js';
import { compact } from './core/util.js';
import { randomUUID,randomBytes } from 'node:crypto';

export const SCHEMA_TABLES = Object.freeze([
  'vercel_accounts', 'oauth_clients', 'oauth_codes', 'oauth_tokens', 'login_attempts',
  'change_log', 'one_time_secrets', 'pending_inputs', 'protected_resources', 'request_replay', 'result_store', 'purchase_intents', 'rtc_passes', 'dev_runs', 'dev_run_objects', 'dev_sandbox_usage', 'schema_migrations', 'blob_store_connections', 'known_apps'
]);

// AUD-AO (Production Gate decision, 2026-10-31): the fleet retention
// clocks. The change journal and the purchase ledger are kept 400 days,
// then sweep-purged; authorizations that were never exercised are out
// 180 days after they lapse. sweepRetention() below enforces them; the
// dossier (retention-clocks-dossier-2026-10-31.md) records which stores
// each clock covers and which are excluded, with reasons.
export const CHANGE_LOG_RETENTION_DAYS = 400;
export const PURCHASE_LEDGER_RETENTION_DAYS = 400;
export const UNUSED_AUTHORIZATION_RETENTION_DAYS = 180;
// This codebase has no scheduler: maintenance is opportunistic on
// requests (initSchema runs at every entry route; the result store
// already sweeps its own expired rows at read). The retention sweep
// follows that shape, throttled in-process so a busy instance sweeps
// at most hourly; the deletes are idempotent, so overlap between
// instances is harmless.
const RETENTION_SWEEP_INTERVAL_MS = 3600000;
let lastRetentionSweepAt = 0;

// P-1 (BATCH-P): the seeded project profile. A profile is data, not code:
// one row in known_apps per app, generated from docs/APP-NEEDS-APPLIANCE-DESK.md
// as re-verified against the app repo on 2026-10-30 (docs/pr-cards/P-1.md §4
// traces every item to the app file it came from). Seeded from initSchema()
// with an upsert that refreshes the row only while its source stays
// 'default', so the APP-NEEDS rule "this file and the seed change in the
// same PR" actually deploys, and owner edits are never overwritten. No
// Vercel IDs are recorded here; IDs are enrollment data.
export const APPLIANCE_DESK_PROFILE = Object.freeze({
  id: 'appliance-desk',
  name: 'Appliance Desk',
  vercel_account: null,
  projects: ['appliance-desk'],
  production_branch: 'live',
  release_rule: 'branch',
  rollback_caution: 'Rolling back to a deployment built before a migration runs old code against the new database schema; check docs/runbooks/RESTORE.md first.',
  no_preview_branches: ['ai/**', 'transfer/**', 'recovery/**'],
  managed_env: ['BLOB_READ_WRITE_TOKEN', 'PRIVATE_PHOTO_BLOB_READ_WRITE_TOKEN',
    'PREVIEW_PRIVATE_BLOB_READ_WRITE_TOKEN', 'PRIVATE_PHOTO_BLOB_STORE_ID',
    'PREVIEW_PRIVATE_BLOB_STORE_ID'],
  expected_env: {
    production: ['DATABASE_URL', 'DIRECT_URL', 'BETTER_AUTH_SECRET',
      'BETTER_AUTH_URL', 'NEXT_PUBLIC_APP_URL', 'STRIPE_SECRET_KEY',
      'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY', 'STRIPE_WEBHOOK_SECRET',
      'BLOB_READ_WRITE_TOKEN', 'PRIVATE_PHOTO_BLOB_READ_WRITE_TOKEN',
      'PRIVATE_PHOTO_BLOB_STORE_ID', 'CRON_SECRET', 'RESEND_API_KEY',
      'RESEND_FROM_EMAIL', 'LEAD_NOTIFICATION_EMAIL',
      'MAINTENANCE_NOTIFICATION_EMAIL', 'BILLING_NOTIFICATION_EMAIL',
      'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'SENTRY_DSN',
      'NEXT_PUBLIC_SENTRY_DSN', 'SENTRY_ORG', 'SENTRY_PROJECT',
      'SENTRY_AUTH_TOKEN'],
    preview: ['PREVIEW_PRIVATE_BLOB_READ_WRITE_TOKEN',
      'PREVIEW_PRIVATE_BLOB_STORE_ID'],
    development: []
  },
  owned_domains: ['robinsonappliancerentals.com'],
  owned_dns_records: [
    { type: 'MX', name: '@', note: 'Google Workspace mail' },
    { type: 'TXT', name: '@', value_prefix: 'v=spf1', note: 'SPF' },
    { type: 'TXT', name: '*._domainkey', note: 'DKIM' },
    { type: 'TXT', name: 'resend._domainkey', note: 'Resend DKIM' },
    { type: 'TXT', name: '_dmarc', value_prefix: 'v=DMARC1', note: 'DMARC' },
    { name: 'send', note: 'Resend sending subdomain' }
  ],
  owned_stores: ['appliance-desk-photos'],
  owned_store_ids: [],
  expected_crons: [
    { path: '/api/cron/launch-emails', schedule: '0 16 * * *' },
    { path: '/api/cron/billing-reminders', schedule: '0 14 * * *' },
    { path: '/api/cron/job-reminders', schedule: '0 13 * * *' },
    { path: '/api/cron/start-renewals', schedule: '10 7 * * *' },
    { path: '/api/cron/late-fees', schedule: '0 15 * * *' },
    { path: '/api/cron/collections', schedule: '20 15 * * *' },
    { path: '/api/cron/billing-reconcile', schedule: '30 15 * * *' },
    { path: '/api/cron/backup', schedule: '0 9 * * *' },
    { path: '/api/cron/telecom-sync', schedule: '20 9 * * *' },
    { path: '/api/cron/books-nightly', schedule: '40 9 * * *' },
    { path: '/api/cron/estimate-follow-ups', schedule: '0 16 * * *' },
    { path: '/api/cron/tax-address-recheck', schedule: '20 13 * * *' },
    { path: '/api/cron/tax-rate-changes', schedule: '5 18 * * *' },
    { path: '/api/cron/tenant-retention', schedule: '30 10 * * *' },
    { path: '/api/cron/expense-drafts', schedule: '50 9 * * *' },
    { path: '/api/cron/scheduled-prices', schedule: '10 10 * * *' },
    { path: '/api/cron/recall-watch', schedule: '30 11 * * *' },
    { path: '/api/cron/emergency-access', schedule: '15 13 * * *' },
    { path: '/api/cron/access-expiry', schedule: '35 8 * * *' }
  ],
  node_version: '24',
  framework: 'nextjs',
  protected_sandboxes: [],
  cost_target_cents: 2000,
  dashboard_settings: [
    { setting: 'Production branch tracking', recommended: 'live',
      note: 'Guided (the app\u2019s IN-68): Vercel \u2192 project appliance-desk \u2192 Settings \u2192 Environments \u2192 Production \u2192 Branch Tracking; read back through the project\u2019s link.productionBranch.' },
    { setting: 'Spend Management', recommended: 'Budget alerts on; pause production off',
      note: 'Guided (IN-12): alerts live only in Vercel; this server reads and reports them, never controls them.' }
  ],
  record_links: [],
  notes: [
    'TWILIO_PHONE_NUMBER is deliberately unset today (APP-NEEDS), so it is not an expected_env entry.',
    'COLORADO_GIS_API_KEY is planned, not expected yet.',
    'The private photo Blob store and the preview-only private Blob store join owned_stores when the owner connects them through Blob enrollment in the sign-in flow; only appliance-desk-photos is named in the app docs.',
    'vercel.json git.deploymentEnabled now default-denies the app\u2019s own git deployments except live and testing; no_preview_branches above is the explicit never-preview list this server\u2019s preview tools enforce.'
  ]
});
export const KNOWN_APP_SEED = Object.freeze([APPLIANCE_DESK_PROFILE]);

export const CONNECTION_FIELDS = Object.freeze(['vercel_account', 'mode', 'profile', 'listing']);

// IN-07 (AUD-AV re-home): the seeded protected-project defaults
// are empty by the owner's ruling — existing seeded records
// persist, but no new defaults are seeded. This constant lived in
// src/vercel/setup.js until AUD-AV deleted that module; its home
// is now beside seedProtectedProjects, which consumes such lists.
export const PROTECTED_DEFAULTS = Object.freeze([]);
// TEST probes this service only, never Vercel provider/account resources.
const rtcModeSafe=(mode,areas)=>mode==='preview'||(mode==='test'&&
  Array.isArray(areas)&&areas.length===1&&areas[0]==='server');
// R-1W (BATCH-R amendment, 2026-10-30): a write pass is an rtc_passes row with
// allow_writes set, a delegated profile (everyday/full) and a preview or
// production mode; TEST never writes. The read-only predicates are preserved
// verbatim for read passes; this shape is the second disjunct wherever a pass
// is inspected or authorized, so a malformed write row can never authorize.
const rtcProjectIdList=(value)=>value===null||(Array.isArray(value)&&
  value.length>=1&&value.length<=50&&new Set(value).size===value.length&&
  value.every(x=>typeof x==='string'&&/^[a-zA-Z0-9_-]{3,128}$/.test(x)));
const rtcWritePassShape=(row)=>row.allow_writes===true&&
  ['everyday','full'].includes(row.profile)&&
  ['preview','production'].includes(row.mode)&&
  Array.isArray(row.areas)&&row.areas.length>=1&&
  Number.isSafeInteger(row.spend_limit_cents)&&row.spend_limit_cents>=0&&
  rtcProjectIdList(row.project_ids??null);

export function connectionSettings(row) {
  if (!row || typeof row !== 'object') throw new TypeError('A connection row is required');
  return Object.fromEntries(CONNECTION_FIELDS.map((field) => [field, row[field]]));
}

export function createDb(query) {
  if (query !== undefined && typeof query !== 'function') {
    throw new TypeError('createDb expects a Neon-shaped query function');
  }
  let sql = query;
  function getSql() {
    if (sql) return sql;
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL is not configured. Set DATABASE_URL before using the database.');
    sql = neon(connectionString);
    return sql;
  }

  return {

    // RTC 1: called by owner setup and, since AUD-AU, by
    // vercel_issue_pass on the owner's own connector connection.
    // A read-only pass never allows
    // writes, production mode or financial outflow. Store only SHA-256,
    // not bearer. Write-capable passes are issueWriteRtcPass below.
    async issueReadOnlyRtcPass({account,hours=24,areas=['server'],mode='preview',rateLimitPerMinute=120}) {
      if(!/^[a-zA-Z0-9_/-]{3,256}$/.test(account||'') ||
        !Number.isInteger(hours)||hours<1||hours>720||
        !Array.isArray(areas)||areas.length<1||areas.length>12||
        new Set(areas).size!==areas.length||
        areas.some(x=>typeof x!=='string'||!/^[a-z][a-z0-9_]{0,47}$/.test(x))||
        !rtcModeSafe(mode,areas)||!Number.isInteger(rateLimitPerMinute)||
        rateLimitPerMinute<1||rateLimitPerMinute>600)
        throw new TypeError('Invalid RTC pass scope');
      const token='rtc_pass_'+randomBytes(32).toString('base64url');
      const digest=hashToken(token),id='pass_'+digest.slice(0,20);
      const run=getSql();
      // Issuance and its audit are one statement: a failed audit cannot
      // leave behind an active undisclosed pass after an insertion.
      const rows=await run`WITH issued AS (
        INSERT INTO rtc_passes (pass_id,token_hash,vercel_account,mode,areas,rate_limit_per_minute,expires_at)
        SELECT ${id},${digest},id,${mode},${JSON.stringify(areas)}::jsonb,
          ${rateLimitPerMinute},now()+${hours} * interval '1 hour'
        FROM vercel_accounts WHERE id=${account}
        RETURNING pass_id,expires_at,vercel_account,mode
      ), audited AS (
        INSERT INTO change_log(vercel_account,mode,tool,summary,dry_run,production)
        SELECT vercel_account,mode,'vercel_owner_issue_read_only_pass',
          'Owner issued scoped read-only RTC pass',FALSE,FALSE FROM issued
        RETURNING id
      ) SELECT pass_id,expires_at FROM issued`;
      if(rows.length!==1) return null;
      return {token,id,expiresAt:rows[0].expires_at};
    },
    // R-1W: the write-capable sibling (BATCH-R amendment, 2026-10-30). Same
    // issuance/audit atomicity as a read pass; the scope is a delegated
    // profile with a standing spend ceiling (0 = no spend) and an optional
    // project restriction (null = unrestricted). Called by owner setup
    // (behind the administrator passphrase) and, since AUD-AU, by
    // vercel_issue_pass on the owner's own connector connection.
    async issueWriteRtcPass({account,profile='everyday',mode='preview',hours=24,
      areas,spendLimitCents=0,projectIds=null,rateLimitPerMinute=120}) {
      if(!/^[a-zA-Z0-9_/-]{3,256}$/.test(account||'') ||
        !['everyday','full'].includes(profile)||
        !['preview','production'].includes(mode)||
        !Number.isInteger(hours)||hours<1||hours>720||
        !Array.isArray(areas)||areas.length<1||areas.length>12||
        new Set(areas).size!==areas.length||
        areas.some(x=>typeof x!=='string'||!/^[a-z][a-z0-9_]{0,47}$/.test(x))||
        !Number.isSafeInteger(spendLimitCents)||spendLimitCents<0||
        spendLimitCents>2147483647||
        !rtcProjectIdList(projectIds)||
        !Number.isInteger(rateLimitPerMinute)||
        rateLimitPerMinute<1||rateLimitPerMinute>600)
        throw new TypeError('Invalid RTC write pass scope');
      const token='rtc_pass_'+randomBytes(32).toString('base64url');
      const digest=hashToken(token),id='pass_'+digest.slice(0,20);
      const run=getSql();
      const rows=await run`WITH issued AS (
        INSERT INTO rtc_passes (pass_id,token_hash,vercel_account,profile,mode,areas,rate_limit_per_minute,expires_at,allow_writes,spend_limit_cents,project_ids)
        SELECT ${id},${digest},id,${profile},${mode},${JSON.stringify(areas)}::jsonb,
          ${rateLimitPerMinute},now()+${hours} * interval '1 hour',TRUE,
          ${spendLimitCents},${projectIds===null?null:JSON.stringify(projectIds)}::jsonb
        FROM vercel_accounts WHERE id=${account}
        RETURNING pass_id,expires_at,vercel_account,mode
      ), audited AS (
        INSERT INTO change_log(vercel_account,mode,tool,summary,dry_run,production)
        SELECT vercel_account,mode,'vercel_owner_issue_write_pass',
          'Owner issued scoped write-capable RTC pass',FALSE,${mode==='production'}
        FROM issued
        RETURNING id
      ) SELECT pass_id,expires_at FROM issued`;
      if(rows.length!==1) return null;
      return {token,id,expiresAt:rows[0].expires_at};
    },
    // Single atomic DB update enforces a shared per-pass rolling minute limit.
    // Return only normalized scope and neutral status; never the bearer/hash.
    // Unmetered, non-executable pass inspection. A final atomic
    // authorizeRtcPass still checks expiry/revocation and debits reads.
    async inspectRtcPass(token) {
      if(typeof token!=='string'||!/^rtc_pass_[A-Za-z0-9_-]{43}$/.test(token))
        return {status:'permission'};
      const run=getSql(),digest=hashToken(token);
      const rows=await run`SELECT pass_id,vercel_account,profile,mode,listing,
          areas,rate_limit_per_minute,expires_at,revoked_at,allow_writes,
          spend_limit_cents,project_ids FROM rtc_passes WHERE token_hash=${digest}`;
      if(rows.length!==1)return {status:'permission'};
      const row=rows[0];
      if(row.revoked_at)return {status:'pass_revoked'};
      if(new Date(row.expires_at).getTime()<=Date.now())return {status:'pass_expired'};
      if(!Number.isInteger(row.rate_limit_per_minute)||row.rate_limit_per_minute<1||
        row.rate_limit_per_minute>600)return {status:'permission'};
      if(row.profile==='read_only'){
        // The read-only predicate, preserved verbatim: a read row that
        // somehow carries allow_writes is corrupt and never authorizes.
        if(!rtcModeSafe(row.mode,row.areas)||row.allow_writes===true)
          return {status:'permission'};
        return {status:'ok',id:row.pass_id,account:row.vercel_account,
          profile:row.profile,mode:row.mode,listing:row.listing,areas:row.areas,
          rateLimitPerMinute:row.rate_limit_per_minute};
      }
      if(!rtcWritePassShape(row))return {status:'permission'};
      return {status:'ok',id:row.pass_id,account:row.vercel_account,
        profile:row.profile,mode:row.mode,listing:row.listing,areas:row.areas,
        rateLimitPerMinute:row.rate_limit_per_minute,allowWrites:true,
        spendLimitCents:row.spend_limit_cents,projectIds:row.project_ids??null};
    },
    async authorizeRtcPass(token,units=1) {
      // Each batch tool consumes one unit. Validate before touching SQL.
      if(!Number.isInteger(units)||units<1||units>10)
        return {status:'permission'};
      if(typeof token!=='string'||!/^rtc_pass_[A-Za-z0-9_-]{43}$/.test(token))
        return {status:'permission'};
      const digest=hashToken(token),run=getSql();
      const rows=await run`UPDATE rtc_passes SET
        window_count=CASE WHEN window_started<=now()-interval '1 minute'
          THEN ${units} ELSE window_count+${units} END,
        window_started=CASE WHEN window_started<=now()-interval '1 minute'
          THEN now() ELSE window_started END
        WHERE token_hash=${digest} AND revoked_at IS NULL
          AND expires_at>now()
          AND ((profile='read_only'
            AND (mode='preview' OR (mode='test' AND areas='["server"]'::jsonb)))
           OR (allow_writes AND profile IN ('everyday','full')
            AND mode IN ('preview','production')))
          AND rate_limit_per_minute BETWEEN 1 AND 600
          AND (window_started<=now()-interval '1 minute' OR window_count+${units}<=rate_limit_per_minute)
        RETURNING pass_id,vercel_account,profile,mode,listing,areas,rate_limit_per_minute,allow_writes,spend_limit_cents,project_ids`;
      if(rows.length===1){
        const row=rows[0];
        if(!Array.isArray(row.areas)||row.areas.length<1||
          !Number.isInteger(row.rate_limit_per_minute)||
          row.rate_limit_per_minute<1||row.rate_limit_per_minute>600)return {status:'permission'};
        if(row.profile==='read_only'){
          if(!rtcModeSafe(row.mode,row.areas)||row.allow_writes===true)
            return {status:'permission'};
          return {status:'ok',id:row.pass_id,account:row.vercel_account,
            profile:row.profile,mode:row.mode,listing:row.listing,areas:row.areas,
            rateLimitPerMinute:row.rate_limit_per_minute};
        }
        if(!rtcWritePassShape(row))return {status:'permission'};
        return {status:'ok',id:row.pass_id,account:row.vercel_account,
          profile:row.profile,mode:row.mode,listing:row.listing,areas:row.areas,
          rateLimitPerMinute:row.rate_limit_per_minute,allowWrites:true,
          spendLimitCents:row.spend_limit_cents,projectIds:row.project_ids??null};
      }
      const reason=await run`SELECT expires_at,revoked_at,mode,profile,areas,rate_limit_per_minute,window_count,window_started,allow_writes,spend_limit_cents,project_ids
        FROM rtc_passes WHERE token_hash=${digest}`;
      if(reason.length!==1)return {status:'permission'};
      const row=reason[0];
      if(row.revoked_at)return {status:'pass_revoked'};
      if(new Date(row.expires_at).getTime()<=Date.now())return {status:'pass_expired'};
      if(!Number.isInteger(row.rate_limit_per_minute)||row.rate_limit_per_minute<1||
        row.rate_limit_per_minute>600)return {status:'permission'};
      if(row.profile==='read_only'){
        if(!rtcModeSafe(row.mode,row.areas)||row.allow_writes===true)
          return {status:'permission'};
      }else if(!rtcWritePassShape(row))return {status:'permission'};
      return {status:'rate_limited'};
    },
    async listRtcPasses(account) {
      if(!/^[a-zA-Z0-9_/-]{3,256}$/.test(account||''))
        throw new TypeError('Invalid RTC account');
      const run=getSql();
      return run`SELECT pass_id,mode,areas,rate_limit_per_minute,expires_at,revoked_at,created_at
        FROM rtc_passes WHERE vercel_account=${account}
        ORDER BY created_at DESC LIMIT 20`;
    },
    async revokeRtcPass({account,id}) {
      if(!/^[a-zA-Z0-9_/-]{3,256}$/.test(account||'') ||
        !/^pass_[a-f0-9]{20}$/.test(id||''))return false;
      const run=getSql();
      const rows=await run`WITH revoked AS (
        UPDATE rtc_passes SET revoked_at=now()
        WHERE pass_id=${id} AND vercel_account=${account}
          AND revoked_at IS NULL RETURNING pass_id,mode
      ),audit AS (
        INSERT INTO change_log(vercel_account,mode,tool,summary,dry_run,production)
        SELECT ${account},mode,'vercel_owner_revoke_read_only_pass',
          'Owner revoked a scoped RTC pass',FALSE,FALSE
        FROM revoked RETURNING id
      ) SELECT (SELECT COUNT(*) FROM revoked)::int AS n,
          (SELECT COUNT(*) FROM audit)::int AS audits`;
      return rows[0]?.n===1&&rows[0]?.audits===1;
    },
    async listVercelAccounts() {
      const run = getSql();
      return run`SELECT id, team_id, team_slug, label, scope, project_id, project_name,
        production_enabled, production_enable_strictness, is_default, token_last4,
        token_expires_at, token_no_expiry, token_version, spend_limit_cents,
        token_probe,
        purchase_budget_cents, purchase_grant_required FROM vercel_accounts ORDER BY is_default DESC, label ASC`;
    },

    /**
     * Owner-setup-only global default selection. One SQL statement atomically
     * updates every default flag AND records the safe audit row. A competing
     * selection may win before read-back; in that case never claim success.
     * Never call from an OAuth tool (owner setup authenticates independently).
     */
    async setDefaultOwnerAccount(id) {
      if (typeof id !== 'string' || !/^[a-zA-Z0-9_/-]{3,256}$/.test(id)) {
        throw new TypeError('Invalid default Vercel account');
      }
      const run = getSql();
      const rows = await run`WITH target AS (
          SELECT id FROM vercel_accounts WHERE id = ${id}
        ), changed AS (
          UPDATE vercel_accounts SET is_default = (id = ${id})
          WHERE EXISTS (SELECT 1 FROM target)
          RETURNING id, is_default
        ), audit AS (
          INSERT INTO change_log (vercel_account, mode, tool, summary, dry_run, production)
          SELECT ${id}, 'production', 'vercel_set_default_account',
            'Owner selected default Vercel account', FALSE, TRUE
          WHERE (SELECT COUNT(*) FROM changed WHERE is_default = TRUE) = 1
          RETURNING id
        )
        SELECT (SELECT COUNT(*) FROM changed WHERE is_default = TRUE) AS selected_count,
          (SELECT COUNT(*) FROM audit) AS audit_count`;
      if (Number(rows[0]?.selected_count) !== 1 || Number(rows[0]?.audit_count) !== 1) {
        return false;
      }
      const verified = await run`SELECT id FROM vercel_accounts WHERE is_default = TRUE`;
      return verified.length === 1 && verified[0].id === id;
    },

    /**
     * Independently authenticated owner setup only. Atomic account-scoped
     * spend-limit update and audit; this never authorizes a purchase.
     */
    async setOwnerSpendLimit(id, cents) {
      if (typeof id !== 'string' || !/^[a-zA-Z0-9_/-]{3,256}$/.test(id) ||
        !Number.isInteger(cents) || cents < 0 || cents > 2147483647) {
        throw new TypeError('Invalid account or exact spend limit in cents');
      }
      const run = getSql();
      const rows = await run`WITH changed AS (
          UPDATE vercel_accounts SET spend_limit_cents = ${cents} WHERE id = ${id}
          RETURNING id
        ), audit AS (
          INSERT INTO change_log
            (vercel_account, mode, tool, summary, dry_run, production, after)
          SELECT ${id}, 'production', 'vercel_set_spend_limit',
            'Owner changed the daily spend limit', FALSE, TRUE,
            jsonb_build_object('limitCents', ${cents}::integer)
          FROM changed RETURNING id
        )
        SELECT (SELECT COUNT(*) FROM changed) AS changed_count,
          (SELECT COUNT(*) FROM audit) AS audit_count`;
      if (Number(rows[0]?.changed_count) !== 1 || Number(rows[0]?.audit_count) !== 1) {
        return false;
      }
      const verified = await run`SELECT spend_limit_cents FROM vercel_accounts WHERE id = ${id}`;
      return verified.length === 1 && verified[0].spend_limit_cents === cents;
    },

    /**
     * AUD-A1 (design D-A, owner ruling OP-2): the account's standing purchase
     * policy — an optional owner-set agent budget (NULL = no budget) and the
     * owner's opt-in to per-purchase grants. Storage only in this packet:
     * reading or setting the policy never authorizes a purchase, and the
     * executor keeps its current grant behavior until AUD-A2.
     * Returns null when the account does not exist.
     */
    async getPurchasePolicy(id) {
      if (typeof id !== 'string' || !/^[a-zA-Z0-9_/-]{3,256}$/.test(id)) {
        throw new TypeError('Invalid Vercel account');
      }
      const run = getSql();
      const rows = await run`SELECT purchase_budget_cents, purchase_grant_required
        FROM vercel_accounts WHERE id = ${id}`;
      if (rows.length !== 1) return null;
      return { budgetCents: rows[0].purchase_budget_cents ?? null,
        grantRequired: Boolean(rows[0].purchase_grant_required) };
    },

    /**
     * Owner-proofed callers only: an owner-applied approval envelope
     * (AUD-AT — the
     * envelope is the owner's act; a proposal tool never calls this).
     * Atomic account-scoped purchase-policy update and audit, with the
     * same read-back verification pattern as setOwnerSpendLimit. Every
     * successful set is journaled.
     */
    async setPurchasePolicy(id, policy) {
      const { budgetCents, grantRequired } = policy ?? {};
      if (typeof id !== 'string' || !/^[a-zA-Z0-9_/-]{3,256}$/.test(id) ||
        !(budgetCents === null || (Number.isInteger(budgetCents) &&
          budgetCents >= 0 && budgetCents <= 2147483647)) ||
        typeof grantRequired !== 'boolean') {
        throw new TypeError('Invalid account or purchase policy');
      }
      const budgetText = budgetCents === null ? 'no agent budget' :
        'agent budget $' + Math.floor(budgetCents / 100) + '.' +
          String(budgetCents % 100).padStart(2, '0');
      const summary = 'Owner set the purchase policy: ' + budgetText +
        (grantRequired ? '; per-purchase grant required' :
          '; per-purchase grant not required');
      const run = getSql();
      const rows = await run`WITH changed AS (
          UPDATE vercel_accounts
          SET purchase_budget_cents = ${budgetCents},
            purchase_grant_required = ${grantRequired}
          WHERE id = ${id}
          RETURNING id
        ), audit AS (
          INSERT INTO change_log
            (vercel_account, mode, tool, summary, dry_run, production, after)
          SELECT ${id}, 'production', 'vercel_set_purchase_policy',
            ${summary}, FALSE, TRUE,
            jsonb_build_object('budgetCents', ${budgetCents}::integer,
              'grantRequired', ${grantRequired}::boolean)
          FROM changed RETURNING id
        )
        SELECT (SELECT COUNT(*) FROM changed) AS changed_count,
          (SELECT COUNT(*) FROM audit) AS audit_count`;
      if (Number(rows[0]?.changed_count) !== 1 || Number(rows[0]?.audit_count) !== 1) {
        return false;
      }
      const verified = await this.getPurchasePolicy(id);
      return verified !== null && verified.budgetCents === budgetCents &&
        verified.grantRequired === grantRequired;
    },

    /**
     * AUD-E (design D-E, ruling IN-04): the owner's no-expiry attestation
     * for the enrolled token. (AUD-AT: the attestation may also arrive
     * as an owner-applied approval envelope bound to the same token
     * version — an agent's proposal is never the attestation until the
     * owner applies it, so the AUD-E property is preserved.) A null token_expires_at establishes nothing —
     * storeToken writes it unconditionally — so "no expiry — owner's
     * choice" may be shown only when this flag is positively set. Returns
     * null when the account does not exist.
     */
    async getTokenNoExpiry(id) {
      if (typeof id !== 'string' || !/^[a-zA-Z0-9_/-]{3,256}$/.test(id)) {
        throw new TypeError('Invalid Vercel account');
      }
      const run = getSql();
      const rows = await run`SELECT token_no_expiry
        FROM vercel_accounts WHERE id = ${id}`;
      if (rows.length !== 1) return null;
      return Boolean(rows[0].token_no_expiry);
    },

    /**
     * Owner-proofed callers only — an owner-applied approval envelope
     * (AUD-AT); no tool may call this directly.
     * Atomic account-scoped attestation update and audit, with the
     * same read-back verification pattern as setPurchasePolicy. Every
     * successful set or clear writes a change_log row.
     */
    async setTokenNoExpiry(id, attested, expectedVersion) {
      if (typeof id !== 'string' || !/^[a-zA-Z0-9_/-]{3,256}$/.test(id) ||
        typeof attested !== 'boolean' ||
        typeof expectedVersion !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(expectedVersion)) {
        throw new TypeError('Invalid account or no-expiry attestation');
      }
      const summary = attested
        ? 'Owner attested the enrolled token has no expiry'
        : 'Owner cleared the no-expiry attestation for the enrolled token';
      const run = getSql();
      // The attestation is bound to the enrolled token's non-secret version:
      // the update lands only while token_version still equals the version
      // the setup form was rendered for, so a form opened before a token
      // rotation can never attest the replacement token.
      const rows = await run`WITH changed AS (
          UPDATE vercel_accounts
          SET token_no_expiry = ${attested}
          WHERE id = ${id} AND token_version = ${expectedVersion}
          RETURNING id
        ), audit AS (
          INSERT INTO change_log
            (vercel_account, mode, tool, summary, dry_run, production, after)
          SELECT ${id}, 'production', 'vercel_set_token_no_expiry',
            ${summary}, FALSE, TRUE,
            jsonb_build_object('tokenNoExpiry', ${attested}::boolean)
          FROM changed RETURNING id
        )
        SELECT (SELECT COUNT(*) FROM changed) AS changed_count,
          (SELECT COUNT(*) FROM audit) AS audit_count`;
      if (Number(rows[0]?.changed_count) !== 1 || Number(rows[0]?.audit_count) !== 1) {
        return false;
      }
      const verified = await run`SELECT token_no_expiry, token_version
        FROM vercel_accounts WHERE id = ${id}`;
      return verified.length === 1 &&
        Boolean(verified[0].token_no_expiry) === attested &&
        verified[0].token_version === expectedVersion;
    },


    // IN-08 grant ledger, retained by AUD-A2 (design D-A) for delegated and
    // builder connections and for owners who opted into
    // purchase_grant_required: AI calls on those connections can request a
    // priced operation, but cannot approve it — only the separately
    // authenticated setup endpoint may invoke approval. Owner connections
    // whose policy does not require a grant never create intents (AUD-A2).
    async requestPurchaseIntent({account,operation,requestKey,fingerprint,priceCents,pricingSource}) {
      if(!/^[a-zA-Z0-9_/-]{3,256}$/.test(account||'') ||
        !/^vercel_[a-z0-9_]{3,100}$/.test(operation||'') ||
        !/^rmcp_[a-zA-Z0-9_-]{16,190}$/.test(requestKey||'') ||
        !/^[a-f0-9]{64}$/.test(fingerprint||'') ||
        !['provider_quote','published_price','metered'].includes(pricingSource) ||
        (priceCents===null ? pricingSource!=='metered' :
          !Number.isSafeInteger(priceCents)||priceCents<1))
        throw new TypeError('Invalid purchase proposal');
      const run=getSql();
      const id=randomUUID();
      const rows=await run`WITH inserted AS (
          INSERT INTO purchase_intents
            (id,vercel_account,operation,request_key,fingerprint,price_cents,pricing_source,expires_at)
          SELECT ${id},${account},${operation},${requestKey},${fingerprint},
            ${priceCents},${pricingSource},now()+interval '30 minutes'
          WHERE EXISTS(SELECT 1 FROM vercel_accounts WHERE id=${account})
          ON CONFLICT (vercel_account,operation,request_key) DO NOTHING
          RETURNING id,fingerprint,price_cents,pricing_source,status,expires_at
        )
        SELECT id,fingerprint,price_cents,pricing_source,status,expires_at FROM inserted
        UNION ALL
        SELECT id,fingerprint,price_cents,pricing_source,status,expires_at
        FROM purchase_intents WHERE vercel_account=${account} AND operation=${operation}
          AND request_key=${requestKey} AND NOT EXISTS (SELECT 1 FROM inserted)`;
      if(rows.length!==1||rows[0].fingerprint!==fingerprint||
        Number(rows[0].price_cents??-1)!==Number(priceCents??-1)||
        rows[0].pricing_source!==pricingSource||
        !['pending','approved'].includes(rows[0].status)||
        new Date(rows[0].expires_at).getTime()<=Date.now()) return null;
      return {reference:rows[0].id,status:rows[0].status,expiresAt:rows[0].expires_at};
    },
    async getPurchaseIntent({account,reference}) {
      if(!/^[a-zA-Z0-9_/-]{3,256}$/.test(account||'') ||
        !/^[0-9a-f-]{36}$/.test(reference||'')) return null;
      const run=getSql();
      const rows=await run`SELECT id,vercel_account,operation,price_cents,pricing_source,
        ceiling_cents,allow_unbounded_metered,status,created_at,expires_at,approved_at,consumed_at
        FROM purchase_intents WHERE id=${reference} AND vercel_account=${account}`;
      return rows.length===1?rows[0]:null;
    },
    async approvePurchaseIntent({account,reference,ceilingCents,acknowledgeUnbounded=false}) {
      if(!/^[a-zA-Z0-9_/-]{3,256}$/.test(account||'')||
        !/^[0-9a-f-]{36}$/.test(reference||'')||
        !Number.isSafeInteger(ceilingCents)||ceilingCents<1||
        typeof acknowledgeUnbounded!=='boolean')
        return false;
      const run=getSql();
      const rows=await run`WITH approved AS (
          UPDATE purchase_intents SET status='approved',approved_at=now(),
            ceiling_cents=${ceilingCents},allow_unbounded_metered=${acknowledgeUnbounded}
          WHERE id=${reference} AND vercel_account=${account}
            AND status='pending' AND expires_at>now()
            AND (price_cents IS NULL OR price_cents<=${ceilingCents})
            AND ((price_cents IS NOT NULL AND ${acknowledgeUnbounded}=FALSE)
              OR (price_cents IS NULL AND pricing_source='metered'
                AND operation='vercel_dev_sandbox_create' AND ${acknowledgeUnbounded}=TRUE))
          RETURNING id
        ),audit AS (
          INSERT INTO change_log(vercel_account,mode,tool,summary,dry_run,production)
          SELECT ${account},'production','vercel_owner_approve_purchase',
            'Owner approved an exact purchase intent',FALSE,FALSE
          FROM approved RETURNING id
        )
        SELECT (SELECT COUNT(*) FROM approved)::int AS approved_count,
          (SELECT COUNT(*) FROM audit)::int AS audit_count`;
      if(rows.length!==1||Number(rows[0].approved_count)!==1||
        Number(rows[0].audit_count)!==1) return false;
      const read=await this.getPurchaseIntent({account,reference});
      return read?.status==='approved'&&Number(read.ceiling_cents)===ceilingCents&&
        read.allow_unbounded_metered===acknowledgeUnbounded;
    },
    async consumePurchaseIntent({account,reference,operation,requestKey,fingerprint,priceCents,pricingSource}) {
      if(!/^[a-zA-Z0-9_/-]{3,256}$/.test(account||'')||
        !/^[0-9a-f-]{36}$/.test(reference||'')||
        !/^vercel_[a-z0-9_]{3,100}$/.test(operation||'')||
        !/^rmcp_[a-zA-Z0-9_-]{16,190}$/.test(requestKey||'')||
        !/^[a-f0-9]{64}$/.test(fingerprint||'')||
        !['provider_quote','published_price','metered'].includes(pricingSource)||
        (priceCents!==null&&(!Number.isSafeInteger(priceCents)||priceCents<1)))
        return false;
      const run=getSql();
      const rows=await run`WITH used AS (
          UPDATE purchase_intents SET status='consumed',consumed_at=now()
          WHERE id=${reference} AND vercel_account=${account}
            AND operation=${operation} AND request_key=${requestKey}
            AND fingerprint=${fingerprint} AND price_cents IS NOT DISTINCT FROM ${priceCents}
            AND pricing_source=${pricingSource}
            AND status='approved' AND approved_at IS NOT NULL
            AND consumed_at IS NULL AND expires_at>now()
            AND ceiling_cents IS NOT NULL
            AND (price_cents IS NULL OR price_cents<=ceiling_cents)
            AND ((price_cents IS NOT NULL AND allow_unbounded_metered=FALSE)
              OR (price_cents IS NULL AND pricing_source='metered'
                AND operation='vercel_dev_sandbox_create' AND allow_unbounded_metered=TRUE))
          RETURNING id
        ),audit AS (
          INSERT INTO change_log(vercel_account,mode,tool,summary,dry_run,production)
          SELECT ${account},'production','vercel_purchase_approval_consumed',
            'A transaction-bound owner approval was consumed',FALSE,FALSE
          FROM used RETURNING id
        )
        SELECT (SELECT COUNT(*) FROM used)::int AS used_count,
          (SELECT COUNT(*) FROM audit)::int AS audit_count`;
      if(rows.length!==1||Number(rows[0].used_count)!==1||
        Number(rows[0].audit_count)!==1) return false;
      const read=await this.getPurchaseIntent({account,reference});
      return read?.status==='consumed'&&Boolean(read.consumed_at);
    },
    /** Safe single-account read for MCP callers: no cross-account enumeration or secrets. */
    async getVercelAccountSafe(id) {
      if (typeof id !== 'string' || !id || id.length > 256) {
        throw new TypeError('An authenticated Vercel account is required');
      }
      const run = getSql();
      const rows = await run`SELECT id, team_id, team_slug, label, scope, project_id, project_name,
        production_enabled, production_enable_strictness, is_default, token_last4,
        token_expires_at, token_no_expiry, token_version, spend_limit_cents,
        purchase_budget_cents, purchase_grant_required
        FROM vercel_accounts WHERE id = ${id} LIMIT 1`;
      return rows[0] ?? null;
    },
    /**
     * AUD-AA: the removal plan's facts for one enrolled account — the
     * safe row fields plus the exact cascade counts, in one read. The
     * counts describe what removeOwnerAccount will revoke or delete;
     * audit history and purchase records are retained and never
     * counted here. Returns null when the account does not exist.
     */
    async getAccountRemovalFacts(id) {
      if (typeof id !== 'string' || !/^[a-zA-Z0-9_/-]{3,256}$/.test(id)) {
        throw new TypeError('Invalid Vercel account');
      }
      const run = getSql();
      const rows = await run`SELECT a.id, a.label, a.scope, a.team_slug,
          a.project_id, a.token_last4, a.is_default, a.production_enabled,
          (SELECT COUNT(*) FROM vercel_accounts)::int AS account_count,
          (SELECT COUNT(*) FROM oauth_tokens
            WHERE vercel_account = a.id AND revoked_at IS NULL)::int AS live_tokens,
          (SELECT COUNT(*) FROM rtc_passes
            WHERE vercel_account = a.id AND revoked_at IS NULL)::int AS live_passes,
          (SELECT COUNT(*) FROM oauth_codes
            WHERE vercel_account = a.id)::int AS pending_codes,
          (SELECT COUNT(*) FROM pending_inputs
            WHERE vercel_account = a.id)::int AS pending_inputs,
          (SELECT COUNT(*) FROM one_time_secrets
            WHERE vercel_account = a.id)::int AS pending_secrets,
          (SELECT COUNT(*) FROM protected_resources
            WHERE vercel_account = a.id)::int AS protections
        FROM vercel_accounts a WHERE a.id = ${id}`;
      return rows[0] ?? null;
    },

    /** Tenant-scoped connection listing: never SELECT token_hash or refresh_hash. */
    async listAccountConnections({ account, includeRevoked = false, limit = 20 }) {
      if (typeof account !== 'string' || !account || typeof includeRevoked !== 'boolean' ||
        !Number.isInteger(limit) || limit < 1 || limit > 20) {
        throw new TypeError('Invalid account connection listing');
      }
      const run = getSql();
      return run`SELECT 'conn_' || LEFT(md5(token_hash), 20) AS id,
        client_id, vercel_account, mode, profile, listing, kind,
        created_at, last_used_at, expires_at, revoked_at
        FROM oauth_tokens WHERE vercel_account = ${account}
          AND (${includeRevoked} OR revoked_at IS NULL)
        ORDER BY created_at DESC, token_hash DESC LIMIT ${limit}`;
    },
    /** AUD-I S4: a connection flips its OWN working mode inside its
     * granted ceiling. Keyed by the public connection id (the same
     * derivation listAccountConnections exposes), account-scoped,
     * connector-kind only, live tokens only. Select-then-update with
     * a confirming read-back, mirroring revokeOwnerConnection's
     * discipline; only the bearer of the token can name its id, and
     * the auth layer derives that id from the presented token. */
    async setOwnConnectionMode({ account, connectionId, mode }) {
      if (typeof account !== 'string' || !/^[a-zA-Z0-9_/-]{3,256}$/.test(account) ||
        typeof connectionId !== 'string' || !/^conn_[a-f0-9]{20}$/.test(connectionId) ||
        !['preview', 'production'].includes(mode)) {
        throw new TypeError('Invalid connection mode flip');
      }
      const run = getSql();
      const before = await run`SELECT mode FROM oauth_tokens
        WHERE vercel_account = ${account} AND kind = 'connector'
          AND revoked_at IS NULL AND expires_at > now()
          AND 'conn_' || LEFT(md5(token_hash), 20) = ${connectionId}`;
      if (before.length !== 1) return null;
      const from = before[0].mode;
      if (from !== mode) {
        await run`UPDATE oauth_tokens SET mode = ${mode}
          WHERE vercel_account = ${account} AND kind = 'connector'
            AND revoked_at IS NULL AND expires_at > now()
            AND 'conn_' || LEFT(md5(token_hash), 20) = ${connectionId}`;
      }
      const readback = await run`SELECT mode FROM oauth_tokens
        WHERE vercel_account = ${account} AND kind = 'connector'
          AND revoked_at IS NULL AND expires_at > now()
          AND 'conn_' || LEFT(md5(token_hash), 20) = ${connectionId}`;
      if (readback.length !== 1 || readback[0].mode !== mode) return null;
      return { from, to: mode };
    },

    /** AUD-AQ: a connection flips its OWN read-only switch — the
     * end-user safety dial (IN-09 one layer down), never a sign-in
     * class. Same discipline as setOwnConnectionMode: keyed by the
     * public connection id, account-scoped, connector-kind only,
     * live tokens only, select-then-update with a confirming
     * read-back. Only the bearer <redacted> the token can name its id,
     * and the auth layer derives that id from the presented token. */
    async setOwnConnectionReadOnly({ account, connectionId, readOnly }) {
      if (typeof account !== 'string' || !/^[a-zA-Z0-9_/-]{3,256}$/.test(account) ||
        typeof connectionId !== 'string' || !/^conn_[a-f0-9]{20}$/.test(connectionId) ||
        typeof readOnly !== 'boolean') {
        throw new TypeError('Invalid connection read-only flip');
      }
      const run = getSql();
      const before = await run`SELECT read_only FROM oauth_tokens
        WHERE vercel_account = ${account} AND kind = 'connector'
          AND revoked_at IS NULL AND expires_at > now()
          AND 'conn_' || LEFT(md5(token_hash), 20) = ${connectionId}`;
      if (before.length !== 1) return null;
      const from = before[0].read_only === true;
      if (from !== readOnly) {
        await run`UPDATE oauth_tokens SET read_only = ${readOnly}
          WHERE vercel_account = ${account} AND kind = 'connector'
            AND revoked_at IS NULL AND expires_at > now()
            AND 'conn_' || LEFT(md5(token_hash), 20) = ${connectionId}`;
      }
      const readback = await run`SELECT read_only FROM oauth_tokens
        WHERE vercel_account = ${account} AND kind = 'connector'
          AND revoked_at IS NULL AND expires_at > now()
          AND 'conn_' || LEFT(md5(token_hash), 20) = ${connectionId}`;
      if (readback.length !== 1 || (readback[0].read_only === true) !== readOnly) return null;
      return { from, to: readOnly };
    },

    /** Owner connection only; serialized, account-scoped, one-token revocation. */
    async revokeOwnerConnection({account, connectionId}) {
      if (typeof account !== 'string' || !/^[a-zA-Z0-9_/-]{3,256}$/.test(account) ||
        typeof connectionId !== 'string' || !/^conn_[a-f0-9]{20}$/.test(connectionId)) {
        throw new TypeError('Invalid account connector reference');
      }
      const run = getSql();
      const rows = await run`SELECT rmcp_owner_revoke_connector(${account}, ${connectionId}) AS revoked`;
      if (rows[0]?.revoked !== true) return false;
      const readback = await run`SELECT revoked_at IS NOT NULL AS revoked FROM oauth_tokens
        WHERE vercel_account = ${account} AND kind = 'connector'
          AND 'conn_' || LEFT(md5(token_hash), 20) = ${connectionId}`;
      return readback.length === 1 && readback[0].revoked === true;
    },

    /**
     * AUD-AA: owner setup only; atomic removal of one enrolled account
     * row with its cascade (see rmcp_owner_remove_account). Credentials
     * never outlive the enrollment: live connection tokens and RTC
     * passes are revoked, unconsumed codes, pending secret inputs,
     * pending one-time secrets and account-scoped protections are
     * deleted; change_log history and purchase intents are retained.
     * Returns 'removed' | 'missing' | 'is_default' | 'unverified' —
     * 'removed' only after an independent read-back finds the row
     * gone; never claim success on an ambiguous result.
     */
    async removeOwnerAccount(id) {
      if (typeof id !== 'string' || !/^[a-zA-Z0-9_/-]{3,256}$/.test(id)) {
        throw new TypeError('Invalid Vercel account');
      }
      const run = getSql();
      const rows = await run`SELECT rmcp_owner_remove_account(${id}) AS status`;
      const status = rows[0]?.status;
      if (status === 'is_default' || status === 'missing') return status;
      if (status !== 'removed') return 'unverified';
      const readback = await run`SELECT id FROM vercel_accounts WHERE id = ${id}`;
      return readback.length === 0 ? 'removed' : 'unverified';
    },

    /** Scoped and non-consuming encrypted owner approval inspection. */
    async getOwnerApprovalRequest({account,reference}) {
      if (typeof account !== 'string' || !/^[a-zA-Z0-9_/-]{3,256}$/.test(account) ||
        typeof reference !== 'string' || !/^[0-9a-f-]{36}$/.test(reference)) {
        throw new TypeError('Invalid pending approval lookup');
      }
      const run=getSql();
      const rows=await run`SELECT id,vercel_account,kind,ciphertext,expires_at
        FROM one_time_secrets
        WHERE id=${reference} AND vercel_account=${account}
          AND kind='owner_account_change' AND expires_at>now()
          AND viewed_at IS NULL LIMIT 1`;
      return rows[0] ?? null;
    },

    // AUD-AS: the production-enable sibling of the two reads above —
    // scoped, non-consuming inspection of a passphrase-strictness
    // enable receipt so vercel_apply_owner_approval can preview it
    // before approveProductionEnable consumes it.
    async getProductionEnableRequest({account,reference}) {
      if(typeof account!=='string'||!/^[a-zA-Z0-9_/-]{3,256}$/.test(account)||
        typeof reference!=='string'||!/^[0-9a-f-]{36}$/.test(reference))
        throw new TypeError('Invalid pending production enable lookup');
      const run=getSql();
      const rows=await run`SELECT id,vercel_account,kind,ciphertext,expires_at
        FROM one_time_secrets WHERE id=${reference} AND vercel_account=${account}
          AND kind='production_enable' AND expires_at>now()
          AND viewed_at IS NULL LIMIT 1`;
      return rows[0]??null;
    },

    // AUD-AT: the account-setting sibling of the two reads above —
    // scoped, non-consuming inspection of a pending account-setting
    // approval envelope (purchase policy, no-expiry attestation,
    // production strictness, protected-resource clearing) so
    // vercel_apply_owner_approval can preview it before the family's
    // consume step runs.
    async getAccountSettingRequest({account,reference}) {
      if(typeof account!=='string'||!/^[a-zA-Z0-9_/-]{3,256}$/.test(account)||
        typeof reference!=='string'||!/^[0-9a-f-]{36}$/.test(reference))
        throw new TypeError('Invalid pending account setting lookup');
      const run=getSql();
      const rows=await run`SELECT id,vercel_account,kind,ciphertext,expires_at
        FROM one_time_secrets WHERE id=${reference} AND vercel_account=${account}
          AND kind='owner_account_setting' AND expires_at>now()
          AND viewed_at IS NULL LIMIT 1`;
      return rows[0]??null;
    },

    // Proposal metadata stays service-owned and encrypted; never returns a bearer.
    async getRtcPassRequest({account,reference}) {
      if(typeof account!=='string'||!/^[a-zA-Z0-9_/-]{3,256}$/.test(account)||
        typeof reference!=='string'||!/^[0-9a-f-]{36}$/.test(reference))
        throw new TypeError('Invalid pending pass lookup');
      const run=getSql();
      const rows=await run`SELECT id,vercel_account,kind,ciphertext,expires_at
        FROM one_time_secrets WHERE id=${reference} AND vercel_account=${account}
          AND kind='rtc_pass_request' AND expires_at>now()
          AND viewed_at IS NULL LIMIT 1`;
      return rows[0]??null;
    },

    // AUD-AU: scoped, non-consuming METADATA read for the reveal
    // tool's preview — the reveal-side sibling of the reads above.
    // Never selects the ciphertext; the consume path
    // (consumeOneTimeSecret) stays the only way to the value.
    // account null addresses the server / global scope, matching
    // the consume predicate exactly (IS NOT DISTINCT FROM).
    async getOneTimeSecret({id, account = null}) {
      if(typeof id!=='string'||!/^[0-9a-f-]{36}$/.test(id)||
        !(account===null||(typeof account==='string'&&
          /^[a-zA-Z0-9_/-]{3,256}$/.test(account))))
        throw new TypeError('Invalid one-time secret lookup');
      const run=getSql();
      const rows=await run`SELECT id,vercel_account,kind,label,expires_at
        FROM one_time_secrets WHERE id=${id}
          AND vercel_account IS NOT DISTINCT FROM ${account}
          AND expires_at>now() AND viewed_at IS NULL LIMIT 1`;
      return rows[0]??null;
    },

    /** Bounded account audit; never fetch raw before/after or replay data. */
    async listRecentChanges({ account, tool = null, projectId = null, mode = null,
      since = null, includePreviews = false, limit = 20 }) {
      if (typeof account !== 'string' || !account ||
        (tool !== null && (typeof tool !== 'string' || !/^vercel_[a-z0-9_]{1,80}$/.test(tool))) ||
        (projectId !== null && (typeof projectId !== 'string' ||
          !/^[a-zA-Z0-9_-]{2,128}$/.test(projectId))) ||
        (mode !== null && !['preview','production'].includes(mode)) ||
        typeof includePreviews !== 'boolean' ||
        !Number.isInteger(limit) || limit < 1 || limit > 20 ||
        (since !== null && (typeof since !== 'string' || !Number.isFinite(Date.parse(since))))) {
        throw new TypeError('Invalid account audit filter');
      }
      const run = getSql();
      return run`SELECT id, at, tool, project_id, mode,
        LEFT(summary, 160) AS summary, dry_run, production, spend_cents
        FROM change_log WHERE vercel_account = ${account}
          AND (${tool}::text IS NULL OR tool = ${tool})
          AND (${projectId}::text IS NULL OR project_id = ${projectId})
          AND (${mode}::text IS NULL OR mode = ${mode})
          AND (${since}::timestamptz IS NULL OR at >= ${since}::timestamptz)
          AND (${includePreviews} OR dry_run = FALSE)
        ORDER BY at DESC, id DESC LIMIT ${limit}`;
    },
    // O-5b (VMCP-021): the owner export's change-log read — the same safe
    // projection as listRecentChanges (summaries are pre-truncated to the
    // 160-char display bound), with an exact total so the export can state
    // honestly when its cap truncates the journal.
    async exportChanges({ account, limit = 500 }) {
      if (typeof account !== 'string' || !account ||
        !Number.isInteger(limit) || limit < 1 || limit > 1000) {
        throw new TypeError('Invalid account export filter');
      }
      const run = getSql();
      const totals = await run`SELECT COUNT(*)::int AS total FROM change_log
        WHERE vercel_account = ${account}`;
      const rows = await run`SELECT id, at, tool, project_id, mode,
        LEFT(summary, 160) AS summary, dry_run, production, spend_cents
        FROM change_log WHERE vercel_account = ${account}
        ORDER BY at DESC, id DESC LIMIT ${limit}`;
      return { total: totals[0]?.total ?? 0, rows };
    },
    // X-1: the one account-scoped read vercel_undo_change needs — the
    // row itself (with its stored inverse) plus whether a confirmed
    // undo already points at it. Never returns another account's row.
    async getChangeForUndo({ account, id }) {
      if (typeof account !== 'string' || !account ||
        !Number.isSafeInteger(id) || id < 1) {
        throw new TypeError('Invalid change lookup');
      }
      const run = getSql();
      const rows = await run`SELECT id, at, tool, mode, dry_run,
          production, inverse FROM change_log
        WHERE vercel_account = ${account} AND id = ${id} LIMIT 1`;
      const row = rows[0] ?? null;
      if (!row) return null;
      const undone = await run`SELECT id FROM change_log
        WHERE vercel_account = ${account}
          AND tool = 'vercel_undo_change' AND dry_run = FALSE
          AND (after ->> 'undoes')::bigint = ${id}
        ORDER BY id DESC LIMIT 1`;
      return { ...row, alreadyUndoneBy: undone[0]?.id ?? null };
    },
    // A-5a: all single-use retrieval is an atomic DELETE RETURNING, never a
    // SELECT followed by DELETE (which could expose the same value twice).
    async insertOneTimeSecret({ id, account = null, kind, label = null, ciphertext, expiresAt }) {
      if (!id || !kind || !ciphertext || !(expiresAt instanceof Date)) throw new TypeError('Invalid one-time secret');
      const run = getSql();
      await run`INSERT INTO one_time_secrets
        (id, vercel_account, kind, label, ciphertext, expires_at)
        VALUES (${id}, ${account}, ${kind}, ${label}, ${ciphertext}, ${expiresAt})`;
    },
    async consumeOneTimeSecret({ id, account = null }) {
      if (!id) return null;
      const run = getSql();
      const rows = await run`DELETE FROM one_time_secrets WHERE id = ${id}
        AND vercel_account IS NOT DISTINCT FROM ${account}
        AND expires_at > now()
        RETURNING id, vercel_account, kind, label, ciphertext`;
      return rows[0] ?? null;
    },
    // AUD-AV: the pending-input writer/reader methods are deleted
    // with the setup page (dossier D9). The pending_inputs TABLE
    // stays (additive-only schema rule): pre-deletion rows expire
    // unconsumed under AUD-AO's 180-day sweep, and the AUD-AA
    // removal cascade plus the owner-proposal counts still read it.
    // M-4: Blob store connections. The list method never selects the
    // ciphertext; only resolveBlobStore (the Blob wrapper) and the
    // AUD-AR enrollment path may call the ciphertext method.
    async insertBlobStoreConnection({ account, storeId, label, access = 'public',
      ciphertext, tokenLast4 }) {
      if (!account || !storeId || !label || !ciphertext ||
        !['public', 'private'].includes(access) ||
        !/^[a-zA-Z0-9]{4}$/.test(tokenLast4 || '')) {
        throw new TypeError('Invalid Blob store connection');
      }
      const run = getSql();
      await run`INSERT INTO blob_store_connections
        (vercel_account, store_id, label, access, ciphertext, token_last4)
        VALUES (${account}, ${storeId}, ${label}, ${access}, ${ciphertext}, ${tokenLast4})
        ON CONFLICT (vercel_account, store_id) DO UPDATE SET
          label = EXCLUDED.label, access = EXCLUDED.access,
          ciphertext = EXCLUDED.ciphertext, token_last4 = EXCLUDED.token_last4,
          updated_at = now()`;
    },
    async listBlobStoreConnections(account = null) {
      const run = getSql();
      const rows = account
        ? await run`SELECT vercel_account, store_id, label, access, token_last4,
            created_at, updated_at FROM blob_store_connections
            WHERE vercel_account = ${account} ORDER BY label`
        : await run`SELECT vercel_account, store_id, label, access, token_last4,
            created_at, updated_at FROM blob_store_connections
            ORDER BY vercel_account, label`;
      return rows.map(r => ({ account: r.vercel_account, storeId: r.store_id,
        label: r.label, access: r.access, tokenLast4: r.token_last4,
        createdAt: r.created_at, updatedAt: r.updated_at }));
    },
    async getBlobStoreConnectionCiphertext({ account, storeId }) {
      if (!account || !storeId) return null;
      const run = getSql();
      const rows = await run`SELECT ciphertext FROM blob_store_connections
        WHERE vercel_account = ${account} AND store_id = ${storeId}`;
      return rows[0]?.ciphertext ?? null;
    },
    async deleteBlobStoreConnection({ account, storeId }) {
      if (!account || !storeId) return false;
      const run = getSql();
      const rows = await run`DELETE FROM blob_store_connections
        WHERE vercel_account = ${account} AND store_id = ${storeId}
        RETURNING store_id`;
      return rows.length === 1;
    },
    // P-1 (BATCH-P): project profiles are data. A row is scoped to one
    // internal account (vercel_account) or to every account ('', the
    // protected_resources idea with a sentinel so the pair can be the
    // primary key); an account's own row shadows the global row with
    // the same id. The profile JSON itself follows
    // docs/designs/BATCH-P.md P2; structural validation lives in
    // src/tools/app-guard.js (validateProfile) and is enforced by the
    // tool/setup callers, so stored rows are returned as recorded.
    async listKnownApps(account) {
      if (typeof account !== 'string' || !account) throw new TypeError('Account required');
      const run = getSql();
      const rows = await run`SELECT DISTINCT ON (id) id, name, status,
          vercel_account, source, profile, updated_at FROM known_apps
        WHERE vercel_account = '' OR vercel_account = ${account}
        ORDER BY id, (vercel_account = ${account}) DESC`;
      return rows.map(r => ({ id: r.id, name: r.name, status: r.status,
        account: r.vercel_account === '' ? null : r.vercel_account,
        source: r.source, profile: r.profile, updatedAt: r.updated_at }));
    },
    async getKnownApp(account, id) {
      if (typeof account !== 'string' || !account ||
        typeof id !== 'string' || !id) throw new TypeError('Account and profile id required');
      const run = getSql();
      const rows = await run`SELECT id, name, status, vercel_account, source,
          profile, updated_at FROM known_apps
        WHERE id = ${id} AND (vercel_account = '' OR vercel_account = ${account})
        ORDER BY (vercel_account = ${account}) DESC
        LIMIT 1`;
      return rows.length ? { id: rows[0].id, name: rows[0].name,
        status: rows[0].status,
        account: rows[0].vercel_account === '' ? null : rows[0].vercel_account,
        source: rows[0].source, profile: rows[0].profile,
        updatedAt: rows[0].updated_at } : null;
    },
    async upsertKnownApp({ account = null, id, name, status = 'active',
      source = 'setup_page', profile }) {
      if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]{1,60}$/.test(id) ||
        typeof name !== 'string' || !name || name.length > 120 ||
        !['active', 'draft'].includes(status) ||
        !['default', 'setup_page', 'draft'].includes(source) ||
        (account !== null && (typeof account !== 'string' || !account)) ||
        !profile || typeof profile !== 'object' || Array.isArray(profile) ||
        profile.id !== id) {
        throw new TypeError('Invalid known app profile');
      }
      const run = getSql();
      const body = JSON.stringify(profile);
      await run`INSERT INTO known_apps
          (id, name, status, vercel_account, source, profile)
        VALUES (${id}, ${name}, ${status}, ${account ?? ''}, ${source}, ${body}::jsonb)
        ON CONFLICT (vercel_account, id) DO UPDATE SET
          name = EXCLUDED.name, status = EXCLUDED.status,
          source = EXCLUDED.source, profile = EXCLUDED.profile,
          updated_at = now()`;
      return { id, name, status, account, source, profile };
    },
    // Only owner setup routes may call these credential methods. Tool handlers
    // must never select token_enc or return decrypted credentials.
    async upsertVercelAccount({ id, teamId, teamSlug, label, scope, projectId = null,
      projectName = null, tokenEnc, tokenLast4, expiresAt = null, probe }) {
      if (!id || !teamId || !teamSlug || !label ||
        !['team', 'project', 'full'].includes(scope) || !tokenEnc ||
        !/^[a-zA-Z0-9]{4}$/.test(tokenLast4) ||
        (scope === 'project' && !projectId)) throw new TypeError('Invalid Vercel account');
      const run = getSql();
      const summary = JSON.stringify(probe);
      // AUD-E: a newly enrolled or rotated token carries no attestation of
      // its own — the ON CONFLICT update resets token_no_expiry to FALSE so
      // a previous key's attestation can never be presented as this key's,
      // and every enrollment mints a fresh non-secret token_version that
      // attestation submissions are bound to.
      const tokenVersion = randomUUID();
      await run`INSERT INTO vercel_accounts
        (id, team_id, team_slug, label, scope, project_id, project_name,
          token_enc, token_last4, token_expires_at, token_checked_at, token_probe,
          token_version)
        VALUES (${id}, ${teamId}, ${teamSlug}, ${label}, ${scope}, ${projectId}, ${projectName},
          ${tokenEnc}, ${tokenLast4}, ${expiresAt}, now(), ${summary}::jsonb,
          ${tokenVersion})
        ON CONFLICT (id) DO UPDATE SET
          team_slug = EXCLUDED.team_slug, label = EXCLUDED.label, scope = EXCLUDED.scope,
          project_id = EXCLUDED.project_id, project_name = EXCLUDED.project_name,
          token_enc = EXCLUDED.token_enc, token_last4 = EXCLUDED.token_last4,
          token_expires_at = EXCLUDED.token_expires_at,
          token_no_expiry = FALSE,
          token_version = EXCLUDED.token_version,
          token_checked_at = now(), token_probe = EXCLUDED.token_probe`;
    },
    async getAccountCredential(id) {
      if (typeof id !== 'string' || !id) return null;
      const run = getSql();
      const rows = await run`SELECT id, team_id, scope, project_id, token_enc, token_expires_at,
        token_probe
        FROM vercel_accounts WHERE id = ${id}`;
      return rows[0] || null;
    },
    async seedProtectedProjects(names) {
      if (!Array.isArray(names) || !names.length || names.some(x => typeof x !== 'string' ||
        !/^[a-z0-9][a-z0-9-]{1,100}$/.test(x))) throw new TypeError('Invalid protected project list');
      const run = getSql();
      for (const name of names) {
        await run`INSERT INTO protected_resources (vercel_account, kind, match, note, source)
          VALUES (NULL, 'project', ${name}, 'Robinson MCP baseline protection', 'default')
          ON CONFLICT DO NOTHING`;
      }
    },
    async getTodaySpendCents(accountId) {
      const run = getSql();
      const rows = await run`SELECT COALESCE(SUM(spend_cents),0)::bigint AS cents FROM change_log
        WHERE vercel_account = ${accountId} AND spend_cents IS NOT NULL
          AND at >= (date_trunc('day', now() AT TIME ZONE 'America/Denver')
            AT TIME ZONE 'America/Denver')`;
      return Number(rows[0]?.cents || 0);
    },
    async recordChange(entry) {
      if (!entry || !entry.account || !entry.tool || !entry.summary ||
        typeof entry.dryRun !== 'boolean' || typeof entry.production !== 'boolean') {
        throw new TypeError('A complete safe audit record is required');
      }
      // Audit is a permanent record: secrets must never be recorded even if
      // a caller accidentally fails to redact a provider response.
      const fields = [entry.before, entry.after, entry.result, entry.inverse, entry.targets];
      function assertNoCredentials(value) {
        if (value === undefined || value === null) return;
        if (Array.isArray(value)) { for (const item of value) assertNoCredentials(item); return; }
        if (typeof value === 'object') {
          for (const [key, item] of Object.entries(value)) {
            if (/(token|secret|password|credential|auth.?code|private.?key|decrypted.?value)/i.test(key)) {
              throw new TypeError('Audit data contains a sensitive field');
            }
            assertNoCredentials(item);
          }
          return;
        }
        if (typeof value === 'string' &&
          /(?:rtc_pass_|vcp_|github_pat_|ghp_|whsec_|sk_live_)[A-Za-z0-9_-]{8,}/.test(value)) {
          throw new TypeError('Audit data contains a sensitive credential');
        }
      }
      for (const field of [...fields, entry.summary, entry.moneyLine, entry.delegation]) assertNoCredentials(field);
      // AUD-A2 (design D-A, OP-2): an owner-word purchase carries a delegation
      // block { basis:'owner_word', budgetCents, quotedCents, overBudget }.
      // It is persisted in this row's result JSONB under the field name
      // `delegation` — the field the AUD-A2 acceptance tests and the S7 probe
      // read back. Malformed blocks are refused, never silently dropped.
      let delegation = null;
      if (entry.delegation !== undefined && entry.delegation !== null) {
        const d = entry.delegation;
        if (!d || typeof d !== 'object' || Array.isArray(d) || d.basis !== 'owner_word' ||
          !(d.budgetCents === null || (Number.isSafeInteger(d.budgetCents) && d.budgetCents >= 0)) ||
          !(d.quotedCents === null || (Number.isSafeInteger(d.quotedCents) && d.quotedCents >= 0)) ||
          typeof d.overBudget !== 'boolean') {
          throw new TypeError('Invalid purchase delegation block');
        }
        delegation = { basis: 'owner_word', budgetCents: d.budgetCents,
          quotedCents: d.quotedCents, overBudget: d.overBudget };
      }
      const before = JSON.stringify({ snapshot: entry.before ?? null, targets: entry.targets ?? [] });
      const after = JSON.stringify(entry.after ?? null);
      const result = JSON.stringify(delegation ?
        { ...(entry.result && typeof entry.result === 'object' && !Array.isArray(entry.result) ?
            entry.result : {}), delegation } :
        (entry.result ?? null));
      const inverse = JSON.stringify(entry.inverse ?? null);
      const summary = String(entry.summary) + (entry.moneyLine ? ' | ' + String(entry.moneyLine) : '');
      if (Buffer.byteLength(before + after + result + inverse + summary) > 8192) {
        throw new TypeError('Audit record exceeds safe 8 KB limit');
      }
      const cents=entry.spendCents;
      if(cents!==undefined && cents!==null &&
        (!Number.isSafeInteger(cents)||cents<0))
        throw new TypeError('Spend audit must be nonnegative integer cents');
      const run = getSql();
      const rows = await run`INSERT INTO change_log
        (vercel_account, mode, tool, summary, before, after, dry_run,
          production, request_key, result, inverse, spend_cents)
        VALUES (${entry.account}, ${entry.mode || 'preview'}, ${entry.tool}, ${summary},
          ${before}::jsonb, ${after}::jsonb, ${entry.dryRun},
          ${entry.production}, ${entry.requestKey || null},
          ${result}::jsonb, ${inverse}::jsonb, ${entry.dryRun?null:(cents??null)})
        RETURNING id`;
      return rows[0].id;
    },
    async setProductionEnabled(accountId, enabled) {
      if (typeof accountId !== 'string' || !accountId || typeof enabled !== 'boolean') {
        throw new TypeError('Invalid production setting');
      }
      const run = getSql();
      const rows = await run`UPDATE vercel_accounts SET production_enabled = ${enabled}
        WHERE id = ${accountId} RETURNING id`;
      return rows.length === 1;
    },

    /**
     * AUD-B (design D-B, ruling IN-09): the per-team production-enable
     * strictness — 'word' (default: enable completes on the owner's
     * confirmed word) or 'passphrase' (the owner chose the two-step setup
     * ceremony for this team). Returns null when the account does not
     * exist; a missing/unknown stored value reads back as 'word', the
     * ruled default.
     */
    async getProductionEnableStrictness(id) {
      if (typeof id !== 'string' || !/^[a-zA-Z0-9_/-]{3,256}$/.test(id)) {
        throw new TypeError('Invalid Vercel account');
      }
      const run = getSql();
      const rows = await run`SELECT production_enable_strictness
        FROM vercel_accounts WHERE id = ${id}`;
      if (rows.length !== 1) return null;
      return rows[0].production_enable_strictness === 'passphrase' ?
        'passphrase' : 'word';
    },

    /**
     * Owner-proofed callers only — an owner-applied approval envelope
     * (AUD-AT); never settable by a tool's own call
     * (AUD-B's intent, preserved by the envelope). Atomic account-scoped update and audit,
     * with the same read-back verification pattern as setPurchasePolicy.
     * The change_log row is recorded under vercel_enable_production and
     * its summary names the new strictness (packet AUD-B build contract).
     */
    async setProductionEnableStrictness(id, strictness) {
      if (typeof id !== 'string' || !/^[a-zA-Z0-9_/-]{3,256}$/.test(id) ||
        !['word', 'passphrase'].includes(strictness)) {
        throw new TypeError('Invalid account or production enable strictness');
      }
      const summary = 'Owner set the production enable strictness to ' +
        strictness + ' for this team';
      const run = getSql();
      const rows = await run`WITH changed AS (
          UPDATE vercel_accounts
          SET production_enable_strictness = ${strictness}
          WHERE id = ${id}
          RETURNING id
        ), audit AS (
          INSERT INTO change_log
            (vercel_account, mode, tool, summary, dry_run, production, after)
          SELECT ${id}, 'production', 'vercel_enable_production',
            ${summary}, FALSE, TRUE,
            jsonb_build_object('strictness', ${strictness}::text)
          FROM changed RETURNING id
        )
        SELECT (SELECT COUNT(*) FROM changed) AS changed_count,
          (SELECT COUNT(*) FROM audit) AS audit_count`;
      if (Number(rows[0]?.changed_count) !== 1 || Number(rows[0]?.audit_count) !== 1) {
        return false;
      }
      const verified = await this.getProductionEnableStrictness(id);
      return verified === strictness;
    },
    async revokeProductionTokens(accountId) {
      if (typeof accountId !== 'string' || !accountId) throw new TypeError('Invalid account');
      const run = getSql();
      const rows = await run`UPDATE oauth_tokens SET revoked_at = now()
        WHERE vercel_account = ${accountId} AND mode = 'production'
          AND revoked_at IS NULL RETURNING token_hash`;
      return rows.length;
    },
    async listProtectedResources(account) {
      if (typeof account !== 'string' || !account) throw new TypeError('Account required');
      const run = getSql();
      return run`SELECT kind, match, note, source FROM protected_resources
        WHERE vercel_account IS NULL OR vercel_account = ${account}
        ORDER BY kind, match`;
    },
    async addProtectedResource({ account, kind = 'project', match, note = 'Owner protected' }) {
      if (typeof account !== 'string' || !account || kind !== 'project' ||
        typeof match !== 'string' || !/^[a-z0-9][a-z0-9-]{1,100}$/.test(match) ||
        typeof note !== 'string' || note.length > 120) {
        throw new TypeError('Invalid protected resource');
      }
      const run = getSql();
      await run`INSERT INTO protected_resources (vercel_account, kind, match, note, source)
        VALUES (${account}, ${kind}, ${match}, ${note}, 'setup_page')
        ON CONFLICT DO NOTHING`;
    },
    // IN-07: independently signed-in owner can retire the old global defaults
    // and account-specific project rules. Never delete token or other rules.
    // Mutation and immutable audit are one database statement.
    async clearProtectedProjectRules(account) {
      if(typeof account!=='string'||!account) throw new TypeError('Account required');
      const run=getSql();
      const existing=await run`SELECT id FROM vercel_accounts WHERE id=${account}`;
      if(existing.length!==1) return false;
      const rows=await run`
        WITH removed AS (
          DELETE FROM protected_resources
            WHERE kind='project' AND (vercel_account IS NULL OR vercel_account=${account})
            RETURNING id
        ), audited AS (
          INSERT INTO change_log (vercel_account,mode,tool,summary,dry_run,production)
          SELECT ${account},'preview','vercel_clear_project_protections',
            'Owner cleared the project exclusion list',FALSE,FALSE
          WHERE EXISTS (SELECT 1 FROM removed) RETURNING id
        )
        SELECT (SELECT COUNT(*) FROM removed)::integer AS removed,
               (SELECT COUNT(*) FROM audited)::integer AS audited`;
      if(rows.length!==1||rows[0].audited!==(rows[0].removed>0?1:0))return false;
      const after=await this.listProtectedResources(account);
      return Array.isArray(after)&&after.every(x=>x.kind!=='project');
    },
    async createOAuthClient({ clientId, clientSecret, redirectUris, clientName,
      tokenEndpointAuthMethod = 'client_secret_post' }) {
      if (!clientId || !Array.isArray(redirectUris) || !redirectUris.length ||
        !['client_secret_post','none'].includes(tokenEndpointAuthMethod) ||
        (tokenEndpointAuthMethod === 'none' ? clientSecret !== null :
          typeof clientSecret !== 'string' || clientSecret.length < 1)) {
        throw new TypeError('Missing OAuth client registration fields');
      }
      const run = getSql();
      const data = JSON.stringify({
        client_secret_hash: tokenEndpointAuthMethod === 'none' ? null : hashToken(clientSecret),
        token_endpoint_auth_method: tokenEndpointAuthMethod,
        redirect_uris: redirectUris,
        client_name: clientName || null
      });
      await run`INSERT INTO oauth_clients (client_id, data) VALUES (${clientId}, ${data}::jsonb)`;
    },
    async getOAuthClient(clientId) {
      const run = getSql();
      const rows = await run`SELECT client_id, data FROM oauth_clients WHERE client_id = ${clientId}`;
      return rows[0] ? { client_id: rows[0].client_id, ...rows[0].data } : null;
    },
    async createAuthCode({
      code, clientId, redirectUri, codeChallenge, codeChallengeMethod = 'S256',
      vercelAccount = null, mode = 'preview', profile = 'everyday', listing = 'front_door', ttlSeconds = 600
    }) {
      const run = getSql();
      const data = JSON.stringify({
        redirect_uri: redirectUri,
        code_challenge: codeChallenge,
        code_challenge_method: codeChallengeMethod
      });
      const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
      await run`INSERT INTO oauth_codes
        (code, client_id, data, vercel_account, mode, profile, listing, expires_at)
        VALUES (${hashToken(code)}, ${clientId}, ${data}::jsonb, ${vercelAccount},
          ${mode}, ${profile}, ${listing}, ${expiresAt})`;
    },
    async consumeAuthCode(code) {
      if (typeof code !== 'string' || !code) return null;
      const run = getSql();
      const rows = await run`DELETE FROM oauth_codes WHERE code = ${hashToken(code)}
        AND expires_at > now()
        RETURNING client_id, data, vercel_account, mode, profile, listing`;
      const row = rows[0];
      return row ? { client_id: row.client_id, ...row.data, ...connectionSettings(row) } : null;
    },
    async createAccessToken({
      accessToken, refreshToken, clientId, vercelAccount = null,
      mode = 'preview', profile = 'everyday', listing = 'front_door', ttlSeconds = 3600
    }) {
      const run = getSql();
      const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
      await run`INSERT INTO oauth_tokens
        (token_hash, refresh_hash, client_id, vercel_account, mode, profile, listing, expires_at)
        VALUES (${hashToken(accessToken)}, ${refreshToken ? hashToken(refreshToken) : null},
          ${clientId}, ${vercelAccount}, ${mode}, ${profile}, ${listing}, ${expiresAt})`;
    },
    async getAccessToken(accessToken) {
      if (typeof accessToken !== 'string' || !accessToken) return null;
      const run = getSql();
      const rows = await run`SELECT client_id, vercel_account, mode, profile, listing, kind,
        read_only,
        'conn_' || LEFT(md5(token_hash), 20) AS connection_id,
        expires_at, revoked_at FROM oauth_tokens WHERE token_hash = ${hashToken(accessToken)}
        AND expires_at > now() AND revoked_at IS NULL AND kind = 'connector'`;
      return rows[0] || null;
    },
    async getTokenByRefreshToken(refreshToken) {
      if (typeof refreshToken !== 'string' || !refreshToken) return null;
      const run = getSql();
      const rows = await run`SELECT client_id, vercel_account, mode, profile, listing
        FROM oauth_tokens WHERE refresh_hash = ${hashToken(refreshToken)}
        AND revoked_at IS NULL AND kind = 'connector'`;
      return rows[0] || null;
    },
    async rotateRefreshToken({
      refreshToken, clientId, accessToken, newRefreshToken, ttlSeconds = 3600
    }) {
      const run = getSql();
      const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
      const rows = await run`UPDATE oauth_tokens SET
        token_hash = ${hashToken(accessToken)}, refresh_hash = ${hashToken(newRefreshToken)},
        expires_at = ${expiresAt}, last_used_at = NULL
        WHERE refresh_hash = ${hashToken(refreshToken)} AND client_id = ${clientId}
          AND revoked_at IS NULL AND kind = 'connector'
        RETURNING client_id, vercel_account, mode, profile, listing`;
      return rows[0] || null;
    },
    // Client disconnect must never revoke another caller or an RTC pass.
    async revokeOAuthToken({token,clientId}) {
      if(typeof token!=='string'||!token||typeof clientId!=='string'||!clientId)
        throw new TypeError('Token and authenticated OAuth client required');
      const run=getSql();
      const rows=await run`UPDATE oauth_tokens SET revoked_at=now()
        WHERE client_id=${clientId} AND kind='connector' AND revoked_at IS NULL
          AND (token_hash=${hashToken(token)} OR refresh_hash=${hashToken(token)})
        RETURNING token_hash`;
      return rows.length>0;
    },
    async revokeAccessToken(accessToken) {
      if (typeof accessToken !== 'string' || !accessToken) return false;
      const run = getSql();
      const rows = await run`UPDATE oauth_tokens SET revoked_at = now()
        WHERE token_hash = ${hashToken(accessToken)} AND revoked_at IS NULL
        RETURNING token_hash`;
      return rows.length > 0;
    },
    async recordLoginAttempt(ip) {
      const run = getSql();
      const rows = await run`INSERT INTO login_attempts (ip, success) VALUES (${ip}, FALSE) RETURNING id`;
      return rows[0].id;
    },
    async markLoginAttemptSucceeded(id) {
      const run = getSql();
      await run`UPDATE login_attempts SET success = TRUE WHERE id = ${id}`;
    },
    async countRecentFailedLogins(ip, minutes = 15) {
      const run = getSql();
      const rows = await run`SELECT count(*)::integer AS count FROM login_attempts
        WHERE ip = ${ip} AND success = FALSE
          AND attempted_at > now() - ${minutes} * interval '1 minute'`;
      return rows[0].count;
    },
    // Atomic, cross-instance reservation: a timed-out write stays pending, not blindly retried.

    // V-1: all run and object access is bound to the stored Vercel account.
    // An id is never evidence of ownership; SQL checks the actual owner.
    async createDevRun({id,account,connection,description='',requestKey=null}) {
      if(!/^run_[0-9]{8}_[a-z0-9]{6,24}$/.test(id)||
         typeof account!=='string'||!account||
         typeof connection!=='string'||!connection||
         typeof description!=='string'||description.length>240||
         requestKey!==null&&(typeof requestKey!=='string'||!/^[a-zA-Z0-9_-]{8,128}$/.test(requestKey)))
        throw new TypeError('Invalid development run intent');
      const run=getSql();
      const inserted=await run`INSERT INTO dev_runs
        (id,vercel_account,connection,description,request_key)
        VALUES (${id},${account},${connection},${description},${requestKey})
        ON CONFLICT (id) DO NOTHING RETURNING id`;
      const rows=await run`SELECT id,vercel_account,connection,description,request_key,status,created_at
        FROM dev_runs WHERE id=${id} AND vercel_account=${account}
        AND connection=${connection}`;
      if(rows.length!==1||rows[0].status!=='active'||
         rows[0].description!==description||rows[0].request_key!==requestKey)
        throw new TypeError('Development run id belongs to another owner or has changed');
      return {created:inserted.length===1,id:rows[0].id};
    },
    async getDevRunByRequestKey({account,requestKey}) {
      if(typeof account!=='string'||!account||
         typeof requestKey!=='string'||!/^[a-zA-Z0-9_-]{8,128}$/.test(requestKey))
        throw new TypeError('Invalid development request identity');
      const run=getSql();
      const rows=await run`SELECT id,status,description FROM dev_runs
        WHERE vercel_account=${account} AND request_key=${requestKey}`;
      return rows.length===1?rows[0]:null;
    },
    async getDevRun({id,account}) {
      if(typeof id!=='string'||typeof account!=='string')throw new TypeError('Invalid run lookup');
      const run=getSql();
      const rows=await run`SELECT id,vercel_account,connection,description,status,created_at,cleaned_at
        FROM dev_runs WHERE id=${id} AND vercel_account=${account}`;
      return rows.length===1?rows[0]:null;
    },
    async listDevRuns({account,limit=20}) {
      if(typeof account!=='string'||!account||!Number.isInteger(limit)||limit<1||limit>50)
        throw new TypeError('Invalid development run listing');
      const run=getSql();
      return run`SELECT id,description,status,created_at,cleaned_at
        FROM dev_runs WHERE vercel_account=${account}
        ORDER BY created_at DESC,id DESC LIMIT ${limit}`;
    },
    // V-4: atomic account/day estimated usage accounting for owner visibility.
    // Never use developer-era sandbox_minutes_per_day as an end-user quota.
    // The provider's session ceiling and a user's own delegated policy govern usage.
    // An uncertain provider POST remains recorded, not silently refunded.
    async recordDevSandboxMinutes({account,minutes,day}) {
      if(typeof account!=='string'||!account||
        !Number.isSafeInteger(minutes)||minutes<1||minutes>1440||
        typeof day!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(day))
        throw new TypeError('Invalid Sandbox session usage record');
      const run=getSql();
      const rows=await run`INSERT INTO dev_sandbox_usage
        (vercel_account,day,minutes)
        SELECT a.id,${day}::date,${minutes}
        FROM vercel_accounts a WHERE a.id=${account}
        ON CONFLICT (vercel_account,day) DO UPDATE
          SET minutes=dev_sandbox_usage.minutes + EXCLUDED.minutes
        RETURNING minutes`;
      return rows.length===1?{recorded:true,used:rows[0].minutes}:{recorded:false};
    },
    async listDevRunObjects({account,id}) {
      if(typeof account!=='string'||!account||typeof id!=='string')
        throw new TypeError('Invalid development object lookup');
      const run=getSql();
      return run`SELECT o.object_type,o.object_id,o.project_id,o.detail,
        o.created_at,o.status,o.last_error,o.cleaned_at
        FROM dev_run_objects o JOIN dev_runs r ON r.id=o.run_id
        WHERE r.vercel_account=${account} AND r.id=${id}
        ORDER BY o.created_at DESC,o.object_type DESC,o.object_id DESC LIMIT 100`;
    },
    async addDevRunObject({account,id,type,objectId,projectId=null,detail={}}) {
      const kinds=['intent','project','deployment','alias','env','bypass','sandbox','webhook'];
      if(typeof account!=='string'||typeof id!=='string'||!kinds.includes(type)||
         typeof objectId!=='string'||objectId.length<3||objectId.length>180||
         projectId!==null&&(typeof projectId!=='string'||projectId.length>128)||
         !detail||typeof detail!=='object'||Array.isArray(detail)||
         Buffer.byteLength(JSON.stringify(detail))>2000)
        throw new TypeError('Invalid precise development resource');
      const run=getSql();
      const rows=await run`INSERT INTO dev_run_objects
        (run_id,object_type,object_id,project_id,detail)
        SELECT r.id,${type},${objectId},${projectId},${JSON.stringify(detail)}::jsonb
        FROM dev_runs r WHERE r.id=${id} AND r.vercel_account=${account}
        AND r.status='active'
        ON CONFLICT (run_id,object_type,object_id) DO NOTHING RETURNING object_id`;
      if(rows.length!==1)throw new TypeError('Object was already tracked or the run is not active');
      return true;
    },
    async setDevRunObjectOutcome({account,id,type,objectId,status,error=null}) {
      if(!['cleaned','blocked','uncertain'].includes(status)||
         error!==null&&(typeof error!=='string'||error.length>160))
        throw new TypeError('Invalid cleanup outcome');
      const run=getSql();
      const rows=await run`UPDATE dev_run_objects AS o SET
        status=${status},last_error=${error},
        detail=CASE WHEN o.object_type='webhook' AND ${status}='cleaned'
          THEN '{}'::jsonb ELSE o.detail END,
        cleaned_at=CASE WHEN ${status}='cleaned' THEN now() ELSE NULL END
        FROM dev_runs AS r
        WHERE r.id=o.run_id AND r.id=${id} AND r.vercel_account=${account}
        AND o.object_type=${type} AND o.object_id=${objectId}
        AND o.status<>'cleaned' RETURNING o.object_id`;
      return rows.length===1;
    },
    async completeDevRunCleanup({account,id}) {
      const run=getSql();
      const rows=await run`UPDATE dev_runs AS r SET status='cleaned',cleaned_at=now()
        WHERE r.id=${id} AND r.vercel_account=${account} AND r.status='active'
        AND NOT EXISTS (SELECT 1 FROM dev_run_objects o
          WHERE o.run_id=r.id AND o.status<>'cleaned')
        RETURNING r.id`;
      return rows.length===1;
    },
    requestReplayStore() {
      return {
        async claim({ key, account, mode, tool, ttlMs = 600000 }) {
          if (typeof key !== 'string' || !/^[a-zA-Z0-9_-]{8,160}$/.test(key)) {
            throw new TypeError('Invalid write replay key');
          }
          if (!account || !tool || !Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > 600000) {
            throw new TypeError('Invalid write replay scope or lifetime');
          }
          const run = getSql();
          const claimId = randomUUID();
          const expiresAt = new Date(Date.now() + ttlMs);
          // A unique constraint serializes racing callers, even on separate serverless instances.
          const rows = await run`INSERT INTO request_replay
            (request_key, vercel_account, mode, tool, claim_id, expires_at, status)
            VALUES (${key}, ${account}, ${mode}, ${tool}, ${claimId}, ${expiresAt}, 'pending')
            ON CONFLICT (request_key) DO UPDATE SET
              claim_id = EXCLUDED.claim_id, expires_at = EXCLUDED.expires_at,
              vercel_account = EXCLUDED.vercel_account, mode = EXCLUDED.mode,
              tool = EXCLUDED.tool, status = 'pending', result = NULL
            WHERE request_replay.expires_at <= now()
            RETURNING claim_id`;
          if (rows.length) return { state: 'claimed', claimId };
          const existing = await run`SELECT status, result FROM request_replay
            WHERE request_key = ${key} AND expires_at > now()`;
          if (existing[0]?.status === 'completed') return { state: 'completed', result: existing[0].result };
          return { state: 'pending' };
        },
        async release({ key, claimId }) {
          if (typeof key !== 'string' || !/^[a-zA-Z0-9_-]{8,160}$/.test(key) ||
            typeof claimId !== 'string' || !claimId)
            throw new TypeError('A verified replay claimant is required');
          const run = getSql();
          const rows = await run`DELETE FROM request_replay
            WHERE request_key = ${key} AND claim_id = ${claimId} AND status = 'pending'
            RETURNING request_key`;
          if (rows.length !== 1) throw new Error('Replay claim ownership changed; verify before retry');
        },
        async complete({ key, claimId, result }) {
          if (!claimId || result === undefined) throw new TypeError('Missing replay claim or shaped result');
          const serialized = JSON.stringify(result);
          if (!serialized || Buffer.byteLength(serialized) > 8192) {
            throw new TypeError('Replay result exceeds the safe storage limit');
          }
          const run = getSql();
          const rows = await run`UPDATE request_replay SET
            status = 'completed', result = ${serialized}::jsonb
            WHERE request_key = ${key} AND claim_id = ${claimId} AND status = 'pending'
            RETURNING request_key`;
          if (!rows.length) throw new Error('The replay claim expired or was replaced; verify the write before retry');
        }
      };
    },
    async putResult({account,owner,body,summary='',ttlMs=86400000}) {
      if (typeof account!=='string' || !/^[a-zA-Z0-9_/-]{3,256}$/.test(account) ||
        typeof owner!=='string' || !/^resown_[a-f0-9]{64}$/.test(owner) ||
        typeof summary!=='string' || summary.length>160 ||
        !Number.isSafeInteger(ttlMs) || ttlMs<1000 || ttlMs>86400000)
        throw new TypeError('Invalid result scope or lifetime');
      const safe=compact(body,1048576);
      const data=JSON.stringify(safe);
      const handle='res_'+randomUUID().replace(/-/g,'');
      const expiresAt=new Date(Date.now()+ttlMs);
      const run=getSql();
      await run`INSERT INTO result_store(handle,connection,vercel_account,expires_at,summary,body)
        VALUES(${handle},${owner},${account},${expiresAt},${summary},${data}::jsonb)`;
      return {handle,expiresAt:expiresAt.toISOString()};
    },
    async getResult({account,owner,handle}) {
      if (typeof account!=='string' || !/^[a-zA-Z0-9_/-]{3,256}$/.test(account) ||
        typeof owner!=='string' || !/^resown_[a-f0-9]{64}$/.test(owner) ||
        typeof handle!=='string' || !/^res_[a-f0-9]{32}$/.test(handle)) return null;
      const run=getSql();
      await run`WITH expired AS (SELECT handle FROM result_store WHERE expires_at<=now()
        ORDER BY expires_at LIMIT 100) DELETE FROM result_store
        USING expired WHERE result_store.handle=expired.handle`;
      const rows=await run`SELECT handle,summary,body,expires_at FROM result_store
        WHERE handle=${handle} AND vercel_account=${account} AND connection=${owner}
        AND expires_at>now() LIMIT 1`;
      return rows[0]||null;
    },
    // The public health check's only store question: can the server's
    // store answer at all? One constant read — no schema setup, no table
    // dependency, no row data leaves this method, only the boolean.
    async storeReachable() {
      try {
        const run = getSql();
        const rows = await run`SELECT 1 AS one`;
        return Array.isArray(rows) && rows.length > 0;
      } catch { return false; }
    },
    // AUD-AO: the retention sweep. One bounded batch per store per run,
    // in the result store's CTE shape. The 400-day clocks purge the
    // journal and the purchase ledger by age; the 180-day clock purges
    // only authorizations that were never exercised — for codes,
    // one-time secrets and pending inputs, consumption deletes the
    // row, so a surviving row past its lapse is unused by construction;
    // for purchase intents, "unused" is still-pending; for RTC passes
    // it is window_count = 0 (authorizeRtcPass debits the window on
    // first use and it never returns to 0) and never revoked. Exercised
    // intents and passes, and every oauth_tokens row (no durable use
    // marker exists and refresh rows are live credentials), are NOT
    // swept here — see the AUD-AO dossier for the per-store reasons.
    // A sweep that purges anything journals exactly one change_log row
    // with counts only, never contents (the AUD-AA precedent); the row
    // carries no account, so it appears in no account's audit list.
    async sweepRetention({ batch = 1000 } = {}) {
      if (!Number.isInteger(batch) || batch < 1 || batch > 10000) {
        throw new TypeError('Invalid retention sweep batch');
      }
      const run = getSql();
      const counts = {
        changeLog: 0, purchaseIntents: 0, purchaseIntentsUnused: 0,
        oauthCodes: 0, oneTimeSecrets: 0, pendingInputs: 0, rtcPassesUnused: 0
      };
      const purged = async (rows) => rows.length;
      counts.changeLog = await purged(await run`WITH aged AS (
          SELECT id FROM change_log
          WHERE at < now() - interval '400 days' ORDER BY at LIMIT ${batch})
        DELETE FROM change_log USING aged WHERE change_log.id = aged.id
        RETURNING change_log.id`);
      counts.purchaseIntentsUnused = await purged(await run`WITH aged AS (
          SELECT id FROM purchase_intents
          WHERE status = 'pending' AND approved_at IS NULL
            AND consumed_at IS NULL
            AND expires_at < now() - interval '180 days'
          ORDER BY created_at LIMIT ${batch})
        DELETE FROM purchase_intents USING aged
        WHERE purchase_intents.id = aged.id RETURNING purchase_intents.id`);
      counts.purchaseIntents = await purged(await run`WITH aged AS (
          SELECT id FROM purchase_intents
          WHERE created_at < now() - interval '400 days'
          ORDER BY created_at LIMIT ${batch})
        DELETE FROM purchase_intents USING aged
        WHERE purchase_intents.id = aged.id RETURNING purchase_intents.id`);
      counts.oauthCodes = await purged(await run`WITH aged AS (
          SELECT code FROM oauth_codes
          WHERE expires_at < now() - interval '180 days'
          ORDER BY expires_at LIMIT ${batch})
        DELETE FROM oauth_codes USING aged WHERE oauth_codes.code = aged.code
        RETURNING oauth_codes.code`);
      counts.oneTimeSecrets = await purged(await run`WITH aged AS (
          SELECT id FROM one_time_secrets
          WHERE expires_at < now() - interval '180 days'
          ORDER BY expires_at LIMIT ${batch})
        DELETE FROM one_time_secrets USING aged
        WHERE one_time_secrets.id = aged.id RETURNING one_time_secrets.id`);
      counts.pendingInputs = await purged(await run`WITH aged AS (
          SELECT id FROM pending_inputs
          WHERE expires_at < now() - interval '180 days'
          ORDER BY expires_at LIMIT ${batch})
        DELETE FROM pending_inputs USING aged
        WHERE pending_inputs.id = aged.id RETURNING pending_inputs.id`);
      counts.rtcPassesUnused = await purged(await run`WITH aged AS (
          SELECT pass_id FROM rtc_passes
          WHERE window_count = 0 AND revoked_at IS NULL
            AND expires_at < now() - interval '180 days'
          ORDER BY expires_at LIMIT ${batch})
        DELETE FROM rtc_passes USING aged WHERE rtc_passes.pass_id = aged.pass_id
        RETURNING rtc_passes.pass_id`);
      const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
      if (total > 0) {
        await run`INSERT INTO change_log
            (vercel_account, mode, tool, summary, dry_run, production, after)
          VALUES (NULL, 'production', 'vercel_retention_sweep',
            ${'Retention sweep purged ' + total + ' aged record(s) under the ' +
              '400-day journal/ledger and 180-day unused-authorization clocks ' +
              '(counts only; contents never recorded)'},
            FALSE, TRUE, ${JSON.stringify(counts)}::jsonb)`;
      }
      return { ...counts, total, journaled: total > 0 };
    },
    async initSchema() {
      const run = getSql();
      await run`CREATE TABLE IF NOT EXISTS vercel_accounts (
        id TEXT PRIMARY KEY, team_id TEXT NOT NULL, team_slug TEXT NOT NULL, label TEXT NOT NULL,
        scope TEXT NOT NULL, project_id TEXT, project_name TEXT, token_enc TEXT NOT NULL, token_last4 TEXT NOT NULL,
        token_expires_at TIMESTAMPTZ, token_checked_at TIMESTAMPTZ, token_probe JSONB,
        token_no_expiry BOOLEAN NOT NULL DEFAULT FALSE, token_version TEXT,
        production_enabled BOOLEAN NOT NULL DEFAULT FALSE, spend_limit_cents INTEGER NOT NULL DEFAULT 0,
        purchase_budget_cents INTEGER, purchase_grant_required BOOLEAN NOT NULL DEFAULT FALSE,
        production_enable_strictness TEXT NOT NULL DEFAULT 'word',
        sandbox_minutes_per_day INTEGER, is_default BOOLEAN NOT NULL DEFAULT FALSE,
        added_at TIMESTAMPTZ NOT NULL DEFAULT now())`;
      // AUD-E (D-E/IN-04): the owner's no-expiry attestation on existing tables.
      await run`ALTER TABLE vercel_accounts ADD COLUMN IF NOT EXISTS
        token_no_expiry BOOLEAN NOT NULL DEFAULT FALSE`;
      await run`ALTER TABLE vercel_accounts ADD COLUMN IF NOT EXISTS
        token_version TEXT`;
      // Backfill a non-secret version for tokens enrolled before AUD-E;
      // inert once every row carries one (enrollment mints its own).
      await run`UPDATE vercel_accounts SET token_version = gen_random_uuid()::text
        WHERE token_version IS NULL`;
      // AUD-A1 (D-A/OP-2): standing purchase policy on existing tables.
      await run`ALTER TABLE vercel_accounts ADD COLUMN IF NOT EXISTS purchase_budget_cents INTEGER`;
      await run`ALTER TABLE vercel_accounts ADD COLUMN IF NOT EXISTS
        purchase_grant_required BOOLEAN NOT NULL DEFAULT FALSE`;
      // AUD-B (D-B/IN-09): per-team production enable strictness.
      await run`ALTER TABLE vercel_accounts ADD COLUMN IF NOT EXISTS
        production_enable_strictness TEXT NOT NULL DEFAULT 'word'`;
      await run`CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`;
      // One-time carry of an existing positive owner spend limit into the
      // new optional agent budget, gated on a durable marker row.
      // initSchema() runs on requests, so an unguarded IS NULL update would
      // resurrect a budget the owner later cleared back to NULL. The marker
      // insert and the carry are one statement — they commit together or
      // not at all — and once the marker exists this is inert.
      await run`WITH marker AS (
          INSERT INTO schema_migrations (name)
          VALUES ('aud_a1_purchase_policy_carry_v1')
          ON CONFLICT (name) DO NOTHING RETURNING name
        ), carried AS (
          UPDATE vercel_accounts SET purchase_budget_cents = spend_limit_cents
          WHERE spend_limit_cents > 0 AND EXISTS (SELECT 1 FROM marker)
          RETURNING id
        ) SELECT (SELECT COUNT(*) FROM marker) AS marker_count,
          (SELECT COUNT(*) FROM carried) AS carried_count`;
      await run`CREATE TABLE IF NOT EXISTS oauth_clients (
        client_id TEXT PRIMARY KEY, data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`;
      await run`CREATE TABLE IF NOT EXISTS oauth_codes (
        code TEXT PRIMARY KEY, client_id TEXT NOT NULL, data JSONB NOT NULL, vercel_account TEXT,
        mode TEXT NOT NULL DEFAULT 'preview', profile TEXT NOT NULL DEFAULT 'everyday',
        listing TEXT NOT NULL DEFAULT 'front_door', expires_at TIMESTAMPTZ NOT NULL)`;
      await run`CREATE TABLE IF NOT EXISTS oauth_tokens (
        token_hash TEXT PRIMARY KEY, client_id TEXT, refresh_hash TEXT, vercel_account TEXT,
        mode TEXT NOT NULL DEFAULT 'preview', profile TEXT NOT NULL DEFAULT 'everyday',
        listing TEXT NOT NULL DEFAULT 'front_door', kind TEXT NOT NULL DEFAULT 'connector',
        expires_at TIMESTAMPTZ, last_used_at TIMESTAMPTZ, revoked_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now())`;
      // AUD-C (OP-1/D-C): new issuances default to the front_door listing.
      // Align the column defaults on tables created before this change;
      // stored rows keep the listing they were issued with — never rewritten.
      await run`ALTER TABLE oauth_codes ALTER COLUMN listing SET DEFAULT 'front_door'`;
      await run`ALTER TABLE oauth_tokens ALTER COLUMN listing SET DEFAULT 'front_door'`;
      // AUD-AQ: the read-only end-user switch — a per-connection flag on
      // oauth_tokens, born off, flipped only by the connection's own user
      // (vercel_set_read_only). Additive; existing rows read as off and no
      // stored row is rewritten.
      await run`ALTER TABLE oauth_tokens ADD COLUMN IF NOT EXISTS read_only
        BOOLEAN NOT NULL DEFAULT FALSE`;
      await run`CREATE TABLE IF NOT EXISTS rtc_passes (
        pass_id TEXT PRIMARY KEY,token_hash TEXT NOT NULL UNIQUE,
        vercel_account TEXT NOT NULL,profile TEXT NOT NULL DEFAULT 'read_only',
        mode TEXT NOT NULL DEFAULT 'preview',listing TEXT NOT NULL DEFAULT 'compact',
        areas JSONB NOT NULL,expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),revoked_at TIMESTAMPTZ,
        window_started TIMESTAMPTZ NOT NULL DEFAULT now(),
        window_count INTEGER NOT NULL DEFAULT 0,
        rate_limit_per_minute INTEGER NOT NULL DEFAULT 120 CHECK(rate_limit_per_minute BETWEEN 1 AND 600))`;
      // Existing grants had an implicit 60/minute cap. Never widen an issued pass
      // just because the new selectable default is 120.
      await run`ALTER TABLE rtc_passes ADD COLUMN IF NOT EXISTS rate_limit_per_minute
        INTEGER CHECK(rate_limit_per_minute BETWEEN 1 AND 600)`;
      await run`UPDATE rtc_passes SET rate_limit_per_minute=60
        WHERE rate_limit_per_minute IS NULL`;
      await run`ALTER TABLE rtc_passes ALTER COLUMN rate_limit_per_minute SET DEFAULT 120`;
      await run`ALTER TABLE rtc_passes ALTER COLUMN rate_limit_per_minute SET NOT NULL`;
      await run`CREATE INDEX IF NOT EXISTS rtc_passes_owner
        ON rtc_passes(vercel_account,created_at DESC)`;
      // R-1W (BATCH-R amendment, 2026-10-30): write-capable passes live in the
      // same table. The defaults keep every existing row exactly today's
      // read-only pass: no writes, no spend delegation, no project restriction.
      await run`ALTER TABLE rtc_passes ADD COLUMN IF NOT EXISTS allow_writes
        BOOLEAN NOT NULL DEFAULT FALSE`;
      await run`ALTER TABLE rtc_passes ADD COLUMN IF NOT EXISTS spend_limit_cents
        INTEGER NOT NULL DEFAULT 0`;
      await run`ALTER TABLE rtc_passes ADD COLUMN IF NOT EXISTS project_ids JSONB`;
      await run`CREATE TABLE IF NOT EXISTS login_attempts (
        id BIGSERIAL PRIMARY KEY, ip TEXT NOT NULL, attempted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        success BOOLEAN NOT NULL)`;
      await run`CREATE TABLE IF NOT EXISTS change_log (
        id BIGSERIAL PRIMARY KEY, at TIMESTAMPTZ NOT NULL DEFAULT now(), vercel_account TEXT, mode TEXT,
        connection TEXT, tool TEXT NOT NULL, project_id TEXT, target TEXT, summary TEXT NOT NULL,
        before JSONB, after JSONB, dry_run BOOLEAN NOT NULL DEFAULT FALSE, production BOOLEAN NOT NULL DEFAULT FALSE,
        spend_cents BIGINT, request_key TEXT, result JSONB, inverse JSONB, undone_by BIGINT)`;
      // PostgreSQL routine uses the team row as a serialization lock. Subsequent
      // statements under READ COMMITTED get a fresh snapshot after waiting.
      await run`CREATE OR REPLACE FUNCTION rmcp_owner_revoke_connector(
          p_account TEXT, p_ref TEXT) RETURNS BOOLEAN LANGUAGE plpgsql
        AS $rmcp$
        DECLARE target_hash TEXT; active_count INTEGER;
        BEGIN
          PERFORM 1 FROM vercel_accounts WHERE id = p_account FOR UPDATE;
          IF NOT FOUND THEN RETURN FALSE; END IF;
          SELECT token_hash INTO target_hash FROM oauth_tokens
          WHERE vercel_account = p_account AND kind = 'connector'
            AND revoked_at IS NULL
            AND (expires_at > now() OR refresh_hash IS NOT NULL)
            AND 'conn_' || LEFT(md5(token_hash), 20) = p_ref
          FOR UPDATE;
          IF NOT FOUND THEN RETURN FALSE; END IF;
          SELECT COUNT(*) INTO active_count FROM oauth_tokens
          WHERE vercel_account = p_account AND kind = 'connector'
            AND revoked_at IS NULL
            AND (expires_at > now() OR refresh_hash IS NOT NULL);
          IF active_count < 2 THEN RETURN FALSE; END IF;
          UPDATE oauth_tokens SET revoked_at = now()
          WHERE token_hash = target_hash AND revoked_at IS NULL;
          IF NOT FOUND THEN RETURN FALSE; END IF;
          INSERT INTO change_log (vercel_account, mode, tool, summary, dry_run, production)
          VALUES (p_account, 'production', 'vercel_revoke_connection',
            'Owner revoked one connector for this account', FALSE, TRUE);
          RETURN TRUE;
        END;
        $rmcp$`;
      // AUD-AA: enrolled-account removal. The target row is the
      // serialization lock (the revoke function's precedent); the
      // default guard is re-derived under it because approval-time
      // state, not proposal-time state, is the truth. The two
      // refusals stay distinguishable ('missing' vs 'is_default')
      // so callers can classify them; any later failure raises and
      // rolls the whole removal back — a half-removed account is
      // never committed. Audit history (change_log) and the
      // purchase ledger are deliberately retained.
      await run`CREATE OR REPLACE FUNCTION rmcp_owner_remove_account(
          p_target TEXT) RETURNS TEXT LANGUAGE plpgsql
        AS $rmcp$
        DECLARE
          v_default BOOLEAN;
          v_total INTEGER;
          v_deleted INTEGER;
          v_tokens INTEGER; v_passes INTEGER; v_codes INTEGER;
          v_inputs INTEGER; v_secrets INTEGER; v_protections INTEGER;
          v_blob_conns INTEGER;
        BEGIN
          SELECT is_default INTO v_default FROM vercel_accounts
            WHERE id = p_target FOR UPDATE;
          IF NOT FOUND THEN RETURN 'missing'; END IF;
          SELECT COUNT(*) INTO v_total FROM vercel_accounts;
          IF v_default AND v_total > 1 THEN RETURN 'is_default'; END IF;
          DELETE FROM vercel_accounts WHERE id = p_target;
          GET DIAGNOSTICS v_deleted = ROW_COUNT;
          IF v_deleted <> 1 THEN
            RAISE EXCEPTION 'account removal deleted % rows', v_deleted;
          END IF;
          UPDATE oauth_tokens SET revoked_at = now()
            WHERE vercel_account = p_target AND revoked_at IS NULL;
          GET DIAGNOSTICS v_tokens = ROW_COUNT;
          UPDATE rtc_passes SET revoked_at = now()
            WHERE vercel_account = p_target AND revoked_at IS NULL;
          GET DIAGNOSTICS v_passes = ROW_COUNT;
          DELETE FROM oauth_codes WHERE vercel_account = p_target;
          GET DIAGNOSTICS v_codes = ROW_COUNT;
          DELETE FROM pending_inputs WHERE vercel_account = p_target;
          GET DIAGNOSTICS v_inputs = ROW_COUNT;
          DELETE FROM one_time_secrets WHERE vercel_account = p_target;
          GET DIAGNOSTICS v_secrets = ROW_COUNT;
          DELETE FROM protected_resources WHERE vercel_account = p_target;
          GET DIAGNOSTICS v_protections = ROW_COUNT;
          DELETE FROM blob_store_connections WHERE vercel_account = p_target;
          GET DIAGNOSTICS v_blob_conns = ROW_COUNT;
          INSERT INTO change_log
            (vercel_account, mode, tool, summary, dry_run, production, after)
          VALUES (p_target, 'production', 'vercel_remove_account',
            'Owner removed an enrolled Vercel account and its account-scoped state',
            FALSE, TRUE,
            jsonb_build_object('tokensRevoked', v_tokens,
              'passesRevoked', v_passes, 'codesDeleted', v_codes,
              'pendingInputsDeleted', v_inputs,
              'pendingSecretsDeleted', v_secrets,
              'protectionsDeleted', v_protections,
              'blobConnectionsDeleted', v_blob_conns,
              'wasDefault', v_default));
          RETURN 'removed';
        END;
        $rmcp$`;

      await run`CREATE TABLE IF NOT EXISTS one_time_secrets (
        id TEXT PRIMARY KEY, vercel_account TEXT, kind TEXT NOT NULL, label TEXT, ciphertext TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(), expires_at TIMESTAMPTZ NOT NULL, viewed_at TIMESTAMPTZ)`;
      await run`CREATE TABLE IF NOT EXISTS pending_inputs (
        id TEXT PRIMARY KEY, vercel_account TEXT NOT NULL, kind TEXT NOT NULL, label TEXT NOT NULL,
        ciphertext TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        expires_at TIMESTAMPTZ NOT NULL, used_at TIMESTAMPTZ)`;
      // M-4 (IN-15): Blob store connections are connection STATE, entered
      // by the owner through the sign-in flow's enrollment step and held encrypted like every
      // other credential. One row per (account, store); reconnecting a
      // store replaces its token.
      await run`CREATE TABLE IF NOT EXISTS blob_store_connections (
        vercel_account TEXT NOT NULL, store_id TEXT NOT NULL,
        label TEXT NOT NULL, access TEXT NOT NULL DEFAULT 'public',
        ciphertext TEXT NOT NULL, token_last4 TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (vercel_account, store_id))`;
      await run`CREATE TABLE IF NOT EXISTS protected_resources (
        id BIGSERIAL PRIMARY KEY, vercel_account TEXT, kind TEXT NOT NULL, match TEXT NOT NULL, note TEXT,
        source TEXT NOT NULL DEFAULT 'default', added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE NULLS NOT DISTINCT (vercel_account, kind, match))`;

      await run`CREATE TABLE IF NOT EXISTS purchase_intents (
        id TEXT PRIMARY KEY, vercel_account TEXT NOT NULL,
        operation TEXT NOT NULL, request_key TEXT NOT NULL, fingerprint TEXT NOT NULL,
        price_cents BIGINT, pricing_source TEXT NOT NULL,
        ceiling_cents BIGINT, allow_unbounded_metered BOOLEAN NOT NULL DEFAULT FALSE,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        expires_at TIMESTAMPTZ NOT NULL,
        approved_at TIMESTAMPTZ,consumed_at TIMESTAMPTZ,
        UNIQUE(vercel_account,operation,request_key))`;
      await run`ALTER TABLE purchase_intents ADD COLUMN IF NOT EXISTS
        allow_unbounded_metered BOOLEAN NOT NULL DEFAULT FALSE`;
      await run`CREATE INDEX IF NOT EXISTS purchase_intents_expires ON purchase_intents(expires_at)`;

      await run`CREATE TABLE IF NOT EXISTS result_store (
        handle TEXT PRIMARY KEY, connection TEXT NOT NULL, vercel_account TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(), expires_at TIMESTAMPTZ NOT NULL,
        summary TEXT, body JSONB NOT NULL)`;
      await run`CREATE INDEX IF NOT EXISTS result_store_expires ON result_store(expires_at)`;

      await run`CREATE TABLE IF NOT EXISTS dev_runs (
        id TEXT PRIMARY KEY,vercel_account TEXT NOT NULL,
        connection TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',
        request_key TEXT,UNIQUE(vercel_account,request_key),
        status TEXT NOT NULL DEFAULT 'active'
          CHECK (status IN ('active','cleaned')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),cleaned_at TIMESTAMPTZ)`;
      await run`CREATE INDEX IF NOT EXISTS dev_runs_account
        ON dev_runs(vercel_account,created_at DESC)`;
      await run`CREATE TABLE IF NOT EXISTS dev_sandbox_usage (
        vercel_account TEXT NOT NULL,day DATE NOT NULL,
        minutes INTEGER NOT NULL DEFAULT 0 CHECK(minutes>=0),
        PRIMARY KEY(vercel_account,day))`;
      await run`CREATE TABLE IF NOT EXISTS dev_run_objects (
        run_id TEXT NOT NULL REFERENCES dev_runs(id),object_type TEXT NOT NULL,
        object_id TEXT NOT NULL,project_id TEXT,detail JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        status TEXT NOT NULL DEFAULT 'active'
          CHECK (status IN ('active','cleaned','blocked','uncertain')),
        last_error TEXT,cleaned_at TIMESTAMPTZ,
        PRIMARY KEY (run_id,object_type,object_id))`;
      await run`CREATE INDEX IF NOT EXISTS dev_run_objects_run
        ON dev_run_objects(run_id,created_at DESC)`;
      await run`CREATE TABLE IF NOT EXISTS request_replay (
        request_key TEXT PRIMARY KEY, vercel_account TEXT NOT NULL, mode TEXT NOT NULL,
        tool TEXT NOT NULL, claim_id UUID NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
        expires_at TIMESTAMPTZ NOT NULL, result JSONB)`;

      await run`CREATE INDEX IF NOT EXISTS change_log_request_key ON change_log (request_key, at)`;
      await run`CREATE INDEX IF NOT EXISTS oauth_codes_expires_at ON oauth_codes (expires_at)`;
      await run`CREATE INDEX IF NOT EXISTS oauth_tokens_refresh_hash ON oauth_tokens (refresh_hash)`;
      await run`CREATE INDEX IF NOT EXISTS oauth_tokens_expires_at ON oauth_tokens (expires_at)`;
      await run`CREATE INDEX IF NOT EXISTS login_attempts_ip_attempted_at ON login_attempts (ip, attempted_at)`;
      await run`CREATE INDEX IF NOT EXISTS change_log_account_at ON change_log (vercel_account, at DESC)`;
      await run`CREATE INDEX IF NOT EXISTS one_time_secrets_expires_at ON one_time_secrets (expires_at)`;
      await run`CREATE INDEX IF NOT EXISTS pending_inputs_expires_at ON pending_inputs (expires_at)`;
      // P-1 (BATCH-P): project profiles. Design §2 plus the repo's account
      // scope column ('' = every account, so (vercel_account, id) can be
      // the primary key and an account row shadows the global default)
      // and a source column; the seed upsert refreshes a row only while
      // it is still the shipped default.
      await run`CREATE TABLE IF NOT EXISTS known_apps (
        vercel_account TEXT NOT NULL DEFAULT '', id TEXT NOT NULL,
        name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active',
        source TEXT NOT NULL DEFAULT 'setup_page',
        profile JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (vercel_account, id))`;
      for (const seed of KNOWN_APP_SEED) {
        const body = JSON.stringify(seed);
        await run`INSERT INTO known_apps
            (id, name, status, vercel_account, source, profile)
          VALUES (${seed.id}, ${seed.name}, 'active', '', 'default', ${body}::jsonb)
          ON CONFLICT (vercel_account, id) DO UPDATE SET
            name = EXCLUDED.name, profile = EXCLUDED.profile, updated_at = now()
          WHERE known_apps.source = 'default'`;
      }
      // AUD-AO: the retention sweep rides the one hook every entry
      // route already calls, throttled in-process (see the constants
      // at the top of this module). A sweep failure must never break
      // schema init or the request it rode in on, so it is contained
      // here; the sweep itself stays strict and testable on its own.
      const sweepNow = Date.now();
      if (sweepNow - lastRetentionSweepAt >= RETENTION_SWEEP_INTERVAL_MS) {
        lastRetentionSweepAt = sweepNow;
        try { await this.sweepRetention(); } catch { /* contained above */ }
      }
    }
  };
}

export const initSchema = () => createDb().initSchema();
