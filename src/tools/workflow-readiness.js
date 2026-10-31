// P-2 (BATCH-P): vercel_workflow_app_readiness — every row of a project
// profile checked against the live account, composed read-only through
// the registry (the dispatchTool seam). Verdicts: done / fixable /
// needs_you / needs_decision. A fixable row carries the exact area-tool
// call; the caller runs it through that tool's own preview and confirm
// (dossier R-1: the composition seam is read-only by construction and
// the guarded-write machinery is sealed, so readiness never writes).
// It never invents values (missing variable names become pending-input
// requests), never touches managed variables, owned DNS records or
// stores, and never promotes for a branch release rule.
import { globMatch, validateProfile } from './app-guard.js';

const PROFILES = ['read_only', 'everyday', 'full'];
const text = (value) => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });

async function call(ctx, name, args) {
  const r = await ctx.dispatchTool(name, args);
  if (r?.isError) {
    throw new Error(r.content?.[0]?.text ?? `${name} failed`);
  }
  const raw = r?.content?.[0]?.text;
  try { return JSON.parse(raw); } catch { return { text: raw }; }
}
async function tryCall(ctx, name, args) {
  try { return await call(ctx, name, args); } catch { return null; }
}
const major = (v) => {
  const m = /^(\d+)/.exec(String(v ?? ''));
  return m ? m[1] : null;
};
function dnsRuleMatched(rule, records) {
  // Profile rules write the apex as '@'; provider records report it ''.
  const apex = (n) => (n === '@' ? '' : n ?? '');
  return records.some((rec) => {
    if (rule.type && rec.type !== rule.type) return false;
    let compared = false;
    if (rule.name) { compared = true; if (!globMatch(apex(rule.name), apex(rec.name))) return false; }
    if (rule.value_prefix) {
      compared = true;
      if (typeof rec.value !== 'string' || !rec.value.startsWith(rule.value_prefix)) return false;
    }
    return compared;
  });
}

async function projectRows(ctx, profile, projectName, account) {
  const rows = [];
  const push = (row) => rows.push({ project: projectName, ...row });
  let proj = null;
  try {
    proj = await call(ctx, 'vercel_project_get', { project: projectName });
  } catch {
    push({ id: 'project', label: 'Project exists', status: 'needs_you',
      detail: `Project ${projectName} could not be read on this account.`,
      steps: ['Confirm the project name and that this connection is on the team that owns it, or create the project first (vercel_workflow_project_setup).'] });
    return rows;
  }
  push({ id: 'project', label: 'Project exists', status: 'done',
    detail: `${proj.name} (${proj.id})` });

  if (profile.framework) {
    if (proj.framework === profile.framework) {
      push({ id: 'framework', label: 'Framework', status: 'done',
        detail: proj.framework });
    } else {
      push({ id: 'framework', label: 'Framework', status: 'fixable',
        detail: `Project framework is ${proj.framework ?? 'unset'}; the profile expects ${profile.framework}.`,
        fixCall: { tool: 'vercel_project_update_settings',
          args: { project: proj.name, framework: profile.framework } } });
    }
  }
  if (profile.node_version) {
    if (major(proj.nodeVersion) === major(profile.node_version)) {
      push({ id: 'node', label: 'Node version', status: 'done',
        detail: `Node ${proj.nodeVersion}` });
    } else {
      push({ id: 'node', label: 'Node version', status: 'needs_you',
        detail: `Project runs Node ${proj.nodeVersion ?? 'unknown'}; the profile expects ${profile.node_version}. No tool in this server changes a project's Node version (dossier R-2).`,
        steps: [`Set "engines": { "node": "${profile.node_version}.x" } in the app's package.json, or set the project's Node.js Version in the Vercel dashboard (Project → Settings → General), then re-run readiness to read it back.`] });
    }
  }
  if (profile.production_branch) {
    const actual = proj.productionBranch ?? proj.git?.productionBranch ?? null;
    if (actual === profile.production_branch) {
      push({ id: 'production-branch', label: 'Production branch tracking',
        status: 'done', detail: `Tracking ${actual}` });
    } else {
      push({ id: 'production-branch', label: 'Production branch tracking',
        status: 'needs_you',
        detail: `Production tracks ${actual ?? 'an unknown branch'}; the profile expects ${profile.production_branch}. Branch tracking is a guided dashboard setting (no API).`,
        steps: [`In the Vercel dashboard open the project → Settings → Git → Production Branch and set it to ${profile.production_branch}.`, 'Re-run readiness afterwards; it reads the tracked branch back.'] });
    }
  }
  if (Array.isArray(profile.no_preview_branches) && profile.no_preview_branches.length) {
    if (typeof proj.ignoreBuildStep === 'string' && proj.ignoreBuildStep) {
      push({ id: 'no-preview-branches', label: 'No-preview branch rule',
        status: 'done',
        detail: 'An ignore-build-step command is set on the project; its contents live in the app repo. This server additionally refuses previews for the profile branches without outsideApp.' });
    } else {
      push({ id: 'no-preview-branches', label: 'No-preview branch rule',
        status: 'needs_you',
        detail: `No ignore-build-step command is set; the profile's never-preview branches (${profile.no_preview_branches.join(', ')}) are enforced for this server's own previews by the profile guard, but the app-side rule is missing. Report only — the rule lives in the app's repo.`,
        steps: ['Add the branch rule to the app repo (vercel.json git.deploymentEnabled / ignore command), as the app already does for its other branches.'] });
    }
  }
  if (profile.release_rule) {
    const caution = typeof profile.rollback_caution === 'string' &&
      profile.rollback_caution.length > 0;
    push({ id: 'release-rule', label: 'Release rule', status: 'done',
      detail: profile.release_rule === 'branch'
        ? `Production changes only by moving the ${profile.production_branch ?? 'production'} branch; promotes need outsideApp and rollback stays available.${caution ? ' Rollback caution is recorded.' : ' No rollback caution is recorded.'}`
        : 'Production changes by promote; the guard labels profile-owned releases.' });
  }

  // Environment rows (names only — values are never read).
  const expectedEnv = profile.expected_env ?? {};
  const managed = new Set(profile.managed_env ?? []);
  const targets = ['production', 'preview', 'development']
    .filter((t) => Array.isArray(expectedEnv[t]) && expectedEnv[t].length);
  if (targets.length) {
    let inventory = null;
    try {
      inventory = await call(ctx, 'vercel_env_list', { project: projectName });
    } catch { inventory = null; }
    for (const target of targets) {
      const id = `env-${target}`;
      if (!inventory) {
        push({ id, label: `Variables: ${target}`, status: 'needs_you',
          detail: 'The variable inventory could not be read.' });
        continue;
      }
      const present = new Set((inventory.items ?? [])
        .filter((i) => (i.targets ?? []).includes(target)).map((i) => i.key));
      const missing = expectedEnv[target].filter((k) => !present.has(k));
      if (!missing.length) {
        push({ id, label: `Variables: ${target}`, status: 'done',
          detail: `All ${expectedEnv[target].length} expected names are present.` });
        continue;
      }
      const plain = missing.filter((k) => !managed.has(k));
      const managedMissing = missing.filter((k) => managed.has(k));
      push({ id, label: `Variables: ${target}`, status: 'needs_you',
        detail: `Missing in ${target}: ${missing.join(', ')}.`,
        ...(plain.length ? { pendingInputs: plain.map((key) => ({
          key, target,
          label: `${key} (${target}) for ${profile.name}`,
          note: 'Readiness never invents values; supply the value and set it with vercel_env_set.' })) } : {}),
        ...(managedMissing.length ? { steps: [
          `${managedMissing.join(', ')} are managed by an integration or store — connect it (vercel_integration_connect_resource); never set them by hand.`] } : {}) });
    }
    // Preview database isolation (names + compare verdicts, never values).
    // A key absent from preview cannot reach the production database; a
    // key present in preview must provably differ (compare verdicts).
    const isoKeys = ['DATABASE_URL', 'DIRECT_URL'].filter((k) =>
      (expectedEnv.production ?? []).includes(k));
    if (isoKeys.length && !inventory) {
      push({ id: 'env-isolation', label: 'Preview database isolation',
        status: 'needs_you',
        detail: 'Isolation could not be checked: the variable inventory could not be read.' });
    } else if (isoKeys.length) {
      const previewPresent = new Set((inventory.items ?? [])
        .filter((i) => (i.targets ?? []).includes('preview')).map((i) => i.key));
      const toCompare = isoKeys.filter((k) => previewPresent.has(k));
      const absent = isoKeys.filter((k) => !previewPresent.has(k));
      const cmp = toCompare.length
        ? await tryCall(ctx, 'vercel_env_compare', {
          left: { project: projectName, target: 'production' },
          right: { project: projectName, target: 'preview' }, keys: toCompare })
        : null;
      const comparisons = cmp?.comparisons ?? [];
      const verdict = new Map(comparisons.map((c) => [c.key, c.status]));
      const same = toCompare.filter((k) => verdict.get(k) === 'same');
      if (!toCompare.length || toCompare.every((k) => verdict.get(k) === 'different')) {
        push({ id: 'env-isolation', label: 'Preview database isolation',
          status: 'done',
          detail: [
            absent.length ? `Not set for preview at all: ${absent.join(', ')}.` : '',
            toCompare.length ? `Preview values differ from production for ${toCompare.join(', ')} (compared without reading them).` : ''
          ].filter(Boolean).join(' ') });
      } else if (same.length) {
        push({ id: 'env-isolation', label: 'Preview database isolation',
          status: 'needs_you',
          detail: `Preview shares the production value for ${same.join(', ')} — previews would write to the production database.`,
          steps: ['Point the preview values at the preview database (a separate Neon branch), then re-run readiness.'] });
      } else {
        push({ id: 'env-isolation', label: 'Preview database isolation',
          status: 'needs_you',
          detail: `Isolation could not be verified (${comparisons.map((c) => `${c.key}: ${c.status}`).join('; ') || 'compare unavailable'}). Secret values are never read by this server, so sameness of secrets is unprovable here (dossier R-3).`,
          steps: ['Confirm in the database console that the preview variables point at the preview database/branch.'] });
      }
    }
  }

  if (Array.isArray(profile.expected_crons) && profile.expected_crons.length) {
    const cron = await tryCall(ctx, 'vercel_cron_list', { project: projectName });
    if (!cron || cron.available !== true) {
      push({ id: 'crons', label: 'Cron schedule', status: 'needs_you',
        detail: 'Cron definitions were not returned, so the schedule cannot be verified.' });
    } else {
      const have = new Map((cron.jobs ?? []).map((j) => [j.path, j.scheduleUtc]));
      const missing = profile.expected_crons.filter((c) => !have.has(c.path));
      const drifted = profile.expected_crons.filter((c) =>
        have.has(c.path) && have.get(c.path) !== c.schedule);
      if (!missing.length && !drifted.length) {
        push({ id: 'crons', label: 'Cron schedule', status: 'done',
          detail: `All ${profile.expected_crons.length} expected crons are present with matching schedules.` });
      } else {
        push({ id: 'crons', label: 'Cron schedule', status: 'needs_you',
          detail: [
            missing.length ? `Missing: ${missing.map((c) => c.path).join(', ')}.` : '',
            drifted.length ? `Schedule differs: ${drifted.map((c) => `${c.path} (expected ${c.schedule}, found ${have.get(c.path)})`).join(', ')}.` : ''
          ].filter(Boolean).join(' '),
          steps: ['Crons are declared in the app repo (vercel.json); fix them there — this server never edits vercel.json.'] });
      }
    }
  }

  if (Array.isArray(profile.owned_domains) && profile.owned_domains.length) {
    const attached = await tryCall(ctx, 'vercel_domain_list_project_domains',
      { project: projectName });
    const team = await tryCall(ctx, 'vercel_domain_list', {});
    const teamByName = new Map((team?.domains ?? []).map((d) => [d.name, d]));
    for (const domain of profile.owned_domains) {
      const row = (attached?.domains ?? []).find((d) => d.name === domain);
      const expiry = teamByName.get(domain)?.expiresAt;
      const expiryNote = Number.isSafeInteger(expiry)
        ? ` Registration expires ${new Date(expiry).toISOString().slice(0, 10)}.` : '';
      if (!row) {
        push({ id: `domain-${domain}`, label: `Domain ${domain}`,
          status: 'fixable',
          detail: `${domain} is not attached to the project.`,
          fixCall: { tool: 'vercel_domain_attach_to_project',
            args: { project: projectName, domain, outsideApp: true } } });
      } else if (row.verified === true) {
        push({ id: `domain-${domain}`, label: `Domain ${domain}`,
          status: 'done', detail: `${domain} is attached and verified.${expiryNote}` });
      } else if (row.verified === false) {
        push({ id: `domain-${domain}`, label: `Domain ${domain}`,
          status: 'fixable',
          detail: `${domain} is attached but not verified.${expiryNote}`,
          fixCall: { tool: 'vercel_domain_verify_project_domain',
            args: { project: projectName, domain, outsideApp: true } } });
      } else {
        push({ id: `domain-${domain}`, label: `Domain ${domain}`,
          status: 'needs_you',
          detail: `${domain} is attached; its verification state is unknown.${expiryNote}` });
      }
    }
  }
  if (Array.isArray(profile.owned_dns_records) && profile.owned_dns_records.length &&
    Array.isArray(profile.owned_domains)) {
    for (const domain of profile.owned_domains) {
      const dns = await tryCall(ctx, 'vercel_dns_list', { domain });
      if (!dns) {
        push({ id: `dns-${domain}`, label: `DNS records ${domain}`,
          status: 'needs_you', detail: 'DNS records could not be read.' });
        continue;
      }
      const records = dns.records ?? dns.items ?? [];
      const missing = profile.owned_dns_records.filter((r) => !dnsRuleMatched(r, records));
      if (!missing.length) {
        push({ id: `dns-${domain}`, label: `DNS records ${domain}`,
          status: 'done',
          detail: `All ${profile.owned_dns_records.length} owned record rules match live records.` });
      } else {
        push({ id: `dns-${domain}`, label: `DNS records ${domain}`,
          status: 'needs_you',
          detail: `Owned records not found: ${missing.map((r) => `${r.type ?? ''} ${r.name ?? ''}`.trim()).join('; ')}. Readiness never changes owned DNS records.`,
          steps: ['Restore the records in the DNS console (they belong to the app: mail and sending authentication depend on them).'] });
      }
    }
  }

  if (Array.isArray(profile.owned_stores) && profile.owned_stores.length &&
    typeof ctx.db?.listBlobStoreConnections === 'function') {
    let labels = [];
    try {
      labels = (await ctx.db.listBlobStoreConnections(account))
        .map((c) => c.label);
    } catch { labels = []; }
    const missing = profile.owned_stores.filter((s) => !labels.includes(s));
    if (!missing.length) {
      push({ id: 'stores', label: 'Owned stores connected', status: 'done',
        detail: `Connected: ${profile.owned_stores.join(', ')}.` });
    } else {
      push({ id: 'stores', label: 'Owned stores connected',
        status: 'needs_you',
        detail: `Not connected: ${missing.join(', ')}. Blob files in a store are reachable only once the owner connects it (a connection state, not a rule).`,
        steps: ['Connect the store through the enrollment step of the sign-in flow so its label matches the profile.'] });
    }
  }

  const protection = await tryCall(ctx, 'vercel_protection_get',
    { project: proj.id });
  if (protection) {
    if (protection.vercelAuthentication?.enabled) {
      push({ id: 'preview-protection', label: 'Preview protection',
        status: 'done',
        detail: `Vercel Authentication is on (${protection.vercelAuthentication.deploymentType ?? 'scope unknown'}).` });
    } else {
      push({ id: 'preview-protection', label: 'Preview protection',
        status: 'needs_you',
        detail: 'Vercel Authentication is off — previews are publicly reachable.',
        steps: ['Turn on Vercel Authentication for previews (vercel_protection_set_auth or the project\'s Deployment Protection settings).'] });
    }
  }

  for (const [i, entry] of (profile.dashboard_settings ?? []).entries()) {
    const setting = entry?.setting ?? entry?.name ?? '';
    if (!setting || /production branch/i.test(setting)) continue;
    if (typeof entry.decision === 'string' && entry.decision) {
      push({ id: `dashboard-${i}`, label: setting, status: 'needs_decision',
        detail: `Waiting on a decision (${entry.decision}).${entry.recommended ? ` Recommended: ${entry.recommended}` : ''}` });
      continue;
    }
    const guide = await tryCall(ctx, 'vercel_where_is_setting', { setting });
    push({ id: `dashboard-${i}`, label: setting, status: 'needs_you',
      detail: `Guided dashboard setting — this server cannot read or change it.${entry.recommended ? ` Recommended: ${entry.recommended}` : ''}`,
      steps: Array.isArray(guide?.steps) && guide.steps.length
        ? guide.steps
        : [`Open the dashboard and set ${setting}${entry.recommended ? ` to ${entry.recommended}` : ''}, then re-run readiness.`] });
  }
  return rows;
}

export const workflowReadinessTools = {
  tools: [{
    name: 'vercel_workflow_app_readiness', writes: false, area: 'profiles',
    profiles: PROFILES,
    description: 'Check every row of a project profile (or inline spec): done, fixable (exact area-tool call), needs you, or needs a decision. Never invents values.',
    inputSchema: { type: 'object', additionalProperties: false,
      properties: {
        app: { type: 'string', minLength: 1, maxLength: 64 },
        spec: { type: 'object' }
      } },
    annotations: { readOnlyHint: true }
  }],
  handlers: {
    async vercel_workflow_app_readiness(args, ctx) {
      const hasApp = typeof args?.app === 'string' && args.app.length > 0;
      const hasSpec = Boolean(args?.spec && typeof args.spec === 'object' &&
        !Array.isArray(args.spec));
      if (hasApp === hasSpec) {
        throw new TypeError('Give exactly one of app or spec');
      }
      let profile; let profileStatus = 'spec'; let source = 'inline spec';
      if (hasApp) {
        if (typeof ctx.db?.getKnownApp !== 'function') {
          throw new TypeError('Profile storage is unavailable');
        }
        const row = await ctx.db.getKnownApp(ctx.connection.account, args.app);
        if (!row) throw new TypeError(`Unknown app profile: ${args.app}`);
        profile = row.profile; profileStatus = row.status; source = 'stored profile';
      } else {
        const problems = validateProfile(args.spec);
        if (problems.length) {
          throw new TypeError(`Invalid spec profile: ${problems.join(', ')}`);
        }
        profile = args.spec;
      }
      const projects = Array.isArray(profile.projects) ? profile.projects : [];
      const rows = [];
      for (const projectName of projects) {
        rows.push(...await projectRows(ctx, profile, projectName,
          ctx.connection.account));
      }
      const count = (s) => rows.filter((r) => r.status === s).length;
      return text({
        app: profile.id, appName: profile.name, source, profileStatus,
        projects, rows,
        summary: { total: rows.length, done: count('done'),
          fixable: count('fixable'), needsYou: count('needs_you'),
          needsDecision: count('needs_decision') },
        note: 'Read-only check. Fixable rows carry the exact area-tool call; run it through that tool\'s own preview and confirm. Values of variables are never read.'
      });
    }
  }
};
