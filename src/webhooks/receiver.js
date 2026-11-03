// AUD-CI: the Vercel deployment webhook receiver
// (design: vercel-deployment-webhook-design-2026-11-03).
// One route — POST /api/webhooks/deployments — records every
// deployment event on the team with its actor, so no deployment
// is ever unattributed again. The contract that matters:
//  - the signature is HMAC-SHA1 over the RAW body, compared in
//    constant time; forged traffic gets a 403 and never
//    reaches the store;
//  - deliveries are at-least-once (Vercel retries for 24h), so
//    recording is idempotent on the delivery id;
//  - a record that could not be written answers 500, never a
//    false 200 — the retry is the safety net, and a silent gap
//    is the exact failure this receiver exists to eliminate.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createDb } from '../db.js';
import { only, send } from '../core/http.js';
import { classifyDeployment, denverDayRangeUtc, liftCommitFields } from './classify.js';

export const DEPLOYMENT_WEBHOOK_PATH = '/api/webhooks/deployments';
export const WEBHOOK_EVENTS = new Set([
  'deployment.created', 'deployment.succeeded', 'deployment.error',
  'deployment.canceled', 'deployment.promoted', 'deployment.rollback'
]);
const TERMINAL_OR_PROMOTED = new Set([
  'deployment.succeeded', 'deployment.error', 'deployment.canceled',
  'deployment.promoted'
]);
// Test-visible count of signature rejects (design §6: counted,
// never stored as events).
export const signatureRejects = { count: 0 };

async function readRawBody(req) {
  if (typeof req?.rawBody === 'string') return req.rawBody;
  if (Buffer.isBuffer(req?.rawBody)) return req.rawBody.toString('utf8');
  if (typeof req?.body === 'string') return req.body;
  if (Buffer.isBuffer(req?.body)) return req.body.toString('utf8');
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function signatureMatches(rawBody, signature, secret) {
  if (typeof signature !== 'string' || !signature) return false;
  const expected = createHmac('sha1', secret).update(rawBody, 'utf8').digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signature, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

const STATE_RANK = { created: 0, ready: 1, error: 1, canceled: 1 };

// Fold one event into the deployments rollup. Pure: the caller
// persists the result. State only moves forward (a retried
// 'created' arriving after 'succeeded' changes nothing), the
// actor is the FIRST event's user (design §4), timestamps come
// from Vercel's envelope clock, and a hand-corrected purpose is
// never overwritten (the caller skips classification then too).
export function mergeDeployment(existing, seed, eventType, eventAt) {
  const at = new Date(eventAt);
  const row = existing ? { ...existing } : {
    deployment_id: seed.deploymentId,
    project_id: seed.projectId,
    state: 'created',
    promoted: false,
    rolled_back: false,
    ready_at: null,
    failed_at: null,
    promoted_at: null,
    rolled_back_at: null,
    purpose: null,
    purpose_rule: null,
    purpose_confirmed: false,
    actor_user_id: null,
    created_at: at
  };
  row.project_id = seed.projectId;
  row.project_name = seed.projectName ?? row.project_name ?? null;
  row.team_id = seed.teamId ?? row.team_id ?? null;
  row.target = seed.target ?? row.target ?? null;
  row.commit_sha = seed.commitSha ?? row.commit_sha ?? null;
  row.commit_ref = seed.commitRef ?? row.commit_ref ?? null;
  row.repo = seed.repo ?? row.repo ?? null;
  if (row.actor_user_id === null || row.actor_user_id === undefined) {
    row.actor_user_id = seed.actorUserId ?? null;
  }
  if (eventType === 'deployment.created') {
    const seen = new Date(row.created_at);
    if (at < seen) row.created_at = at;
  }
  const rank = STATE_RANK[row.state] ?? 0;
  if (eventType === 'deployment.succeeded' && rank < 1) {
    row.state = 'ready'; row.ready_at = at;
  } else if (eventType === 'deployment.error' && rank < 1) {
    row.state = 'error'; row.failed_at = at;
  } else if (eventType === 'deployment.canceled' && rank < 1) {
    row.state = 'canceled';
  } else if (eventType === 'deployment.promoted') {
    row.promoted = true; row.promoted_at = row.promoted_at ?? at;
  } else if (eventType === 'deployment.rollback') {
    row.rolled_back = true; row.rolled_back_at = row.rolled_back_at ?? at;
  }
  return row;
}

function toRecord(row) {
  const time = (v) => (v === null || v === undefined ? null :
    (v instanceof Date ? v.toISOString() : v));
  return {
    deploymentId: row.deployment_id,
    projectId: row.project_id,
    projectName: row.project_name ?? null,
    teamId: row.team_id ?? null,
    actorUserId: row.actor_user_id ?? null,
    target: row.target ?? null,
    commitSha: row.commit_sha ?? null,
    commitRef: row.commit_ref ?? null,
    repo: row.repo ?? null,
    state: row.state,
    promoted: row.promoted === true,
    rolledBack: row.rolled_back === true,
    createdAt: time(row.created_at),
    readyAt: time(row.ready_at),
    failedAt: time(row.failed_at),
    promotedAt: time(row.promoted_at),
    rolledBackAt: time(row.rolled_back_at),
    purpose: row.purpose ?? null,
    purposeRule: row.purpose_rule ?? null,
    purposeConfirmed: row.purpose_confirmed === true
  };
}

export function createDeploymentWebhookHandler({ db, env = process.env } = {}) {
  const store = db ?? createDb();
  return async function deploymentWebhook(req, res) {
    if (!only(res, req, ['POST'])) return;
    const secret = env?.VERCEL_DEPLOY_WEBHOOK_SECRET;
    if (typeof secret !== 'string' || !secret) {
      return send(res, 500, { error: 'webhook_secret_not_configured' });
    }
    let raw;
    try { raw = await readRawBody(req); }
    catch { return send(res, 400, { error: 'unreadable_body' }); }
    if (!signatureMatches(raw, req.headers?.['x-vercel-signature'], secret)) {
      signatureRejects.count += 1;
      return send(res, 403, { error: 'invalid_signature' });
    }
    let envelope;
    try { envelope = JSON.parse(raw); }
    catch { return send(res, 400, { error: 'invalid_json' }); }
    if (!envelope || typeof envelope !== 'object' ||
      typeof envelope.id !== 'string' || typeof envelope.type !== 'string' ||
      !Number.isFinite(envelope.createdAt)) {
      return send(res, 400, { error: 'invalid_envelope' });
    }
    if (!WEBHOOK_EVENTS.has(envelope.type)) {
      return send(res, 200, { recorded: false, ignored: true });
    }
    const payload = envelope.payload ?? {};
    const deployment = payload.deployment ?? {};
    if (typeof deployment.id !== 'string' || typeof payload.project?.id !== 'string') {
      return send(res, 400, { error: 'invalid_payload' });
    }
    const eventAt = new Date(envelope.createdAt);
    const meta = deployment.meta ?? null;
    const commit = liftCommitFields(meta);
    const eventRow = {
      deliveryId: envelope.id,
      eventType: envelope.type,
      eventCreatedAt: eventAt.toISOString(),
      deploymentId: deployment.id,
      projectId: payload.project.id,
      projectName: deployment.name ?? null,
      teamId: payload.team?.id ?? null,
      actorUserId: payload.user?.id ?? null,
      target: payload.target ?? null,
      deploymentUrl: deployment.url ?? null,
      meta,
      rawPayload: envelope
    };
    const seed = {
      deploymentId: deployment.id,
      projectId: payload.project.id,
      projectName: deployment.name ?? null,
      teamId: payload.team?.id ?? null,
      actorUserId: payload.user?.id ?? null,
      target: payload.target ?? null,
      ...commit
    };
    try {
      await store.initSchema();
      // The event insert is the idempotency anchor; folding and
      // classification are themselves idempotent, so a duplicate
      // delivery (a retry of one that died mid-write, or a plain
      // re-send) simply re-runs them and heals any partial state.
      const inserted = await store.recordDeploymentEvent(eventRow);
      const existing = await store.getDeploymentRecord(deployment.id);
      let merged = mergeDeployment(existing, seed, envelope.type, eventAt);
      await store.upsertDeploymentRecord(toRecord(merged));
      if (TERMINAL_OR_PROMOTED.has(envelope.type) &&
        merged.purpose_rule !== 'manual') {
        // Context is read AFTER the upsert so the same-day count
        // includes this deployment, exactly as the rules state.
        const { start, end } = denverDayRangeUtc(new Date(merged.created_at));
        const context = await store.deploymentClassificationContext({
          projectId: merged.project_id,
          deploymentId: merged.deployment_id,
          createdAt: new Date(merged.created_at).toISOString(),
          branch: merged.commit_ref ?? null,
          dayStart: start.toISOString(),
          dayEnd: end.toISOString()
        });
        const verdict = classifyDeployment({
          deployment: {
            target: merged.target,
            createdAt: merged.created_at,
            commitRef: merged.commit_ref ?? null
          },
          context
        });
        merged = { ...merged, purpose: verdict.purpose, purpose_rule: verdict.rule };
        await store.upsertDeploymentRecord(toRecord(merged));
      }
      return send(res, 200, { recorded: inserted, duplicate: !inserted });
    } catch {
      // Never a false 200: Vercel retries for 24 hours and the
      // delivery id makes the retry safe.
      return send(res, 500, { error: 'record_write_failed' });
    }
  };
}

export const handleDeploymentWebhook = createDeploymentWebhookHandler();
