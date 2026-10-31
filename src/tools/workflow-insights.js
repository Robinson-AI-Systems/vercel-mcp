// W-6 (BATCH-W §3 row W7, §4 row W-6): cost_check and
// security_audit — the batch's closing reads, composed through the
// registry's dispatch seam like W-1's. cost_check reports real FOCUS
// charges against the target and ties every suggestion to a charge
// actually present (verdict W6-C1). security_audit reports each area
// ok / needs_attention / not_readable and never lets one unreadable
// area fail the whole audit.
import { RefusalError } from '../core/write.js';
import { loadProfiles } from './app-guard.js';

const PROFILES = ['read_only', 'everyday', 'full'];
const BUDGET_MS = 45000;
const SUSPICIOUS_PUBLIC = /KEY|SECRET|TOKEN|PASSWORD|PASSWD|PRIVATE|CREDENTIAL/;
const NINETY_DAYS_MS = 90 * 86400000;

const text = (value) => ({
  content: [{ type: 'text', text: JSON.stringify(value) }] });
async function call(ctx, name, args) {
  const r = await ctx.dispatchTool(name, args);
  if (r?.isError) throw new Error(r.content?.[0]?.text ?? `${name} failed`);
  const raw = r?.content?.[0]?.text;
  try { return JSON.parse(raw); } catch { return { text: raw }; }
}
async function tryCall(ctx, name, args) {
  try { return await call(ctx, name, args); } catch { return null; }
}
function makeBudget() {
  const start = Date.now();
  return { tripped: () => Date.now() - start > BUDGET_MS };
}
async function profileForProject(ctx, projectId, projectName) {
  try {
    const profiles = await loadProfiles(ctx.db, ctx.connection?.account);
    const wanted = String(projectName ?? '').toLowerCase();
    return profiles.find((p) =>
      (Array.isArray(p?.projects) &&
        p.projects.some((n) => String(n).toLowerCase() === wanted)) ||
      (Array.isArray(p?.project_ids) && p.project_ids.includes(projectId))
    ) ?? null;
  } catch { return null; }
}
const money = (cents) => typeof cents === 'number'
  ? `$${(cents / 100).toFixed(2)}` : null;

/* ---------------- cost_check ---------------- */

function assertCostArgs(args) {
  if (!args || typeof args !== 'object' || Array.isArray(args) ||
    Object.keys(args).some((k) => !['project', 'from', 'to'].includes(k)) ||
    (args.project !== undefined &&
      (typeof args.project !== 'string' || !args.project ||
        args.project.length > 128)) ||
    (args.from !== undefined && typeof args.from !== 'string') ||
    (args.to !== undefined && typeof args.to !== 'string')) {
    throw new RefusalError('Invalid cost check request: optional project, from and to');
  }
  return args;
}

async function costCheck(args, ctx) {
  const a = assertCostArgs(args);
  if (typeof ctx.dispatchTool !== 'function') {
    throw new RefusalError('Registry composition is unavailable');
  }
  const windowArgs = { ...(a.from ? { from: a.from } : {}),
    ...(a.to ? { to: a.to } : {}) };
  const summary = await tryCall(ctx, 'vercel_billing_summary', windowArgs);
  const chargesReply = await tryCall(ctx, 'vercel_billing_list_charges',
    windowArgs);
  const charges = chargesReply?.charges ?? null;

  // Drivers: from the charge rows actually present; the summary's own
  // aggregates are the fallback when the rows cannot be listed.
  let byService = null, byProject = null, driverSource = null;
  if (charges) {
    const agg = (key) => {
      const m = new Map();
      for (const c of charges) {
        const name = c[key] ?? 'Unspecified';
        m.set(name, (m.get(name) ?? 0) + (c.effectiveCents ?? 0));
      }
      return [...m.entries()]
        .map(([name, cents]) => ({ name, cents }))
        .sort((x, y) => Math.abs(y.cents) - Math.abs(x.cents)).slice(0, 5);
    };
    byService = agg('service'); byProject = agg('project');
    driverSource = 'charges';
  } else if (summary) {
    byService = (summary.byService ?? []).slice(0, 5)
      .map((s) => ({ name: s.name, cents: s.effectiveCents }));
    byProject = (summary.byProject ?? []).slice(0, 5)
      .map((s) => ({ name: s.name, cents: s.effectiveCents }));
    driverSource = 'summary aggregates (charge rows not readable)';
  }

  // Target: a covering profile's cost_target_cents wins for a named,
  // profiled project; otherwise the billing summary's stored target.
  let project = null, targetCents = summary?.against?.monthlyTargetCents ?? null;
  let targetSource = targetCents !== null ? 'billing setting' : null;
  if (a.project) {
    const proj = await tryCall(ctx, 'vercel_project_get',
      { project: a.project });
    if (proj?.id) {
      project = { id: proj.id, name: proj.name ?? a.project };
      const profile = await profileForProject(ctx, proj.id, proj.name);
      if (profile && Number.isSafeInteger(profile.cost_target_cents)) {
        targetCents = profile.cost_target_cents;
        targetSource = `profile ${profile.name ?? profile.id} cost target`;
      }
    }
  }
  const effective = summary?.effectiveTotalCents ?? null;

  // Builds by day and branch for the named project, paged under budget.
  let builds = null;
  if (project) {
    const budget = makeBudget();
    const byDay = {}, byBranch = {};
    let total = 0, until, complete = false;
    for (let page = 0; page < 10; page++) {
      const reply = await tryCall(ctx, 'vercel_deploy_list',
        { project: project.id, limit: 100, ...(until ? { until } : {}) });
      if (!reply) break;
      for (const d of reply.deployments ?? []) {
        total += 1;
        const day = typeof d.createdAt === 'number'
          ? new Date(d.createdAt).toISOString().slice(0, 10) : 'unknown';
        byDay[day] = (byDay[day] ?? 0) + 1;
        const branch = d.branch ?? 'unknown';
        byBranch[branch] = (byBranch[branch] ?? 0) + 1;
      }
      if (!reply.next) { complete = true; break; }
      until = reply.next;
      if (budget.tripped()) break;
    }
    builds = { total, byDay, byBranch, complete };
  }

  const drains = await tryCall(ctx, 'vercel_drain_list',
    project ? { project: project.id } : {});

  // W6-C1: a suggestion exists only when its charge is present.
  const suggestions = [];
  if (charges) {
    const has = (re) => charges.some((c) => re.test(c.service ?? ''));
    const centsFor = (re) => charges.filter((c) => re.test(c.service ?? ''))
      .reduce((sum, c) => sum + (c.effectiveCents ?? 0), 0);
    if (has(/drain/i)) {
      suggestions.push({ because: `Log drain charges of ${money(centsFor(/drain/i))} in this window${drains ? `; ${drains.drains?.length ?? 0} drains are configured` : ''}`,
        consider: 'Review the configured drains (vercel_drain_list) and remove or narrow any that are no longer used.' });
    }
    if (has(/sandbox/i)) {
      suggestions.push({ because: `Sandbox charges of ${money(centsFor(/sandbox/i))} in this window`,
        consider: 'Sandbox minutes add up in long runs; check sandbox session lifetimes in the calling workflow.' });
    }
    if (has(/analytics/i)) {
      suggestions.push({ because: `Analytics charges of ${money(centsFor(/analytics/i))} in this window`,
        consider: 'Analytics is a paid add-on; confirm it is still wanted on the projects using it.' });
    }
    if (has(/rolling/i)) {
      suggestions.push({ because: `Rolling-release charges of ${money(centsFor(/rolling/i))} in this window`,
        consider: 'Rolling releases are charged while configured; complete or remove stale rolling releases.' });
    }
    if (byService?.length && Math.abs(byService[0].cents) > 0) {
      suggestions.push({ because: `${byService[0].name} is the largest driver at ${money(byService[0].cents)} in this window`,
        consider: `Start the cost review with ${byService[0].name}; it is where the money in this window actually went.` });
    }
  }

  return text({
    window: { from: summary?.from ?? a.from ?? null,
      to: summary?.to ?? a.to ?? null },
    project,
    totals: summary ? { effectiveCents: effective,
        effectiveDisplay: money(effective),
        billedCents: summary.billedTotalCents ?? null,
        creditLinesCents: summary.creditLinesCents ?? null }
      : null,
    target: targetCents !== null ? { cents: targetCents,
        display: money(targetCents), source: targetSource,
        over: effective !== null ? effective > targetCents : null,
        overByCents: effective !== null
          ? Math.max(0, effective - targetCents) : null }
      : null,
    drivers: byService || byProject
      ? { byService, byProject, source: driverSource } : null,
    builds,
    drains: drains ? { count: drains.drains?.length ?? 0 } : null,
    suggestions,
    notes: summary ? [] : ['Billing summary could not be read; totals and target are unavailable.']
  });
}

/* ---------------- security_audit ---------------- */

function assertAuditArgs(args) {
  if (!args || typeof args !== 'object' || Array.isArray(args) ||
    Object.keys(args).some((k) => k !== 'project') ||
    typeof args.project !== 'string' || !args.project ||
    args.project.length > 128) {
    throw new RefusalError('Invalid security audit request: project is required');
  }
  return args;
}
const PROD_COVERING = ['all', 'prod_deployment_urls_and_all_previews'];

async function securityAudit(args, ctx) {
  const a = assertAuditArgs(args);
  if (typeof ctx.dispatchTool !== 'function') {
    throw new RefusalError('Registry composition is unavailable');
  }
  const proj = await call(ctx, 'vercel_project_get', { project: a.project });
  if (typeof proj?.id !== 'string') {
    throw new RefusalError('Project could not be resolved to an exact id');
  }
  const id = proj.id;
  const sections = {};
  const section = (status, facts, reasons = []) =>
    ({ status, facts, reasons });

  // Deployment protection (W6-C2).
  const prot = await tryCall(ctx, 'vercel_protection_get', { project: id });
  if (!prot) {
    sections.protection = section('not_readable', null,
      ['vercel_protection_get could not be read']);
  } else {
    const auth = prot.vercelAuthentication ?? {};
    const pw = prot.passwordProtection ?? {};
    const reasons = [];
    if (!auth.enabled && !pw.enabled) {
      reasons.push('Neither Vercel Authentication nor password protection is enabled');
    } else {
      if (auth.enabled && !PROD_COVERING.includes(auth.deploymentType)) {
        reasons.push(auth.deploymentType === 'all_except_custom_domains'
          ? 'Vercel Authentication does not cover custom domains'
          : `Vercel Authentication covers only ${auth.deploymentType ?? 'an unknown scope'}, not production`);
      }
      if (!auth.enabled && pw.enabled &&
        !PROD_COVERING.includes(pw.deploymentType) &&
        pw.deploymentType !== 'all_except_custom_domains') {
        reasons.push('Password protection does not cover production deployments');
      }
    }
    sections.protection = section(reasons.length ? 'needs_attention' : 'ok',
      { vercelAuthentication: auth, passwordProtection: pw,
        trustedIpsEnabled: prot.trustedIps?.enabled ?? null }, reasons);
  }

  // Bypass secrets: anything older than 90 days is flagged.
  const bypass = await tryCall(ctx, 'vercel_protection_list_bypass',
    { project: id });
  if (!bypass) {
    sections.bypass = section('not_readable', null,
      ['vercel_protection_list_bypass could not be read']);
  } else {
    const now = Date.now();
    const aged = (bypass.bypassSecrets ?? [])
      .filter((b) => b.createdAt &&
        now - Date.parse(b.createdAt) > NINETY_DAYS_MS)
      .map((b) => ({ note: b.note ?? null,
        ageDays: Math.floor((now - Date.parse(b.createdAt)) / 86400000) }));
    sections.bypass = section(aged.length ? 'needs_attention' : 'ok',
      { count: bypass.count ?? (bypass.bypassSecrets?.length ?? 0),
        capped: bypass.capped ?? false },
      aged.map((b) => `Bypass secret ${b.note ? `"${b.note}" ` : ''}is ${b.ageDays} days old (over 90); rotate or revoke it if it is still needed`));
  }

  // Firewall.
  const fw = await tryCall(ctx, 'vercel_firewall_get', { project: id });
  if (!fw) {
    sections.firewall = section('not_readable', null,
      ['vercel_firewall_get could not be read']);
  } else {
    const reasons = [];
    if (fw.firewallEnabled !== true) {
      reasons.push('The firewall is not enabled on this project');
    }
    const managedActive = Object.values(fw.managedRules ?? {})
      .filter((r) => r?.active === true).length;
    sections.firewall = section(reasons.length ? 'needs_attention' : 'ok',
      { enabled: fw.firewallEnabled ?? null,
        activeVersion: fw.activeVersion ?? null,
        rules: (fw.rules ?? []).length, managedRulesActive: managedActive },
      reasons);
  }

  // Variables: Secret inventory + suspicious public names.
  const env = await tryCall(ctx, 'vercel_env_list', { project: id });
  if (!env) {
    sections.variables = section('not_readable', null,
      ['vercel_env_list could not be read']);
  } else {
    const items = env.items ?? [];
    const flagged = items.map((i) => i.key)
      .filter((k) => typeof k === 'string' &&
        k.startsWith('NEXT_PUBLIC_') && SUSPICIOUS_PUBLIC.test(k));
    sections.variables = section(flagged.length ? 'needs_attention' : 'ok',
      { total: items.length,
        secretKind: items.filter((i) => i.kind === 'Secret').length,
        capped: env.capped ?? false },
      flagged.map((k) => `${k} is public (NEXT_PUBLIC_) but its name looks secret — its value is shipped to the browser`));
  }

  // Access: project members + team roster.
  const pm = await tryCall(ctx, 'vercel_project_list_members',
    { project: id });
  const tm = await tryCall(ctx, 'vercel_member_list', {});
  if (!pm && !tm) {
    sections.access = section('not_readable', null,
      ['Neither project members nor the team roster could be read']);
  } else {
    const roleCount = (members) => {
      const out = {};
      for (const m of members ?? []) {
        const role = m.role ?? 'unknown';
        out[role] = (out[role] ?? 0) + 1;
      }
      return out;
    };
    sections.access = section('ok', {
      projectMembers: pm ? { count: pm.count ?? pm.members?.length ?? 0,
        roles: roleCount(pm.members), complete: pm.complete ?? null } : null,
      teamMembers: tm ? { count: tm.members?.length ?? 0,
        roles: roleCount(tm.members),
        pendingInvites: tm.invites?.length ?? 0 } : null },
      [...(!pm ? ['Project members could not be read'] : []),
        ...(!tm ? ['The team roster could not be read'] : [])]);
  }

  const statuses = Object.values(sections).map((s) => s.status);
  return text({ project: { id, name: proj.name ?? a.project },
    overall: statuses.includes('needs_attention') ? 'needs_attention'
      : statuses.includes('not_readable') ? 'partially_readable' : 'ok',
    sections });
}

export const workflowInsightsTools = {
  tools: [
    { name: 'vercel_workflow_cost_check', writes: false, profiles: PROFILES,
      area: 'workflows',
      description: 'Month so far vs target: real charges, cost drivers, builds by day/branch.',
      inputSchema: { type: 'object', properties: {
          project: { type: 'string' }, from: { type: 'string' },
          to: { type: 'string' } },
        additionalProperties: false },
      annotations: { readOnlyHint: true } },
    { name: 'vercel_workflow_security_audit', writes: false, profiles: PROFILES,
      area: 'workflows',
      description: 'One project security audit: protection, bypass age, firewall, variables, access.',
      inputSchema: { type: 'object', properties: {
          project: { type: 'string' } }, required: ['project'],
        additionalProperties: false },
      annotations: { readOnlyHint: true } }],
  handlers: { vercel_workflow_cost_check: costCheck,
    vercel_workflow_security_audit: securityAudit }
};
