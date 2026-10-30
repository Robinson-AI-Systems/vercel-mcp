// F-1: deployment protection and bypass. Protection fields are PATCH
// /v9/projects fields; bypass secrets live in a project-record map KEYED BY
// THE SECRET ITSELF, so keys are used inside these handlers only — state is
// carried between preview and apply as SHA-256 fingerprints, and created
// secrets reach the owner only through the one-time-secret page.
import { createHash } from 'node:crypto';
import { defineWrite, bindGuardedWrite, requirePreDispatch, RefusalError } from '../core/write.js';
import { compact, credentialLike } from '../core/util.js';
import { readProvider, writeProvider } from '../vercel/provider.js';
import { checkProtected } from './self-guard.js';
import { checkApp } from './app-guard.js';
import { validateRequest } from '../vercel/openapi-validation.js';
import { pendingInputs } from '../core/pending-inputs.js';
import { oneTimeSecrets } from '../core/one-time-secrets.js';

const ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const ALIAS = /^[A-Za-z0-9][A-Za-z0-9._-]{0,252}$/;
const READ_PROFILES = ['read_only', 'everyday', 'full'];
const FULL = ['full'];
const AUTH_TYPES = ['all', 'preview', 'prod_deployment_urls_and_all_previews', 'all_except_custom_domains'];
const IP_TYPES = ['all', 'preview', 'production', 'prod_deployment_urls_and_all_previews', 'all_except_custom_domains'];
const SCOPE_WORDS = {
  all: 'all deployments',
  preview: 'preview deployments only',
  production: 'production deployments only',
  prod_deployment_urls_and_all_previews: 'production deployment URLs and all preview deployments',
  all_except_custom_domains: 'all deployments except custom domains'
};
// Coverage rank for loosening detection: a move to a strictly lower rank, or
// off, widens who can view deployments. The two middle scopes cover different
// axes, so a lateral move between them is disclosed but not an access change.
const SCOPE_RANK = { all: 3, prod_deployment_urls_and_all_previews: 2, all_except_custom_domains: 2, preview: 1 };
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
    throw new RefusalError('Invalid protection request');
}
function projectArg(args) {
  if (typeof args?.project !== 'string' || !ID.test(args.project))
    throw new RefusalError('Invalid project');
}
async function resolveProject(ctx, project) {
  const { client, account } = await readProvider(ctx);
  if (account.scope === 'project' && project !== account.project_id)
    throw new RefusalError('Connection cannot act on another project');
  const row = await client.request('projects_get', { path: { idOrName: project } });
  if (typeof row?.id !== 'string' || typeof row?.name !== 'string' ||
    (account.scope === 'project' && row.id !== account.project_id))
    throw new RefusalError('Project identity unavailable');
  return { client, account, row };
}
const scopeOrNull = (value, allowed) =>
  typeof value === 'string' && allowed.includes(value) ? value : null;
function loosens(currentType, newType) {
  if (currentType == null) return false;
  if (newType == null) return true;
  return SCOPE_RANK[newType] < SCOPE_RANK[currentType];
}
function bypassEntries(row) {
  const map = row?.protectionBypass;
  if (!map || typeof map !== 'object' || Array.isArray(map)) return [];
  return Object.entries(map)
    .filter(([, v]) => v && typeof v === 'object' && !Array.isArray(v))
    .map(([secret, v]) => ({
      secret,
      note: typeof v.note === 'string' ? v.note : null,
      createdAt: Number.isFinite(v.createdAt) ? v.createdAt : null,
      isEnvVar: typeof v.isEnvVar === 'boolean' ? v.isEnvVar : null,
      scope: typeof v.scope === 'string' ? v.scope : 'automation-bypass'
    }));
}
// The contract: with any automation bypasses present exactly one is the env
// var; an undefined isEnvVar on a lone user entry means that entry is it.
function envVarEntry(entries) {
  const user = entries.filter(e => e.scope !== 'integration-automation-bypass');
  return user.find(e => e.isEnvVar === true) ??
    (user.length === 1 ? user[0] : user.find(e => e.isEnvVar === null) ?? null);
}
function publicBypass(entries) {
  const envVar = envVarEntry(entries);
  return entries.map(e => ({
    note: e.note,
    createdAt: e.createdAt ? new Date(e.createdAt).toISOString() : null,
    isEnvVar: envVar != null && e.secret === envVar.secret,
    scope: e.scope,
    ...(e.scope === 'integration-automation-bypass' ? { managedByIntegration: true } : {})
  }));
}
function protectionView(row) {
  const trusted = row.trustedIps && typeof row.trustedIps === 'object' ? row.trustedIps : null;
  return {
    project: { id: row.id, name: row.name },
    vercelAuthentication: {
      enabled: row.ssoProtection != null,
      deploymentType: scopeOrNull(row.ssoProtection?.deploymentType, AUTH_TYPES)
    },
    // The pinned snapshot documents passwordProtection as an opaque object:
    // presence is fact, scope is reported only when the record carries it.
    passwordProtection: {
      enabled: row.passwordProtection != null,
      deploymentType: scopeOrNull(row.passwordProtection?.deploymentType, AUTH_TYPES)
    },
    trustedIps: trusted ? {
      enabled: true,
      deploymentType: scopeOrNull(trusted.deploymentType, IP_TYPES),
      protectionMode: trusted.protectionMode === 'exclusive' || trusted.protectionMode === 'additional'
        ? trusted.protectionMode : null,
      addresses: Array.isArray(trusted.addresses)
        ? trusted.addresses.filter(a => a && typeof a.value === 'string')
          .map(a => ({ value: a.value, note: typeof a.note === 'string' ? a.note : null }))
        : null
    } : { enabled: false },
    optionsAllowlist: {
      paths: Array.isArray(row.optionsAllowlist?.paths)
        ? row.optionsAllowlist.paths.filter(p => typeof p?.value === 'string').map(p => p.value)
        : []
    },
    bypassSecrets: publicBypass(bypassEntries(row)),
    note: 'Bypass secret values are never returned; notes and dates only'
  };
}
// Shared guarded PATCH of one projects_update field with drift protection.
// bodyFor (optional) assembles the dispatch body inside apply, after the
// drift re-check — set_password uses it to consume the setup-page input.
function settingsWrite({ name, field, validate, plan, previewText, accessFor, verifyField, description, secretIn = false, bodyFor = null }) {
  const inputSchema = { type: 'object', additionalProperties: false,
    properties: {
      project: { type: 'string', minLength: 1, maxLength: 128 },
      ...(plan.props || {}),
      confirm: { type: 'boolean' }, dryRun: { type: 'boolean' },
      requestKey: { type: 'string', pattern: '^[a-zA-Z0-9_-]{8,128}$' }
    }, required: ['project', ...(plan.required || [])] };
  const spec = defineWrite({
    name, ...(secretIn ? { secretIn: true } : {}),
    ...(accessFor ? { risk: { access: true } } : {}),
    async before(args, ctx) {
      validate(args);
      const { row } = await resolveProject(ctx, args.project);
      const planned = plan(args, row);
      validateRequest('projects_update', {
        path: { idOrName: args.project }, query: { teamId: 'team_FAKE_validation' },
        body: planned.body });
      return { id: row.id, name: row.name, ...planned.before,
        fieldFingerprint: fp(JSON.stringify(row[field] ?? null)) };
    },
    async preview(_args, _ctx, before) { return previewText(before); },
    async production() {
      return { production: true,
        why: 'Deployment protection decides who can view this project\u2019s deployment URLs' };
    },
    ...(accessFor ? { async access(_args, before) { return accessFor(before); } } : {}),
    async targets(_args, before) { return [{ kind: 'project', id: before.id, name: before.name }]; },
    async apply(args, ctx, before, requestKey) {
      const provider = await writeProvider(ctx);
      await requirePreDispatch(async () => {
        const row = await provider.read('projects_get', { path: { idOrName: before.id } });
        if (row?.id !== before.id ||
          fp(JSON.stringify(row[field] ?? null)) !== before.fieldFingerprint)
          throw new TypeError('Project protection changed since the confirmed preview');
      });
      const body = bodyFor ? await bodyFor(args, ctx, before) : plan(args, null).body;
      return provider.write('projects_update', { path: { idOrName: before.id }, body },
        { requestKey, tool: name, shapeResult: row => {
          if (row?.id !== before.id) throw new TypeError('Project identity missing in mutation response');
          return { id: row.id };
        } });
    },
    async verify(args, ctx, before) {
      const { client } = await readProvider(ctx);
      const row = await client.request('projects_get', { path: { idOrName: before.id } });
      return { confirmed: row?.id === before.id && verifyField(row, before), project: before.id };
    }
  });
  return { spec, name, inputSchema, description };
}

const setVercelAuth = settingsWrite({
  name: 'vercel_protection_set_vercel_auth', field: 'ssoProtection',
  description: 'Turn Vercel Authentication on or off for a project and set which deployments it covers; loosening is an access change.',
  validate(args) {
    projectArg(args);
    if (typeof args.enabled !== 'boolean' ||
      (args.enabled && !AUTH_TYPES.includes(args.deploymentType)) ||
      (!args.enabled && args.deploymentType !== undefined) ||
      (args.confirm !== undefined && typeof args.confirm !== 'boolean') ||
      (args.dryRun !== undefined && typeof args.dryRun !== 'boolean'))
      throw new RefusalError('Invalid Vercel Authentication change');
  },
  plan: Object.assign((args, row) => {
    const current = row ? scopeOrNull(row.ssoProtection?.deploymentType, AUTH_TYPES) : null;
    const currentPresent = row ? row.ssoProtection != null : false;
    const newType = args.enabled ? args.deploymentType : null;
    if (row && args.enabled && currentPresent && current === newType)
      throw new RefusalError('Vercel Authentication already covers ' + SCOPE_WORDS[newType]);
    if (row && !args.enabled && !currentPresent)
      throw new RefusalError('Vercel Authentication is already off for this project');
    return { body: { ssoProtection: newType ? { deploymentType: newType } : null },
      before: { newType, currentType: current, loosening: loosens(current, newType) } };
  }, { props: {
    enabled: { type: 'boolean' },
    deploymentType: { type: 'string', enum: AUTH_TYPES }
  }, required: ['enabled'] }),
  previewText: b => b.newType
    ? 'Turn Vercel Authentication ON for project ' + b.name + ': visitors to ' +
      SCOPE_WORDS[b.newType] + ' must sign in with a Vercel account on the team.'
    : 'Turn Vercel Authentication OFF for project ' + b.name +
      ': anyone with a deployment URL can view it without signing in. This LOOSENS access.',
  accessFor: b => b.loosening
    ? { widens: true, who: 'Anyone who has a deployment URL for this project',
        what: 'View deployments that Vercel Authentication previously gated' }
    : { widens: false },
  verifyField: (row, b) => (row.ssoProtection == null) === (b.newType == null) &&
    scopeOrNull(row.ssoProtection?.deploymentType, AUTH_TYPES) === b.newType
});

const setPassword = settingsWrite({
  name: 'vercel_protection_set_password', field: 'passwordProtection', secretIn: true,
  description: 'Turn password protection on or off for a project; the password is typed on the setup page and never passes through chat.',
  validate(args) {
    projectArg(args);
    if (typeof args.enabled !== 'boolean' ||
      (args.deploymentType !== undefined && !AUTH_TYPES.includes(args.deploymentType)) ||
      (args.pendingInputId !== undefined &&
        (typeof args.pendingInputId !== 'string' || !UUID.test(args.pendingInputId))) ||
      (args.confirm !== undefined && typeof args.confirm !== 'boolean') ||
      (args.dryRun !== undefined && typeof args.dryRun !== 'boolean'))
      throw new RefusalError('Invalid password protection change');
  },
  plan: Object.assign((args, row) => {
    const currentPresent = row ? row.passwordProtection != null : false;
    const currentType = row ? scopeOrNull(row.passwordProtection?.deploymentType, AUTH_TYPES) : null;
    if (row && !args.enabled && !currentPresent)
      throw new RefusalError('Password protection is already off for this project');
    if (row && args.enabled && !currentPresent && !args.pendingInputId)
      throw new RefusalError('Turning password protection on needs a password typed on the setup page: pass its pendingInputId');
    if (row && args.enabled && !currentPresent && !args.deploymentType)
      throw new RefusalError('Turning password protection on needs a deployment scope');
    const newType = args.enabled ? (args.deploymentType ?? currentType) : null;
    if (row && args.enabled && currentPresent && newType === currentType && !args.pendingInputId)
      throw new RefusalError('No password protection change requested');
    const loosening = loosens(currentPresent ? currentType : null, newType);
    return { body: { passwordProtection: args.enabled
        ? { deploymentType: newType, ...(args.pendingInputId ? { password: 'FAKE_PASSWORD' } : {}) }
        : null },
      before: { newType, currentType, loosening,
        hasPendingInput: Boolean(args.pendingInputId) } };
  }, { props: {
    enabled: { type: 'boolean' },
    deploymentType: { type: 'string', enum: AUTH_TYPES },
    pendingInputId: { type: 'string', description: 'Setup-page pending input of kind deploy_password' }
  }, required: ['enabled'] }),
  previewText: b => b.newType
    ? 'Turn password protection ON for project ' + b.name + ': visitors to ' +
      SCOPE_WORDS[b.newType] + ' need the project password.' +
      (b.hasPendingInput ? ' The new password was typed on the setup page; it is never shown here.' : '')
    : 'Turn password protection OFF for project ' + b.name +
      ': visitors no longer need a password. This LOOSENS access.',
  accessFor: b => b.loosening
    ? { widens: true, who: 'Anyone who has a deployment URL for this project',
        what: 'View deployments that password protection previously gated' }
    : { widens: false },
  verifyField: (row, b) => (row.passwordProtection == null) === (b.newType == null) &&
    (b.newType == null || row.passwordProtection == null ||
      scopeOrNull(row.passwordProtection?.deploymentType, AUTH_TYPES) === b.newType ||
      scopeOrNull(row.passwordProtection?.deploymentType, AUTH_TYPES) === null),
  // The password is consumed from the setup page inside apply, after the
  // drift re-check, and reaches only the provider request body.
  bodyFor: async (a, ctx, before) => {
    if (!a.enabled) return { passwordProtection: null };
    let password;
    if (a.pendingInputId) {
      password = await pendingInputs({ db: ctx.db, env: ctx.env }).consume({
        id: a.pendingInputId, account: ctx.connection.account, kind: 'deploy_password' });
      if (typeof password !== 'string' || !password)
        throw new TypeError('Setup-page password input is no longer available');
    }
    return { passwordProtection: { deploymentType: before.newType,
      ...(password ? { password } : {}) } };
  }
});
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?:\/(\d{1,2}))?$/;
function validIp(value) {
  const m = typeof value === 'string' ? IPV4.exec(value) : null;
  return Boolean(m) && m.slice(1, 5).every(o => Number(o) <= 255) &&
    (m[5] === undefined || Number(m[5]) <= 32);
}
const normalizeTrusted = t => t == null ? null : {
  deploymentType: t.deploymentType ?? null,
  protectionMode: t.protectionMode ?? null,
  addresses: (Array.isArray(t.addresses) ? t.addresses : [])
    .map(a => ({ value: a.value, note: a.note ?? null }))
    .sort((x, y) => x.value.localeCompare(y.value) || String(x.note).localeCompare(String(y.note)))
};
const setTrustedIps = settingsWrite({
  name: 'vercel_protection_set_trusted_ips', field: 'trustedIps',
  description: 'Set the trusted IP ranges that satisfy or bypass deployment protection for a project (IPv4 and CIDR only).',
  validate(args) {
    projectArg(args);
    const addrs = args.addresses;
    if (typeof args.enabled !== 'boolean' ||
      (args.enabled && (!IP_TYPES.includes(args.deploymentType) ||
        !['exclusive', 'additional'].includes(args.protectionMode) ||
        !Array.isArray(addrs) || addrs.length < 1 || addrs.length > 50 ||
        addrs.some(a => !a || typeof a !== 'object' || !validIp(a.value) ||
          (a.note !== undefined && (typeof a.note !== 'string' || a.note.length > 20))))) ||
      (!args.enabled && (args.deploymentType !== undefined ||
        args.protectionMode !== undefined || addrs !== undefined)) ||
      (args.confirm !== undefined && typeof args.confirm !== 'boolean') ||
      (args.dryRun !== undefined && typeof args.dryRun !== 'boolean'))
      throw new RefusalError('Invalid trusted IP change');
  },
  plan: Object.assign((args, row) => {
    const newValue = args.enabled ? {
      deploymentType: args.deploymentType, protectionMode: args.protectionMode,
      addresses: args.addresses.map(a => ({ value: a.value, ...(a.note ? { note: a.note } : {}) }))
    } : null;
    if (row && JSON.stringify(normalizeTrusted(row.trustedIps ?? null)) ===
      JSON.stringify(normalizeTrusted(newValue)))
      throw new RefusalError('Trusted IPs already match the requested settings');
    return { body: { trustedIps: newValue },
      before: { newValue: normalizeTrusted(newValue), enabling: args.enabled } };
  }, { props: {
    enabled: { type: 'boolean' },
    deploymentType: { type: 'string', enum: IP_TYPES },
    protectionMode: { type: 'string', enum: ['exclusive', 'additional'] },
    addresses: { type: 'array', minItems: 1, maxItems: 50, items: { type: 'object',
      properties: { value: { type: 'string' }, note: { type: 'string', maxLength: 20 } },
      required: ['value'], additionalProperties: false } }
  }, required: ['enabled'] }),
  previewText: b => b.enabling
    ? 'Set trusted IPs for project ' + b.name + ': requests from ' +
      b.newValue.addresses.map(a => a.value).join(', ') + ' (' + SCOPE_WORDS[b.newValue.deploymentType] +
      ') are ' + (b.newValue.protectionMode === 'exclusive'
        ? 'let through without other deployment protection'
        : 'counted as one protection factor; other protection still applies') + '.'
    : 'Remove trusted IPs from project ' + b.name + ': no IP range gets special treatment.',
  accessFor: b => b.enabling
    ? { widens: true, who: 'Requests from the listed IP ranges',
        what: 'Satisfy or bypass deployment protection for this project from those addresses' }
    : { widens: false },
  verifyField: (row, b) => JSON.stringify(normalizeTrusted(row.trustedIps ?? null)) ===
    JSON.stringify(b.newValue)
});

function noteArg(args) {
  if (typeof args.note !== 'string' || args.note.length < 3 || args.note.length > 100 ||
    /[\x00-\x1f\x7f]/.test(args.note) || credentialLike(args.note))
    throw new RefusalError('Invalid bypass note');
}
const createBypass = defineWrite({
  name: 'vercel_protection_create_bypass', risk: { access: true },
  secretOut: true, oneTimeDelivery: true,
  async before(args, ctx) {
    strictArgs(args, ['project', 'note', 'confirm', 'dryRun', 'requestKey']);
    projectArg(args);
    if (args.note !== undefined) noteArg(args);
    const { row } = await resolveProject(ctx, args.project);
    validateRequest('project_protection_bypass_update', {
      path: { idOrName: args.project }, query: { teamId: 'team_FAKE_validation' },
      body: { generate: { ...(args.note ? { note: args.note } : {}) } } });
    return { id: row.id, name: row.name, note: args.note ?? null,
      existing: bypassEntries(row).map(e => fp(e.secret)) };
  },
  async preview(_args, _ctx, b) {
    return 'Create a protection-bypass secret for project ' + b.name +
      (b.note ? ' (note: ' + b.note + ')' : '') +
      '. Anyone holding the secret can bypass deployment protection for this project. ' +
      'The secret is shown once on the setup page, never here.';
  },
  async production() {
    return { production: true, why: 'A bypass secret opens this project\u2019s live deployment URLs' };
  },
  async access() {
    return { widens: true, who: 'Whoever holds the new bypass secret',
      what: 'Bypass deployment protection for this project' };
  },
  async targets(_args, b) { return [{ kind: 'project', id: b.id, name: b.name }]; },
  async apply(args, ctx, b, requestKey) {
    const provider = await writeProvider(ctx);
    await requirePreDispatch(async () => {
      const row = await provider.read('projects_get', { path: { idOrName: b.id } });
      if (row?.id !== b.id ||
        JSON.stringify(bypassEntries(row).map(e => fp(e.secret)).sort()) !==
          JSON.stringify([...b.existing].sort()))
        throw new TypeError('Project bypass secrets changed since the confirmed preview');
    });
    // The contract makes generate.secret optional and constrains a supplied
    // value to exactly 32 alphanumeric characters, so the provider mints the
    // secret; the tool recovers it by diffing the returned map against the
    // fingerprints captured at preview — the value itself never leaves here
    // except into the one-time-secret store.
    let minted = null;
    await provider.write('project_protection_bypass_update', {
      path: { idOrName: b.id },
      body: { generate: { ...(b.note ? { note: b.note } : {}) } }
    }, { requestKey, tool: 'vercel_protection_create_bypass', shapeResult: row => {
      const map = row?.protectionBypass;
      if (!map || typeof map !== 'object' || Array.isArray(map))
        throw new TypeError('Provider did not prove the newly issued bypass secret');
      const fresh = Object.keys(map).filter(k => !b.existing.includes(fp(k)));
      if (fresh.length !== 1)
        throw new TypeError('Provider did not prove the newly issued bypass secret');
      minted = fresh[0];
      return { configured: true };
    } });
    const receipt = await oneTimeSecrets({ db: ctx.db, env: ctx.env }).issue({
      account: ctx.connection.account, kind: 'protection_bypass',
      label: b.note ?? ('Protection bypass for ' + b.name), value: minted });
    return { ownerRevealRef: receipt.id, expiresAt: receipt.expiresAt, fingerprint: fp(minted) };
  },
  async verify(_args, ctx, b, applied) {
    if (typeof applied?.fingerprint !== 'string') return { confirmed: null };
    const { client } = await readProvider(ctx);
    const row = await client.request('projects_get', { path: { idOrName: b.id } });
    return { confirmed: bypassEntries(row).some(e => fp(e.secret) === applied.fingerprint),
      project: b.id };
  }
});

const revokeBypass = defineWrite({
  name: 'vercel_protection_revoke_bypass',
  async before(args, ctx) {
    strictArgs(args, ['project', 'note', 'createdAt', 'confirm', 'dryRun', 'requestKey']);
    projectArg(args);
    noteArg(args);
    if (args.createdAt !== undefined &&
      (!Number.isSafeInteger(args.createdAt) || args.createdAt < 0))
      throw new RefusalError('Invalid bypass creation time');
    const { row } = await resolveProject(ctx, args.project);
    const entries = bypassEntries(row);
    const user = entries.filter(e => e.scope !== 'integration-automation-bypass');
    let matches = user.filter(e => e.note === args.note);
    if (args.createdAt !== undefined) matches = matches.filter(e => e.createdAt === args.createdAt);
    if (!matches.length)
      throw new RefusalError('No bypass secret with that note exists on this project');
    if (matches.length > 1)
      throw new RefusalError('More than one bypass secret uses that note; pass createdAt to pick one');
    const target = matches[0];
    validateRequest('project_protection_bypass_update', {
      path: { idOrName: args.project }, query: { teamId: 'team_FAKE_validation' },
      body: { revoke: { secret: 'a'.repeat(32), regenerate: false } } });
    return { id: row.id, name: row.name, note: args.note,
      fingerprint: fp(target.secret),
      isEnvVar: envVarEntry(entries)?.secret === target.secret };
  },
  async preview(_args, _ctx, b) {
    return 'Revoke the bypass secret noted \u201C' + b.note + '\u201D for project ' + b.name +
      '. Holders of that secret lose bypass access.' +
      (b.isEnvVar ? ' WARNING: this secret is the project\u2019s VERCEL_AUTOMATION_BYPASS_SECRET \u2014 ' +
        'deployments built with it stop bypassing until they are redeployed.' : '');
  },
  async production() {
    return { production: true, why: 'Revoking a bypass changes who can reach live deployment URLs' };
  },
  async targets(_args, b) { return [{ kind: 'project', id: b.id, name: b.name }]; },
  async apply(_args, ctx, b, requestKey) {
    const provider = await writeProvider(ctx);
    let secret;
    await requirePreDispatch(async () => {
      const row = await provider.read('projects_get', { path: { idOrName: b.id } });
      const target = bypassEntries(row).find(e => fp(e.secret) === b.fingerprint);
      if (row?.id !== b.id || !target)
        throw new TypeError('Bypass secret changed since the confirmed preview');
      secret = target.secret;
    });
    return provider.write('project_protection_bypass_update', {
      path: { idOrName: b.id }, body: { revoke: { secret, regenerate: false } }
    }, { requestKey, tool: 'vercel_protection_revoke_bypass', shapeResult: row => {
      const map = row?.protectionBypass;
      if (map && typeof map === 'object' && Object.hasOwn(map, secret))
        throw new TypeError('Provider did not prove the bypass revocation');
      return { revoked: true };
    } });
  },
  async verify(_args, ctx, b) {
    const { client } = await readProvider(ctx);
    const row = await client.request('projects_get', { path: { idOrName: b.id } });
    return { confirmed: !bypassEntries(row).some(e => fp(e.secret) === b.fingerprint),
      project: b.id };
  }
});

function shareableEntries(row) {
  const map = row?.protectionBypass;
  if (!map || typeof map !== 'object' || Array.isArray(map)) return [];
  return Object.entries(map)
    .filter(([, v]) => v && typeof v === 'object' && v.scope === 'shareable-link')
    .map(([secret, v]) => ({ secret,
      createdAt: Number.isFinite(v.createdAt) ? v.createdAt : null }));
}
const shareableLink = defineWrite({
  name: 'vercel_alias_set_shareable_link', risk: { access: true },
  secretOut: true, oneTimeDelivery: true,
  oneTimeWhen: args => args.action === 'create',
  async before(args, ctx) {
    strictArgs(args, ['alias', 'action', 'ttlSeconds', 'createdAt', 'confirm', 'dryRun', 'requestKey']);
    if (typeof args.alias !== 'string' || !ALIAS.test(args.alias) ||
      !['create', 'revoke'].includes(args.action) ||
      (args.ttlSeconds !== undefined && (args.action !== 'create' ||
        !Number.isSafeInteger(args.ttlSeconds) || args.ttlSeconds < 60 || args.ttlSeconds > 63072000)) ||
      (args.action === 'revoke' && !Number.isSafeInteger(args.createdAt)) ||
      (args.action === 'create' && args.createdAt !== undefined))
      throw new RefusalError('Invalid shareable link change');
    const { client } = await readProvider(ctx);
    const row = await client.request('release_alias_get', { path: { idOrAlias: args.alias } });
    if (typeof row?.uid !== 'string' || typeof row?.alias !== 'string' ||
      typeof row?.projectId !== 'string')
      throw new RefusalError('Alias identity unavailable');
    const links = shareableEntries(row);
    if (args.action === 'create') {
      if (links.length)
        throw new RefusalError('This URL already has a shareable link; revoke it before creating another');
      validateRequest('aliases_protection_bypass_update', {
        path: { id: args.alias }, query: { teamId: 'team_FAKE_validation' },
        body: args.ttlSeconds ? { ttl: args.ttlSeconds } : {} });
      return { aliasId: row.uid, aliasName: row.alias, projectId: row.projectId, action: 'create',
        existing: links.map(e => fp(e.secret)) };
    }
    const target = links.find(e => e.createdAt === args.createdAt);
    if (!target) throw new RefusalError('No shareable link with that creation time exists for this URL');
    validateRequest('aliases_protection_bypass_update', {
      path: { id: args.alias }, query: { teamId: 'team_FAKE_validation' },
      body: { revoke: { secret: 'a'.repeat(32), regenerate: false } } });
    return { aliasId: row.uid, aliasName: row.alias, projectId: row.projectId, action: 'revoke',
      fingerprint: fp(target.secret) };
  },
  async preview(args, _ctx, b) {
    return b.action === 'create'
      ? 'Create a shareable link for ' + b.aliasName +
        ': anyone with the link can view this deployment without signing in.' +
        (args.ttlSeconds ? ' It expires after ' + args.ttlSeconds + ' seconds.' : ' It does not expire.') +
        ' The link is shown once on the setup page, never here.'
      : 'Revoke the shareable link for ' + b.aliasName +
        ': anyone using that link loses access to this deployment.';
  },
  async production() {
    return { production: true, why: 'A shareable link changes who can reach this deployment URL' };
  },
  async access(_args, before) {
    return before.action === 'create'
      ? { widens: true, who: 'Anyone who has the shareable link',
          what: 'View this deployment without signing in' }
      : { widens: false };
  },
  // Ownership is proven through the owning project: the guards can only
  // classify project targets, and the alias record carries its projectId.
  async targets(_args, b) { return [{ kind: 'project', id: b.projectId, name: b.aliasName }]; },
  async apply(args, ctx, b, requestKey) {
    const provider = await writeProvider(ctx);
    if (b.action === 'create') {
      await provider.write('aliases_protection_bypass_update', {
        path: { id: b.aliasId }, body: args.ttlSeconds ? { ttl: args.ttlSeconds } : {}
      }, { requestKey, tool: 'vercel_alias_set_shareable_link', shapeResult: row => {
        if (!row || typeof row !== 'object') throw new TypeError('Shareable link response unproven');
        return { acknowledged: true };
      } });
      // The pinned snapshot documents this response as opaque, so the minted
      // secret is recovered from the documented alias read, never the reply.
      const { client } = await readProvider(ctx);
      const row = await client.request('release_alias_get', { path: { idOrAlias: b.aliasId } });
      const fresh = shareableEntries(row).find(e => !b.existing.includes(fp(e.secret)));
      if (!fresh) throw new TypeError('Shareable link was not proven by read-back');
      const receipt = await oneTimeSecrets({ db: ctx.db, env: ctx.env }).issue({
        account: ctx.connection.account, kind: 'shareable_link',
        label: 'Shareable link for ' + b.aliasName, value: fresh.secret });
      return { ownerRevealRef: receipt.id, expiresAt: receipt.expiresAt,
        fingerprint: fp(fresh.secret) };
    }
    let secret;
    await requirePreDispatch(async () => {
      const row = await provider.read('release_alias_get', { path: { idOrAlias: b.aliasId } });
      const target = shareableEntries(row).find(e => fp(e.secret) === b.fingerprint);
      if (!target) throw new TypeError('Shareable link changed since the confirmed preview');
      secret = target.secret;
    });
    return provider.write('aliases_protection_bypass_update', {
      path: { id: b.aliasId }, body: { revoke: { secret, regenerate: false } }
    }, { requestKey, tool: 'vercel_alias_set_shareable_link', shapeResult: row => {
      if (!row || typeof row !== 'object') throw new TypeError('Shareable link response unproven');
      return { acknowledged: true };
    } });
  },
  async verify(_args, ctx, b, applied) {
    const { client } = await readProvider(ctx);
    const row = await client.request('release_alias_get', { path: { idOrAlias: b.aliasId } });
    const present = b.action === 'create'
      ? shareableEntries(row).some(e => fp(e.secret) === applied?.fingerprint)
      : !shareableEntries(row).some(e => fp(e.secret) === b.fingerprint);
    return { confirmed: present, alias: b.aliasId };
  }
});

function guarded({ spec, name, inputSchema, description }, profiles) {
  return {
    tool: { name, writes: true, guardedWrite: true, profiles,
      area: 'protection', description, inputSchema,
      writeContract: spec.writeContract,
      annotations: { readOnlyHint: false, destructiveHint: false } },
    handler: bindGuardedWrite(spec, context, result)
  };
}

const authTool = guarded(setVercelAuth, FULL);
const passwordTool = guarded(setPassword, FULL);
const trustedTool = guarded(setTrustedIps, FULL);
const createBypassTool = {
  tool: { name: 'vercel_protection_create_bypass', writes: true, guardedWrite: true,
    profiles: FULL, area: 'protection',
    description: 'Create a protection-bypass secret for a project; it is shown once on the setup page, never in a result.',
    inputSchema: { type: 'object', additionalProperties: false,
      properties: {
        project: { type: 'string', minLength: 1, maxLength: 128 },
        note: { type: 'string', minLength: 3, maxLength: 100 },
        confirm: { type: 'boolean' }, dryRun: { type: 'boolean' },
        requestKey: { type: 'string', pattern: '^[a-zA-Z0-9_-]{8,128}$' } },
      required: ['project'] },
    writeContract: createBypass.writeContract,
    annotations: { readOnlyHint: false, destructiveHint: false } },
  handler: bindGuardedWrite(createBypass, context, result)
};
const revokeBypassTool = {
  tool: { name: 'vercel_protection_revoke_bypass', writes: true, guardedWrite: true,
    profiles: FULL, area: 'protection',
    description: 'Revoke one protection-bypass secret of a project, identified by its note (the secret itself is never needed or shown).',
    inputSchema: { type: 'object', additionalProperties: false,
      properties: {
        project: { type: 'string', minLength: 1, maxLength: 128 },
        note: { type: 'string', minLength: 3, maxLength: 100 },
        createdAt: { type: 'integer', minimum: 0 },
        confirm: { type: 'boolean' }, dryRun: { type: 'boolean' },
        requestKey: { type: 'string', pattern: '^[a-zA-Z0-9_-]{8,128}$' } },
      required: ['project', 'note'] },
    writeContract: revokeBypass.writeContract,
    annotations: { readOnlyHint: false, destructiveHint: false } },
  handler: bindGuardedWrite(revokeBypass, context, result)
};
const shareableTool = {
  tool: { name: 'vercel_alias_set_shareable_link', writes: true, guardedWrite: true,
    profiles: ['everyday', 'full'], area: 'protection',
    description: 'Create or revoke a shareable link for one protected deployment URL; a created link is shown once on the setup page.',
    inputSchema: { type: 'object', additionalProperties: false,
      properties: {
        alias: { type: 'string', minLength: 1, maxLength: 253 },
        action: { type: 'string', enum: ['create', 'revoke'] },
        ttlSeconds: { type: 'integer', minimum: 60, maximum: 63072000 },
        createdAt: { type: 'integer', minimum: 0 },
        confirm: { type: 'boolean' }, dryRun: { type: 'boolean' },
        requestKey: { type: 'string', pattern: '^[a-zA-Z0-9_-]{8,128}$' } },
      required: ['alias', 'action'] },
    writeContract: shareableLink.writeContract,
    annotations: { readOnlyHint: false, destructiveHint: false } },
  handler: bindGuardedWrite(shareableLink, context, result)
};

export const protectionTools = {
  tools: [
    { name: 'vercel_protection_get', writes: false, area: 'protection', profiles: READ_PROFILES,
      description: 'Read a project\u2019s deployment protection: Vercel Authentication, password protection, trusted IPs, OPTIONS allowlist and bypass notes.',
      inputSchema: { type: 'object', properties: { project: { type: 'string' } },
        required: ['project'], additionalProperties: false },
      annotations: { readOnlyHint: true } },
    { name: 'vercel_protection_list_bypass', writes: false, area: 'protection', profiles: READ_PROFILES,
      description: 'List a project\u2019s protection-bypass secrets by note and date only; secret values are never returned.',
      inputSchema: { type: 'object', properties: { project: { type: 'string' } },
        required: ['project'], additionalProperties: false },
      annotations: { readOnlyHint: true } },
    authTool.tool, passwordTool.tool, trustedTool.tool,
    createBypassTool.tool, revokeBypassTool.tool, shareableTool.tool
  ],
  handlers: {
    async vercel_protection_get(args, ctx) {
      strictArgs(args, ['project']);
      if (typeof args?.project !== 'string' || !ID.test(args.project))
        throw new RefusalError('Invalid project');
      const { row } = await resolveProject(ctx, args.project);
      return text(protectionView(row));
    },
    async vercel_protection_list_bypass(args, ctx) {
      strictArgs(args, ['project']);
      if (typeof args?.project !== 'string' || !ID.test(args.project))
        throw new RefusalError('Invalid project');
      const { row } = await resolveProject(ctx, args.project);
      const entries = publicBypass(bypassEntries(row));
      return text({ project: { id: row.id, name: row.name },
        bypassSecrets: entries.slice(0, 50), count: entries.length,
        capped: entries.length > 50,
        note: 'Secret values are never returned; notes and dates only' });
    },
    vercel_protection_set_vercel_auth: authTool.handler,
    vercel_protection_set_password: passwordTool.handler,
    vercel_protection_set_trusted_ips: trustedTool.handler,
    vercel_protection_create_bypass: createBypassTool.handler,
    vercel_protection_revoke_bypass: revokeBypassTool.handler,
    vercel_alias_set_shareable_link: shareableTool.handler
  }
};
