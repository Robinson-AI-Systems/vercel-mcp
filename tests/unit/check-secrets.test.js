import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { isPinnedOpenApiSnapshot, PINNED_OPENAPI, scanFiles, scanText } from '../../scripts/check-secrets.mjs';

const SCRIPT = resolve('scripts/check-secrets.mjs');
// Real-shaped values are assembled at run time so this file itself never contains one.
const realVercelToken = 'vcp_' + 'Ab3dE5gH7jK9mN1pQ3sT5vX7z'.repeat(2);
const dirs = [];
const tempDir = () => { const d = mkdtempSync(join(tmpdir(), 'vercel-mcp-secret-')); dirs.push(d); return d; };
afterEach(() => { while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true }); });

describe('secret scan', () => {
  it('permits only the untouched SHA-pinned official API document', () => {
    const bytes = readFileSync(PINNED_OPENAPI.path);
    expect(isPinnedOpenApiSnapshot(PINNED_OPENAPI.path, bytes)).toBe(true);
    expect(scanFiles([PINNED_OPENAPI.path])).toEqual([]);
    expect(isPinnedOpenApiSnapshot(PINNED_OPENAPI.path, Buffer.concat([bytes, Buffer.from('x')]))).toBe(false);
    expect(isPinnedOpenApiSnapshot('src/other.json', bytes)).toBe(false);
  });

  it('fails on a planted real-shaped vcp_ token in a file, without printing the value', () => {
    const dir = tempDir();
    const path = join(dir, 'planted.js');
    writeFileSync(path, `export const token = '${realVercelToken}';\n`);
    expect(scanFiles([path])).toEqual([{ path, types: ['Vercel token'] }]);
    const run = spawnSync(process.execPath, [SCRIPT, '--file', path], { encoding: 'utf8' });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('Vercel token');
    expect(run.stdout + run.stderr).not.toContain(realVercelToken);
  });

  it('scans the files git tracks (not just named files)', () => {
    const dir = tempDir();
    const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.test', ...args], { cwd: dir });
    git('init', '-q');
    writeFileSync(join(dir, 'clean.md'), 'nothing here\n');
    writeFileSync(join(dir, 'leak.env'), `VERCEL_TOKEN=${realVercelToken}\n`);
    writeFileSync(join(dir, 'untracked.txt'), `${realVercelToken}\n`);
    git('add', 'clean.md', 'leak.env');
    const run = spawnSync(process.execPath, [SCRIPT], { cwd: dir, encoding: 'utf8' });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('leak.env');
    expect(run.stderr).not.toContain('untracked.txt');
    git('rm', '-q', '--cached', 'leak.env');
    const clean = spawnSync(process.execPath, [SCRIPT], { cwd: dir, encoding: 'utf8' });
    expect(clean.status).toBe(0);
    expect(clean.stdout).toMatch(/Secret scan passed \(1 tracked files\)/);
  });

  it('allows explicitly fake values', () => {
    expect(scanText('vcp_FAKE' + 'x'.repeat(30) + ' vercel_blob_rw_FAKE' + 'y'.repeat(20))).toEqual([]);
    expect(scanText('team_FAKE' + 'a'.repeat(20) + ' prj_FAKE' + 'b'.repeat(24) + ' sk_test_FAKE' + 'c'.repeat(20))).toEqual([]);
    expect(scanText('postgresql://postgres:ci-only-not-a-secret@127.0.0.1:5432/postgres')).toEqual([]);
  });

  it('flags every kind of credential and real ID the card names', () => {
    const cases = [
      ['vci_' + 'Q'.repeat(24), 'Vercel token'],
      ['vercel_blob_rw_' + 'Z9'.repeat(10), 'Vercel Blob token'],
      ['sk_' + 'live_' + 'FAKE' + 'A'.repeat(24), 'Stripe live key'],
      ['rk_' + 'test_' + 'B'.repeat(24), 'Stripe test key'],
      ['whsec_' + 'C'.repeat(24), 'webhook secret'],
      ['ghp_' + 'D'.repeat(36), 'GitHub token'],
      ['github_pat_' + 'E'.repeat(40), 'GitHub token'],
      ['team_' + 'F1'.repeat(12), 'Vercel ID'],
      ['prj_' + 'G2'.repeat(14), 'Vercel ID'],
      ['dpl_' + 'H3'.repeat(14), 'Vercel ID'],
      ['ep-' + 'cool-darkness-a1b2c3d4', 'Neon endpoint ID'],
      ['postgres' + 'ql://user:pa55word@db.example.org/app', 'database URL with a password']
    ];
    for (const [value, kind] of cases) expect(scanText(`x ${value} y`), value.slice(0, 6)).toContain(kind);
  });

  it('rejects runtime-created RTC pass bearer values by shape, even when marked FAKE',()=>{
    const pass='rtc_pass_'+randomBytes(32).toString('base64url');
    expect(scanText(pass)).toContain('RTC pass');
    const synthetic='rtc_pass_'+'FAKE'+'A'.repeat(39);
    expect(scanText(synthetic)).toContain('RTC pass');
    const dir=tempDir(),path=join(dir,'pass.txt');
    writeFileSync(path,pass);
    const result=spawnSync(process.execPath,[SCRIPT,'--file',path],{encoding:'utf8'});
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('RTC pass');
    expect(result.stderr).not.toContain(pass);
  });
  it('never exempts live keys or GitHub tokens because they contain FAKE', () => {
    expect(scanText('sk_' + 'live_' + 'FAKE' + 'A'.repeat(24))).toEqual(['Stripe live key']);
    expect(scanText('ghp_' + 'FAKE' + 'A'.repeat(32))).toEqual(['GitHub token']);
  });
});
