import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  createDeploymentWebhookHandler, signatureMatches, signatureRejects
} from '../../src/webhooks/receiver.js';
import {
  classifyDeployment, denverDayRangeUtc, inPromotionWindow, liftCommitFields
} from '../../src/webhooks/classify.js';

const SECRET = 'whsec_FAKE_test_secret';
const sign = (raw) => createHmac('sha1', SECRET).update(raw, 'utf8').digest('hex');

function mockRes() {
  return {
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; },
    send(body) { this.body = body; return this; }
  };
}
function mockReq(raw, signature) {
  return { method: 'POST', headers: { 'x-vercel-signature': signature }, rawBody: raw };
}

function makeStore() {
  const events = new Map();
  const deployments = new Map();
  const toSnake = (r) => ({
    deployment_id: r.deploymentId, project_id: r.projectId,
    project_name: r.projectName, team_id: r.teamId,
    actor_user_id: r.actorUserId, target: r.target,
    commit_sha: r.commitSha, commit_ref: r.commitRef, repo: r.repo,
    state: r.state, promoted: r.promoted, rolled_back: r.rolledBack,
    created_at: r.createdAt, ready_at: r.readyAt, failed_at: r.failedAt,
    promoted_at: r.promotedAt, rolled_back_at: r.rolledBackAt,
    purpose: r.purpose, purpose_rule: r.purposeRule,
    purpose_confirmed: r.purposeConfirmed
  });
  return {
    events, deployments,
    async initSchema() {},
    async recordDeploymentEvent(row) {
      if (events.has(row.deliveryId)) return false;
      events.set(row.deliveryId, row);
      return true;
    },
    async getDeploymentRecord(id) { return deployments.get(id) ?? null; },
    async upsertDeploymentRecord(record) {
      deployments.set(record.deploymentId, toSnake(record));
    },
    async deploymentClassificationContext({ projectId, deploymentId, createdAt, branch, dayStart, dayEnd }) {
      const rows = [...deployments.values()].filter((r) => r.project_id === projectId);
      const prev = rows
        .filter((r) => r.target === 'production' && r.deployment_id !== deploymentId &&
          new Date(r.created_at) < new Date(createdAt))
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
      const n = rows.filter((r) => {
        const t = new Date(r.created_at);
        return t >= new Date(dayStart) && t < new Date(dayEnd) &&
          (branch === null || r.commit_ref === branch);
      }).length;
      return {
        previousProduction: prev ?
          { state: prev.state, created_at: prev.created_at, commit_ref: prev.commit_ref } : null,
        sameDayCount: n
      };
    }
  };
}

let seq = 0;
function envelope(type, {
  at, deploymentId = 'dpl_FAKE_1', projectId = 'prj_FAKE', target = null,
  meta = { githubCommitSha: 'sha_FAKE', githubCommitRef: 'main', githubCommitRepo: 'owner/repo' },
  user = 'user_FAKE_chris'
} = {}) {
  seq += 1;
  return JSON.stringify({
    id: 'whd_FAKE_' + seq, type, createdAt: Date.parse(at),
    region: null,
    payload: {
      team: { id: 'team_FAKE' },
      user: { id: user },
      project: { id: projectId },
      target,
      deployment: {
        id: deploymentId, name: 'fake-project',
        url: deploymentId.toLowerCase() + '.vercel.app', meta
      },
      links: { deployment: 'https://vercel.com/x', project: 'https://vercel.com/y' }
    }
  });
}
async function deliver(handler, raw) {
  const res = mockRes();
  await handler(mockReq(raw, sign(raw)), res);
  return res;
}

describe('AUD-CI deployment webhook receiver', () => {
  it('verifies the HMAC over the raw body and rejects a forged delivery before the store', async () => {
    const store = makeStore();
    const handler = createDeploymentWebhookHandler({ db: store, env: { VERCEL_DEPLOY_WEBHOOK_SECRET: SECRET } });
    const raw = envelope('deployment.created', { at: '2026-11-04T17:00:00Z' });
    expect(signatureMatches(raw, sign(raw), SECRET)).toBe(true);
    expect(signatureMatches(raw + ' ', sign(raw), SECRET)).toBe(false);
    const before = signatureRejects.count;
    const res = mockRes();
    await handler(mockReq(raw, 'deadbeef'), res);
    expect(res.statusCode).toBe(403);
    expect(signatureRejects.count).toBe(before + 1);
    expect(store.events.size).toBe(0);
  });

  it('answers 500 when the secret is not configured, and 405 for non-POST', async () => {
    const store = makeStore();
    const noSecret = createDeploymentWebhookHandler({ db: store, env: {} });
    const res = mockRes();
    await noSecret(mockReq('{}', 'x'), res);
    expect(res.statusCode).toBe(500);
    const handler = createDeploymentWebhookHandler({ db: store, env: { VERCEL_DEPLOY_WEBHOOK_SECRET: SECRET } });
    const getRes = mockRes();
    await handler({ method: 'GET', headers: {}, rawBody: '' }, getRes);
    expect(getRes.statusCode).toBe(405);
  });

  it('records a preview deployment end to end and classifies it development-verification', async () => {
    const store = makeStore();
    const handler = createDeploymentWebhookHandler({ db: store, env: { VERCEL_DEPLOY_WEBHOOK_SECRET: SECRET } });
    const created = envelope('deployment.created', { at: '2026-11-04T17:00:00Z' });
    expect((await deliver(handler, created)).statusCode).toBe(200);
    const done = envelope('deployment.succeeded', { at: '2026-11-04T17:02:00Z' });
    const res = await deliver(handler, done);
    expect(JSON.parse(res.body)).toMatchObject({ recorded: true });
    const row = store.deployments.get('dpl_FAKE_1');
    expect(row.state).toBe('ready');
    expect(row.actor_user_id).toBe('user_FAKE_chris');
    expect(row.commit_sha).toBe('sha_FAKE');
    expect(row.purpose).toBe('development-verification');
    expect(row.purpose_rule).toBe('development-verification:non-production-target');
    expect(store.events.size).toBe(2);
  });

  it('absorbs a duplicate delivery and keeps state when events arrive out of order', async () => {
    const store = makeStore();
    const handler = createDeploymentWebhookHandler({ db: store, env: { VERCEL_DEPLOY_WEBHOOK_SECRET: SECRET } });
    const done = envelope('deployment.succeeded', { at: '2026-11-04T17:02:00Z' });
    await deliver(handler, done);
    const again = await deliver(handler, done);
    expect(JSON.parse(again.body)).toMatchObject({ duplicate: true });
    expect(store.events.size).toBe(1);
    const lateCreated = envelope('deployment.created', { at: '2026-11-04T17:00:00Z' });
    await deliver(handler, lateCreated);
    const row = store.deployments.get('dpl_FAKE_1');
    expect(row.state).toBe('ready');
    expect(new Date(row.created_at).toISOString()).toBe('2026-11-04T17:00:00.000Z');
  });

  it('classifies a production deployment inside the promotion window as scheduled-release', async () => {
    const store = makeStore();
    const handler = createDeploymentWebhookHandler({ db: store, env: { VERCEL_DEPLOY_WEBHOOK_SECRET: SECRET } });
    // 07:10 UTC = 00:10 in Denver (MST) — inside 00:01–00:45.
    await deliver(handler, envelope('deployment.created', { at: '2026-11-04T07:10:00Z', target: 'production' }));
    await deliver(handler, envelope('deployment.succeeded', { at: '2026-11-04T07:12:00Z', target: 'production' }));
    const row = store.deployments.get('dpl_FAKE_1');
    expect(row.purpose).toBe('scheduled-release');
    expect(row.purpose_rule).toBe('scheduled-release:promotion-window');
  });

  it('classifies a production deployment after a failed one as production-repair', async () => {
    const store = makeStore();
    const handler = createDeploymentWebhookHandler({ db: store, env: { VERCEL_DEPLOY_WEBHOOK_SECRET: SECRET } });
    await deliver(handler, envelope('deployment.created', { at: '2026-11-04T15:00:00Z', deploymentId: 'dpl_FAKE_1', target: 'production' }));
    await deliver(handler, envelope('deployment.error', { at: '2026-11-04T15:03:00Z', deploymentId: 'dpl_FAKE_1', target: 'production' }));
    await deliver(handler, envelope('deployment.created', { at: '2026-11-04T17:00:00Z', deploymentId: 'dpl_FAKE_2', target: 'production' }));
    await deliver(handler, envelope('deployment.succeeded', { at: '2026-11-04T17:02:00Z', deploymentId: 'dpl_FAKE_2', target: 'production' }));
    expect(store.deployments.get('dpl_FAKE_2').purpose).toBe('production-repair');
    expect(store.deployments.get('dpl_FAKE_2').purpose_rule).toBe('production-repair:after-error');
  });

  it('classifies the second same-day production deploy as development-verification, and a lone one as unknown', async () => {
    const store = makeStore();
    const handler = createDeploymentWebhookHandler({ db: store, env: { VERCEL_DEPLOY_WEBHOOK_SECRET: SECRET } });
    await deliver(handler, envelope('deployment.succeeded', { at: '2026-11-04T15:02:00Z', deploymentId: 'dpl_FAKE_1', target: 'production' }));
    expect(store.deployments.get('dpl_FAKE_1').purpose).toBe('unknown');
    await deliver(handler, envelope('deployment.succeeded', {
      at: '2026-11-04T19:02:00Z', deploymentId: 'dpl_FAKE_2', target: 'production',
      meta: { githubCommitSha: 'sha_FAKE2', githubCommitRef: 'feature-x', githubCommitRepo: 'owner/repo' }
    }));
    // Different branch: the same-day count is per project+branch,
    // so this is a first-of-day for its branch — still unknown.
    expect(store.deployments.get('dpl_FAKE_2').purpose).toBe('unknown');
    // More than two hours after the second: too late for the
    // rapid-replacement repair rule, so the day's repeat-deploy
    // pattern is what remains.
    await deliver(handler, envelope('deployment.succeeded', {
      at: '2026-11-04T22:30:00Z', deploymentId: 'dpl_FAKE_3', target: 'production',
      meta: { githubCommitSha: 'sha_FAKE3', githubCommitRef: 'feature-x', githubCommitRepo: 'owner/repo' }
    }));
    expect(store.deployments.get('dpl_FAKE_3').purpose).toBe('development-verification');
    expect(store.deployments.get('dpl_FAKE_3').purpose_rule).toBe('development-verification:repeat-deploy');
  });

  it('never overwrites a hand-corrected purpose, ignores unsubscribed types, and answers 500 when the store write fails', async () => {
    const store = makeStore();
    const handler = createDeploymentWebhookHandler({ db: store, env: { VERCEL_DEPLOY_WEBHOOK_SECRET: SECRET } });
    await deliver(handler, envelope('deployment.created', { at: '2026-11-04T17:00:00Z' }));
    const row = store.deployments.get('dpl_FAKE_1');
    row.purpose = 'production-repair'; row.purpose_rule = 'manual'; row.purpose_confirmed = true;
    await deliver(handler, envelope('deployment.succeeded', { at: '2026-11-04T17:02:00Z' }));
    expect(store.deployments.get('dpl_FAKE_1').purpose).toBe('production-repair');
    expect(store.deployments.get('dpl_FAKE_1').purpose_rule).toBe('manual');
    const ignored = await deliver(handler, envelope('domain.created', { at: '2026-11-04T17:03:00Z' }));
    expect(ignored.statusCode).toBe(200);
    expect(JSON.parse(ignored.body)).toMatchObject({ ignored: true });
    const broken = makeStore();
    broken.recordDeploymentEvent = async () => { throw new Error('store down'); };
    const brokenHandler = createDeploymentWebhookHandler({ db: broken, env: { VERCEL_DEPLOY_WEBHOOK_SECRET: SECRET } });
    const res = await deliver(brokenHandler, envelope('deployment.created', { at: '2026-11-04T17:00:00Z' }));
    expect(res.statusCode).toBe(500);
  });
});

describe('AUD-CI classifier helpers', () => {
  it('knows the promotion window edges in Denver time', () => {
    expect(inPromotionWindow(new Date('2026-11-04T07:00:00Z'))).toBe(false); // 00:00 MST
    expect(inPromotionWindow(new Date('2026-11-04T07:01:00Z'))).toBe(true);
    expect(inPromotionWindow(new Date('2026-11-04T07:45:00Z'))).toBe(true);
    expect(inPromotionWindow(new Date('2026-11-04T07:46:00Z'))).toBe(false);
    expect(inPromotionWindow(new Date('2026-07-04T06:30:00Z'))).toBe(true); // 00:30 MDT
  });
  it('bounds a Denver day in UTC across the offset', () => {
    const { start, end } = denverDayRangeUtc(new Date('2026-11-04T17:00:00Z'));
    expect(start.toISOString()).toBe('2026-11-04T07:00:00.000Z');
    expect(end.toISOString()).toBe('2026-11-05T07:00:00.000Z');
  });
  it('lifts commit fields from the recognized meta keys and tolerates their absence', () => {
    expect(liftCommitFields({ githubCommitSha: 'a', githubCommitRef: 'b', githubCommitRepo: 'o/r' }))
      .toEqual({ commitSha: 'a', commitRef: 'b', repo: 'o/r' });
    expect(liftCommitFields({})).toEqual({ commitSha: null, commitRef: null, repo: null });
    expect(liftCommitFields(null)).toEqual({ commitSha: null, commitRef: null, repo: null });
  });
  it('classifies rapid same-branch replacement as production-repair', () => {
    const verdict = classifyDeployment({
      deployment: { target: 'production', createdAt: '2026-11-04T16:30:00Z', commitRef: 'main' },
      context: {
        previousProduction: { state: 'ready', created_at: '2026-11-04T15:45:00Z', commit_ref: 'main' },
        sameDayCount: 2
      }
    });
    expect(verdict).toEqual({ purpose: 'production-repair', rule: 'production-repair:rapid-replacement' });
  });
});
