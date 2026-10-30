// P-1 (BATCH-P): the project-profile guard. A profile is data (one row in
// known_apps per app) describing what an app manages itself — its release
// rule, managed variables, owned DNS records and stores, protected
// sandboxes — so this server defers instead of fighting it (IN-11).
// The write preflight calls checkApp(targets, { db, connection, env })
// after the protected-resources guard; the guard never sees the tool
// args, so a caller's outsideApp declaration reaches it as an
// `outsideApp: true` marker that targets() copies onto its targets
// (the write-contract helper's convention). Like checkProtected, the
// guard fails closed when profile data cannot be loaded; an account
// with no profiles allows everything. Reads are never blocked.
const DENY = reason => ({ blocked: true, reason });
const norm = v => typeof v === 'string' ? v.trim().toLowerCase() : '';
const list = (p, field) => Array.isArray(p?.[field]) ? p[field] : [];

export function globToRegExp(glob) {
  const src = String(glob);
  let out = '';
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '*') {
      if (src[i + 1] === '*') { out += '.*'; i++; }
      else out += '[^/]*';
    } else {
      out += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp('^' + out + '$', 'i');
}
export function globMatch(pattern, value) {
  return typeof pattern === 'string' && typeof value === 'string' &&
    globToRegExp(pattern).test(value);
}

export function profileOf(row) {
  if (!row || typeof row !== 'object') return null;
  return row.profile && typeof row.profile === 'object' ? row.profile : row;
}
export function activeProfiles(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map(row => ({ row, profile: profileOf(row) }))
    .filter(({ row, profile }) => profile &&
      (row?.status ?? profile.status ?? 'active') === 'active');
}

function targetProjectKeys(target) {
  const ids = [], names = [];
  for (const f of ['projectId', 'parentProjectId']) {
    if (typeof target[f] === 'string') ids.push(target[f]);
  }
  for (const f of ['projectName', 'parentProjectName']) {
    if (typeof target[f] === 'string') names.push(target[f]);
  }
  if (target.kind === 'project') {
    if (typeof target.id === 'string') ids.push(target.id);
    if (typeof target.name === 'string') names.push(target.name);
  }
  return { ids, names };
}
export function owningProfile(active, target) {
  const { ids, names } = targetProjectKeys(target);
  if (!ids.length && !names.length) return null;
  for (const { profile } of active) {
    if (list(profile, 'projects').some(n => names.some(t => norm(t) === norm(n)))) {
      return profile;
    }
    if (list(profile, 'project_ids').some(i => ids.includes(i))) return profile;
  }
  return null;
}
export function profileOwningDomain(active, domain) {
  if (!domain) return null;
  for (const { profile } of active) {
    if (list(profile, 'owned_domains').some(d => norm(d) === norm(domain))) {
      return profile;
    }
  }
  return null;
}

const KEY_SHAPED = /^[A-Z][A-Z0-9_]{1,127}$/;
function envKeyOf(target) {
  if (typeof target.key === 'string' && target.key) return target.key;
  if (typeof target.id === 'string' && KEY_SHAPED.test(target.id)) return target.id;
  return null;
}
function storeOwningProfile(active, target, storeLabels) {
  for (const { profile } of active) {
    if (list(profile, 'owned_store_ids').includes(target.id)) return profile;
    const label = typeof target.storeName === 'string' && target.storeName
      ? target.storeName : storeLabels?.get?.(target.id);
    if (label && list(profile, 'owned_stores')
      .some(s => norm(s) === norm(label))) return profile;
  }
  return null;
}
function recordMatches(rule, target) {
  let compared = 0;
  if (rule?.type) {
    if (typeof target.type !== 'string' ||
      norm(target.type) !== norm(rule.type)) return false;
    compared++;
  }
  if (rule?.name) {
    if (typeof target.name !== 'string' ||
      !globMatch(rule.name, target.name)) return false;
    compared++;
  }
  if (rule?.value_prefix) {
    if (typeof target.value !== 'string' ||
      !target.value.startsWith(rule.value_prefix)) return false;
    compared++;
  }
  return compared > 0;
}

export function checkAppTargets(targets, rows, { storeLabels } = {}) {
  if (!Array.isArray(targets)) return DENY('The write targets were not identified');
  if (!Array.isArray(rows)) return DENY('App profile data is unavailable');
  const active = activeProfiles(rows);
  if (!active.length) return { blocked: false };
  for (const target of targets) {
    if (!target || typeof target !== 'object') continue;
    const outside = target.outsideApp === true;
    if (target.kind === 'sandbox') {
      const name = target.name ?? target.id;
      for (const { profile } of active) {
        if (list(profile, 'protected_sandboxes')
          .some(s => norm(s) === norm(name))) {
          return DENY('Sandbox ' + name + ' is protected by the ' +
            profile.name + ' profile: the app owns it and this server never stops or deletes it');
        }
      }
      continue;
    }
    if (target.kind === 'env') {
      const owner = owningProfile(active, target);
      const key = envKeyOf(target);
      if (owner && key && list(owner, 'managed_env').includes(key) && !outside) {
        return DENY('The variable ' + key + ' is managed by ' + owner.name +
          ' (injected by an integration or store connection); changing it needs outsideApp: true');
      }
      continue;
    }
    if (target.kind === 'store') {
      const owner = storeOwningProfile(active, target, storeLabels);
      const destructive = target.storeAction === 'delete' ||
        target.storeAction === 'disconnect' || target.overwrite === true;
      if (owner && destructive && !outside) {
        return DENY('That store belongs to ' + owner.name +
          '; deleting its files or the store itself can break the live app. It needs outsideApp: true');
      }
      continue;
    }
    if (target.kind === 'dns_record') {
      const domain = target.domain ?? target.domainName ?? null;
      const owner = profileOwningDomain(active, domain) ??
        owningProfile(active, target);
      if (owner && !outside &&
        list(owner, 'owned_dns_records').some(r => recordMatches(r, target))) {
        return DENY('That DNS record is owned by ' + owner.name +
          ' (its mail/DNS contract in its profile); changing it needs outsideApp: true');
      }
      continue;
    }
    const owner = owningProfile(active, target);
    if (owner && owner.release_rule === 'branch' && !outside) {
      const branch = owner.production_branch ?? 'production';
      if (target.release === 'promote' || target.release === 'rolling_start') {
        return DENY(owner.name + ' releases by moving its ' + branch +
          ' branch; this change moves production traffic for its project and needs outsideApp: true');
      }
      if (target.deployTarget === 'production') {
        return DENY(owner.name + ' releases by moving its ' + branch +
          ' branch; a direct production deployment for its project needs outsideApp: true');
      }
    }
  }
  return { blocked: false };
}

export async function checkApp(targets, { db, connection } = {}) {
  if (!db || !connection?.account) {
    return DENY('App profile data is unavailable');
  }
  // A db build with no listKnownApps at all predates profiles entirely:
  // no profile can exist in it, so nothing is owned. The deployed server
  // always runs the current db module (only older test fixtures present
  // that shape). A store that exists but ERRORS still fails closed
  // below — that is the "rules could not be verified" case.
  if (typeof db.listKnownApps !== 'function') return { blocked: false };
  let rows;
  try {
    rows = await db.listKnownApps(connection.account);
  } catch {
    return DENY('App profile rules could not be verified');
  }
  let storeLabels;
  if (Array.isArray(targets) &&
    targets.some(t => t?.kind === 'store' && !t.storeName) &&
    typeof db.listBlobStoreConnections === 'function') {
    try {
      storeLabels = new Map();
      const conns = await db.listBlobStoreConnections(connection.account);
      for (const c of conns ?? []) {
        if (c?.storeId && c?.label) storeLabels.set(c.storeId, c.label);
      }
    } catch { storeLabels = undefined; }
  }
  return checkAppTargets(targets, rows, { storeLabels });
}

export async function loadProfiles(db, account) {
  if (!db?.listKnownApps || !account) return [];
  try {
    return activeProfiles(await db.listKnownApps(account)).map(x => x.profile);
  } catch { return []; }
}

// The dev preview tools' no-preview rule, sourced from profiles: the
// union of the account's profiles' no_preview_branches globs. When no
// profile data exists at all, the B-7 built-in default stands so a
// profile-less install behaves exactly as before P-1.
const LEGACY_NO_PREVIEW = /^(ai|transfer|recovery)(\/|$)/i;
export async function previewBranchRefusal({ db, account, branch, outsideApp }) {
  if (outsideApp === true || typeof branch !== 'string' || !branch) return null;
  let globs = null;
  if (db?.listKnownApps && account) {
    try {
      globs = activeProfiles(await db.listKnownApps(account))
        .flatMap(({ profile }) => list(profile, 'no_preview_branches'));
    } catch { globs = null; }
  }
  if (globs === null) {
    return LEGACY_NO_PREVIEW.test(branch) ? 'No-preview branch refused' : null;
  }
  return globs.some(g => globMatch(g, branch))
    ? 'No-preview branch refused' : null;
}

// Structural validation for profile writes (P-3 drafts, setup page):
// data-only checks — the right types on the fields the design names.
// Unknown extra fields pass through; a profile is data, not code.
export function validateProfile(profile) {
  const problems = [];
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
    return ['A profile must be an object'];
  }
  if (typeof profile.id !== 'string' ||
    !/^[a-z0-9][a-z0-9-]{1,60}$/.test(profile.id)) problems.push('id');
  if (typeof profile.name !== 'string' || !profile.name) problems.push('name');
  const stringList = f => {
    if (profile[f] !== undefined &&
      (!Array.isArray(profile[f]) ||
        profile[f].some(x => typeof x !== 'string'))) problems.push(f);
  };
  for (const f of ['projects', 'project_ids', 'no_preview_branches',
    'managed_env', 'owned_domains', 'owned_stores', 'owned_store_ids',
    'protected_sandboxes']) stringList(f);
  if (profile.release_rule !== undefined &&
    !['promote', 'branch'].includes(profile.release_rule)) {
    problems.push('release_rule');
  }
  if (profile.expected_env !== undefined) {
    const ee = profile.expected_env;
    if (!ee || typeof ee !== 'object' || Array.isArray(ee) ||
      Object.values(ee).some(v => !Array.isArray(v) ||
        v.some(x => typeof x !== 'string'))) problems.push('expected_env');
  }
  if (profile.owned_dns_records !== undefined &&
    (!Array.isArray(profile.owned_dns_records) ||
      profile.owned_dns_records.some(r => !r || typeof r !== 'object' ||
        Array.isArray(r)))) problems.push('owned_dns_records');
  if (profile.expected_crons !== undefined &&
    (!Array.isArray(profile.expected_crons) ||
      profile.expected_crons.some(c => !c || typeof c.path !== 'string' ||
        typeof c.schedule !== 'string'))) problems.push('expected_crons');
  if (profile.cost_target_cents !== undefined &&
    (!Number.isSafeInteger(profile.cost_target_cents) ||
      profile.cost_target_cents < 0)) problems.push('cost_target_cents');
  return problems;
}
