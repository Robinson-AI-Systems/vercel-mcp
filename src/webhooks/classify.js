// AUD-CI: the deployment-purpose classifier (design:
// vercel-deployment-webhook-design-2026-11-03 §4, applying the
// rack-audit amendment of the same day: deployments are
// classified by PURPOSE, never by their branch or production
// label alone). Pure functions — the receiver supplies the
// stored context, this module supplies the judgment, and every
// result names the rule that fired so a human can audit or
// overturn it (a row corrected by hand carries
// purpose_rule='manual' and is never reclassified).

const DENVER = 'America/Denver';
const partsFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: DENVER, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hour12: false
});

export function denverParts(date) {
  const parts = {};
  for (const part of partsFmt.formatToParts(date)) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }
  if (parts.hour === 24) parts.hour = 0;
  return parts;
}

// The nightly promotion window: 00:01–00:45 Denver.
export function inPromotionWindow(date) {
  const { hour, minute } = denverParts(date);
  return hour === 0 && minute >= 1 && minute <= 45;
}

function denverOffsetMs(ts) {
  const p = denverParts(new Date(ts));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) -
    Math.floor(ts / 60000) * 60000;
}

// The UTC instants bounding the Denver calendar day that
// contains `date` — the classifier's "same day" is a Denver day.
export function denverDayRangeUtc(date) {
  const p = denverParts(date);
  const naive = Date.UTC(p.year, p.month - 1, p.day);
  let start = naive - denverOffsetMs(naive);
  start = naive - denverOffsetMs(start);
  let end = naive + 86400000 - denverOffsetMs(naive + 86400000);
  end = naive + 86400000 - denverOffsetMs(end);
  return { start: new Date(start), end: new Date(end) };
}

// Commit identity lifted from deployment meta. The documented
// payload names meta only as a Map — its keys are NOT
// enumerated — so the lift accepts the recognized key spellings
// and the events table keeps meta verbatim regardless; a key
// spelling not yet seen live simply leaves the fields null
// (the design's rule: confirm against first live deliveries).
export function liftCommitFields(meta) {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
    return { commitSha: null, commitRef: null, repo: null };
  }
  const pick = (...keys) => {
    for (const key of keys) {
      if (typeof meta[key] === 'string' && meta[key]) return meta[key];
    }
    return null;
  };
  let repo = pick('githubCommitRepo', 'githubRepo', 'repo');
  if (!repo) {
    const org = pick('githubCommitOrg', 'githubOrg');
    const name = pick('githubCommitRepoName');
    if (org && name) repo = org + '/' + name;
  }
  return {
    commitSha: pick('githubCommitSha', 'commitSha', 'sha'),
    commitRef: pick('githubCommitRef', 'commitRef', 'ref', 'branch'),
    repo
  };
}

// Rules run in the design's order; first match wins.
// deployment: { target, createdAt, commitRef }
// context: { previousProduction: { state, created_at, commit_ref } | null,
//            sameDayCount } — sameDayCount includes this deployment.
export function classifyDeployment({ deployment, context }) {
  const created = new Date(deployment.createdAt);
  const isProduction = deployment.target === 'production';
  if (isProduction && inPromotionWindow(created)) {
    return { purpose: 'scheduled-release', rule: 'scheduled-release:promotion-window' };
  }
  if (isProduction && context?.previousProduction) {
    const prev = context.previousProduction;
    if (prev.state === 'error') {
      return { purpose: 'production-repair', rule: 'production-repair:after-error' };
    }
    const prevAt = new Date(prev.created_at);
    if (deployment.commitRef && prev.commit_ref &&
      prev.commit_ref === deployment.commitRef &&
      created - prevAt >= 0 && created - prevAt < 2 * 3600 * 1000) {
      return { purpose: 'production-repair', rule: 'production-repair:rapid-replacement' };
    }
  }
  if (!isProduction) {
    return { purpose: 'development-verification', rule: 'development-verification:non-production-target' };
  }
  if ((context?.sameDayCount ?? 0) >= 2) {
    return { purpose: 'development-verification', rule: 'development-verification:repeat-deploy' };
  }
  return { purpose: 'unknown', rule: 'unknown' };
}
