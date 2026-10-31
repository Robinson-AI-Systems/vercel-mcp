// AUD-I S3 — the two-layer box, reported. Every enrolled account has
// a DECLARED box (what its user chose at their door) and a PROBED box
// (the reach the enrollment probe actually verified). The declared
// box is the record; the probe is corroboration (AUD-I card). This
// module renders both from the stored account row, names a
// divergence in plain words instead of papering over it, and states
// the two consequences an agent needs: whether the account layer is
// in this seat at all (A-12), and which working-box changes are
// instant flips versus steps outside this tool (A-10).
//
// Declaration sources, in order: the probe record's stored
// declaredBox (integration enrollments record it at the door); the
// personal account kind; otherwise the enrollment the scope itself
// evidences — a Full Account token enrolled on the setup page IS the
// Door-2 declaration, a team/project-scoped enrollment the narrower
// one. The probed box renders the personal label from the probe
// record's accountKind, never from the scope enum (DECISIONS S1b).

function probeOf(row) {
  const raw = row?.token_probe;
  if (raw && typeof raw === 'object') return raw;
  if (typeof raw === 'string') {
    try { const parsed = JSON.parse(raw); return parsed && typeof parsed === 'object' ? parsed : {}; }
    catch { return {}; }
  }
  return {};
}

const BOXES = ['account', 'team', 'personal', 'team-projects', 'project'];

export function declaredBoxOf(row) {
  const probe = probeOf(row);
  if (BOXES.includes(probe.declaredBox)) return probe.declaredBox;
  if (probe.accountKind === 'personal') return 'personal';
  if (row?.scope === 'full') return 'account';
  if (row?.scope === 'project') return 'project';
  return 'team';
}

export function probedBoxOf(row) {
  const probe = probeOf(row);
  if (probe.accountKind === 'personal') return 'personal';
  if (row?.scope === 'full') return 'account';
  if (row?.scope === 'project') return 'project';
  return 'team';
}

function divergenceText(declared, probed) {
  if (declared === probed) return null;
  if (declared === 'account' && probed === 'team') {
    // The known honest case (the owner's own god-mode seat): a Full
    // Account token on an account that owns one team reads back as
    // one team. Vercel enforces the token's real reach — nothing the
    // user asked for is missing.
    return 'You enrolled an account-wide (Full Account) token; its reads currently show one team because the account owns one team. Vercel enforces the token\'s real reach, so nothing you asked for is missing.';
  }
  if (declared === 'team-projects') {
    return 'You chose specific projects on the team; this connection works inside that project set, and widening it is a step on Vercel\'s dashboard (Manage Access), not a flip here.';
  }
  return 'The reach verified at enrollment (' + probed + ') differs from the box chosen (' +
    declared + '). The verified reach is what this connection can actually do; re-enroll through the connection page to change the declaration.';
}

export function boxReport(row) {
  const probe = probeOf(row);
  const declaredBox = declaredBoxOf(row);
  const probedBox = probedBoxOf(row);
  return {
    declaredBox, probedBox,
    source: probe.source || 'token',
    accountKind: probe.accountKind || 'team',
    scopeVerified: probe.scopeVerified === true,
    divergence: divergenceText(declaredBox, probedBox)
  };
}

// A-12: the account layer (creating teams, account settings) is a
// tier capability of the token door, never a sum of installs. A seat
// outside it gets the plain answer plus the offer, not a wall.
export function accountLayerText(report) {
  if (report.probedBox === 'account') {
    return 'Account-wide actions (creating teams, account settings) are part of this seat.';
  }
  return 'Account-wide actions (creating teams, account settings) are not part of this seat — they belong to the token tier. To get them, connect through Door 2 on the connection page (a Full Account token); installs never add up to account-wide.';
}

// A-10: which working-box changes are instant, and which are steps.
// Production mode is the user's own pre-existing setting and flips
// instantly inside the ceiling; widening a Door-1 install's project
// set happens on Vercel's dashboard; a grant-level change (a bigger
// box than the seat's ceiling) means a new credential, by design.
export function flipReport(report) {
  const step = report.source === 'integration' ?
    'Widening this install\'s projects is a step: Vercel dashboard → Integrations → Manage Access. Changes inside the granted set are instant.' :
    'Widening beyond this seat means enrolling a broader credential through the sign-in flow\\u2019s enrollment branch.';
  return {
    withinCeiling: 'instant — a setting flip on this connection, journaled, credential untouched',
    beyondCeiling: step,
    grantLevel: 'A bigger granted ceiling is a new credential (a new install or a new token), never a silent widening.'
  };
}
