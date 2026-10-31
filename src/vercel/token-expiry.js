// AUD-E (design D-E, finding VMCP-003, ruling IN-04): the enrolled token's
// expiry posture — one derivation shared by vercel_whoami and the setup
// page, so both surfaces state the same truth from the same stored values.
//
// States, derived in this order (each result names its `source`):
//   a stored expiry in the past  -> 'expired'   (source 'recorded')
//   a stored future expiry       -> 'expiring'  (source 'recorded';
//                                                  daysLeft reported)
//   no date + owner attestation  -> 'no_expiry' (source 'attestation')
//   no date + provider-reported  -> 'no_expiry' (source 'provider')
//     none on the probe record
//   no date + neither            -> 'unknown'   (source null)
// AUD-BI closed the recording gap this file once documented: enrollment
// now reads the token's own provider record (storeToken's expiry leg)
// and persists a real date when Vercel carries one — so a null date on
// its own STILL establishes nothing about the owner's choice, and the
// two no-expiry states stay distinct facts with distinct labels: the
// owner's attestation ("owner's choice") is never rendered for a merely
// provider-reported none, and vice versa. 'unknown' is stated as
// "expiry not recorded", never as owner's choice, and never carries
// warning styling.

function denverLocal(milliseconds) {
  if (!Number.isFinite(milliseconds)) return null;
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Denver', year: 'numeric', month: 'short',
    day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short'
  }).format(new Date(milliseconds));
}

// The stored probe record, tolerated as object or JSON string (the
// box.js probeOf precedent).
function probeOf(row) {
  const raw = row?.token_probe ?? row?.tokenProbe ?? null;
  if (raw && typeof raw === 'object') return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch { return {}; }
  }
  return {};
}

export function tokenExpiryPosture(row, nowMs = Date.now()) {
  const raw = row?.token_expires_at ?? row?.tokenExpiresAt ?? null;
  const time = raw ? new Date(raw).getTime() : NaN;
  if (Number.isFinite(time)) {
    const daysLeft = Math.ceil((time - nowMs) / 86400000);
    const expiresAt = new Date(time).toISOString();
    if (daysLeft <= 0) {
      return { posture: 'expired', expiresAt, expiresAtLocal: denverLocal(time),
        daysLeft, label: 'expired', inWindow: true, source: 'recorded' };
    }
    return { posture: 'expiring', expiresAt, expiresAtLocal: denverLocal(time),
      daysLeft,
      label: daysLeft === 1 ? 'expires in 1 day' : 'expires in ' + daysLeft + ' days',
      inWindow: daysLeft <= 14, source: 'recorded' };
  }
  if (row?.token_no_expiry === true || row?.tokenNoExpiry === true) {
    return { posture: 'no_expiry', expiresAt: null, expiresAtLocal: null,
      daysLeft: null, label: "no expiry — owner's choice", inWindow: false,
      source: 'attestation' };
  }
  if (probeOf(row).tokenExpiry?.state === 'none_reported') {
    return { posture: 'no_expiry', expiresAt: null, expiresAtLocal: null,
      daysLeft: null, label: 'no expiry — Vercel reports none for this token',
      inWindow: false, source: 'provider' };
  }
  return { posture: 'unknown', expiresAt: null, expiresAtLocal: null,
    daysLeft: null, label: 'expiry not recorded for this token', inWindow: false,
    source: null };
}
