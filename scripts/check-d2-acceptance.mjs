// D-2 read-only CODE acceptance: the inventory/CI evidence is NOT a live provider certification.
import {readFileSync,existsSync} from 'node:fs';
import {registry} from '../src/tools/index.js';

export const D2_EVIDENCE=Object.freeze([
  ['vercel_deploy_list','tests/unit/deployments.test.js'],
  ['vercel_deploy_get','tests/unit/deployments.test.js'],
  ['vercel_deploy_get_build_logs','tests/unit/deployment-diagnostics.test.js'],
  ['vercel_deploy_get_runtime_logs','tests/unit/runtime-logs.test.js'],
  ['vercel_deploy_list_files','tests/unit/deployment-diagnostics.test.js'],
  ['vercel_deploy_get_file','tests/unit/deployment-file-content.test.js'],
  ['vercel_deploy_wait','tests/unit/deploy-wait.test.js'],
  ['vercel_check_list_runs','tests/unit/checks-read.test.js'],
  ['vercel_check_get_run','tests/unit/checks-read.test.js'],
  ['vercel_check_list_project_checks','tests/unit/checks-read.test.js']
]);

export function d2CatalogNames(markdown){
  const start=markdown.indexOf('## Deployments: reads, logs and checks');
  const end=markdown.indexOf('## Deployments: changes',start+1);
  if(start<0||end<start)throw new TypeError('D-2 catalog section is missing');
  return [...markdown.slice(start,end).matchAll(/^\|\s*`(vercel_[a-z0-9_]+)`\s*\|/gm)]
    .map(m=>m[1]);
}

export function validateD2Code({tools,handlers},markdown,hasFile=existsSync){
  let catalog;
  try{catalog=d2CatalogNames(markdown);}
  catch{return ['D-2 catalog section is unavailable'];}
  const errors=[];
  if(catalog.length!==10||new Set(catalog).size!==10)
    errors.push('D-2 catalog must list exactly 10 unique read operations');
  const expected=new Set(D2_EVIDENCE.map(([name])=>name));
  for(const name of catalog)if(!expected.has(name))
    errors.push('Unexpected D-2 catalog operation: '+name);
  const byName=new Map(tools.map(tool=>[tool.name,tool]));
  for(const [name,testPath] of D2_EVIDENCE){
    if(!catalog.includes(name))errors.push(name+': missing from authoritative catalog');
    const tool=byName.get(name);
    if(!tool){errors.push(name+': registered read tool is missing');continue;}
    if(typeof handlers[name]!=='function')
      errors.push(name+': implementation handler is missing');
    if(tool.writes!==false||tool.guardedWrite===true||tool.writeContract||
      tool.annotations?.readOnlyHint!==true)
      errors.push(name+': cannot qualify as a strictly read-only tool');
    if(tool.area!=='deployments')
      errors.push(name+': wrong account-scoped diagnostic area');
    if(!hasFile(testPath))
      errors.push(name+': evidence test file missing: '+testPath);
  }
  return errors;
}
if(process.argv[1]?.endsWith('/check-d2-acceptance.mjs')){
  const errors=validateD2Code(registry,readFileSync('docs/TOOL-CATALOG.md','utf8'));
  if(errors.length){console.error(errors.join('\n'));process.exitCode=1;}
  else console.log('D-2 finite code registry and CI evidence gate passed (10 reads; connected acceptance pending)');
}
