import { describe, it, expect } from 'vitest';
import { probeToken, storeToken } from '../../src/vercel/tokens.js';

const team = { id: 'team_FAKE', slug: 'fixture-team' };
function provider(teamPages, projectPages = [{ projects: [] }]) {
  const calls = [], positions = new Map();
  const fetchImpl = async (input, init) => {
    const url = new URL(input);
    calls.push({ path: url.pathname, query: Object.fromEntries(url.searchParams), method: init.method });
    if (url.pathname === '/v2/user') return Response.json({ user: { id: 'user_FAKE' } });
    const pages = url.pathname === '/v2/teams' ? teamPages : projectPages;
    const index = positions.get(url.pathname) || 0;
    positions.set(url.pathname, index + 1);
    return Response.json(pages[index] || pages.at(-1));
  };
  return { fetchImpl, calls };
}
const args = { token: 'vcp_FAKEpagination_12345678', teamId: team.id };

describe('owner token verification follows bounded provider pagination', () => {
  it('accepts a short team page only after following its cursor to exhaustion', async () => {
    const api = provider([{ teams: [team], pagination: { next: 1756771018525 } },
      { teams: [], pagination: { next: null } }]);
    const result = await probeToken({ ...args, fetchImpl: api.fetchImpl });
    expect(result.scope).toBe('team');
    expect(result.visibleTeamCount).toBe(1);
    expect(api.calls.filter(c => c.path === '/v2/teams').map(c => c.query)).toEqual([
      { limit: '100', teamId: team.id },
      { limit: '100', until: '1756771018525', teamId: team.id }
    ]);
    expect(api.calls.every(c => c.method === 'GET')).toBe(true);
  });
  it('does not hide broader teams found on continuation pages', async () => {
    const pages = [{ teams: [team], pagination: { next: 100 } },
      { teams: [{ id: 'team_OTHER', slug: 'other' }], pagination: { next: null } }];
    await expect(probeToken({ ...args, fetchImpl: provider(pages).fetchImpl }))
      .rejects.toThrow(/owner allowance/);
    expect((await probeToken({ ...args, allowFull: true, fetchImpl: provider(pages).fetchImpl })).scope)
      .toBe('full');
  });
  it('finds later projects while preserving the broader visibility guard', async () => {
    const api = provider([{ teams: [team] }], [
      { projects: [], pagination: { next: null } }
    ]);
    await expect(probeToken({ ...args, projectId: 'prj_FAKE', fetchImpl: api.fetchImpl }))
      .rejects.toThrow(/selected project/);
    const pages = [{ projects: [{ id: 'prj_OTHER', name: 'other' }], pagination: { next: 100 } },
      { projects: [{ id: 'prj_FAKE', name: 'selected' }], pagination: { next: null } }];
    await expect(probeToken({ ...args, projectId: 'prj_FAKE', fetchImpl: provider([{ teams: [team] }], pages).fetchImpl }))
      .rejects.toThrow(/owner allowance/);
    const accepted = await probeToken({ ...args, projectId: 'prj_FAKE', allowFull: true,
      fetchImpl: provider([{ teams: [team] }], pages).fetchImpl });
    expect(accepted.projectId).toBe('prj_FAKE');
    expect(accepted.visibleProjectCount).toBe(2);
    expect(accepted.scope).toBe('full');
  });
  it.each(['100', -1, 1.5, {}, Number.MAX_SAFE_INTEGER + 1])('refuses malformed cursor %j', async next => {
    await expect(probeToken({ ...args, fetchImpl: provider([{ teams: [team], pagination: { next } }]).fetchImpl }))
      .rejects.toThrow(/incomplete/);
  });
  it('refuses repeated cursors and duplicate identities without storing a token', async () => {
    let stored = false;
    const pages = [{ teams: [team], pagination: { next: 100 } },
      { teams: [{ id: 'team_OTHER', slug: 'other' }], pagination: { next: 100 } }];
    await expect(storeToken({ ...args, db: { upsertVercelAccount: async () => { stored = true; } },
      fetchImpl: provider(pages).fetchImpl })).rejects.toThrow(/incomplete/);
    expect(stored).toBe(false);
    await expect(probeToken({ ...args, fetchImpl: provider([
      { teams: [team], pagination: { next: 100 } }, { teams: [team] }
    ]).fetchImpl })).rejects.toThrow(/unique/);
  });
  it('refuses unbounded and empty nonterminal pagination', async () => {
    const pages = Array.from({ length: 5 }, (_, i) => ({
      teams: [{ id: `team_FAKE${i}`, slug: 'fixture' }], pagination: { next: 100 - i }
    }));
    const api = provider(pages);
    await expect(probeToken({ ...args, fetchImpl: api.fetchImpl })).rejects.toThrow(/incomplete/);
    expect(api.calls.filter(c => c.path === '/v2/teams')).toHaveLength(5);
    await expect(probeToken({ ...args, fetchImpl: provider([
      { teams: [], pagination: { next: 100 } }
    ]).fetchImpl })).rejects.toThrow(/incomplete/);
  });
});
