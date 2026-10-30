// F-2: project firewall — custom rules, managed rule sets, IP blocks,
// attack mode and events. Every write reads the active configuration,
// previews the diff in words (design F4), journals the restore-version
// inverse, re-checks for drift before dispatch, and verifies by read-back.
//
// The firewall-config PATCH is the one operation in this server exempt
// from validateRequest: the pinned snapshot's oneOf for it is internally
// ambiguous (dossier §4.1, proven with the repo's own AJV settings —
// documented bodies match two branches, and several enum branches carry
// value shapes belonging to other actions). Bodies here are built
// strictly per the documented branch shapes (enums + the generic-branch
// value schemas + Vercel's published examples) and pinned byte-exact in
// tests/unit/firewall.test.js.
import { createHash } from 'node:crypto';
import { defineWrite, bindGuardedWrite, requirePreDispatch, RefusalError } from '../core/write.js';
import { compact } from '../core/util.js';
import { readProvider, writeProvider } from '../vercel/provider.js';
import { checkProtected } from './self-guard.js';
import { checkApp } from './app-guard.js';
import { validateRequest } from '../vercel/openapi-validation.js';

const ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const READ_PROFILES = ['read_only', 'everyday', 'full'];
const FULL = ['full'];
const EVERYDAY = ['everyday', 'full'];
// The PATCH (write) condition-type enum has 31 entries; the config read
// enum adds trusted_source. Writes validate against the write enum.
const CONDITION_TYPES = ['host', 'path', 'method', 'header', 'query', 'cookie',
  'target_path', 'route', 'raw_path', 'ip_address', 'region', 'protocol', 'scheme',
  'environment', 'domain_environment', 'user_agent', 'geo_continent', 'geo_country',
  'geo_country_region', 'geo_city', 'geo_as_number', 'ja4_digest', 'ja3_digest',
  'rate_limit_api_id', 'server_action', 'bot_name', 'bot_category', 'bot_status',
  'bot_protection', 'shared_condition', 'traffic_source', 'ruleset'];
const CONDITION_OPS = ['re', 'eq', 'neq', 'ex', 'nex', 'inc', 'ninc', 'pre', 'suf',
  'sub', 'gt', 'gte', 'lt', 'lte', 'list'];
const MITIGATE_ACTIONS = ['allow', 'bypass', 'challenge', 'deny', 'log', 'rate_limit', 'redirect'];
const MANAGED_KEYS = ['ai_bots', 'bot_protection', 'owasp', 'traffic_sources', 'vercel_ruleset'];
const MANAGED_ACTIONS = ['challenge', 'deny', 'log'];
const CRS_KEYS = ['gen', 'java', 'lfi', 'ma', 'php', 'rce', 'rfi', 'sd', 'sf', 'sqli', 'xss'];
const CRS_ACTIONS = ['deny', 'log'];
const IP_ACTIONS = ['deny', 'challenge', 'bypass', 'log'];
const OP_WORDS = { eq: 'equals', neq: 'does not equal', re: 'matches the pattern',
  ex: 'is present', nex: 'is absent', inc: 'is one of', ninc: 'is not one of',
  pre: 'starts with', suf: 'ends with', sub: 'contains', gt: 'is greater than',
  gte: 'is at least', lt: 'is less than', lte: 'is at most', list: 'is in the list' };
const fp = value => createHash('sha256').update(value).digest('hex');
const text = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });
const result = r => ({
  isError: ['refused_by_guard', 'outcome_unknown'].includes(r.status),
  content: [{ type: 'text', text: JSON.stringify(r) }]
});
function context({ db, connection, env, fetchImpl }) {
  return { db, connection, env, fetchImpl, shape: compact,
    audit: x => db.recordChange(x), replayStore: db.requestReplayStore(),
    guardProtected: targets => checkProtected(targets, { db, connection, env }),
    guardApp: targets => checkApp(targets, { db, connection, env }) };
}
function strictArgs(args, allowed) {
  if (!args || typeof args !== 'object' || Array.isArray(args) ||
    Object.keys(args).some(k => !allowed.includes(k)))
    throw new RefusalError('Invalid firewall request');
}
async function resolveProject(ctx, project) {
  if (typeof project !== 'string' || !ID.test(project))
    throw new RefusalError('Invalid project');
  const { client, account } = await readProvider(ctx);
  if (account.scope === 'project' && project !== account.project_id)
    throw new RefusalError('Connection cannot act on another project');
  const row = await client.request('projects_get', { path: { idOrName: project } });
  if (typeof row?.id !== 'string' || typeof row?.name !== 'string' ||
    (account.scope === 'project' && row.id !== account.project_id))
    throw new RefusalError('Project identity unavailable');
  return { client, account, row };
}
async function getConfig(ctx, projectId) {
  const { client } = await readProvider(ctx);
  const cfg = await client.request('firewall_config_get', { query: { projectId } });
  if (!cfg || typeof cfg !== 'object' || !cfg.active || typeof cfg.active !== 'object')
    throw new RefusalError('Firewall configuration unavailable');
  return cfg;
}
const activeOf = cfg => cfg.active;
const findRule = (cfg, ruleId) =>
  (Array.isArray(activeOf(cfg)?.rules) ? activeOf(cfg).rules : []).find(r => r?.id === ruleId) ?? null;
const findIp = (cfg, ip) =>
  (Array.isArray(activeOf(cfg)?.ips) ? activeOf(cfg).ips : []).find(e => e?.ip === ip) ?? null;
function conditionWords(c) {
  const value = Array.isArray(c.value) ? c.value.join(', ') : String(c.value ?? '');
  return (c.neg ? 'not ' : '') + String(c.type).replaceAll('_', ' ') +
    (c.key ? ' ' + c.key : '') + ' ' + (OP_WORDS[c.op] ?? c.op) + (value ? ' ' + value : '');
}
function ruleWords(rule) {
  const groups = Array.isArray(rule?.conditionGroup) ? rule.conditionGroup : [];
  const conditions = groups.flatMap(g => Array.isArray(g?.conditions) ? g.conditions : []);
  const action = rule?.action?.mitigate?.action;
  const verb = { deny: 'Deny', challenge: 'Challenge', allow: 'Allow', bypass: 'Bypass the firewall for',
    log: 'Log', rate_limit: 'Rate-limit', redirect: 'Redirect' }[action] ?? 'Handle';
  let words = verb + ' requests';
  if (conditions.length) words += ' where ' + conditions.map(conditionWords).join(' and ');
  if (action === 'rate_limit' && rule.action.mitigate.rateLimit)
    words += ' (limit ' + rule.action.mitigate.rateLimit.limit + ' per ' +
      rule.action.mitigate.rateLimit.window + ')';
  if (action === 'redirect' && rule.action.mitigate.redirect)
    words += ' to ' + (typeof rule.action.mitigate.redirect === 'string'
      ? rule.action.mitigate.redirect : rule.action.mitigate.redirect.location);
  return words;
}
function configView(cfg, project) {
  const active = activeOf(cfg);
  return {
    project,
    firewallEnabled: typeof active.firewallEnabled === 'boolean' ? active.firewallEnabled : null,
    activeVersion: Number.isInteger(active.version) ? active.version : null,
    draftVersion: Number.isInteger(cfg.draft?.version) ? cfg.draft.version : null,
    rules: (Array.isArray(active.rules) ? active.rules : []).map(r => ({
      id: r.id, name: r.name, active: r.active === true,
      summary: ruleWords(r), valid: typeof r.valid === 'boolean' ? r.valid : null })),
    ipEntries: (Array.isArray(active.ips) ? active.ips : []).map(e => ({
      id: e.id, ip: e.ip, hostname: e.hostname, action: e.action,
      ...(typeof e.notes === 'string' ? { notes: e.notes } : {}) })),
    managedRules: Object.fromEntries(MANAGED_KEYS.map(k => [k, {
      active: active.managedRules?.[k]?.active === true,
      action: typeof active.managedRules?.[k]?.action === 'string' ? active.managedRules[k].action : null }])),
    crs: Object.fromEntries(CRS_KEYS.map(k => [k, {
      active: active.crs?.[k]?.active === true,
      action: typeof active.crs?.[k]?.action === 'string' ? active.crs[k].action : null }])),
    versions: (Array.isArray(cfg.versions) ? cfg.versions : []).map(v => ({
      version: v.version, updatedAt: v.updatedAt ?? null,
      isActive: Number.isInteger(active.version) && v.version === active.version }))
  };
}
function validCondition(c) {
  if (!c || typeof c !== 'object' || Array.isArray(c)) return false;
  if (!CONDITION_TYPES.includes(c.type) || !CONDITION_OPS.includes(c.op)) return false;
  if (c.key !== undefined && (typeof c.key !== 'string' || c.key.length > 128)) return false;
  if (c.neg !== undefined && typeof c.neg !== 'boolean') return false;
  const v = c.value;
  if (typeof v === 'string') return v.length <= 500;
  if (typeof v === 'number') return Number.isFinite(v);
  if (Array.isArray(v)) return v.length <= 75 && v.every(x => typeof x === 'string' && x.length <= 500);
  return v === undefined && ['ex', 'nex'].includes(c.op);
}
function validMitigate(m) {
  if (!m || typeof m !== 'object' || !MITIGATE_ACTIONS.includes(m.action)) return false;
  if (m.action === 'rate_limit') {
    const r = m.rateLimit;
    if (!r || !['fixed_window', 'token_bucket'].includes(r.algo) ||
      !Number.isSafeInteger(r.window) || r.window < 1 || r.window > 86400 ||
      !Number.isSafeInteger(r.limit) || r.limit < 1 ||
      (r.keys !== undefined && (!Array.isArray(r.keys) || r.keys.some(k => typeof k !== 'string'))))
      return false;
  } else if (m.rateLimit !== undefined && m.rateLimit !== null) return false;
  if (m.action === 'redirect') {
    const r = m.redirect;
    if (!r || typeof r.location !== 'string' || !r.location || r.location.length > 500 ||
      (r.permanent !== undefined && typeof r.permanent !== 'boolean')) return false;
  } else if (m.redirect !== undefined && m.redirect !== null) return false;
  if (m.actionDuration !== undefined && m.actionDuration !== null &&
    typeof m.actionDuration !== 'string') return false;
  return true;
}
const conditionBody = c => ({ type: c.type, op: c.op,
  ...(c.key !== undefined ? { key: c.key } : {}),
  ...(c.neg !== undefined ? { neg: c.neg } : {}),
  ...(c.value !== undefined ? { value: c.value } : {}) });
const mitigateBody = m => ({ action: m.action,
  rateLimit: m.action === 'rate_limit'
    ? { algo: m.rateLimit.algo, window: m.rateLimit.window, limit: m.rateLimit.limit,
        ...(m.rateLimit.keys ? { keys: m.rateLimit.keys } : {}) }
    : null,
  redirect: m.action === 'redirect'
    ? { location: m.redirect.location, permanent: m.redirect.permanent === true }
    : null,
  actionDuration: m.actionDuration ?? null });
const ruleValue = ({ name, description, active, conditions, mitigate }) => ({
  name, ...(description ? { description } : {}), active,
  conditionGroup: [{ conditions: conditions.map(conditionBody) }],
  action: { mitigate: mitigateBody(mitigate) }
});

// Shared skeleton for the config-PATCH writes: read, plan in words, drift
// re-check on the active version + a plan fingerprint, dispatch, read-back.
function configWrite({ name, profiles, description, validate, plan, inputSchema }) {
  const spec = defineWrite({
    name,
    async before(args, ctx) {
      validate(args);
      const { row } = await resolveProject(ctx, args.project);
      const cfg = await getConfig(ctx, row.id);
      const planned = plan(args, cfg, row);
      return { id: row.id, name: row.name, activeVersion: activeOf(cfg).version,
        body: planned.body, ...planned.before };
    },
    async preview(_args, _ctx, b) {
      return b.words + ' Undo: vercel_firewall_restore_version to version ' +
        b.activeVersion + '.';
    },
    async production() {
      return { production: true,
        why: 'The firewall decides which requests reach this project\u2019s live deployments' };
    },
    async targets(_args, b) { return [{ kind: 'project', id: b.id, name: b.name }]; },
    async apply(args, ctx, b, requestKey) {
      const provider = await writeProvider(ctx);
      await requirePreDispatch(async () => {
        const cfg = await provider.read('firewall_config_get', { query: { projectId: b.id } });
        if (!cfg?.active || cfg.active.version !== b.activeVersion ||
          fp(b.driftSlice(cfg)) !== b.fingerprint)
          throw new TypeError('Firewall configuration changed since the confirmed preview');
      });
      return provider.write('firewall_config_patch',
        { query: { projectId: b.id }, body: b.body },
        { requestKey, tool: name, shapeResult: row => {
          if (!row || typeof row !== 'object')
            throw new TypeError('Firewall change response unproven');
          return { acknowledged: true };
        } });
    },
    async verify(args, ctx, b) {
      const cfg = await getConfig(ctx, b.id);
      const outcome = b.check(cfg);
      return { confirmed: outcome.found, project: b.id,
        ...(outcome.in ? { carriedBy: outcome.in } : {}),
        activeVersion: activeOf(cfg).version ?? null,
        draftVersion: cfg.draft?.version ?? null };
    },
    async inverse(args, b) {
      return { tool: 'vercel_firewall_restore_version', project: args.project,
        version: b.activeVersion };
    }
  });
  return {
    tool: { name, writes: true, guardedWrite: true, profiles, area: 'firewall',
      description, inputSchema, writeContract: spec.writeContract,
      annotations: { readOnlyHint: false, destructiveHint: false } },
    handler: bindGuardedWrite(spec, context, result)
  };
}
const baseProps = {
  project: { type: 'string', minLength: 1, maxLength: 128 },
  confirm: { type: 'boolean' }, dryRun: { type: 'boolean' },
  requestKey: { type: 'string', pattern: '^[a-zA-Z0-9_-]{8,128}$' }
};
const schema = (props, required) => ({ type: 'object', additionalProperties: false,
  properties: { ...baseProps, ...props }, required: ['project', ...required] });
const conditionSchema = { type: 'array', minItems: 1, maxItems: 10, items: { type: 'object',
  properties: { type: { type: 'string', enum: CONDITION_TYPES },
    op: { type: 'string', enum: CONDITION_OPS },
    value: {}, key: { type: 'string', maxLength: 128 }, neg: { type: 'boolean' } },
  required: ['type', 'op'], additionalProperties: false } };
const mitigateSchema = { type: 'object', additionalProperties: false,
  properties: { action: { type: 'string', enum: MITIGATE_ACTIONS },
    rateLimit: { type: 'object', properties: { algo: { type: 'string', enum: ['fixed_window', 'token_bucket'] },
      window: { type: 'integer', minimum: 1, maximum: 86400 }, limit: { type: 'integer', minimum: 1 },
      keys: { type: 'array', items: { type: 'string' } } }, required: ['algo', 'window', 'limit'] },
    redirect: { type: 'object', properties: { location: { type: 'string', maxLength: 500 },
      permanent: { type: 'boolean' } }, required: ['location'] },
    actionDuration: { type: 'string' } },
  required: ['action'] };

// Verify helper: a change may land in the active configuration or the
// draft; report which one carries it, never pretend.
function searchParts(cfgAfter, predicate) {
  for (const [label, part] of [['active', cfgAfter.active], ['draft', cfgAfter.draft]]) {
    if (part && predicate(part)) return { found: true, in: label };
  }
  return { found: false };
}

const addRule = configWrite({
  name: 'vercel_firewall_add_rule', profiles: FULL,
  description: 'Add a custom firewall rule; the preview renders it in plain words and names the undo version.',
  inputSchema: schema({
    name: { type: 'string', minLength: 1, maxLength: 160 },
    description: { type: 'string', maxLength: 256 },
    active: { type: 'boolean' },
    conditions: conditionSchema, mitigate: mitigateSchema
  }, ['name', 'conditions', 'mitigate']),
  validate(args) {
    strictArgs(args, ['project', 'name', 'description', 'active', 'conditions', 'mitigate',
      'confirm', 'dryRun', 'requestKey']);
    if (typeof args.name !== 'string' || !args.name || args.name.length > 160 ||
      (args.description !== undefined && (typeof args.description !== 'string' || args.description.length > 256)) ||
      (args.active !== undefined && typeof args.active !== 'boolean') ||
      !Array.isArray(args.conditions) || !args.conditions.length || args.conditions.length > 10 ||
      !args.conditions.every(validCondition) || !validMitigate(args.mitigate))
      throw new RefusalError('Invalid firewall rule');
  },
  plan(args, cfg) {
    const value = ruleValue({ name: args.name, description: args.description,
      active: args.active !== false, conditions: args.conditions, mitigate: args.mitigate });
    const rules = Array.isArray(activeOf(cfg).rules) ? activeOf(cfg).rules : [];
    return { body: { action: 'rules.insert', id: null, value },
      before: {
        words: 'Add firewall rule \u201C' + args.name + '\u201D to this project: ' +
          ruleWords({ conditionGroup: value.conditionGroup, action: value.action }) + '.',
        fingerprint: fp(JSON.stringify(rules.map(r => r.id))),
        driftSlice: c => JSON.stringify((c.active?.rules ?? []).map(r => r.id)),
        check: cfgAfter => searchParts(cfgAfter, part =>
          (part.rules ?? []).some(r => r.name === args.name &&
            JSON.stringify(r.conditionGroup) === JSON.stringify(value.conditionGroup)))
      } };
  }
});

const updateRule = configWrite({
  name: 'vercel_firewall_update_rule', profiles: FULL,
  description: 'Change one custom firewall rule (name, description, on/off, conditions or action); the preview shows the new wording.',
  inputSchema: schema({
    ruleId: { type: 'string', minLength: 1, maxLength: 128 },
    name: { type: 'string', minLength: 1, maxLength: 160 },
    description: { type: 'string', maxLength: 256 },
    active: { type: 'boolean' },
    conditions: conditionSchema, mitigate: mitigateSchema
  }, ['ruleId']),
  validate(args) {
    strictArgs(args, ['project', 'ruleId', 'name', 'description', 'active', 'conditions',
      'mitigate', 'confirm', 'dryRun', 'requestKey']);
    if (typeof args.ruleId !== 'string' || !args.ruleId ||
      (args.name !== undefined && (typeof args.name !== 'string' || !args.name || args.name.length > 160)) ||
      (args.description !== undefined && (typeof args.description !== 'string' || args.description.length > 256)) ||
      (args.active !== undefined && typeof args.active !== 'boolean') ||
      (args.conditions !== undefined && (!Array.isArray(args.conditions) ||
        !args.conditions.length || !args.conditions.every(validCondition))) ||
      (args.mitigate !== undefined && !validMitigate(args.mitigate)) ||
      (args.name === undefined && args.description === undefined && args.active === undefined &&
        args.conditions === undefined && args.mitigate === undefined))
      throw new RefusalError('Invalid firewall rule change');
  },
  plan(args, cfg) {
    const rule = findRule(cfg, args.ruleId);
    if (!rule) throw new RefusalError('No firewall rule with that id exists on this project');
    const currentConditions = (rule.conditionGroup ?? [])
      .flatMap(g => Array.isArray(g?.conditions) ? g.conditions : []);
    const value = ruleValue({
      name: args.name ?? rule.name,
      description: args.description ?? (typeof rule.description === 'string' ? rule.description : undefined),
      active: args.active ?? rule.active === true,
      conditions: args.conditions ?? currentConditions,
      mitigate: args.mitigate ?? rule.action?.mitigate });
    if (!validMitigate(value.action.mitigate))
      throw new RefusalError('The existing rule\u2019s action cannot be carried forward; pass a full action');
    return { body: { action: 'rules.update', id: args.ruleId, value },
      before: {
        words: 'Change firewall rule \u201C' + value.name + '\u201D on this project to: ' +
          ruleWords({ conditionGroup: value.conditionGroup, action: value.action }) +
          (value.active ? '.' : ' (the rule is switched OFF).'),
        fingerprint: fp(JSON.stringify(rule)),
        driftSlice: c => JSON.stringify(findRule(c, args.ruleId)),
        check: cfgAfter => searchParts(cfgAfter, part =>
          (part.rules ?? []).some(r => r.id === args.ruleId &&
            JSON.stringify(r.conditionGroup) === JSON.stringify(value.conditionGroup) &&
            r.active === value.active))
      } };
  }
});

const removeRule = configWrite({
  name: 'vercel_firewall_remove_rule', profiles: FULL,
  description: 'Remove one custom firewall rule; the preview names the rule and the undo version.',
  inputSchema: schema({ ruleId: { type: 'string', minLength: 1, maxLength: 128 } }, ['ruleId']),
  validate(args) {
    strictArgs(args, ['project', 'ruleId', 'confirm', 'dryRun', 'requestKey']);
    if (typeof args.ruleId !== 'string' || !args.ruleId)
      throw new RefusalError('Invalid firewall rule');
  },
  plan(args, cfg) {
    const rule = findRule(cfg, args.ruleId);
    if (!rule) throw new RefusalError('No firewall rule with that id exists on this project');
    return { body: { action: 'rules.remove', id: args.ruleId, value: null },
      before: {
        words: 'Remove firewall rule \u201C' + rule.name + '\u201D from this project (' +
          ruleWords(rule) + ').',
        fingerprint: fp(JSON.stringify(rule)),
        driftSlice: c => JSON.stringify(findRule(c, args.ruleId)),
        check: cfgAfter => ({
          found: !findRule(cfgAfter, args.ruleId) &&
            !(cfgAfter.draft?.rules ?? []).some(r => r.id === args.ruleId),
          in: 'active' })
      } };
  }
});

const setManagedRules = configWrite({
  name: 'vercel_firewall_set_managed_rules', profiles: FULL,
  description: 'Turn one managed rule set (OWASP, bot protection, AI bots, or a CRS group) on or off and set its action.',
  inputSchema: schema({
    ruleset: { type: 'string', enum: [...MANAGED_KEYS, ...CRS_KEYS] },
    active: { type: 'boolean' },
    action: { type: 'string', enum: ['challenge', 'deny', 'log'] }
  }, ['ruleset', 'active']),
  validate(args) {
    strictArgs(args, ['project', 'ruleset', 'active', 'action', 'confirm', 'dryRun', 'requestKey']);
    const isCrs = CRS_KEYS.includes(args.ruleset);
    if (![...MANAGED_KEYS, ...CRS_KEYS].includes(args.ruleset) ||
      typeof args.active !== 'boolean' ||
      (args.action !== undefined &&
        !(isCrs ? CRS_ACTIONS : MANAGED_ACTIONS).includes(args.action)))
      throw new RefusalError('Invalid managed rule set change');
  },
  plan(args, cfg) {
    const isCrs = CRS_KEYS.includes(args.ruleset);
    const family = isCrs ? 'crs' : 'managedRules';
    const current = activeOf(cfg)[family]?.[args.ruleset];
    if (!current || typeof current !== 'object')
      throw new RefusalError('That rule set is not part of this project\u2019s firewall configuration');
    const action = args.action ?? (typeof current.action === 'string' ? current.action : undefined);
    if (args.active === (current.active === true) &&
      (args.action === undefined || args.action === current.action))
      throw new RefusalError('That rule set already has the requested state');
    const value = { active: args.active, ...(action ? { action } : {}) };
    return { body: { action: isCrs ? 'crs.update' : 'managedRules.update',
        id: args.ruleset, value },
      before: {
        words: 'Turn the ' + args.ruleset.replaceAll('_', ' ') + ' managed rule set ' +
          (args.active ? 'ON' : 'OFF') + ' for this project' +
          (args.active && action ? ', action: ' + action : '') + '.',
        fingerprint: fp(JSON.stringify(current)),
        driftSlice: c => JSON.stringify(c.active?.[family]?.[args.ruleset] ?? null),
        check: cfgAfter => searchParts(cfgAfter, part =>
          part[family]?.[args.ruleset]?.active === args.active &&
          (args.action === undefined || part[family][args.ruleset].action === args.action))
      } };
  }
});

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?:\/(\d{1,2}))?$/;
function validIp(value) {
  const m = typeof value === 'string' ? IPV4.exec(value) : null;
  return Boolean(m) && m.slice(1, 5).every(o => Number(o) <= 255) &&
    (m[5] === undefined || Number(m[5]) <= 32);
}
const blockIp = configWrite({
  name: 'vercel_firewall_block_ip', profiles: EVERYDAY,
  description: 'Block an IP address or range at the firewall (or challenge, bypass or log it).',
  inputSchema: schema({
    ip: { type: 'string', minLength: 3, maxLength: 43 },
    action: { type: 'string', enum: IP_ACTIONS },
    hostname: { type: 'string', maxLength: 180 },
    notes: { type: 'string', maxLength: 200 }
  }, ['ip']),
  validate(args) {
    strictArgs(args, ['project', 'ip', 'action', 'hostname', 'notes', 'confirm', 'dryRun', 'requestKey']);
    if (!validIp(args.ip) ||
      (args.action !== undefined && !IP_ACTIONS.includes(args.action)) ||
      (args.hostname !== undefined && (typeof args.hostname !== 'string' || args.hostname.length > 180)) ||
      (args.notes !== undefined && (typeof args.notes !== 'string' || args.notes.length > 200)))
      throw new RefusalError('Invalid IP block');
  },
  plan(args, cfg) {
    if (findIp(cfg, args.ip))
      throw new RefusalError('That IP already has a firewall entry on this project');
    const action = args.action ?? 'deny';
    const value = { hostname: args.hostname ?? args.ip, ip: args.ip,
      ...(args.notes ? { notes: args.notes } : {}), action };
    const ips = Array.isArray(activeOf(cfg).ips) ? activeOf(cfg).ips : [];
    return { body: { action: 'ip.insert', id: null, value },
      before: {
        words: (action === 'deny' ? 'Block' : action === 'challenge' ? 'Challenge' :
          action === 'bypass' ? 'Bypass the firewall for' : 'Log') +
          ' requests from ' + args.ip + ' at this project\u2019s firewall.',
        fingerprint: fp(JSON.stringify(ips.map(e => e.id))),
        driftSlice: c => JSON.stringify((c.active?.ips ?? []).map(e => e.id)),
        check: cfgAfter => searchParts(cfgAfter, part =>
          (part.ips ?? []).some(e => e.ip === args.ip && e.action === action))
      } };
  }
});

const unblockIp = configWrite({
  name: 'vercel_firewall_unblock_ip', profiles: EVERYDAY,
  description: 'Remove an IP entry from the firewall so the address is treated like any other again.',
  inputSchema: schema({ ip: { type: 'string', minLength: 3, maxLength: 43 } }, ['ip']),
  validate(args) {
    strictArgs(args, ['project', 'ip', 'confirm', 'dryRun', 'requestKey']);
    if (!validIp(args.ip)) throw new RefusalError('Invalid IP address');
  },
  plan(args, cfg) {
    const entry = findIp(cfg, args.ip);
    if (!entry) throw new RefusalError('That IP has no firewall entry on this project');
    return { body: { action: 'ip.remove', id: entry.id, value: null },
      before: {
        words: 'Remove the firewall entry for ' + args.ip + ' (currently: ' +
          entry.action + ') from this project.',
        fingerprint: fp(JSON.stringify(entry)),
        driftSlice: c => JSON.stringify(findIp(c, args.ip)),
        check: cfgAfter => ({
          found: !findIp(cfgAfter, args.ip) &&
            !(cfgAfter.draft?.ips ?? []).some(e => e.ip === args.ip),
          in: 'active' })
      } };
  }
});

const restoreVersion = defineWrite({
  name: 'vercel_firewall_restore_version',
  async before(args, ctx) {
    strictArgs(args, ['project', 'version', 'confirm', 'dryRun', 'requestKey']);
    if (!Number.isSafeInteger(args?.version) || args.version < 1)
      throw new RefusalError('Invalid firewall version');
    const { row } = await resolveProject(ctx, args.project);
    const cfg = await getConfig(ctx, row.id);
    const versions = Array.isArray(cfg.versions) ? cfg.versions : [];
    if (!versions.some(v => v?.version === args.version))
      throw new RefusalError('No firewall configuration version ' + args.version + ' exists for this project');
    if (activeOf(cfg).version === args.version)
      throw new RefusalError('Version ' + args.version + ' is already the active firewall configuration');
    validateRequest('firewall_config_activate', {
      path: { configVersion: String(args.version) },
      query: { projectId: row.id, teamId: 'team_FAKE_validation' } });
    return { id: row.id, name: row.name, version: args.version,
      activeVersion: activeOf(cfg).version };
  },
  async preview(_args, _ctx, b) {
    return 'Make firewall configuration version ' + b.version + ' active again for this project, ' +
      'replacing version ' + b.activeVersion + '. Undo: restore version ' + b.activeVersion + '.';
  },
  async production() {
    return { production: true, why: 'Restoring a firewall version changes which requests reach live deployments' };
  },
  async targets(_args, b) { return [{ kind: 'project', id: b.id, name: b.name }]; },
  async apply(_args, ctx, b, requestKey) {
    const provider = await writeProvider(ctx);
    await requirePreDispatch(async () => {
      const cfg = await provider.read('firewall_config_get', { query: { projectId: b.id } });
      if (!cfg?.active || cfg.active.version !== b.activeVersion ||
        !(cfg.versions ?? []).some(v => v?.version === b.version))
        throw new TypeError('Firewall configuration changed since the confirmed preview');
    });
    return provider.write('firewall_config_activate',
      { path: { configVersion: String(b.version) }, query: { projectId: b.id } },
      { requestKey, tool: 'vercel_firewall_restore_version', shapeResult: row => {
        if (!row || typeof row !== 'object')
          throw new TypeError('Firewall restore response unproven');
        return { acknowledged: true };
      } });
  },
  async verify(_args, ctx, b) {
    const cfg = await getConfig(ctx, b.id);
    return { confirmed: activeOf(cfg).version === b.version, project: b.id,
      activeVersion: activeOf(cfg).version ?? null };
  },
  async inverse(args, b) {
    return { tool: 'vercel_firewall_restore_version', project: args.project,
      version: b.activeVersion };
  }
});

const setAttackMode = defineWrite({
  name: 'vercel_firewall_set_attack_mode',
  async before(args, ctx) {
    strictArgs(args, ['project', 'enabled', 'durationMinutes', 'confirm', 'dryRun', 'requestKey']);
    if (typeof args?.enabled !== 'boolean' ||
      (args.enabled && (!Number.isSafeInteger(args.durationMinutes) ||
        args.durationMinutes < 5 || args.durationMinutes > 1440)) ||
      (!args.enabled && args.durationMinutes !== undefined))
      throw new RefusalError(args?.enabled
        ? 'Turning attack mode on needs an end time: durationMinutes between 5 and 1440 (24 hours at most)'
        : 'Invalid attack mode change');
    const { row } = await resolveProject(ctx, args.project);
    const until = args.enabled ? Date.now() + args.durationMinutes * 60000 : null;
    const body = args.enabled
      ? { projectId: row.id, attackModeEnabled: true, attackModeActiveUntil: until }
      : { projectId: row.id, attackModeEnabled: false };
    validateRequest('attack_mode_update', { body });
    return { id: row.id, name: row.name, enabled: args.enabled, until, body };
  },
  async preview(_args, _ctx, b) {
    return b.enabled
      ? 'Turn Attack Challenge Mode ON for this project until ' +
        new Date(b.until).toISOString() + ': visitors may be challenged while the mode lasts.'
      : 'Turn Attack Challenge Mode OFF for this project.';
  },
  async production() {
    return { production: true, why: 'Attack mode changes what live visitors experience' };
  },
  async targets(_args, b) { return [{ kind: 'project', id: b.id, name: b.name }]; },
  async apply(_args, ctx, b, requestKey) {
    const provider = await writeProvider(ctx);
    return provider.write('attack_mode_update', { body: b.body },
      { requestKey, tool: 'vercel_firewall_set_attack_mode', shapeResult: row => {
        if (!row || typeof row !== 'object')
          throw new TypeError('Attack mode response unproven');
        return { echoedEnabled: typeof row.attackModeEnabled === 'boolean'
          ? row.attackModeEnabled : null };
      } });
  },
  async verify(_args, _ctx, b, applied) {
    // The attack-status contract has an opaque branch, so state is proven
    // only when the provider echoed it in the mutation response.
    return { confirmed: applied?.echoedEnabled === null || applied?.echoedEnabled === undefined
        ? null : applied.echoedEnabled === b.enabled,
      project: b.id };
  }
});

const restoreTool = {
  tool: { name: 'vercel_firewall_restore_version', writes: true, guardedWrite: true,
    profiles: FULL, area: 'firewall',
    description: 'Make an earlier firewall configuration version active again.',
    inputSchema: schema({ version: { type: 'integer', minimum: 1 } }, ['version']),
    writeContract: restoreVersion.writeContract,
    annotations: { readOnlyHint: false, destructiveHint: false } },
  handler: bindGuardedWrite(restoreVersion, context, result)
};
const attackTool = {
  tool: { name: 'vercel_firewall_set_attack_mode', writes: true, guardedWrite: true,
    profiles: EVERYDAY, area: 'firewall',
    description: 'Turn Attack Challenge Mode on (an end time is required, 24 hours at most) or off.',
    inputSchema: schema({
      enabled: { type: 'boolean' },
      durationMinutes: { type: 'integer', minimum: 5, maximum: 1440 }
    }, ['enabled']),
    writeContract: setAttackMode.writeContract,
    annotations: { readOnlyHint: false, destructiveHint: false } },
  handler: bindGuardedWrite(setAttackMode, context, result)
};

export const firewallTools = {
  tools: [
    { name: 'vercel_firewall_get', writes: false, area: 'firewall', profiles: READ_PROFILES,
      description: 'Read a project\u2019s active firewall: rules in words, managed rule sets, IP entries and version history.',
      inputSchema: { type: 'object', properties: { project: { type: 'string' } },
        required: ['project'], additionalProperties: false },
      annotations: { readOnlyHint: true } },
    { name: 'vercel_firewall_attack_status', writes: false, area: 'firewall', profiles: READ_PROFILES,
      description: 'Whether a project shows attack anomalies right now, and which hosts they affect.',
      inputSchema: { type: 'object', properties: { project: { type: 'string' },
          since: { type: 'number' } }, required: ['project'], additionalProperties: false },
      annotations: { readOnlyHint: true } },
    { name: 'vercel_firewall_list_events', writes: false, area: 'firewall', profiles: READ_PROFILES,
      description: 'Aggregated firewall event summaries (action, rule, host, IP, count, window) for a project.',
      inputSchema: { type: 'object', properties: { project: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 50 },
          action: { type: 'string', enum: ['deny', 'challenge', 'log', 'rate_limit', 'bypass'] },
          ruleKind: { type: 'string', enum: ['system', 'custom'] },
          host: { type: 'string' } }, required: ['project'], additionalProperties: false },
      annotations: { readOnlyHint: true } },
    addRule.tool, updateRule.tool, removeRule.tool, setManagedRules.tool,
    blockIp.tool, unblockIp.tool, restoreTool.tool, attackTool.tool
  ],
  handlers: {
    async vercel_firewall_get(args, ctx) {
      strictArgs(args, ['project']);
      const { row } = await resolveProject(ctx, args?.project);
      const cfg = await getConfig(ctx, row.id);
      return text(configView(cfg, { id: row.id, name: row.name }));
    },
    async vercel_firewall_attack_status(args, ctx) {
      strictArgs(args, ['project', 'since']);
      if (args.since !== undefined && (typeof args.since !== 'number' || !Number.isFinite(args.since)))
        throw new RefusalError('Invalid attack status window');
      const { row } = await resolveProject(ctx, args?.project);
      const { client } = await readProvider(ctx);
      const status = await client.request('firewall_attack_status', {
        query: { projectId: row.id, ...(args.since !== undefined ? { since: args.since } : {}) } });
      if (status && Array.isArray(status.anomalies)) {
        const hosts = [...new Set(status.anomalies.flatMap(a =>
          a?.affectedHostMap && typeof a.affectedHostMap === 'object'
            ? Object.keys(a.affectedHostMap) : []))];
        return text({ project: { id: row.id, name: row.name },
          underAttack: status.anomalies.length > 0,
          anomalyGroups: status.anomalies.length, affectedHosts: hosts.slice(0, 25) });
      }
      return text({ project: { id: row.id, name: row.name }, underAttack: null,
        note: 'The provider did not return a readable attack status for this project' });
    },
    async vercel_firewall_list_events(args, ctx) {
      strictArgs(args, ['project', 'limit', 'action', 'ruleKind', 'host']);
      if ((args.limit !== undefined && (!Number.isSafeInteger(args.limit) || args.limit < 1 || args.limit > 50)) ||
        (args.action !== undefined && !['deny', 'challenge', 'log', 'rate_limit', 'bypass'].includes(args.action)) ||
        (args.ruleKind !== undefined && !['system', 'custom'].includes(args.ruleKind)) ||
        (args.host !== undefined && (typeof args.host !== 'string' || !args.host)))
        throw new RefusalError('Invalid firewall event filters');
      const { row } = await resolveProject(ctx, args?.project);
      const { client } = await readProvider(ctx);
      const page = await client.request('firewall_events_list', { query: {
        projectId: row.id, limit: args.limit ?? 20,
        ...(args.action ? { action: [args.action] } : {}),
        ...(args.ruleKind ? { ruleKind: args.ruleKind } : {}),
        ...(args.host ? { hosts: args.host } : {}) } });
      const items = (Array.isArray(page?.actions) ? page.actions : []).map(a => ({
        action: a.action, actionType: a.action_type, count: a.count,
        startTime: a.startTime, endTime: a.endTime, host: a.host,
        isActive: a.isActive, publicIp: a.public_ip,
        ruleId: a.ruleId ?? null, ruleName: a.ruleName ?? null }));
      return text({ project: { id: row.id, name: row.name }, events: items,
        hasMore: page?.pagination?.hasMore === true });
    },
    vercel_firewall_add_rule: addRule.handler,
    vercel_firewall_update_rule: updateRule.handler,
    vercel_firewall_remove_rule: removeRule.handler,
    vercel_firewall_set_managed_rules: setManagedRules.handler,
    vercel_firewall_block_ip: blockIp.handler,
    vercel_firewall_unblock_ip: unblockIp.handler,
    vercel_firewall_restore_version: restoreTool.handler,
    vercel_firewall_set_attack_mode: attackTool.handler
  }
};
