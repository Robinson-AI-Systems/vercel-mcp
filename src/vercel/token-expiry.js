// AUD-E (design D-E, finding VMCP-003, ruling IN-04): the enrolled token's
// expiry posture — one derivation shared by vercel_whoami and the setup
// page, so both surfaces state the same truth from the same stored values.
//
// Four states, derived in this order:
//   a stored expiry in the past  -> 'expired'
//   a stored future expiry       -> 'expiring' (daysLeft reported)
//   no date + owner attestation  -> 'no_expiry' (positively established)
//   no date + no attestation     -> 'unknown'
// storeToken() writes expiresAt: null unconditionally and probeToken
// retrieves no expiry, so a null date on its own establishes NOTHING about
// the owner's choice: 'unknown' is stated as "expiry not recorded", never
// as owner's choice, and never carries warning styling.

function denverLocal(milliseconds) {
  if (!Number.isFinite(milliseconds)) return null;
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Denver', year: 'numeric', month: 'short',
    day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short'
  }).format(new Date(milliseconds));
}

export function tokenExpiryPosture(row, nowMs = Date.now()) {
  const raw = row?.token_expires_at ?? row?.tokenExpiresAt ?? null;
  const time = raw ? new Date(raw).getTime() : NaN;
  if (Number.isFinite(time)) {
    const daysLeft = Math.ceil((time - nowMs) / 86400000);
    const expiresAt = new Date(time).toISOString();
    if (daysLeft <= 0) {
      return { posture: 'expired', expiresAt, expiresAtLocal: denverLocal(time),
        daysLeft, label: 'expired', inWindow: true };
    }
    return { posture: 'expiring', expiresAt, expiresAtLocal: denverLocal(time),
      daysLeft,
      label: daysLeft === 1 ? 'expires in 1 day' : 'expires in ' + daysLeft + ' days',
      inWindow: daysLeft <= 14 };
  }
  if (row?.token_no_expiry === true || row?.tokenNoExpiry === true) {
    return { posture: 'no_expiry', expiresAt: null, expiresAtLocal: null,
      daysLeft: null, label: "no expiry — owner's choice", inWindow: false };
  }
  return { posture: 'unknown', expiresAt: null, expiresAtLocal: null,
    daysLeft: null, label: 'expiry not recorded for this token', inWindow: false };
}
