// W-4 (BATCH-W §3 row W5): setup_custom_domain. A guarded write
// composing the domain tools through the registry's dispatch seam
// (verdict C-1): attach -> config check -> DNS steps -> verify ->
// certificate. The DNS records' values exist only in the post-attach
// config read, so those steps are derived in apply() from that
// read-back (card verdict W4-C1), each dispatched through its own
// guarded pipeline with derived request keys continuing the sequence.
// When Vercel does not host the DNS, the workflow stops after attach
// and hands back the exact recommended records (W4-C2).
import { defineWrite, bindGuardedWrite, RefusalError } from '../core/write.js';
import { compact } from '../core/util.js';
import { accountSpendGuard } from '../vercel/spend.js';
import { checkProtected } from './self-guard.js';
import { checkApp } from './app-guard.js';

const DOMAIN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const schema = { type: 'object', properties: {
  description: { type: 'object' },
  dryRun: { type: 'boolean' }, confirm: { type: 'boolean' },
  requestKey: { type: 'string', pattern: '^[A-Za-z0-9_-]{8,128}$' }
}, required: ['description'], additionalProperties: false };

async function call(ctx, name, args) {
  const r = await ctx.dispatchTool(name, args);
  if (r?.isError) throw new Error(r.content?.[0]?.text ?? `${name} failed`);
  const raw = r?.content?.[0]?.text;
  try { return JSON.parse(raw); } catch { return { text: raw }; }
}
async function tryCall(ctx, name, args) {
  try { return await call(ctx, name, args); } catch { return null; }
}
function reasonOf(envelope, fallback) {
  if (envelope && typeof envelope === 'object' &&
    typeof envelope.reason === 'string') return envelope.reason;
  return fallback;
}
async function tryStep(ctx, name, args) {
  try { return { ok: true, value: await call(ctx, name, args) }; }
  catch (err) {
    let parsed = null;
    try { parsed = JSON.parse(String(err?.message ?? '')); } catch { /* keep null */ }
    return { ok: false, value: parsed,
      reason: reasonOf(parsed, String(err?.message ?? err).slice(0, 300)) };
  }
}
function stepKey(base, n) { return `${String(base).slice(0, 110)}-s${n}`; }

function context({ db, connection, env, fetchImpl, dispatchTool }) {
  return { db, connection, env, fetchImpl, dispatchTool, shape: compact,
    audit: (entry) => db.recordChange(entry),
    replayStore: db.requestReplayStore(),
    checkSpend: accountSpendGuard({ db, account: connection.account }),
    guardProtected: (targets) => checkProtected(targets, { db, connection, env }),
    guardApp: (targets) => checkApp(targets, { db, connection, env }) };
}

function assertArgs(args) {
  if (!args || typeof args !== 'object' || Array.isArray(args) ||
    Object.keys(args).some((k) => !Object.hasOwn(schema.properties, k)) ||
    !args.description || typeof args.description !== 'object' ||
    Array.isArray(args.description) ||
    (args.confirm !== undefined && typeof args.confirm !== 'boolean') ||
    (args.dryRun !== undefined && typeof args.dryRun !== 'boolean')) {
    throw new RefusalError('Invalid custom-domain request');
  }
  const a = args.description;
  if (typeof a.project !== 'string' || !a.project || a.project.length > 128 ||
    typeof a.domain !== 'string' || !DOMAIN.test(a.domain) ||
    (a.gitBranch !== undefined &&
      (typeof a.gitBranch !== 'string' || !a.gitBranch || a.gitBranch.length > 250)) ||
    (a.outsideApp !== undefined && typeof a.outsideApp !== 'boolean')) {
    throw new RefusalError('Invalid custom-domain description: project, domain, optional gitBranch and outsideApp');
  }
  return a;
}

// The records the config read recommends for this domain, and nothing
// else: apex -> A records; subdomain -> CNAME when one is recommended,
// else A records.
function recommendedRecords(config, domain, apex) {
  const name = domain === apex ? ''
    : domain.slice(0, domain.length - apex.length - 1);
  const out = [];
  if (name !== '' && (config.recommendedCNAME ?? []).length) {
    out.push({ domain: apex, name, type: 'CNAME',
      value: config.recommendedCNAME[0] });
    return out;
  }
  for (const ip of config.recommendedIPv4 ?? []) {
    out.push({ domain: apex, name, type: 'A', value: ip });
  }
  return out;
}
const recordLine = (r) =>
  `${r.type} ${r.name === '' ? '@' : r.name} → ${r.value} (zone ${r.domain})`;

function certCovers(certs, domain) {
  return (certs ?? []).some((cert) => (cert.cns ?? []).some((cn) => {
    if (cn === domain) return true;
    if (typeof cn === 'string' && cn.startsWith('*.')) {
      const suffix = cn.slice(1);
      return domain.endsWith(suffix) &&
        domain.split('.').length === cn.split('.').length;
    }
    return false;
  }));
}

async function domainRow(ctx, projectId, domain) {
  const list = await tryCall(ctx, 'vercel_domain_list_project_domains',
    { project: projectId });
  return (list?.domains ?? []).find((d) => d.name === domain) ?? null;
}

const setupDomain = defineWrite({
  name: 'vercel_workflow_setup_custom_domain',
  async before(args, ctx) {
    const a = assertArgs(args);
    if (typeof ctx.dispatchTool !== 'function') {
      throw new RefusalError('Registry composition is unavailable');
    }
    const proj = await call(ctx, 'vercel_project_get', { project: a.project });
    if (typeof proj?.id !== 'string' || typeof proj?.name !== 'string') {
      throw new RefusalError('Project could not be resolved to an exact id and name');
    }
    const row = await domainRow(ctx, proj.id, a.domain);
    const attached = Boolean(row);
    const steps = [];
    if (!attached) {
      const stepArgs = { project: proj.id, domain: a.domain,
        outsideApp: true,
        ...(a.gitBranch ? { gitBranch: a.gitBranch } : {}) };
      const dry = await tryStep(ctx, 'vercel_domain_attach_to_project',
        { ...stepArgs, dryRun: true, requestKey: stepKey(args.requestKey ?? 'wfdomain', 1) });
      steps.push({ n: 1, tool: 'vercel_domain_attach_to_project',
        args: stepArgs,
        preview: dry.ok ? (dry.value?.preview ?? `Attach ${a.domain}`)
          : `The attach step cannot run on this connection yet: ${dry.reason}` });
    }
    // What is already true is reported, not re-planned (idempotency).
    let config = null, certCovered = null;
    if (attached) {
      config = await tryCall(ctx, 'vercel_domain_check_config',
        { project: proj.id, domain: a.domain });
      const certs = await tryCall(ctx, 'vercel_cert_list', {});
      certCovered = certs ? certCovers(certs.certificates, a.domain) : null;
    }
    return { projectId: proj.id, projectName: proj.name, domain: a.domain,
      gitBranch: a.gitBranch ?? null, outsideApp: a.outsideApp === true,
      attached, apex: row?.apexName ?? a.domain,
      verified: row?.verified ?? null,
      configOk: config ? config.misconfigured === false : null,
      certCovered, steps };
  },
  async preview(_args, _ctx, before) {
    const lines = [`Set up ${before.domain} for ${before.projectName}:`];
    if (before.attached) {
      lines.push(`- Already attached${before.verified ? ' and verified' : ''}${before.configOk ? '; DNS configuration is correct' : ''}${before.certCovered ? '; a certificate already covers it' : ''}.`);
    }
    for (const s of before.steps) lines.push(`- ${s.preview}`);
    lines.push('- After attaching, the workflow reads the DNS configuration Vercel recommends: if Vercel hosts the DNS it creates those records (skipping any already present); if the DNS is hosted elsewhere it stops and hands you the exact records to create.');
    lines.push('- Then it re-checks the configuration and, when the domain verifies and no certificate covers it, issues a certificate.');
    if (before.attached && before.configOk && before.certCovered) {
      lines.push('Nothing to do: the domain is fully set up.');
    }
    return lines.join('\n');
  },
  async production() {
    return { production: true,
      why: 'A custom domain routes live production traffic; its DNS records are production changes' };
  },
  async targets(_args, before) {
    return [{ kind: 'project', id: before.projectId, name: before.projectName,
        outsideApp: before.outsideApp },
      { kind: 'domain', id: before.domain, projectId: before.projectId }];
  },
  async apply(args, ctx, before, requestKey) {
    const report = { projectId: before.projectId, domain: before.domain,
      attached: before.attached, dnsHost: null, recordsCreated: [],
      recordsSkipped: [], needsYou: [], verified: before.verified,
      configOk: before.configOk, certificate: null, stoppedAt: null };
    let n = 0;
    const dispatchStep = async (tool, stepArgs) => {
      n += 1;
      const step = await tryStep(ctx, tool,
        { ...stepArgs, confirm: true, requestKey: stepKey(requestKey, n) });
      if (!step.ok || step.value?.status !== 'applied') {
        report.stoppedAt = { step: n, tool,
          reason: step.ok
            ? reasonOf(step.value, `Step returned status ${step.value?.status ?? 'unknown'}`)
            : step.reason };
        return false;
      }
      return true;
    };
    if (!before.attached) {
      const [planned] = before.steps;
      if (!(await dispatchStep(planned.tool, planned.args))) return report;
      report.attached = true;
    }
    // Config check on the now-attached domain.
    const row = await domainRow(ctx, before.projectId, before.domain);
    const apex = row?.apexName ?? before.apex;
    report.verified = row?.verified ?? report.verified;
    const config = await tryCall(ctx, 'vercel_domain_check_config',
      { project: before.projectId, domain: before.domain });
    if (!config) {
      report.stoppedAt = { step: n + 1, tool: 'vercel_domain_check_config',
        reason: 'The domain configuration could not be read after attach; DNS and certificate steps were not attempted.' };
      return report;
    }
    report.configOk = config.misconfigured === false;
    if (config.misconfigured) {
      const wanted = recommendedRecords(config, before.domain, apex);
      const zone = await tryCall(ctx, 'vercel_dns_list', { domain: apex });
      if (!zone) {
        // External DNS (W4-C2): stop after attach with exact records.
        report.dnsHost = 'external';
        report.needsYou = wanted.map((r) =>
          `Create this record at your DNS host: ${recordLine(r)}`);
        return report;
      }
      report.dnsHost = 'vercel';
      const existing = new Set((zone.records ?? []).map((r) =>
        `${r.type} ${r.name} ${r.value}`));
      for (const rec of wanted) {
        if (existing.has(`${rec.type} ${rec.name} ${rec.value}`)) {
          report.recordsSkipped.push(recordLine(rec));
          continue;
        }
        if (!(await dispatchStep('vercel_dns_create_record',
          { ...rec, outsideApp: true }))) return report;
        report.recordsCreated.push(recordLine(rec));
      }
      const after = await tryCall(ctx, 'vercel_domain_check_config',
        { project: before.projectId, domain: before.domain });
      if (after) report.configOk = after.misconfigured === false;
      const rowAfter = await domainRow(ctx, before.projectId, before.domain);
      report.verified = rowAfter?.verified ?? report.verified;
    }
    // Certificate: only when verified and uncovered.
    if (report.verified === true) {
      const certs = await tryCall(ctx, 'vercel_cert_list', {});
      const covered = certs ? certCovers(certs.certificates, before.domain)
        : null;
      if (covered === true) {
        report.certificate = 'already_covered';
      } else if (covered === false) {
        if (!(await dispatchStep('vercel_cert_issue',
          { cns: [before.domain] }))) return report;
        report.certificate = 'issued';
      } else {
        report.certificate = 'unknown';
      }
    }
    return report;
  },
  async verify(_args, ctx, before, applied) {
    if (applied?.stoppedAt) return { confirmed: false,
      stoppedAt: applied.stoppedAt };
    if (applied?.needsYou?.length) return { confirmed: false,
      needsYou: applied.needsYou };
    const row = await domainRow(ctx, before.projectId, before.domain);
    if (!row) return { confirmed: false };
    const config = await tryCall(ctx, 'vercel_domain_check_config',
      { project: before.projectId, domain: before.domain });
    return { confirmed: row.verified === true &&
        (config ? config.misconfigured === false : false),
      domain: before.domain, verified: row.verified ?? null,
      configOk: config ? config.misconfigured === false : null };
  },
  async inverse(_args, before, applied) {
    return { steps: [{ tool: 'vercel_domain_attach_to_project',
        requestKey: 'derived <workflowKey>-s1',
        undo: "vercel_undo_change over that step's own change-log row" }],
      recordsCreated: applied?.recordsCreated ?? [],
      note: 'Detach with vercel_domain_detach_from_project; delete created DNS records with vercel_dns_delete_record.' };
  },
  async publicReceipt(_args, before, applied) {
    return { project: before.projectName, projectId: before.projectId,
      domain: before.domain, attached: applied?.attached ?? before.attached,
      dnsHost: applied?.dnsHost ?? null,
      recordsCreated: applied?.recordsCreated ?? [],
      recordsSkipped: applied?.recordsSkipped ?? [],
      needsYou: applied?.needsYou ?? [],
      verified: applied?.verified ?? null,
      configOk: applied?.configOk ?? null,
      certificate: applied?.certificate ?? null,
      stoppedAt: applied?.stoppedAt ?? null };
  }
});

export const workflowDomainTools = {
  tools: [{ name: 'vercel_workflow_setup_custom_domain', writes: true,
    guardedWrite: true, profiles: ['full'], area: 'workflows',
    description: 'Attach domain, DNS records if Vercel hosts DNS, verify, issue certificate.',
    inputSchema: schema, writeContract: setupDomain.writeContract,
    annotations: { readOnlyHint: false, destructiveHint: false } }],
  handlers: { vercel_workflow_setup_custom_domain: bindGuardedWrite(setupDomain,
    context, (result) => ({
      isError: ['refused_by_guard', 'outcome_unknown'].includes(result.status),
      content: [{ type: 'text', text: JSON.stringify(result) }]
    })) }
};
