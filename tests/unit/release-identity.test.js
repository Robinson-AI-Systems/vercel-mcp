// VER-1 release provenance: the server's version identity is derived from
// the build that produced it — package version from package.json plus the
// platform-stamped commit — never a literal typed into code. These tests
// pin that contract: with a stamp, identity names the stamp; without one,
// identity states unknown and never falls back to a fixed version string.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  deployedCommit, packageVersion, releaseVersion, serverRelease
} from '../../src/release.js';

const SHA = '0123456789abcdef0123456789abcdef01234567';
const env = { VERCEL_GIT_COMMIT_SHA: SHA };

describe('VER-1 checked release source', () => {
  it('composes <package>+<commit12> only from verified build metadata', () => {
    expect(packageVersion()).toMatch(/^[0-9]+\.[0-9]+\.[0-9]+/);
    expect(deployedCommit(env)).toBe(SHA);
    expect(releaseVersion(env)).toBe(packageVersion() + '+' + SHA.slice(0, 12));
    const release = serverRelease(env);
    expect(release.commit).toBe(SHA);
    expect(release.source).toBe(
      'https://github.com/Robinson-AI-Systems/vercel-mcp/commit/' + SHA);
    expect(release.what_changed).toContain('/commits/live');
  });

  it('states an unknown commit as unknown and never synthesises one', () => {
    for (const bad of [{}, { VERCEL_GIT_COMMIT_SHA: 'main' },
      { VERCEL_GIT_COMMIT_SHA: 'ABCDEF0123456789ABCDEF0123456789ABCDEF01' },
      { VERCEL_GIT_COMMIT_SHA: SHA + 'ff' }, { VERCEL_GIT_COMMIT_SHA: 42 }]) {
      expect(deployedCommit(bad)).toBeNull();
      expect(releaseVersion(bad)).toBe(packageVersion() + '+unknown');
      const release = serverRelease(bad);
      expect(release.commit).toBeNull();
      expect(release.source).toBeNull();
      expect(release.what_changed).toContain('unknown');
    }
  });

  it('keeps packageVersion read from package.json, not a code literal', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url)));
    expect(packageVersion()).toBe(pkg.version);
  });

  it('has no SERVICE_VERSION literal left in the identity module', () => {
    const identity = readFileSync(new URL('../../src/service-identity.js', import.meta.url), 'utf8');
    expect(identity).not.toMatch(/SERVICE_VERSION/);
    expect(identity).not.toMatch(/'0\.1\.0'|"0\.1\.0"/);
  });
});
