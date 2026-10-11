import { describe, expect, it } from 'vitest';
import { makeVercelClient } from '../../src/vercel/client.js';

describe('A-4 Vercel emulator integration', () => {
  it('reads user and teams projects through the official client', async () => {
    const client = makeVercelClient({
      token: 'vcp_FAKEemulateToken',
      account: { id: 'account_FAKE', team_id: 'team_FAKE' },
      baseUrl: process.env.VERCEL_API_BASE
    });
    const user = await client.request('user_get');
    const projects = await client.request('projects_list', { query: { limit: 1 } });
    expect(user).toBeTruthy();
    expect(projects).toBeTruthy();
  });
});
