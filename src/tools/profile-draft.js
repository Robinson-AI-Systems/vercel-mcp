// P-3 (BATCH-P §P6): vercel_profile_draft — turn caller-supplied codebase
// findings into a draft project profile plus the APP-NEEDS-<APP>.md text.
// It never fetches code itself and never writes anything: the caller (an
// agent that read the codebase) supplies structured findings, and the
// mapping onto profile fields is a CLOSED vocabulary — a findings key the
// mapping does not know is reported in `unmapped`, never guessed into the
// profile (design P-3 test). The renderer is shared with
// vercel_workflow_project_setup, which ends a setup by returning the
// same document shape for the app it just created.
import { validateProfile } from './app-guard.js';

const PROFILES = ['read_only', 'everyday', 'full'];
const text = (value) => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });
const ID = /^[a-z0-9][a-z0-9-]{1,60}$/;
const TARGETS = ['production', 'preview', 'development'];
const FINDING_KEYS = ['app', 'name', 'framework', 'nodeVersion',
  'productionBranch', 'releaseRule', 'rollbackCaution', 'projects',
  'crons', 'envNames', 'expectedEnv', 'managedEnv', 'domains', 'dnsRecords',
  'stores', 'storeIds', 'noPreviewBranches', 'protectedSandboxes',
  'costTargetCents', 'scripts'];
const CRON_KEYS = ['path', 'schedule'];
const DNS_KEYS = ['type', 'name', 'value_prefix'];

function fail(message) { throw new TypeError(message); }
function isObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }
function stringList(value, field) {
  if (!Array.isArray(value) || value.some((x) => typeof x !== 'string' || !x)) {
    fail(`Findings field ${field} must be a list of non-empty strings`);
  }
  return [...value];
}

// Map findings onto a profile. Returns { profile, unmapped, notes }.
// Malformed KNOWN fields refuse (named); unknown fields are reported.
export function profileFromFindings(findings) {
  if (!isObj(findings)) fail('Findings must be an object');
  const unmapped = Object.keys(findings).filter((k) => !FINDING_KEYS.includes(k));
  const app = findings.app;
  if (typeof app !== 'string' || !ID.test(app)) {
    fail('Findings need an app id (lowercase slug)');
  }
  const profile = { id: app, name: app };
  const notes = [];
  if (findings.name !== undefined) {
    if (typeof findings.name !== 'string' || !findings.name) {
      fail('Findings field name must be a non-empty string');
    }
    profile.name = findings.name;
  }
  if (findings.projects !== undefined) {
    profile.projects = stringList(findings.projects, 'projects');
  } else {
    profile.projects = [app];
  }
  for (const [field, key] of [['framework', 'framework'],
    ['nodeVersion', 'node_version'], ['productionBranch', 'production_branch'],
    ['rollbackCaution', 'rollback_caution']]) {
    if (findings[field] !== undefined) {
      if (typeof findings[field] !== 'string' || !findings[field]) {
        fail(`Findings field ${field} must be a non-empty string`);
      }
      profile[key] = findings[field];
    }
  }
  if (findings.releaseRule !== undefined) {
    if (!['promote', 'branch'].includes(findings.releaseRule)) {
      fail("Findings field releaseRule must be 'promote' or 'branch'");
    }
    profile.release_rule = findings.releaseRule;
  }
  if (findings.crons !== undefined) {
    if (!Array.isArray(findings.crons)) fail('Findings field crons must be a list');
    profile.expected_crons = findings.crons.map((c, i) => {
      if (!isObj(c) || typeof c.path !== 'string' || !c.path ||
        typeof c.schedule !== 'string' || !c.schedule) {
        fail(`Findings crons[${i}] needs a path and a schedule`);
      }
      for (const k of Object.keys(c)) {
        if (!CRON_KEYS.includes(k)) unmapped.push(`crons[${i}].${k}`);
      }
      return { path: c.path, schedule: c.schedule };
    });
  }
  if (findings.expectedEnv !== undefined) {
    if (!isObj(findings.expectedEnv)) fail('Findings field expectedEnv must be an object');
    const ee = {};
    for (const [target, names] of Object.entries(findings.expectedEnv)) {
      if (!TARGETS.includes(target)) { unmapped.push(`expectedEnv.${target}`); continue; }
      ee[target] = stringList(names, `expectedEnv.${target}`);
    }
    if (Object.keys(ee).length) profile.expected_env = ee;
  } else if (findings.envNames !== undefined) {
    profile.expected_env = {
      production: stringList(findings.envNames, 'envNames')
    };
    notes.push('Variable names were recorded for production only; split ' +
      'them per target on the setup page if preview or development differ.');
  }
  if (findings.managedEnv !== undefined) {
    profile.managed_env = stringList(findings.managedEnv, 'managedEnv');
  }
  if (findings.domains !== undefined) {
    profile.owned_domains = stringList(findings.domains, 'domains');
  }
  if (findings.dnsRecords !== undefined) {
    if (!Array.isArray(findings.dnsRecords)) fail('Findings field dnsRecords must be a list');
    profile.owned_dns_records = findings.dnsRecords.map((r, i) => {
      if (!isObj(r)) fail(`Findings dnsRecords[${i}] must be an object`);
      for (const k of Object.keys(r)) {
        if (!DNS_KEYS.includes(k)) unmapped.push(`dnsRecords[${i}].${k}`);
      }
      const out = {};
      for (const k of DNS_KEYS) {
        if (r[k] !== undefined) {
          if (typeof r[k] !== 'string') fail(`Findings dnsRecords[${i}].${k} must be a string`);
          out[k] = r[k];
        }
      }
      return out;
    });
  }
  if (findings.stores !== undefined) {
    profile.owned_stores = stringList(findings.stores, 'stores');
  }
  if (findings.storeIds !== undefined) {
    profile.owned_store_ids = stringList(findings.storeIds, 'storeIds');
  }
  if (findings.noPreviewBranches !== undefined) {
    profile.no_preview_branches = stringList(findings.noPreviewBranches, 'noPreviewBranches');
  }
  if (findings.protectedSandboxes !== undefined) {
    profile.protected_sandboxes = stringList(findings.protectedSandboxes, 'protectedSandboxes');
  }
  if (findings.costTargetCents !== undefined) {
    if (!Number.isSafeInteger(findings.costTargetCents) ||
      findings.costTargetCents < 0) {
      fail('Findings field costTargetCents must be a non-negative integer');
    }
    profile.cost_target_cents = findings.costTargetCents;
  }
  const problems = validateProfile(profile);
  if (problems.length) {
    fail('Findings do not form a valid profile: ' + problems.join(', '));
  }
  return { profile, unmapped, notes };
}

// The APP-NEEDS document, in the shape of docs/APP-NEEDS-APPLIANCE-DESK.md.
// `extras` carries renderer-only context: script names (no profile field
// holds them), the unmapped-key list, and guidance notes.
export function appNeedsText(profile, extras = {}) {
  const lines = [];
  lines.push(`# What ${profile.name} needs from Vercel, and which tool handles each`);
  lines.push('');
  lines.push('Draft profile generated from codebase findings. Review it, then save ' +
    'the profile on the MCP setup page to activate it; commit this file in the ' +
    "app's own repository.");
  lines.push('');
  lines.push('## What the app manages by itself (the MCP must not duplicate or fight it)');
  lines.push('');
  const own = [];
  if (profile.release_rule === 'branch') {
    own.push('- Releases: production changes only by moving the production ' +
      `branch (${profile.production_branch ?? 'unset'}); the MCP does not promote.`);
  }
  if (profile.no_preview_branches?.length) {
    own.push('- No preview deployments for branches matching: ' +
      profile.no_preview_branches.join(', ') + '.');
  }
  if (profile.managed_env?.length) {
    own.push('- Variables injected by an integration or store (the MCP never ' +
      'writes these): ' + profile.managed_env.join(', ') + '.');
  }
  if (profile.owned_domains?.length) {
    own.push('- Domains the app manages: ' + profile.owned_domains.join(', ') + '.');
  }
  if (profile.owned_dns_records?.length) {
    own.push('- DNS records the app manages: ' +
      profile.owned_dns_records.map((r) =>
        [r.type, r.name, r.value_prefix].filter(Boolean).join(' ')).join('; ') + '.');
  }
  if (profile.owned_stores?.length) {
    own.push('- Stores the app owns: ' + profile.owned_stores.join(', ') + '.');
  }
  if (profile.protected_sandboxes?.length) {
    own.push('- Sandboxes never stopped or deleted: ' +
      profile.protected_sandboxes.join(', ') + '.');
  }
  lines.push(...(own.length ? own : ['- Nothing recorded yet.']));
  lines.push('');
  lines.push('## Everything the app needs from Vercel, and who does it');
  lines.push('');
  lines.push(`- Projects: ${(profile.projects ?? []).join(', ') || '—'} ` +
    '(vercel_project_get / vercel_workflow_project_setup).');
  if (profile.framework) lines.push(`- Framework: ${profile.framework} (project setting).`);
  if (profile.node_version) {
    lines.push(`- Node version: ${profile.node_version} — guided: set "engines" ` +
      'in package.json or the dashboard setting; no MCP tool changes it.');
  }
  if (profile.production_branch) {
    lines.push(`- Production branch: ${profile.production_branch} — branch ` +
      'tracking is a guided dashboard setting.');
  }
  for (const [target, names] of Object.entries(profile.expected_env ?? {})) {
    lines.push(`- Variables expected for ${target}: ${names.join(', ')} ` +
      '(vercel_env_set; values are never part of a profile).');
  }
  for (const c of profile.expected_crons ?? []) {
    lines.push(`- Cron: ${c.path} on schedule ${c.schedule} (vercel_cron_list).`);
  }
  if (profile.cost_target_cents !== undefined && profile.cost_target_cents !== null) {
    lines.push(`- Cost target: ${profile.cost_target_cents} cents per period ` +
      '(vercel_workflow_cost_check).');
  }
  if (extras.scripts?.length) {
    lines.push('');
    lines.push('Repo scripts seen in the findings (names only): ' +
      extras.scripts.join(', ') + '.');
  }
  const open = [...(extras.notes ?? [])];
  if (extras.unmapped?.length) {
    open.push('Findings keys with no profile mapping (reported, not guessed): ' +
      extras.unmapped.join(', ') + '.');
  }
  if (open.length) {
    lines.push('');
    lines.push('## Still to decide');
    lines.push('');
    for (const note of open) lines.push('- ' + note);
  }
  lines.push('');
  return lines.join('\n');
}

export const profileDraftTools = {
  tools: [
    { name: 'vercel_profile_draft', writes: false, area: 'profiles',
      profiles: PROFILES,
      description: 'Turn codebase findings into a draft project profile and APP-NEEDS text. Never fetches code; unknown findings keys are reported, not guessed.',
      inputSchema: { type: 'object',
        properties: { findings: { type: 'object' } },
        required: ['findings'], additionalProperties: false },
      annotations: { readOnlyHint: true } }
  ],
  handlers: {
    async vercel_profile_draft(args) {
      if (!args || typeof args !== 'object' || Array.isArray(args) ||
        Object.keys(args).some((k) => k !== 'findings')) {
        fail('Profile draft takes one findings object');
      }
      const { profile, unmapped, notes } = profileFromFindings(args.findings);
      const scripts = args.findings.scripts !== undefined
        ? stringList(args.findings.scripts, 'scripts') : [];
      return text({
        draft: profile, status: 'draft',
        appNeeds: appNeedsText(profile, { scripts, unmapped, notes }),
        unmapped, notes,
        note: 'Draft only: nothing was stored. Save it on the setup page ' +
          'to activate the profile, and commit the APP-NEEDS text in the ' +
          "app's repository."
      });
    }
  }
};
