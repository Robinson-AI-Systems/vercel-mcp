import { describe, it, expect } from 'vitest';
import { deploymentIsProduction, isLiveProject, envTouchesProduction, domainIsProduction } from '../../src/vercel/production.js';
import { usd, classifySpend, spendPreflight } from '../../src/vercel/spend.js';

describe('B-1 fail-closed Vercel production classifiers', () => {
  it('recognizes live deployment and refuses ambiguous targets', () => {
    expect(deploymentIsProduction({ id: 'a', target: 'production' })).toBe(true);
    expect(deploymentIsProduction({ id: 'a', target: 'preview' })).toBe(false);
    expect(deploymentIsProduction({ id: 'live', target: 'preview' }, 'live')).toBe(true);
    expect(deploymentIsProduction({ id: 'a' })).toBe(true);
    expect(deploymentIsProduction(null)).toBe(true);
  });
  it('uses project targets and fails closed on unknown state', () => {
    expect(isLiveProject({ targets: { production: { id: 'dep_FAKE' } } })).toBe(true);
    expect(isLiveProject({ latestDeployments: [{ target: 'preview' }] })).toBe(false);
    expect(isLiveProject({})).toBe(true);
    expect(isLiveProject(null)).toBe(true);
  });
  it('classifies production environment, domain and DNS', () => {
    expect(envTouchesProduction(['production'])).toBe(true);
    expect(envTouchesProduction(['preview'])).toBe(false);
    expect(envTouchesProduction([])).toBe(true);
    expect(domainIsProduction({ gitBranch: 'feature' })).toBe(false);
    expect(domainIsProduction({ action: 'dns', gitBranch: 'feature' })).toBe(true);
    expect(domainIsProduction({})).toBe(true);
  });
});
describe('B-1 conservative integer-cents spend guard', () => {
  it('formats USD and rejects invalid currency types', () => {
    expect(usd(1125)).toBe('$11.25 USD');
    expect(() => usd(0.5)).toThrow();
    expect(() => classifySpend({ cents: '100', description: 'x' })).toThrow();
  });
  it('defaults to no spending; requires confirm and verified limits', () => {
    const declaration = { cents: 1125, recurring: false, description: 'Domain registration' };
    expect(spendPreflight({ declaration, spentTodayCents: 0, spendLimitCents: 0, confirm: true }).code)
      .toBe('spend_limit');
    expect(spendPreflight({ declaration, spentTodayCents: 100, spendLimitCents: 2000 }).code)
      .toBe('needs_confirmation');
    const approved = spendPreflight({ declaration, spentTodayCents: 100, spendLimitCents: 2000, confirm: true });
    expect(approved.allowed).toBe(true);
    expect(approved.explanation).toContain('$11.25 USD');
    expect(spendPreflight({ declaration, spentTodayCents: 0, spendLimitCents: undefined }).allowed).toBe(false);
  });
  it('does not silently approve unknown-cost operations', () => {
    const declaration = { cents: null, recurring: true, description: 'Usage-based service' };
    expect(spendPreflight({ declaration, spentTodayCents: 0, spendLimitCents: 0 }).code)
      .toBe('needs_confirmation');
  });
});
