import { describe, expect, it } from 'vitest';
import { makeVercelClient } from '../../src/vercel/client.js';

describe('A-4 Vercel emulator integration', () => {
  it('reads the seeded team and its projects through the scoped API client', async () => {
    const base = process.env.VERCEL_API_BASE;
    if (!base || !['localhost', '127.0.0.1'].includes(new URL(base).hostname)) {
      throw new Error('This test may only use localhost emulate');
    }
    const token = 'vcp_FAKEemulateToken';
    const teamsResponse = await fetch(base + '/v2/teams', {
      headers: { authorization: 'Bearer ' + token }
    });
    expect(teamsResponse.status).toBe(200);
    const teams = (await teamsResponse.json()).teams;
    const team = teams.find(item => item.slug === 'a4-test-team');
    expect(team?.id).toEqual(expect.any(String));

    const client = makeVercelClient({
      token, account: { id: 'account_FAKE', team_id: team.id }, baseUrl: base
    });
    const user = await client.request('user_get');
    const projects = await client.request('projects_list', { query: { limit: 1 } });
    expect(user.user).toEqual(expect.objectContaining({ username: expect.any(String) }));
    expect(Array.isArray(projects.projects)).toBe(true);
    expect(projects.projects[0].name).toBe('a4-test-project');
  });
});
