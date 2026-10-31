import { describe, it, expect } from 'vitest';
import { tokenExpiryPosture } from '../../src/vercel/token-expiry.js';

// AUD-BI (VMCP-003): the derivation matrix after enrollment-side
// recording — a stored date, the owner's attestation, and the
// provider-reported no-expiry are three distinct facts with three
// distinct renderings, in that precedence.
const NOW = Date.parse('2026-10-31T12:00:00.000Z');
const future = new Date(NOW + 10 * 86400000).toISOString();
const past = new Date(NOW - 86400000).toISOString();

describe('token expiry posture derivation (AUD-E + AUD-BI)', () => {
  it('a recorded future date is expiring, sourced from the record', () => {
    const posture = tokenExpiryPosture({ token_expires_at: future }, NOW);
    expect(posture.posture).toBe('expiring');
    expect(posture.daysLeft).toBe(10);
    expect(posture.source).toBe('recorded');
  });

  it('a recorded past date is expired, sourced from the record', () => {
    const posture = tokenExpiryPosture({ token_expires_at: past }, NOW);
    expect(posture.posture).toBe('expired');
    expect(posture.source).toBe('recorded');
  });

  it('an attested no-expiry is the owner\'s choice, sourced from the attestation', () => {
    const posture = tokenExpiryPosture(
      { token_expires_at: null, token_no_expiry: true }, NOW);
    expect(posture.posture).toBe('no_expiry');
    expect(posture.label).toBe("no expiry — owner's choice");
    expect(posture.source).toBe('attestation');
  });

  it('a provider-reported no-expiry is no_expiry with its own label and source', () => {
    const posture = tokenExpiryPosture(
      { token_expires_at: null, token_probe: { tokenExpiry: { state: 'none_reported' } } }, NOW);
    expect(posture.posture).toBe('no_expiry');
    expect(posture.label).toBe('no expiry — Vercel reports none for this token');
    expect(posture.label).not.toContain("owner's choice");
    expect(posture.source).toBe('provider');
    expect(posture.expiresAt).toBeNull();
    expect(posture.daysLeft).toBeNull();
    expect(posture.inWindow).toBe(false);
  });

  it('reads the provider-reported state from a JSON-string probe record too', () => {
    const posture = tokenExpiryPosture(
      { token_expires_at: null,
        token_probe: JSON.stringify({ tokenExpiry: { state: 'none_reported' } }) }, NOW);
    expect(posture.posture).toBe('no_expiry');
    expect(posture.source).toBe('provider');
  });

  it('the attestation outranks the provider-reported state when both exist', () => {
    const posture = tokenExpiryPosture(
      { token_expires_at: null, token_no_expiry: true,
        token_probe: { tokenExpiry: { state: 'none_reported' } } }, NOW);
    expect(posture.label).toBe("no expiry — owner's choice");
    expect(posture.source).toBe('attestation');
  });

  it('a recorded date outranks both no-expiry states', () => {
    const posture = tokenExpiryPosture(
      { token_expires_at: future, token_no_expiry: true,
        token_probe: { tokenExpiry: { state: 'none_reported' } } }, NOW);
    expect(posture.posture).toBe('expiring');
    expect(posture.source).toBe('recorded');
  });

  it('an unrecorded leg leaves the posture honestly unknown', () => {
    const posture = tokenExpiryPosture(
      { token_expires_at: null, token_probe: { tokenExpiry: { state: 'unrecorded' } } }, NOW);
    expect(posture.posture).toBe('unknown');
    expect(posture.label).toBe('expiry not recorded for this token');
    expect(posture.source).toBeNull();
  });

  it('no date, no attestation, no probe evidence is unknown', () => {
    const posture = tokenExpiryPosture({ token_expires_at: null }, NOW);
    expect(posture.posture).toBe('unknown');
    expect(posture.source).toBeNull();
  });
});
