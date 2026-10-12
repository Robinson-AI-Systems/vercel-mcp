// D-1 finite CODE acceptance: registry/test-contract gate, not a connected Vercel certification.
import {readFileSync,existsSync} from 'node:fs';
import {registry} from '../src/tools/index.js';

export const D1_EVIDENCE=Object.freeze([
  ['vercel_project_list',false,'tests/unit/projects.test.js'],
  ['vercel_project_get',false,'tests/unit/projects.test.js'],
  ['vercel_project_create',true,'tests/unit/project-create.test.js'],
  ['vercel_project_update_settings',true,'tests/unit/project-settings.test.js'],
  ['vercel_project_set_build_resources',true,'tests/unit/project-resources.test.js'],
  ['vercel_project_delete',true,'tests/unit/project-delete.test.js'],
  ['vercel_project_pause',true,'tests/unit/project-traffic.test.js'],
  ['vercel_project_unpause',true,'tests/unit/project-traffic.test.js'],
  ['vercel_project_transfer',true,'tests/unit/project-transfer.test.js'],
  ['vercel_project_list_members',false,'tests/unit/projects.test.js'],
  ['vercel_project_add_member',true,'tests/unit/project-members.test.js'],
  ['vercel_project_remove_member',true,'tests/unit/project-member-remove.test.js'],
  ['vercel_cron_list',false,'tests/unit/crons.test.js'],
  ['vercel_git_list_namespaces',false,'tests/unit/git.test.js'],
  ['vercel_git_search_repos',false,'tests/unit/git.test.js']
]);

export function d1CatalogNames(markdown) {
  const begin=markdown.indexOf('## Projects, crons and Git');
  const end=markdown.indexOf('## Deployments: reads',begin+1);
  if(begin<0||end<begin)throw new TypeError('D-1 catalog section is missing');
  const section=markdown.slice(begin,end);
  return [...section.matchAll(/^\|\s*\x60(vercel_[a-z0-9_]+)\x60\s*\|/gm)]
    .map(m=>m[1]);
}

export function validateD1Code({tools,handlers},markdown,hasFile=existsSync) {
  const errors=[];
  let catalog=[];
  try{catalog=d1CatalogNames(markdown);}
  catch{return ['D-1 catalog section is unavailable'];}
  if(catalog.length!==15||new Set(catalog).size!==15)
    errors.push('D-1 catalog must list exactly 15 unique approved operations');
  const expected=new Set(D1_EVIDENCE.map(([name])=>name));
  for(const name of catalog)if(!expected.has(name))
    errors.push('Unexpected D-1 catalog operation: '+name);
  const byName=new Map(tools.map(tool=>[tool.name,tool]));
  for(const [name,writes,testPath] of D1_EVIDENCE) {
    if(!catalog.includes(name))errors.push(name+': missing from authoritative catalog');
    const tool=byName.get(name);
    if(!tool){errors.push(name+': handler is not registered');continue;}
    if(typeof handlers[name]!=='function')
      errors.push(name+': implementation handler is missing');
    if(tool.writes!==writes)
      errors.push(name+': incorrect read/write classification');
    if(writes&&tool.guardedWrite!==true)
      errors.push(name+': write is not bound to the guarded-write origin');
    if(!hasFile(testPath))
      errors.push(name+': evidence test file missing: '+testPath);
  }
  return errors;
}

if(process.argv[1]?.endsWith('/check-d1-acceptance.mjs')) {
  const catalog=readFileSync('docs/TOOL-CATALOG.md','utf8');
  const errors=validateD1Code(registry,catalog);
  if(errors.length){console.error(errors.join('\n'));process.exitCode=1;}
  else console.log('D-1 finite code registry and CI evidence gate passed (15 operations; external acceptance not claimed)');
}
