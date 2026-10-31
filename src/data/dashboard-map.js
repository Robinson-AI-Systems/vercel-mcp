// Owner-facing guidance for settings without a safe, supported read/write API.
// Structured form (contract §11): every entry carries a stable dashboard URL,
// numbered steps {n, action, target, value?}, the expected end state, and —
// where a real read tool can verify the outcome — a verifyWith pointer.
// Dashboard menus can change; the root link is stable, and all changes are
// manual. A guided setting is never reported done unless it is read back
// through its verifyWith tool or the owner says so. Deletion entries are
// steps-only and say so; they never carry a verifyWith.
const DASHBOARD = 'https://vercel.com/dashboard';
const S = (action, target, value) => ({action, target, ...(value !== undefined ? {value} : {})});
const steps = (...items) => items.map((item, i) => ({n: i + 1, ...item}));

const GUIDES = [
  { id: 'production-branch', aliases: ['production branch','live branch'],
    name: 'Production branch', area: 'Project → Settings → Git',
    steps: steps(
      S('Choose the intended team and project.', 'Team and project pickers'),
      S('Open project Settings and the Git area.', 'Project → Settings → Git'),
      S('Find the Production Branch control; compare it with the repository release workflow.', 'Production Branch control'),
      S('Change it only through the owner-approved release procedure.', 'Production Branch control')),
    expected: 'The displayed production branch matches the application release policy.',
    readBack: 'Use vercel_project_get to inspect productionBranch; otherwise verify in Settings.',
    verifyWith: {tool: 'vercel_project_get', args: {}, field: 'productionBranch'},
    changesProduction: true },
  { id: 'spend-management', aliases: ['spend management','budget pause','spend budget','spending limit'],
    name: 'Spend Management', area: 'Team → Settings → Billing / Spend Management',
    steps: steps(
      S('Select the intended team.', 'Team picker'),
      S('Open Billing and locate the current Spend Management controls.', 'Team → Settings → Billing'),
      S('Review alerts, limits and the action taken when thresholds are reached.', 'Spend Management controls'),
      S('Do not enable a paid plan or change a spending guard without owner approval.', 'Spend Management controls')),
    expected: 'The configured budget, alerts and production-pause behavior match the approved policy.',
    readBack: 'Dashboard-only: verify the resulting values in Billing; no Vercel API read-back is claimed.',
    changesProduction: true },
  { id: 'cron-run', aliases: ['run cron','run cron now','trigger cron','cron run now'],
    name: 'Run a scheduled Cron job', area: 'Project → Settings → Cron Jobs',
    steps: steps(
      S('Choose the project and view its registered cron paths.', 'Project → Settings → Cron Jobs'),
      S('Check the expected endpoint and any authorization.', 'Cron job row'),
      S('Use the dashboard run control only if available and explicitly approved.', 'Run control'),
      S('Read the resulting run log or function response.', 'Logs')),
    expected: 'The intended cron was invoked and its run outcome can be inspected.',
    readBack: 'Use runtime logs (vercel_deploy_get_runtime_logs) or verify in the project dashboard.',
    changesProduction: true },
  { id: 'cron-config', aliases: ['enable cron','disable cron','cron schedule','cron jobs'],
    name: 'Cron job configuration', area: 'Project → Settings → Cron Jobs / repository vercel.json',
    steps: steps(
      S('Inspect the project Cron Jobs page.', 'Project → Settings → Cron Jobs'),
      S('Review the deployed vercel.json cron definitions.', 'Repository vercel.json'),
      S('Make source-controlled schedule changes through the app repository, not this MCP.', 'Repository'),
      S('Deploy only under the application release and production approval rules.', 'Deployments')),
    expected: 'Deployed job paths and schedules match the reviewed repository configuration.',
    readBack: 'Use vercel_cron_list, or compare the dashboard and released vercel.json.',
    changesProduction: true },
  { id: 'two-step-login', aliases: ['two-step login','two factor','2fa','two-factor authentication','mfa'],
    name: 'Account two-step authentication', area: 'Account → Settings → Security',
    steps: steps(
      S('Sign in as the intended account owner.', 'Vercel sign-in'),
      S('Open account Security settings.', 'Account → Settings → Security'),
      S('Review available two-factor authentication methods and recovery options.', 'Two-factor section'),
      S('Complete changes directly on the authenticated dashboard, never with secrets in chat.', 'Two-factor section')),
    expected: 'Account security visibly shows the selected second-factor method.',
    readBack: 'Dashboard-only: check the Security screen and recovery settings manually.',
    changesProduction: false },
  { id: 'build-branches', aliases: ['preview branches','ignored build','ignore command','deployment enabled'],
    name: 'Preview and ignored-build branch rules', area: 'Project Git settings and app repository vercel.json',
    steps: steps(
      S('Inspect the current Git integration in project settings.', 'Project → Settings → Git'),
      S('Open the app repository vercel.json ignoreCommand and git.deploymentEnabled rules.', 'Repository vercel.json'),
      S('Review changes through normal repository PRs; do not bypass the app release policy.', 'Repository')),
    expected: 'Only intended branches deploy and docs-only commits do not trigger unnecessary builds.',
    readBack: 'Compare Vercel project Git settings with the current source-controlled vercel.json.',
    changesProduction: false },
  { id: 'preview-protection', aliases: ['preview protection','vercel authentication','deployment protection'],
    name: 'Deployment protection for previews', area: 'Project → Settings → Deployment Protection',
    steps: steps(
      S('Choose the project and open Deployment Protection.', 'Project → Settings → Deployment Protection'),
      S('Inspect who can access preview deployments and existing bypass rules.', 'Protection controls'),
      S('Do not loosen authentication or create a bypass without explicit owner approval.', 'Protection controls')),
    expected: 'Preview access follows the approved project security configuration.',
    readBack: 'Use vercel_protection_get where available or inspect the settings screen.',
    changesProduction: true },
  { id: 'team-general', aliases: ['team name','team slug','rename team','team settings'],
    name: 'Team name, slug and description', area: 'Team → Settings → General',
    steps: steps(
      S('Select the intended team.', 'Team picker'),
      S('Open team Settings, General.', 'Team → Settings → General'),
      S('Edit the name, slug or description. Slug changes affect URLs and are rate-limited by Vercel.', 'General form')),
    expected: 'The team record shows the new name, slug or description.',
    readBack: 'Use vercel_team_get to read the team record back.',
    verifyWith: {tool: 'vercel_team_get', args: {}, field: 'name'},
    changesProduction: false },
  { id: 'team-sso-saml', aliases: ['saml','sso','single sign-on','saml sso','identity provider'],
    name: 'SAML single sign-on', area: 'Team → Settings → Security → SAML',
    steps: steps(
      S('Select the intended team and open Security settings.', 'Team → Settings → Security'),
      S('Connect the identity provider (metadata URL or XML) in the SAML section.', 'SAML section'),
      S('Map IdP groups to team roles before enforcing anything.', 'Directory Sync / role mappings'),
      S('Only enforce SAML once the connection is proven — enforcing without a working connection locks the team out.', 'SAML enforced toggle')),
    expected: 'The team record shows a SAML connection; enforcement matches the approved rollout stage.',
    readBack: 'Use vercel_team_get and inspect the saml field; enforcement changes are guarded by vercel_team_update_security.',
    verifyWith: {tool: 'vercel_team_get', args: {}, field: 'saml'},
    changesProduction: false },
  { id: 'team-members-roles', aliases: ['team members','member roles','invite member','team roles'],
    name: 'Team members and roles', area: 'Team → Settings → Members',
    steps: steps(
      S('Select the intended team and open Members.', 'Team → Settings → Members'),
      S('Review who holds Owner and other paid roles.', 'Members list'),
      S('Prefer the member tools for invites, role changes and removals; the dashboard covers directory-sync-managed exceptions.', 'Members list')),
    expected: 'Membership and roles match the approved roster.',
    readBack: 'Use vercel_member_list to read the roster and pending invites.',
    changesProduction: false },
  { id: 'team-delete', aliases: ['delete team','remove team','close team'],
    name: 'Delete a team', area: 'Team → Settings → General → Delete',
    stepsOnly: true,
    steps: steps(
      S('Move or delete every project, domain and stored resource the team still owns.', 'Team resources'),
      S('Remove the team\u2019s seated accounts from this server first if this server manages it (vercel_remove_account).', 'This server\u2019s setup page'),
      S('Open team Settings, General, and use the Delete Team control at the bottom.', 'Team → Settings → General'),
      S('Type the confirmation exactly as the dashboard asks. This cannot be undone.', 'Delete confirmation')),
    expected: 'The team no longer appears in vercel_account_teams.',
    readBack: 'Steps-only: deletion is confirmed by the dashboard and by vercel_account_teams no longer listing the team.',
    changesProduction: true },
  { id: 'project-general', aliases: ['project name','project settings','rename project','framework preset'],
    name: 'Project name and framework settings', area: 'Project → Settings → General',
    steps: steps(
      S('Choose the intended project and open Settings, General.', 'Project → Settings → General'),
      S('Edit the name or framework/build settings.', 'General form')),
    expected: 'The project record shows the new values.',
    readBack: 'Use vercel_project_get to read the project back.',
    verifyWith: {tool: 'vercel_project_get', args: {}, field: 'name'},
    changesProduction: false },
  { id: 'project-domains', aliases: ['project domains','custom domain','add domain to project'],
    name: 'Project domains', area: 'Project → Settings → Domains',
    steps: steps(
      S('Choose the project and open Settings, Domains.', 'Project → Settings → Domains'),
      S('Add or review the domain and its DNS verification state.', 'Domains list'),
      S('Prefer the domain tools for attach/detach; the dashboard covers registrar-side verification.', 'Domains list')),
    expected: 'The domain is attached and verified.',
    readBack: 'Use vercel_domain_list and the project domain reads to verify attachment.',
    changesProduction: true },
  { id: 'project-env-vars', aliases: ['environment variables','env vars','project env'],
    name: 'Project environment variables', area: 'Project → Settings → Environment Variables',
    steps: steps(
      S('Choose the project and open Settings, Environment Variables.', 'Project → Settings → Environment Variables'),
      S('Prefer the env tools for reads and guarded writes; secret values are generated or entered in the Vercel dashboard, never in chat.', 'Env var list')),
    expected: 'The variable names and targets match the intended configuration (values are never shown by this server).',
    readBack: 'Use vercel_env_list to read variable names and targets back.',
    changesProduction: true },
  { id: 'project-delete', aliases: ['delete project','remove project'],
    name: 'Delete a project', area: 'Project → Settings → General → Delete',
    stepsOnly: true,
    steps: steps(
      S('Confirm nothing live depends on the project (domains, aliases, env, integrations).', 'Project overview'),
      S('Prefer vercel_project_delete for a guarded delete with read-back; the dashboard is the fallback.', 'This server'),
      S('In the dashboard: project Settings, General, Delete Project, and type the confirmation. This cannot be undone.', 'Delete confirmation')),
    expected: 'The project no longer appears in vercel_project_list.',
    readBack: 'Steps-only: deletion is confirmed by vercel_project_list no longer listing the project.',
    changesProduction: true },
  { id: 'plan-change', aliases: ['change plan','upgrade plan','downgrade plan','pro plan','hobby plan'],
    name: 'Change the team plan', area: 'Team → Settings → Billing → Plan',
    steps: steps(
      S('Select the intended team and open Billing.', 'Team → Settings → Billing'),
      S('Compare plans on the Plan page; note seat counts before confirming — plan changes bill immediately.', 'Plan page'),
      S('Confirm only with the owner\u2019s explicit word; this server never changes plans (IN-12-adjacent: billing control stays with the owner).', 'Plan page')),
    expected: 'The team record\u2019s plan matches the chosen plan.',
    readBack: 'Dashboard-only for the change itself; vercel_team_get reports the plan afterwards.',
    changesProduction: false },
  { id: 'payment-method', aliases: ['payment method','credit card','billing card','update card'],
    name: 'Payment method', area: 'Team → Settings → Billing → Payment Method',
    steps: steps(
      S('Select the intended team and open Billing, Payment Method.', 'Team → Settings → Billing'),
      S('Update the card directly on the dashboard — card details never pass through this server or chat.', 'Payment Method form')),
    expected: 'The dashboard shows the new payment method as default.',
    readBack: 'Dashboard-only: payment details have no API read-back and are never handled by this server.',
    changesProduction: false },
  { id: 'invoices', aliases: ['invoices','billing history','receipts','past bills'],
    name: 'Invoices and billing history', area: 'Team → Settings → Billing → Invoices',
    steps: steps(
      S('Select the intended team and open Billing, Invoices.', 'Team → Settings → Billing'),
      S('Download the invoice PDF for records or expense filing.', 'Invoice row')),
    expected: 'The invoice for the period is downloaded.',
    readBack: 'Dashboard-only for documents; vercel_billing_list_charges reports the same period\u2019s charge lines.',
    changesProduction: false },
  { id: 'account-notifications', aliases: ['notifications','email notifications','notification settings'],
    name: 'Account notification preferences', area: 'Account → Settings → Notifications',
    steps: steps(
      S('Open account Settings, Notifications.', 'Account → Settings → Notifications'),
      S('Toggle the email and in-app notifications you want.', 'Notification toggles')),
    expected: 'Notification preferences match the toggles shown.',
    readBack: 'Dashboard-only: no API read-back is claimed.',
    changesProduction: false },
  { id: 'account-delete', aliases: ['delete account','close account','remove account'],
    name: 'Delete the Vercel account', area: 'Account → Settings → General → Delete',
    stepsOnly: true,
    steps: steps(
      S('Delete or transfer every team and project the account owns first.', 'Teams list'),
      S('Open account Settings and the Delete Account control at the bottom.', 'Account → Settings → General'),
      S('Type the confirmation exactly as asked. This cannot be undone and removes the account\u2019s seats everywhere.', 'Delete confirmation')),
    expected: 'The account can no longer sign in.',
    readBack: 'Steps-only: confirmed by the dashboard flow itself.',
    changesProduction: true },
  { id: 'directory-sync', aliases: ['directory sync','dsync','scim','directory'],
    name: 'Directory Sync (SCIM) setup', area: 'Team → Settings → Security → Directory Sync',
    steps: steps(
      S('Connect the identity provider\u2019s SCIM endpoint in the Directory Sync section.', 'Directory Sync section'),
      S('Map directory groups to team roles or access groups.', 'Role mappings'),
      S('Prefer vercel_team_set_directory_role_mappings for the mapping itself once the connection exists.', 'Role mappings')),
    expected: 'Directory groups sync and the role mappings match the approved mapping.',
    readBack: 'The connection itself is dashboard-only; mappings are written and journaled by vercel_team_set_directory_role_mappings.',
    changesProduction: false },
  { id: 'git-connection', aliases: ['connect git','disconnect git','git repository','git integration'],
    name: 'Connect or disconnect a Git repository', area: 'Project → Settings → Git',
    steps: steps(
      S('Choose the project and open Settings, Git.', 'Project → Settings → Git'),
      S('Connect the repository, or disconnect it (disconnecting stops automatic deployments).', 'Connected Git Repository')),
    expected: 'The project record\u2019s link shows the connected repository, or no link when disconnected.',
    readBack: 'Use vercel_project_get and inspect the link field.',
    verifyWith: {tool: 'vercel_project_get', args: {}, field: 'link'},
    changesProduction: true },
  { id: 'deploy-hooks', aliases: ['deploy hooks','deploy hook'],
    name: 'Deploy hooks', area: 'Project → Settings → Git → Deploy Hooks',
    steps: steps(
      S('Choose the project and open Settings, Git, Deploy Hooks.', 'Project → Settings → Git'),
      S('Create a hook for a branch if a URL-triggered deploy is needed; treat the hook URL as a secret.', 'Deploy Hooks')),
    expected: 'The hook exists for the intended branch.',
    readBack: 'Dashboard-only: hook URLs are secrets and are never read back by this server.',
    changesProduction: true },
  { id: 'add-ons-credits', aliases: ['add-ons','add ons','credits','buy credits','usage credits'],
    name: 'Add-ons and usage credits', area: 'Team → Settings → Billing → Usage',
    steps: steps(
      S('Review the add-on or credit on the Billing, Usage page.', 'Team → Settings → Billing'),
      S('Purchases happen only with the owner\u2019s explicit word; a credit purchase is a spend operation (also reachable as a $ operation through vercel_api_write).', 'Usage page')),
    expected: 'The add-on or credit balance shows on the Usage page.',
    readBack: 'Dashboard-only for the purchase; vercel_billing_list_charges shows credit lines afterwards.',
    changesProduction: false },
  { id: 'audit-log', aliases: ['audit log','audit trail'],
    name: 'Audit log', area: 'Team → Activity / Settings → Audit Log (Enterprise)',
    steps: steps(
      S('Use vercel_activity_list for the team activity this server can read.', 'This server'),
      S('The full Enterprise audit log lives in the team\u2019s Audit Log area and via Audit Log Drains.', 'Team → Settings')),
    expected: 'The activity in question is found with its actor and time.',
    readBack: 'Use vercel_activity_list; the Enterprise audit surface itself is dashboard-only.',
    changesProduction: false },
  { id: 'api-tokens', aliases: ['api tokens','access tokens','create token','token page'],
    name: 'API tokens', area: 'Account → Settings → Tokens',
    steps: steps(
      S('Open account Settings, Tokens.', 'Account → Settings → Tokens'),
      S('Prefer vercel_token_create (one-time reveal or stored as a server account) and vercel_token_list; the dashboard is the fallback.', 'Tokens list')),
    expected: 'The token list shows the token with its scope and expiry.',
    readBack: 'Use vercel_token_list to read tokens back (values are never shown).',
    changesProduction: false }
];

function canonical(value) {
  return value.toLowerCase().normalize('NFKC').replace(/[^a-z0-9 ]+/g,' ').replace(/\s+/g,' ').trim();
}

function project(guide) {
  return {found: true, setting: guide.name, id: guide.id, dashboardUrl: DASHBOARD,
    url: DASHBOARD, area: guide.area, steps: guide.steps, expected: guide.expected,
    readBack: guide.readBack, ...(guide.verifyWith ? {verifyWith: guide.verifyWith} : {}),
    ...(guide.stepsOnly ? {stepsOnly: true} : {}),
    changesProduction: guide.changesProduction,
    note: 'Dashboard navigation may differ by account plan or current Vercel layout.'};
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
    return { found: false, setting: term, dashboardUrl: DASHBOARD, url: DASHBOARD,
      steps: steps(
        S('Select the intended account or project in the Vercel dashboard.', 'Dashboard'),
        S('Use Settings search or the relevant settings area.', 'Settings'),
        S('Verify the exact current control before changing it; avoid unapproved production or billing changes.', 'Settings')),
      expected: 'The selected control and current value have been verified on the dashboard.',
      readBack: 'Unknown setting: no automated read-back is claimed.' };
  }
  return project(guide);
}

// The full map for vercel_admin_list_guided_settings: identity and coverage
// only — steps stay behind vercel_where_is_setting.
export function listSettingGuides() {
  return GUIDES.map(guide => ({id: guide.id, setting: guide.name, area: guide.area,
    url: DASHBOARD, stepsOnly: guide.stepsOnly === true,
    hasVerify: Boolean(guide.verifyWith), changesProduction: guide.changesProduction}));
}
