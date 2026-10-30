// P-3 acceptance, draft half (BATCH-P §P6 + design P-3 tests):
// findings map onto a valid profile through the closed vocabulary;
// unknown keys — top-level or nested — are reported, not guessed;
// script names reach the APP-NEEDS text only; nothing is stored.
import { describe, it, expect } from 'vitest';
import { profileDraftTools } from '../../src/tools/profile-draft.js';
import { validateProfile } from '../../src/tools/app-guard.js';

const run = async (findings) => {
  const r = await profileDraftTools.handlers.vercel_profile_draft({ findings });
  return JSON.parse(r.content[0].text);
};

describe('P-3 vercel_profile_draft', () => {
  it('maps the full findings vocabulary onto a valid draft profile', async () => {
    const out = await run({
      app: 'shop-api', name: 'Shop API', framework: 'nextjs',
      nodeVersion: '24', productionBranch: 'live', releaseRule: 'branch',
      crons: [{ path: '/api/jobs/nightly', schedule: '0 3 * * *' }],
      envNames: ['DATABASE_URL', 'STRIPE_KEY'],
      managedEnv: ['BLOB_READ_WRITE_TOKEN'],
      domains: ['shop.example.com'],
      dnsRecords: [{ type: 'MX', name: '', value_prefix: 'aspmx' }],
      stores: ['shop-photos'], noPreviewBranches: ['ai/*'],
      costTargetCents: 1500, scripts: ['build', 'vercel-build']
    });
    expect(out.status).toBe('draft');
    expect(validateProfile(out.draft)).toEqual([]);
    expect(out.draft).toMatchObject({
      id: 'shop-api', name: 'Shop API', framework: 'nextjs',
      node_version: '24', production_branch: 'live', release_rule: 'branch',
      projects: ['shop-api'], managed_env: ['BLOB_READ_WRITE_TOKEN'],
      owned_domains: ['shop.example.com'], owned_stores: ['shop-photos'],
      no_preview_branches: ['ai/*'], cost_target_cents: 1500,
      expected_crons: [{ path: '/api/jobs/nightly', schedule: '0 3 * * *' }],
      expected_env: { production: ['DATABASE_URL', 'STRIPE_KEY'] },
      owned_dns_records: [{ type: 'MX', name: '', value_prefix: 'aspmx' }]
    });
    expect(out.unmapped).toEqual([]);
    expect(out.appNeeds).toContain('# What Shop API needs from Vercel');
    expect(out.appNeeds).toContain('Repo scripts seen in the findings (names only): build, vercel-build.');
    // Scripts are doc-only: no profile field carries them.
    expect(JSON.stringify(out.draft)).not.toContain('vercel-build');
  });

  it('reports unknown keys instead of guessing them into the profile', async () => {
    const out = await run({
      app: 'shop-api', telemetry: { vendor: 'x' },
      crons: [{ path: '/a', schedule: '0 0 * * *', retries: 3 }],
      expectedEnv: { production: ['A'], staging: ['B'] },
      dnsRecords: [{ type: 'TXT', ttl: 60 }]
    });
    expect(out.unmapped).toContain('telemetry');
    expect(out.unmapped).toContain('crons[0].retries');
    expect(out.unmapped).toContain('expectedEnv.staging');
    expect(out.unmapped).toContain('dnsRecords[0].ttl');
    expect(out.draft.expected_env).toEqual({ production: ['A'] });
    expect(out.appNeeds).toContain('reported, not guessed');
    expect(JSON.stringify(out.draft)).not.toContain('telemetry');
  });

  it('honors an explicit per-target env split over envNames', async () => {
    const out = await run({ app: 'a1', expectedEnv:
      { preview: ['PREVIEW_ONLY'], production: ['PROD'] } });
    expect(out.draft.expected_env).toEqual(
      { preview: ['PREVIEW_ONLY'], production: ['PROD'] });
    expect(out.notes).toEqual([]);
  });

  it('refuses malformed known fields by name', async () => {
    await expect(run({ app: 'a1', releaseRule: 'sometimes' }))
      .rejects.toThrow(/releaseRule/);
    await expect(run({ app: 'a1', crons: [{ path: '/a' }] }))
      .rejects.toThrow(/crons\[0\]/);
    await expect(run({ app: 'Bad App' })).rejects.toThrow(/app id/);
    await expect(run({ app: 'a1', costTargetCents: -5 }))
      .rejects.toThrow(/costTargetCents/);
  });
});
