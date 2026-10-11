// Owner-facing guidance for settings without a safe, supported read/write API.
// Dashboard menus can change; the root link is stable, and all changes are manual.
const DASHBOARD = 'https://vercel.com/dashboard';
const GUIDES = [
  { id: 'production-branch', aliases: ['production branch','live branch'],
    name: 'Production branch', area: 'Project → Settings → Git',
    steps: ['Choose the intended team and project.', 'Open project Settings and the Git area.',
      'Find the Production Branch control; compare it with the repository release workflow.',
      'Change it only through the owner-approved release procedure.'],
    expected: 'The displayed production branch matches the application release policy.',
    readBack: 'Use vercel_project_get when D-1 is available to inspect productionBranch; otherwise verify in Settings.',
    changesProduction: true },
  { id: 'spend-management', aliases: ['spend management','budget pause','spend budget','spending limit'],
    name: 'Spend Management', area: 'Team → Settings → Billing / Spend Management',
    steps: ['Select the intended team.', 'Open Billing and locate the current Spend Management controls.',
      'Review alerts, limits and the action taken when thresholds are reached.',
      'Do not enable a paid plan or change a spending guard without owner approval.'],
    expected: 'The configured budget, alerts and production-pause behavior match the approved policy.',
    readBack: 'Dashboard-only: verify the resulting values in Billing; no Vercel API read-back is claimed.',
    changesProduction: true },
  { id: 'cron-run', aliases: ['run cron','run cron now','trigger cron','cron run now'],
    name: 'Run a scheduled Cron job', area: 'Project → Settings → Cron Jobs',
    steps: ['Choose the project and view its registered cron paths.', 'Check the expected endpoint and any authorization.',
      'Use the dashboard run control only if available and explicitly approved.',
      'Read the resulting run log or function response.'],
    expected: 'The intended cron was invoked and its run outcome can be inspected.',
    readBack: 'Use runtime logs once D-2 is available; otherwise verify in the project dashboard.',
    changesProduction: true },
  { id: 'cron-config', aliases: ['enable cron','disable cron','cron schedule','cron jobs'],
    name: 'Cron job configuration', area: 'Project → Settings → Cron Jobs / repository vercel.json',
    steps: ['Inspect the project Cron Jobs page.', 'Review the deployed vercel.json cron definitions.',
      'Make source-controlled schedule changes through the app repository, not this MCP.',
      'Deploy only under the application release and production approval rules.'],
    expected: 'Deployed job paths and schedules match the reviewed repository configuration.',
    readBack: 'Use vercel_cron_list once D-1 is available, or compare the dashboard and released vercel.json.',
    changesProduction: true },
  { id: 'two-step-login', aliases: ['two-step login','two factor','2fa','two-factor authentication','mfa'],
    name: 'Account two-step authentication', area: 'Account → Settings → Security',
    steps: ['Sign in as the intended account owner.', 'Open account Security settings.',
      'Review available two-factor authentication methods and recovery options.',
      'Complete changes directly on the authenticated dashboard, never with secrets in chat.'],
    expected: 'Account security visibly shows the selected second-factor method.',
    readBack: 'Dashboard-only: check the Security screen and recovery settings manually.',
    changesProduction: false },
  { id: 'build-branches', aliases: ['preview branches','ignored build','ignore command','deployment enabled'],
    name: 'Preview and ignored-build branch rules', area: 'Project Git settings and app repository vercel.json',
    steps: ['Inspect the current Git integration in project settings.',
      'Open the app repository vercel.json ignoreCommand and git.deploymentEnabled rules.',
      'Review changes through normal repository PRs; do not bypass the app release policy.'],
    expected: 'Only intended branches deploy and docs-only commits do not trigger unnecessary builds.',
    readBack: 'Compare Vercel project Git settings with the current source-controlled vercel.json.',
    changesProduction: false },
  { id: 'preview-protection', aliases: ['preview protection','vercel authentication','deployment protection'],
    name: 'Deployment protection for previews', area: 'Project → Settings → Deployment Protection',
    steps: ['Choose the project and open Deployment Protection.',
      'Inspect who can access preview deployments and existing bypass rules.',
      'Do not loosen authentication or create a bypass without explicit owner approval.'],
    expected: 'Preview access follows the approved project security configuration.',
    readBack: 'Use vercel_protection_get when the relevant card is implemented or inspect the settings screen.',
    changesProduction: true }
];
function canonical(value) {
  return value.toLowerCase().normalize('NFKC').replace(/[^a-z0-9 ]+/g,' ').replace(/\s+/g,' ').trim();
}
export function findSettingGuide(term) {
  if (typeof term !== 'string' || term.length < 2 || term.length > 120) {
    throw new TypeError('Provide a setting name of 2–120 characters');
  }
  const normalized = canonical(term);
  if (normalized.length < 2) throw new TypeError('Invalid setting name');
  const guide = GUIDES.find(item => item.aliases.some(alias => {
    const key = canonical(alias);
    return key === normalized || (key.length >= 5 && normalized.includes(key));
  }));
  if (!guide) {
    return { found: false, setting: term, dashboardUrl: DASHBOARD,
      steps: ['Select the intended account or project in the Vercel dashboard.',
        'Use Settings search or the relevant settings area.',
        'Verify the exact current control before changing it; avoid unapproved production or billing changes.'],
      expected: 'The selected control and current value have been verified on the dashboard.',
      readBack: 'Unknown setting: no automated read-back is claimed.' };
  }
  return { found: true, setting: guide.name, id: guide.id, dashboardUrl: DASHBOARD,
    area: guide.area, steps: guide.steps, expected: guide.expected,
    readBack: guide.readBack, changesProduction: guide.changesProduction,
    note: 'Dashboard navigation may differ by account plan or current Vercel layout.' };
}
