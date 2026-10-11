import { describe, it, expect, vi } from 'vitest';
import { resolveVercelInput, issueVercelSecret, hiddenChangeSummary } from '../../src/vercel/shape.js';

describe('B-5 one-use secret input and output rules', () => {
  it('rejects plain credentials and any plain value on a secret argument', async () => {
    await expect(resolveVercelInput({ value: 'sk_test_FAKEpassword' })).rejects.toThrow(/Secret-like/);
    await expect(resolveVercelInput({ value: 'not-secret' }, { secret: true })).rejects.toThrow(/Secret-like/);
    await expect(resolveVercelInput({ value: 'okay' })).resolves.toEqual({ value: 'okay', source: 'plain' });
    await expect(resolveVercelInput({ value: 'one', generate: { bytes: 32, encoding: 'hex' } }))
      .rejects.toThrow(/exactly one/);
  });
  it('consumes one-use owner input for exactly the selected account and kind', async () => {
    const pending = { consume: vi.fn(async () => 'opaque-secret') };
    const output = await resolveVercelInput({ pendingInputId: 'fixture' }, {
      secret: true, account: 'team_fixture', kind: 'env_value', pending
    });
    expect(output.source).toBe('owner_setup');
    expect(pending.consume).toHaveBeenCalledWith({
      id: 'fixture', account: 'team_fixture', kind: 'env_value'
    });
    await expect(resolveVercelInput({ pendingInputId: 'fixture' }, {
      account: 'team_fixture', kind: 'env_value',
      pending: { consume: async () => null }
    })).rejects.toThrow(/expired/);
  });
  it('generates random secrets only with bounded size and approved encoding', async () => {
    const random = vi.fn(bytes => Buffer.alloc(bytes, 7));
    const output = await resolveVercelInput({ generate: { bytes: 32, encoding: 'hex' } }, { random });
    expect(output.value).toHaveLength(64);
    expect(output.source).toBe('generated');
    expect(random).toHaveBeenCalledWith(32);
    await expect(resolveVercelInput({ generate: { bytes: 8, encoding: 'hex' } }))
      .rejects.toThrow(/16/);
  });
  it('stores created secrets only in one-time encrypted store and returns a reveal reference', async () => {
    const store = { issue: vi.fn(async () => ({ id: 'secret_fixture',
      expiresAt: '2026-10-11T18:00:00Z' })) };
    const response = await issueVercelSecret({ store, account: 'team_fixture', kind: 'token',
      value: 'FAKEsecret', label: 'new credential' });
    expect(store.issue).toHaveBeenCalledTimes(1);
    expect(response).toMatchObject({ secret: '[hidden]', secretRef: 'secret_fixture',
      revealAt: '/api/vercel/setup' });
    expect(JSON.stringify(response)).not.toContain('FAKEsecret');
  });
  it('never persists a secret value in a change description', () => {
    expect(hiddenChangeSummary('api-key')).toEqual({
      label: 'api-key', action: 'value set (hidden)'
    });
    expect(hiddenChangeSummary('vcp_FAKE_secret')).toBe('value set (hidden)');
  });
});
