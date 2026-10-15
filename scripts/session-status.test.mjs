import test from 'node:test';
import assert from 'node:assert/strict';
import { readQueue, planQueue, summarizeRoadmap, run } from './session-status.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const a = 'a'.repeat(40), b = 'b'.repeat(40), c = 'c'.repeat(40);
const row = (id = 'READ', revision = a) => ({ id, priority: 1, requiredRevision: revision, task: 'Read custom service', procedure: 'docs/ACCEPTANCE.md', gates: 'Existing scoped owner grant', lastEvidence: 'Not run', dependsOn: [], status: 'PENDING' });
const block = rows => '<!-- release-acceptance:start -->\n```json\n' + JSON.stringify(rows) + '\n```\n<!-- release-acceptance:end -->';
const obs = { main: c, live: b, deployed: b, deploymentState: 'READY' };
const fixtureRoadmap = {
  order: ['K', 'H', 'S'],
  cards: [
    { id: 'K-1', batch: 'K', units: ['K-1', 'K-1-extra'], status: 'MERGED' },
    { id: 'H-1', batch: 'H', units: ['H-1'], status: 'IN_PROGRESS' },
    { id: 'H-2', batch: 'H', units: ['H-2'], status: 'APPROVED' },
    { id: 'H-3', batch: 'H', units: ['H-3'], status: 'BLOCKED' },
    { id: 'S-future', batch: 'S', units: ['S-future'], status: 'ON_REQUEST' }
  ]
};
const ancestor = (x, y) => [a, b, c].indexOf(x) <= [a, b, c].indexOf(y);

test('partial release clears older work without main/live equality', () => {
  const plan = planQueue([row('OLD', a), row('NEW', c)], obs, ancestor);
  assert.equal(plan.find(x => x.id === 'OLD').disposition, 'DEPLOYED_CANDIDATE_CHECK_GATES');
  assert.equal(plan.find(x => x.id === 'NEW').disposition, 'WAIT_RELEASE_OR_FETCH_HISTORY');
});
test('equal branches without READY production do not clear work', () => {
  for (const change of [{ deployed: null }, { deploymentState: 'BUILDING' }, { live: null }]) {
    assert.equal(planQueue([row()], { ...obs, main: b, ...change }, ancestor)[0].disposition, 'VERIFY_DEPLOYMENT');
  }
});
test('divergent refs, unknown history and production ahead of live fail closed', () => {
  assert.equal(planQueue([row()], obs, () => false)[0].disposition, 'VERIFY_DEPLOYMENT');
  assert.equal(planQueue([row()], { ...obs, deployed: c }, ancestor)[0].disposition, 'VERIFY_DEPLOYMENT');
  assert.equal(planQueue([row()], obs, (x, y) => x === y ? true : null)[0].disposition, 'VERIFY_DEPLOYMENT');
});
test('passed dependencies require their deployed code; rollback reopens proof', () => {
  const first = { ...row('FIRST', c), status: 'PASSED' };
  const second = { ...row('SECOND', a), dependsOn: ['FIRST'] };
  const plan = planQueue([first, second], obs, ancestor);
  assert.equal(plan[0].disposition, 'RECHECK_AFTER_ROLLBACK');
  assert.equal(plan[1].disposition, 'WAIT_ACCEPTANCE_DEPENDENCY');
  first.requiredRevision = a;
  assert.equal(planQueue([first, second], obs, ancestor)[1].disposition, 'DEPLOYED_CANDIDATE_CHECK_GATES');
});
test('external gates are reconsidered; priority is stable and source rows are untouched', () => {
  const rows = [{ ...row('LATER'), priority: 2 }, { ...row('BLOCKED'), status: 'BLOCKED' }];
  const before = JSON.stringify(rows);
  assert.equal(planQueue(rows, obs, ancestor)[0].disposition, 'RECHECK_EXTERNAL_GATE');
  assert.equal(JSON.stringify(rows), before);
});
test('invalid, duplicate, missing, unknown and cyclic queue entries are refused', () => {
  for (const text of ['none', block([]) + block([]), block([row(), row()]), block([{ ...row(), requiredRevision: 'main' }]), block([{ ...row(), dependsOn: ['MISSING'] }]), block([{ ...row(), dependsOn: ['READ'] }]), block([{ ...row(), procedure: '' }])]) assert.throws(() => readQueue(text));
  assert.deepEqual(readQueue(block([])), []);
});
test('PR count is informational and cannot dictate a session boundary', () => {
  assert.doesNotMatch(run.toString(), /Next session boundary/);
});
test('real git refs and ancestry drive the offline CLI without network/mutations', () => {
  const root = mkdtempSync(join(tmpdir(), 'session-status-'));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  try {
    git('init'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid');
    mkdirSync(join(root, 'docs/pr-cards'), { recursive: true });
    writeFileSync(join(root, 'docs/pr-cards/work-index.json'), JSON.stringify(fixtureRoadmap)); writeFileSync(join(root, 'file'), 'first'); git('add', '.'); git('commit', '-m', 'first'); const first = git('rev-parse', 'HEAD');
    writeFileSync(join(root, 'file'), 'second'); git('add', '.'); git('commit', '-m', 'second'); const second = git('rev-parse', 'HEAD');
    git('update-ref', 'refs/remotes/origin/main', second); git('update-ref', 'refs/remotes/origin/live', first);
    writeFileSync(join(root, 'docs/session-policy.json'), JSON.stringify({ repository: 'fixture/repo', ledger: 'docs/STATUS.md', instructions: 'AGENTS.md' }));
    writeFileSync(join(root, 'docs/STATUS.md'), block([row('FIRST', first), row('SECOND', second)]));
    const before = git('status', '--porcelain');
    const output = run(root, ['--deployed', first, '--state', 'READY', '--latest-pr', '104']);
    assert.match(output, /PR work unit = one whole predefined batch subsection/);
    assert.match(output, /Partial subsection = zero completed batch subsections/);
    assert.match(output, /remaining approved/);
    assert.match(output, /PR planning averages: 400–800 changed production lines and 2–5/);
    assert.match(output, /FIRST DEPLOYED_CANDIDATE_CHECK_GATES/); assert.match(output, /SECOND WAIT_RELEASE_OR_FETCH_HISTORY/); assert.match(output, /Latest observed PR: #104 \(informational only/); assert.doesNotMatch(output, /Next session boundary/);
    assert.equal(git('status', '--porcelain'), before);
    assert.match(run(root, []), /VERIFY_DEPLOYMENT/);
    assert.throws(() => run(root, ['--deployed', first])); assert.throws(() => run(root, ['--deployed', first, '--state', 'FAKE'])); assert.throws(() => run(root, ['--latest-pr', '1.5']));
    writeFileSync(join(root, 'docs/STATUS.md'), block(Array.from({ length: 12 }, (_, i) => row(`TASK-${i}`, first))));
    assert.match(run(root, []), /2 additional tasks/);
    assert.doesNotMatch(run(root, ['--limit', '12']), /additional tasks/);
    assert.throws(() => run(root, ['--limit', '0']));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('roadmap progress counts coarse indexed units without promoting in-progress or blocked work', () => {
  const before = JSON.stringify(fixtureRoadmap);
  const summary = summarizeRoadmap(fixtureRoadmap);
  assert.deepEqual({
    total: summary.total, merged: summary.merged,
    inProgress: summary.inProgress, approved: summary.approved,
    blocked: summary.blocked, onRequest: summary.onRequest,
    remainingApproved: summary.remainingApproved,
    unfinishedWithBlocked: summary.unfinishedWithBlocked
  }, {
    total: 6, merged: 2, inProgress: 1, approved: 1,
    blocked: 1, onRequest: 1, remainingApproved: 2,
    unfinishedWithBlocked: 3
  });
  assert.deepEqual(summary.batches[1].remaining, ['H-1', 'H-2']);
  assert.deepEqual(summary.batches[1].blocked, ['H-3']);
  assert.deepEqual(summary.batches[2].onRequest, ['S-future']);
  assert.equal(JSON.stringify(fixtureRoadmap), before);
});

test('roadmap summary refuses missing, duplicate or unknown units/status/batches', () => {
  for (const broken of [
    { ...fixtureRoadmap, cards: [] , order: ['K', 'K'] },
    { ...fixtureRoadmap, cards: [
      ...fixtureRoadmap.cards, { ...fixtureRoadmap.cards[0], id: 'duplicate' }] },
    { ...fixtureRoadmap, cards: [
      ...fixtureRoadmap.cards.slice(0, 1),
      { ...fixtureRoadmap.cards[1], status: 'PENDING_BUT_UNTRACKED' },
      ...fixtureRoadmap.cards.slice(2)] },
    { ...fixtureRoadmap, cards: [
      { ...fixtureRoadmap.cards[0], units: [] }, ...fixtureRoadmap.cards.slice(1)] },
    { ...fixtureRoadmap, cards: [
      { ...fixtureRoadmap.cards[0], batch: 'UNLISTED' },
      ...fixtureRoadmap.cards.slice(1)] }
  ]) assert.throws(() => summarizeRoadmap(broken));
});

test('roadmap totals count the actual local index and never infer fine-grained PR slices', () => {
  const small = summarizeRoadmap({ order: ['H'], cards: [
    { id: 'H-1', batch: 'H', status: 'IN_PROGRESS', units: ['H-1'] },
    { id: 'H-2', batch: 'H', status: 'MERGED', units: ['H-2'] }
  ] });
  assert.equal(small.remainingApproved, 1);
  assert.equal(small.merged, 1);
  assert.equal(Object.hasOwn(small, 'completedPrSlices'), false);
});


test('native COMPLETE and PLANNED statuses remain distinct from merged and approved', () => {
  const result = summarizeRoadmap({ order: ['A'], cards: [
    { id: 'A-1', batch: 'A', units: ['A-1'], status: 'COMPLETE' },
    { id: 'A-2', batch: 'A', units: ['A-2'], status: 'PLANNED' }
  ] });
  assert.equal(result.merged, 0); assert.equal(result.complete, 1);
  assert.equal(result.planned, 1); assert.equal(result.remainingApproved, 0);
  assert.equal(result.remainingIncludingPlanned, 1);
  assert.deepEqual(result.batches[0].planned, ['A-2']);
});
