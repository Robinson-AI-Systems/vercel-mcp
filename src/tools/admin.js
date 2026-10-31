// O-5: administration reads. The security review and cost review compose
// EXISTING provider reads only — nothing here writes. Every section
// reports honestly: ok, needs_attention (with the reason), or not_readable
// (the read failed or no API exists; a guided-setting link is given). A
// failed section read is never dressed up as ok.
import {readProvider} from '../vercel/provider.js';
import {credentialLike} from '../core/util.js';
import {findSettingGuide, listSettingGuides} from '../data/dashboard-map.js';
import {chargeRecords, moneyOf, displayOf} from './billing.js';
import {seatPrice, SECURITY_TOTAL_LABEL} from './members.js';

const PROFILES = ['read_only', 'everyday', 'full'];
const DAY = 86400000;

function safe(value) {
  if (typeof value !== 'string' || credentialLike(value)) return null;
  return value;
}
function result(value) {
  return {content: [{type: 'text', text: JSON.stringify(value)}]};
}
function readEntry(entry) {
  const {properties, ...rest} = entry;
  return {...rest, inputSchema: {type: 'object', additionalProperties: false,
      properties: properties ?? {}},
    annotations: {readOnlyHint: true, destructiveHint: false,
      idempotentHint: true, openWorldHint: true}};
}

async function teamRow(ctx) {
  const {client, account} = await readProvider(ctx);
  if (!account?.team_id) throw new Error('Admin reads need a team-scoped connection.');
  const team = await client.request('teams_get', {path: {teamId: account.team_id}});
  return {client, account, team};
}

async function roster(client, account) {
  const members = [];
  let cursor;
  for (let page = 0; page < 3; page++) {
    const query = cursor ? {limit: 100, until: cursor} : {limit: 100};
    const res = await client.request('teams_members_list',
      {path: {teamId: account.team_id}, query});
    if (Array.isArray(res?.members)) members.push(...res.members);
    cursor = res?.pagination?.next;
    if (!cursor) return {members, invites: res?.emailInviteCodes ?? [], complete: true};
  }
  return {members, invites: [], complete: false};
}

async function item(name, fn) {
  try { return {item: name, ...(await fn())}; }
  catch (error) {
    return {item: name, state: 'not_readable',
      why: `read failed (${error?.code ?? 'unknown'})`};
  }
}
const ok = detail => ({state: 'ok', detail});
const attention = (why, detail) => ({state: 'needs_attention', why, detail});

function tokenFacts(rows, now) {
  const expiring = rows.filter(t => Number.isSafeInteger(t?.expiresAt) &&
    t.expiresAt > now && t.expiresAt - now <= 14 * DAY);
  const leaked = rows.filter(t => t?.leakedAt);
  const noExpiry = rows.filter(t => !Number.isSafeInteger(t?.expiresAt));
  return {total: rows.length, expiringWithin14Days: expiring.length,
    leaked: leaked.length, noExpiryReported: noExpiry.length};
}

async function reviewSecurity(args, ctx) {
  const {client, account, team} = await teamRow(ctx);
  const now = Date.now();
  const items = [];
  items.push(await item('owners', async () => {
    const r = await roster(client, account);
    const owners = r.members.filter(m => m.role === 'OWNER');
    const detail = {owners: owners.length,
      members: r.members.length, rosterComplete: r.complete};
    return owners.length === 1 ?
      attention('exactly one Owner: no backup if that account is ever lost', detail) : ok(detail);
  }));
  items.push({item: 'member_two_step', state: 'not_readable',
    why: 'the member contract reports no two-step field; check per-member in the dashboard',
    detail: {guide: 'two-step-login'}});
  items.push(await item('saml', async () => {
    const r = await roster(client, account);
    const configured = Boolean(team?.saml?.connection);
    const detail = {configured, enforced: team?.saml?.enforced === true,
      members: r.members.length};
    return !configured && r.members.length > 5 ?
      attention(`no SAML connection on a team of ${r.members.length} members`, detail) : ok(detail);
  }));
  items.push(await item('tokens', async () => {
    const page = await client.request('tokens_list', {});
    const rows = Array.isArray(page?.tokens) ? page.tokens : [];
    const facts = tokenFacts(rows, now);
    const old = rows.filter(t => Number.isSafeInteger(t?.createdAt) &&
      now - t.createdAt > 365 * DAY).length;
    const detail = {...facts, olderThanOneYear: old};
    return facts.leaked > 0 ?
      attention(`${facts.leaked} token(s) flagged leaked — revoke them with vercel_token_delete`, detail) : ok(detail);
  }));
  items.push(await item('default_protection', async () => {
    const type = team?.ssoProtection?.deploymentType;
    const detail = {defaultSsoProtection: safe(type)};
    return type ?
      ok(detail) : attention('new projects get no default SSO protection (team default is unset)', detail);
  }));
  return result({team: safe(team?.slug), items,
    note: 'Two-step status per member is the one honest not_readable: Vercel\u2019s member record carries no such field.'});
}

async function costReview(args, ctx) {
  const {client, account} = await teamRow(ctx);
  const {records, from, to} = await chargeRecords(ctx, args ?? {});
  let total = 0;
  const byService = new Map(), byProject = new Map();
  for (const row of records) {
    const cents = moneyOf(row?.EffectiveCost).cents ?? 0;
    total += cents;
    const svc = safe(row?.ServiceName) ?? 'Unspecified service';
    byService.set(svc, (byService.get(svc) ?? 0) + cents);
    const proj = safe(row?.Tags?.ProjectName) ?? 'No project tag';
    byProject.set(proj, (byProject.get(proj) ?? 0) + cents);
  }
  const top = map => [...map.entries()]
    .map(([name, cents]) => ({name, effectiveCents: cents, effectiveDisplay: displayOf(cents)}))
    .sort((a, b) => Math.abs(b.effectiveCents) - Math.abs(a.effectiveCents)).slice(0, 5);
  const r = await roster(client, account);
  let seatCents = 0, unknownPriceRoles = 0;
  for (const m of r.members) {
    const price = seatPrice(m.role);
    if (!price.known) unknownPriceRoles++;
    else seatCents += price.cents;
  }
  const page = await client.request('billing_commitments',
    {query: {teamId: account.team_id}}, {jsonl: true});
  const commitments = Array.isArray(page?.records) ? page.records : [];
  return result({from, to,
    effectiveTotalCents: total, effectiveTotalDisplay: displayOf(total),
    topServices: top(byService), topProjects: top(byProject),
    paidSeats: {monthlyCents: seatCents, monthlyDisplay: displayOf(seatCents),
      rosterComplete: r.complete,
      unknownPriceMembers: unknownPriceRoles,
      // AUD-AJ: a total that excludes an unpriced SECURITY seat is
      // labelled as known-costs-only, in the field and the note.
      label: unknownPriceRoles ? SECURITY_TOTAL_LABEL : null,
      note: unknownPriceRoles ?
        'Seat total is '+SECURITY_TOTAL_LABEL+': Vercel publishes no seat price for the SECURITY role, so its seat is not in this total. Deploying seats (Owner, Member, Developer) are priced at the stored $20/seat default.' :
        'Deploying seats (Owner, Member, Developer) at the stored $20/seat default.'},
    commitments: {count: commitments.length},
    note: 'Figures are reads and stored defaults only. Spend alerts and controls belong to Vercel Spend Management (IN-12); this review never changes them.'});
}

// verifyWith dispatch: the only tools the map points at, read directly.
const VERIFY_READERS = {
  vercel_team_get: async (ctx, _args) => {
    const {client, account} = await readProvider(ctx);
    return client.request('teams_get', {path: {teamId: account.team_id}});
  },
  vercel_project_get: async (ctx, args) => {
    if (typeof args?.projectId !== 'string' || !args.projectId) {
      throw new Error('this setting needs a projectId to read back');
    }
    const {client} = await readProvider(ctx);
    return client.request('projects_get', {path: {idOrName: args.projectId}});
  }
};

function fieldOf(row, field) {
  let cur = row;
  for (const part of String(field).split('.')) {
    if (!cur || typeof cur !== 'object') return undefined;
    cur = cur[part];
  }
  return cur;
}

async function checkSetting(args, ctx) {
  const guide = findSettingGuide(args?.setting);
  if (!guide.found) return result({found: false, setting: args?.setting ?? null,
    state: 'not_readable', why: 'the dashboard map has no guide for this setting',
    dashboardUrl: guide.dashboardUrl});
  if (!guide.verifyWith) {
    return result({found: true, setting: guide.setting, id: guide.id,
      state: 'not_readable',
      why: guide.stepsOnly ? 'steps-only setting (deletion): confirmed on the dashboard, never by read-back' :
        'no API read-back exists for this setting',
      guide});
  }
  const reader = VERIFY_READERS[guide.verifyWith.tool];
  if (!reader) return result({found: true, setting: guide.setting, id: guide.id,
    state: 'not_readable', why: 'the named read-back tool is not dispatchable here', guide});
  try {
    const row = await reader(ctx, args ?? {});
    const value = fieldOf(row, guide.verifyWith.field);
    const present = value !== undefined && value !== null;
    const summary = typeof value === 'object' ?
      {present, keys: Object.keys(value ?? {}).slice(0, 12)} :
      {present, value: typeof value === 'string' ? safe(value) : value ?? null};
    return result({found: true, setting: guide.setting, id: guide.id,
      state: 'read_back', via: guide.verifyWith.tool, field: guide.verifyWith.field,
      ...summary,
      ...(guide.verifyWith.equals !== undefined ?
        {expected: guide.verifyWith.equals, matches: value === guide.verifyWith.equals} : {}),
      note: 'A guided setting is only ever reported from this read-back or the owner\u2019s word — never assumed.'});
  } catch (error) {
    return result({found: true, setting: guide.setting, id: guide.id,
      state: 'not_readable', why: `read-back failed (${error?.code ?? 'unknown'})`, guide});
  }
}

export const adminTools = {
  tools: [
    readEntry({name: 'vercel_admin_review_security', writes: false, area: 'admin', profiles: PROFILES,
      description: 'Security review: owners, SAML, token hygiene and default protection, each marked ok, needs attention or not readable.'}),
    readEntry({name: 'vercel_admin_cost_review', writes: false, area: 'admin', profiles: PROFILES,
      description: 'Where the money goes: top services and projects this period, paid seats at the stored seat price, commitments.',
      properties: {from: {type: 'string', minLength: 10, maxLength: 40}, to: {type: 'string', minLength: 10, maxLength: 40}}}),
    readEntry({name: 'vercel_admin_list_guided_settings', writes: false, area: 'admin', profiles: PROFILES,
      description: 'Every dashboard-only setting the guided map covers, by section, with read-back availability.'}),
    readEntry({name: 'vercel_admin_check_setting', writes: false, area: 'admin', profiles: PROFILES,
      description: 'Read back a guided setting\u2019s current value where Vercel exposes it, after a dashboard change.',
      properties: {setting: {type: 'string', minLength: 2, maxLength: 120},
        projectId: {type: 'string', minLength: 1, maxLength: 200}}})
  ],
  handlers: {
    vercel_admin_review_security: (args, ctx) => reviewSecurity(args ?? {}, ctx),
    vercel_admin_cost_review: (args, ctx) => costReview(args ?? {}, ctx),
    vercel_admin_list_guided_settings: async () => result({settings: listSettingGuides(),
      count: listSettingGuides().length}),
    vercel_admin_check_setting: (args, ctx) => checkSetting(args ?? {}, ctx)
  }
};
