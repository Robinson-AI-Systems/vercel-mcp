// VER-1 release provenance (RAS MCP Standard, Library D-001): one checked
// source for "which exact release is serving". The package version comes
// from the installed package.json. The deployed commit comes only from
// verified build-time deployment metadata (VERCEL_GIT_COMMIT_SHA, the
// value the platform — Vercel or the rack controller — stamps when this
// build was produced) — never from main HEAD, request data, a guessed tag
// or the last CI run. An unknown commit is stated as unknown; one is
// never synthesised, and no version literal lives in code.
import pkg from '../package.json' with { type: 'json' };

export const RELEASE_REPOSITORY_URL =
  'https://github.com/Robinson-AI-Systems/vercel-mcp';
// Production serves the `live` branch: checked main is promoted to it by
// the scheduled daily promotion, so the live branch history — not main —
// is where "what changed" is read.
export const RELEASE_NOTES_URL = RELEASE_REPOSITORY_URL + '/commits/live';

const SHA40 = /^[a-f0-9]{40}$/;
const SEMVER = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export function packageVersion() {
  const version = pkg?.version;
  return typeof version === 'string' && SEMVER.test(version) ? version : 'unknown';
}

export function deployedCommit(env = process.env) {
  const sha = env?.VERCEL_GIT_COMMIT_SHA;
  return typeof sha === 'string' && SHA40.test(sha) ? sha : null;
}

// The one version identity every surface reports:
// "<package-version>+<deployed-commit-12>", or "<package-version>+unknown"
// when the build carries no verified commit metadata.
export function releaseVersion(env = process.env) {
  const commit = deployedCommit(env);
  return packageVersion() + '+' + (commit ? commit.slice(0, 12) : 'unknown');
}

// The machine-readable server_release block (VER-1): identical values back
// initialize serverInfo.version, the manifest, /health and the front door.
export function serverRelease(env = process.env) {
  const commit = deployedCommit(env);
  return Object.freeze({
    version: releaseVersion(env),
    package_version: packageVersion(),
    commit,
    source: commit ? RELEASE_REPOSITORY_URL + '/commit/' + commit : null,
    release_channel: 'live',
    release_notes_url: RELEASE_NOTES_URL,
    what_changed:
      'Production serves the checked release on the live branch, promoted ' +
      'from main by the scheduled daily promotion; main is not necessarily ' +
      'what is serving. Read what changed in the live branch history at ' +
      RELEASE_NOTES_URL + (commit
        ? '; this exact build is ' + RELEASE_REPOSITORY_URL + '/commit/' + commit + '.'
        : '; this build carries no verified commit metadata, so its exact ' +
          'source revision is unknown.')
  });
}
