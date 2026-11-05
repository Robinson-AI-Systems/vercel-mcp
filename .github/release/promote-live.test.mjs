import test from 'node:test';
import assert from 'node:assert/strict';
import { checksPass, checksFailed, decide, denverDay, denverMinute, authorizedReleaseInvocation, run } from './promote-live.mjs';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
const main = 'a'.repeat(40), live = 'b'.repeat(40);
const good = { id: 1, name: 'ci', head_sha: main, app: { slug: 'github-actions' },
  status: 'completed', conclusion: 'success' };
test('Actions repository identity matches the deployed policy', () => {
  const path = new URL('./policy.json', import.meta.url);
  if (process.env.GITHUB_REPOSITORY && existsSync(path)) {
    const policy = JSON.parse(readFileSync(path, 'utf8'));
    assert.equal(policy.repository, process.env.GITHUB_REPOSITORY);
    assert.ok(policy.requiredChecks.includes('release-policy'));
  }
});
test('Denver calendar dates honor midnight and DST', () => {
  assert.equal(denverDay(new Date('2026-10-12T05:59:59Z')), '2026-10-11');
  assert.equal(denverDay(new Date('2026-10-12T06:00:00Z')), '2026-10-12');
  assert.equal(denverDay(new Date('2026-12-12T06:59:59Z')), '2026-12-11');
});
test('owner-only missed-schedule recovery cannot bypass Denver time or repo scope', () => {
  const repo='example/repo';
  const env={GITHUB_REPOSITORY:repo,GITHUB_REF:'refs/heads/main',
    GH_TOKEN:'fixture',GITHUB_EVENT_NAME:'workflow_dispatch',
    GITHUB_ACTOR:'christcr2012', GITHUB_TRIGGERING_ACTOR:'christcr2012',RECOVER_MISSED_DAILY:'true'};
  const before=new Date('2026-10-14T06:00:00Z');
  const after=new Date('2026-10-14T06:01:00Z');
  assert.equal(denverMinute(before),0);
  assert.equal(denverMinute(after),1);
  assert.equal(authorizedReleaseInvocation(env,repo,before),false);
  assert.equal(authorizedReleaseInvocation(env,repo,after),true);
  for(const changed of [
    {GITHUB_ACTOR:'not-the-owner'}, {RECOVER_MISSED_DAILY:'false'},
    {GITHUB_REPOSITORY:'wrong/repo'}, {GITHUB_REF:'refs/heads/feature'},
    {GH_TOKEN:''}, {GITHUB_EVENT_NAME:'push'},
    {GITHUB_EVENT_NAME:'pull_request'}
  ])assert.equal(authorizedReleaseInvocation({...env,...changed},repo,after),false);
  assert.equal(authorizedReleaseInvocation({
    ...env,GITHUB_EVENT_NAME:'schedule',GITHUB_ACTOR:'github-actions',
    RECOVER_MISSED_DAILY:'false'},repo,before),true);
  assert.equal(denverMinute(new Date('2026-12-14T07:01:00Z')),1);
});

test('requires successful latest exact-head trusted checks', () => {
  assert.equal(checksPass([good], ['ci'], main), true);
  for (const change of [{ conclusion: 'failure' }, { conclusion: 'skipped' },
    { status: 'in_progress' }, { head_sha: live }, { app: { slug: 'other' } }])
    assert.equal(checksPass([{ ...good, ...change }], ['ci'], main), false);
  assert.equal(checksPass([], ['ci'], main), false);
  assert.equal(checksPass([good, { ...good, id: 2, conclusion: 'failure' }], ['ci'], main), false);
  assert.equal(checksPass([good], ['ci', 'missing'], main), false);
  assert.equal(checksFailed([{ ...good, conclusion: 'failure' }], ['ci'], main), true);
  assert.equal(checksFailed([{ ...good, status: 'in_progress', conclusion: null }], ['ci'], main), false);
  assert.equal(checksFailed([{ ...good, head_sha: live, conclusion: 'failure' }], ['ci'], main), false);
});
test('one checked fast-forward daily; reruns and unchanged heads skip', () => {
  const state = { main, live, ancestor: true, green: true, alreadyToday: false };
  assert.equal(decide(state), 'promote');
  assert.equal(decide({ ...state, alreadyToday: true }), 'skip');
  assert.equal(decide({ ...state, live: main }), 'skip');
  assert.throws(() => decide({ ...state, ancestor: false }), /rewrite/);
  assert.throws(() => decide({ ...state, green: false }), /checks/);
  assert.throws(() => decide({ ...state, main: 'main' }), /identity/);
});
test('real atomic git promotion, read-back and second same-day update refusal', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'release-policy-'));
  const cwd = process.cwd(), fetchBefore = globalThis.fetch;
  const keys = ['GITHUB_REPOSITORY', 'GITHUB_REF', 'GITHUB_EVENT_NAME', 'GH_TOKEN'];
  const before = keys.map(k => process.env[k]);
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: 'pipe' }).trim();
  try {
    git('init', '--bare', join(dir, 'remote.git'));
    git('init', '-b', 'main');
    git('config', 'user.email', 'test@example.invalid');
    git('config', 'user.name', 'Release test');
    git('remote', 'add', 'origin', join(dir, 'remote.git'));
    writeFileSync(join(dir, 'fixture.txt'), 'first');
    git('add', 'fixture.txt'); git('commit', '-m', 'first');
    git('push', 'origin', 'main', 'main:live');
    const original = git('rev-parse', 'HEAD');
    writeFileSync(join(dir, 'fixture.txt'), 'second');
    git('commit', '-am', 'second'); git('push', 'origin', 'main');
    const second = git('rev-parse', 'HEAD');
    writeFileSync(join(dir, 'fixture.txt'), 'concurrent agent');
    git('commit', '-am', 'concurrent main');
    const checked = git('rev-parse', 'HEAD');
    git('checkout', '--detach', original);
    Object.assign(process.env, { GITHUB_REPOSITORY: 'example/repo', GITHUB_REF: 'refs/heads/main',
      GITHUB_EVENT_NAME: 'schedule', GH_TOKEN: 'fixture' });
    process.chdir(dir);
    const policy = { repository: 'example/repo', requiredChecks: ['ci'] };
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ total_count: 1,
      check_runs: [{ ...good, head_sha: second, conclusion: 'failure' }] }) });
    await assert.rejects(run(policy), /check failed/);
    assert.equal(git('ls-remote', 'origin', 'refs/heads/live').split(/\s+/)[0], original);
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ total_count: 0, check_runs: [] }) });
    await assert.rejects(run(policy, { attempts: 2, pause: async () => {} }), /window exhausted/);
    assert.equal(git('ls-remote', 'origin', 'refs/heads/live').split(/\s+/)[0], original);
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      if (calls === 1) git('push', 'origin', checked + ':refs/heads/main');
      return { ok: true, json: async () => ({ total_count: 1, check_runs: [{ ...good,
        head_sha: calls === 1 ? second : checked,
        status: calls === 2 ? 'in_progress' : 'completed' }] }) };
    };
    await run(policy, { attempts: 3, pause: async () => {} });
    assert.equal(calls, 3);
    assert.equal(git('ls-remote', 'origin', 'refs/heads/live').split(/\s+/)[0], checked);
    assert.equal(git('ls-remote', 'origin', 'refs/tags/live-promotion/' + denverDay()).split(/\s+/)[0], checked);
    git('checkout', 'main');
    writeFileSync(join(dir, 'fixture.txt'), 'third');
    git('commit', '-am', 'third'); git('push', 'origin', 'main');
    await run({ repository: 'example/repo', requiredChecks: ['ci'] });
    assert.equal(git('ls-remote', 'origin', 'refs/heads/live').split(/\s+/)[0], checked);
    process.env.GITHUB_EVENT_NAME = 'workflow_dispatch';
    await assert.rejects(run({ repository: 'example/repo', requiredChecks: ['ci'] }), /Scheduled/);
  } finally {
    process.chdir(cwd); globalThis.fetch = fetchBefore;
    keys.forEach((key, i) => { if (before[i] === undefined) delete process.env[key]; else process.env[key] = before[i]; });
    rmSync(dir, { recursive: true, force: true });
  }
});

test('bounded schedule backups preserve midnight, daily marker and owner recovery', () => {
  const workflow = readFileSync(new URL('../workflows/daily-live.yml', import.meta.url), 'utf8');
  const crons = [...workflow.matchAll(/cron: '([^']+)'/g)].map(m => m[1]);
  assert.deepEqual(crons, ['23 0 * * *', '39 0 * * *', '39 1 * * *', '59 5 * * *', '5 13 * * *']);
  assert.equal((workflow.match(/timezone: America\/Denver/g) || []).length, 4);
  assert.match(workflow, /recover_missed_daily:/);
  assert.match(workflow, /default: false/);
  assert.match(workflow, /github.actor == 'christcr2012'/);
  assert.match(workflow, /RECOVER_MISSED_DAILY:/);
  assert.match(workflow, /cancel-in-progress: false/);
});
test('recovery requires explicit owner, expected repository, main and elapsed midnight', async () => {
  const { authorizedReleaseInvocation } = await import('./promote-live.mjs');
  const env = { GITHUB_REPOSITORY: 'example/repo', GITHUB_REF: 'refs/heads/main',
    GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_ACTOR: 'christcr2012', GITHUB_TRIGGERING_ACTOR: 'christcr2012',
    RECOVER_MISSED_DAILY: 'true', GH_TOKEN: 'fixture' };
  const time = new Date('2026-10-14T11:00:00Z');
  assert.equal(authorizedReleaseInvocation(env, 'example/repo', time), true);
  for (const change of [{ GITHUB_TRIGGERING_ACTOR: 'other' }, { GITHUB_TRIGGERING_ACTOR: undefined }, { GITHUB_ACTOR: 'other' }, { RECOVER_MISSED_DAILY: 'false' },
    { RECOVER_MISSED_DAILY: undefined }, { GITHUB_REF: 'refs/heads/live' },
    { GITHUB_REPOSITORY: 'other/repo' }, { GITHUB_EVENT_NAME: 'push' },
    { GH_TOKEN: '' }])
    assert.equal(authorizedReleaseInvocation({ ...env, ...change }, 'example/repo', time), false);
  assert.equal(authorizedReleaseInvocation(env, 'example/repo', new Date('2026-10-14T06:00:00Z')), false);
  assert.equal(authorizedReleaseInvocation(env, 'example/repo', new Date('2026-12-14T07:00:00Z')), false);
  assert.equal(authorizedReleaseInvocation(env, 'example/repo', new Date('2026-12-14T07:01:00Z')), true);
  assert.equal(authorizedReleaseInvocation({ ...env, GITHUB_EVENT_NAME: 'schedule' }, 'example/repo', time), true);
});

test('successful no-change run records a receipt and suppresses later development', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'release-no-change-'));
  const cwd = process.cwd(), fetchBefore = globalThis.fetch;
  const tokenKey = 'GH_TOKEN';
  const keys = ['GITHUB_REPOSITORY', 'GITHUB_REF', 'GITHUB_EVENT_NAME', tokenKey];
  const before = keys.map(k => process.env[k]);
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: 'pipe' }).trim();
  try {
    git('init', '--bare', join(dir, 'remote.git'));
    git('init', '-b', 'main');
    git('config', 'user.email', 'test@example.invalid');
    git('config', 'user.name', 'Release test');
    git('remote', 'add', 'origin', join(dir, 'remote.git'));
    writeFileSync(join(dir, 'fixture.txt'), 'initial');
    git('add', 'fixture.txt'); git('commit', '-m', 'initial');
    git('push', 'origin', 'main', 'main:live');
    const original = git('rev-parse', 'HEAD');
    Object.assign(process.env, { GITHUB_REPOSITORY: 'example/repo',
      GITHUB_REF: 'refs/heads/main', GITHUB_EVENT_NAME: 'schedule', [tokenKey]: 'fixture' });
    process.chdir(dir);
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ total_count: 1,
      check_runs: [{ ...good, head_sha: original }] }) });
    const policy = { repository: 'example/repo', requiredChecks: ['ci'] };
    await run(policy, { attempts: 1 });
    assert.equal(git('ls-remote', 'origin', 'refs/tags/live-promotion/' + denverDay()).split(/\s+/)[0], original);
    writeFileSync(join(dir, 'fixture.txt'), 'later development');
    git('commit', '-am', 'later'); git('push', 'origin', 'main');
    await run(policy, { attempts: 1 });
    assert.equal(git('ls-remote', 'origin', 'refs/heads/live').split(/\s+/)[0], original);
  } finally {
    process.chdir(cwd); globalThis.fetch = fetchBefore;
    keys.forEach((key, i) => { if (before[i] === undefined) delete process.env[key]; else process.env[key] = before[i]; });
    rmSync(dir, { recursive: true, force: true });
  }
});

test('manual release invocation is owner-gated, SHA-pinned and not Denver-time bound', () => {
  const repo = 'example/repo';
  const sha = 'c'.repeat(40);
  const env = { GITHUB_REPOSITORY: repo, GITHUB_REF: 'refs/heads/main',
    GH_TOKEN: 'fixture', GITHUB_EVENT_NAME: 'workflow_dispatch',
    GITHUB_ACTOR: 'christcr2012', GITHUB_TRIGGERING_ACTOR: 'christcr2012',
    MANUAL_RELEASE: 'true', EXPECTED_MAIN_SHA: sha };
  // The manual route carries the owner's own authority: no elapsed-midnight
  // condition applies to it (that condition guards missed-schedule recovery).
  assert.equal(authorizedReleaseInvocation(env, repo, new Date('2026-10-14T06:00:00Z')), true);
  assert.equal(authorizedReleaseInvocation(env, repo, new Date('2026-10-14T11:00:00Z')), true);
  for (const changed of [
    { GITHUB_ACTOR: 'not-the-owner' }, { GITHUB_TRIGGERING_ACTOR: 'not-the-owner' },
    { GITHUB_TRIGGERING_ACTOR: undefined }, { MANUAL_RELEASE: 'false' },
    { EXPECTED_MAIN_SHA: undefined }, { EXPECTED_MAIN_SHA: '' },
    { EXPECTED_MAIN_SHA: 'abc123' }, { EXPECTED_MAIN_SHA: 'z'.repeat(40) },
    { EXPECTED_MAIN_SHA: sha.toUpperCase() },
    { GITHUB_EVENT_NAME: 'push' }, { GITHUB_EVENT_NAME: 'pull_request' },
    { GITHUB_REPOSITORY: 'wrong/repo' }, { GITHUB_REF: 'refs/heads/live' }, { GH_TOKEN: '' }
  ]) assert.equal(authorizedReleaseInvocation({ ...env, ...changed }, repo,
    new Date('2026-10-14T11:00:00Z')), false);
  // With neither dispatch flag set, a bare owner dispatch is still refused.
  assert.equal(authorizedReleaseInvocation({ ...env, MANUAL_RELEASE: 'false',
    RECOVER_MISSED_DAILY: 'false' }, repo, new Date('2026-10-14T11:00:00Z')), false);
});

test('workflow admits the owner manual release and passes its inputs to the script', () => {
  const workflow = readFileSync(new URL('../workflows/daily-live.yml', import.meta.url), 'utf8');
  assert.match(workflow, /manual_release:/);
  assert.match(workflow, /expected_main_sha:/);
  assert.match(workflow, /inputs.manual_release == true/);
  assert.match(workflow, /MANUAL_RELEASE:/);
  assert.match(workflow, /EXPECTED_MAIN_SHA:/);
});

test('manual release promotes past a consumed day tag, writes its own receipt, and leaves the automatic path capped', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'release-manual-'));
  const cwd = process.cwd(), fetchBefore = globalThis.fetch;
  const keys = ['GITHUB_REPOSITORY', 'GITHUB_REF', 'GITHUB_EVENT_NAME', 'GH_TOKEN',
    'GITHUB_ACTOR', 'GITHUB_TRIGGERING_ACTOR', 'MANUAL_RELEASE', 'EXPECTED_MAIN_SHA', 'RECOVER_MISSED_DAILY'];
  const before = keys.map(k => process.env[k]);
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: 'pipe' }).trim();
  try {
    git('init', '--bare', join(dir, 'remote.git'));
    git('init', '-b', 'main');
    git('config', 'user.email', 'test@example.invalid');
    git('config', 'user.name', 'Release test');
    git('remote', 'add', 'origin', join(dir, 'remote.git'));
    writeFileSync(join(dir, 'fixture.txt'), 'first');
    git('add', 'fixture.txt'); git('commit', '-m', 'first');
    git('push', 'origin', 'main', 'main:live');
    const original = git('rev-parse', 'HEAD');
    // The day's automatic promotion already happened: its receipt tag exists.
    git('push', 'origin', 'main:refs/tags/live-promotion/' + denverDay());
    writeFileSync(join(dir, 'fixture.txt'), 'second');
    git('commit', '-am', 'second'); git('push', 'origin', 'main');
    const second = git('rev-parse', 'HEAD');
    Object.assign(process.env, { GITHUB_REPOSITORY: 'example/repo', GITHUB_REF: 'refs/heads/main',
      GITHUB_EVENT_NAME: 'workflow_dispatch', GH_TOKEN: 'fixture',
      GITHUB_ACTOR: 'christcr2012', GITHUB_TRIGGERING_ACTOR: 'christcr2012',
      MANUAL_RELEASE: 'true', EXPECTED_MAIN_SHA: second });
    process.chdir(dir);
    const policy = { repository: 'example/repo', requiredChecks: ['ci'] };
    let head = second;
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ total_count: 1,
      check_runs: [{ ...good, head_sha: head }] }) });
    // 1. The owner release promotes the exact authorized head even though the
    //    day tag is consumed, and writes its own per-head receipt.
    await run(policy, { attempts: 1, pause: async () => {} });
    assert.equal(git('ls-remote', 'origin', 'refs/heads/live').split(/\s+/)[0], second);
    assert.equal(git('ls-remote', 'origin', 'refs/tags/manual-live-promotion/' + second).split(/\s+/)[0], second);
    // 2. The automatic receipt is untouched: it still names the day's first head.
    assert.equal(git('ls-remote', 'origin', 'refs/tags/live-promotion/' + denverDay()).split(/\s+/)[0], original);
    // 3. Re-running the same owner release is a recorded no-op on its own receipt.
    await run(policy, { attempts: 1, pause: async () => {} });
    assert.equal(git('ls-remote', 'origin', 'refs/heads/live').split(/\s+/)[0], second);
    // 4. A stale authorization (main has since moved) refuses before any move.
    writeFileSync(join(dir, 'fixture.txt'), 'third');
    git('commit', '-am', 'third'); git('push', 'origin', 'main');
    const third = git('rev-parse', 'HEAD');
    head = third;
    process.env.EXPECTED_MAIN_SHA = 'd'.repeat(40);
    await assert.rejects(run(policy, { attempts: 1, pause: async () => {} }), /Main moved/);
    assert.equal(git('ls-remote', 'origin', 'refs/heads/live').split(/\s+/)[0], second);
    // 5. The automatic path is unchanged: the consumed day tag still caps it,
    //    and the manual receipt does not leak into the automatic decision.
    process.env.GITHUB_EVENT_NAME = 'schedule';
    delete process.env.MANUAL_RELEASE; delete process.env.EXPECTED_MAIN_SHA;
    await run(policy, { attempts: 1, pause: async () => {} });
    assert.equal(git('ls-remote', 'origin', 'refs/heads/live').split(/\s+/)[0], second);
  } finally {
    process.chdir(cwd); globalThis.fetch = fetchBefore;
    keys.forEach((key, i) => { if (before[i] === undefined) delete process.env[key]; else process.env[key] = before[i]; });
    rmSync(dir, { recursive: true, force: true });
  }
});
