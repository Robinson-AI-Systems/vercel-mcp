import { beforeAll, afterAll, it, expect } from 'vitest';
import { createDb } from '../../src/db.js';
import { openIsolatedSchema, closeIsolatedSchema, neonShapedQuery }
  from '../../test/helpers/pg-neon-adapter.js';

let db;
beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error('Local disposable Postgres required');
  const url = new URL(process.env.TEST_DATABASE_URL);
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname))
    throw new Error('Refusing remote deployment webhook DB fixture');
  await openIsolatedSchema(process.env.TEST_DATABASE_URL);
  db = createDb(neonShapedQuery());
  await db.initSchema();
});
afterAll(async () => { await closeIsolatedSchema(); });

const event = (deliveryId, at) => ({
  deliveryId, eventType: 'deployment.succeeded',
  eventCreatedAt: at, deploymentId: 'dpl_FAKE_DB_1',
  projectId: 'prj_FAKE_DB', projectName: 'fake-db-project',
  teamId: 'team_FAKE_DB', actorUserId: 'user_FAKE_DB',
  target: 'production', deploymentUrl: 'fake.vercel.app',
  meta: { githubCommitRef: 'main' },
  rawPayload: { id: deliveryId, type: 'deployment.succeeded' }
});
const record = (over = {}) => ({
  deploymentId: 'dpl_FAKE_DB_1', projectId: 'prj_FAKE_DB',
  projectName: 'fake-db-project', teamId: 'team_FAKE_DB',
  actorUserId: 'user_FAKE_DB', target: 'production',
  commitSha: 'sha_FAKE_DB', commitRef: 'main', repo: 'owner/repo',
  state: 'ready', promoted: false, rolledBack: false,
  createdAt: '2026-11-04T15:00:00.000Z', readyAt: '2026-11-04T15:02:00.000Z',
  failedAt: null, promotedAt: null, rolledBackAt: null,
  purpose: 'unknown', purposeRule: 'unknown', purposeConfirmed: false,
  ...over
});

it('stores deliveries idempotently and the rollup with its classification context', async () => {
  expect(await db.recordDeploymentEvent(event('whd_FAKE_DB_1', '2026-11-04T15:02:00.000Z'))).toBe(true);
  // Vercel's retry of the same delivery is absorbed.
  expect(await db.recordDeploymentEvent(event('whd_FAKE_DB_1', '2026-11-04T15:02:00.000Z'))).toBe(false);
  await db.upsertDeploymentRecord(record());
  const row = await db.getDeploymentRecord('dpl_FAKE_DB_1');
  expect(row.actor_user_id).toBe('user_FAKE_DB');
  expect(row.state).toBe('ready');
  expect(row.purpose).toBe('unknown');
  // A second deployment on the same project+branch later the
  // same Denver day sees a same-day count of 2 including itself
  // and the first deployment as its previous production row.
  await db.upsertDeploymentRecord(record({
    deploymentId: 'dpl_FAKE_DB_2',
    createdAt: '2026-11-04T19:00:00.000Z', readyAt: '2026-11-04T19:02:00.000Z'
  }));
  const context = await db.deploymentClassificationContext({
    projectId: 'prj_FAKE_DB', deploymentId: 'dpl_FAKE_DB_2',
    createdAt: '2026-11-04T19:00:00.000Z', branch: 'main',
    dayStart: '2026-11-04T07:00:00.000Z', dayEnd: '2026-11-05T07:00:00.000Z'
  });
  expect(context.sameDayCount).toBe(2);
  expect(context.previousProduction.state).toBe('ready');
  expect(context.previousProduction.commit_ref).toBe('main');
});
