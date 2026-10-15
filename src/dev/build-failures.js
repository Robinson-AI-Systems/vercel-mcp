// V-3: deterministic synthetic-tested build failure categories.
// Raw log messages are untrusted; only finite cause/fix text is public.
export const BUILD_RULES=Object.freeze([
  {id:'missing-env',re:/\b(?:environment variable|env var|process\.env)[\s\S]{0,100}\b(?:missing|undefined|not set|required)\b|\bmissing[\s\S]{0,60}\benvironment variable\b/i,
    cause:'A required preview environment variable was not available at build time',
    fix:'Inspect the preview-only variable names and branch scope; use vercel_dev_wire_preview_env on the owned test run, then request a separately approved preview build'},
  {id:'node-version',re:/unsupported (?:engine|node)|node(?:\.js)? version .*not supported|engines?\s+node.*incompatible/i,
    cause:'The selected Node.js runtime does not satisfy the project engine requirement',
    fix:'Compare package.json engines with the project Node version and choose a supported version in a guarded project configuration change'},
  {id:'lockfile',re:/frozen.lockfile|lockfile.*(?:out of date|missing|incompatible)|npm ci.*package-lock/i,
    cause:'The dependency lockfile and package manifest disagree or are unavailable',
    fix:'Regenerate and commit the matching lockfile locally; retry only with authorized source and build spending'},
  {id:'install',re:/npm err!|yarn (?:error|install)|pnpm (?:error|install)|install command failed|dependency resolution failed/i,
    cause:'Dependency installation failed before the application build could complete',
    fix:'Inspect the package manager and dependency versions; repair reproducible installation before requesting a new build'},
  {id:'typescript-lint',re:/typescript error|ts\d{4}:|eslint|linting failed|typecheck failed|type error/i,
    cause:'A TypeScript, lint or static analysis gate rejected source code',
    fix:'Run the repository’s exact typecheck/lint command, repair the reported file, and rerun local checks before rebuilding'},
  {id:'memory',re:/heap out of memory|allocation failed|javascript heap|out.of.memory|exceeded memory limit/i,
    cause:'The build exhausted its allowed memory',
    fix:'Inspect build dependency size and memory usage; resource upgrades require verified pricing and independent owner approval'},
  {id:'command-missing',re:/command not found|is not recognized as (?:a|an) (?:internal|external) command|enoent.*(?:node|npm|yarn|pnpm|next)/i,
    cause:'A configured build command or executable is not installed',
    fix:'Correct the package scripts and included build tools; verify the command in the repository first'},
  {id:'ignored-build',re:/ignored build step|skipping (?:this )?build|build was skipped|deployment canceled by ignore/i,
    cause:'An ignore-build configuration or policy skipped the deployment build',
    fix:'Review the project’s ignored-build step and intended branch filters before changing deployment policy'},
  {id:'framework',re:/framework.*(?:not detected|unknown|unsupported)|could not detect framework|missing next(?:\.config)?/i,
    cause:'The build system did not recognize the project framework',
    fix:'Check root directory, framework preset and required config files; avoid changing production configuration via a dev tool'},
  {id:'file-limit',re:/file (?:size|count) limit|payload too large|entity too large|maximum (?:file|upload) size/i,
    cause:'An uploaded build input exceeded a provider limit',
    fix:'Reduce generated artifacts and upload volume; respect the repository’s inline 2 MB file-source boundary'}
]);
export function diagnoseBuildText(value){
  if(typeof value!=='string'||value.length>8192)
    return {rule:'unknown',cause:'No classified build error',fix:'Inspect the redacted event in the owner-approved Vercel build view'};
  for(const item of BUILD_RULES){
    if(item.re.test(value))return {rule:item.id,cause:item.cause,fix:item.fix};
  }
  return {rule:'unknown',cause:'The first build failure does not match a known diagnosis rule',
    fix:'Inspect the first failed build event in Vercel and preserve the exact event reference for safe investigation'};
}
