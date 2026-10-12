import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {registry} from '../../src/tools/index.js';
import {D2_EVIDENCE,d2CatalogNames,validateD2Code} from '../../scripts/check-d2-acceptance.mjs';

const catalog=readFileSync('docs/TOOL-CATALOG.md','utf8');
describe('D-2 finite ten-read code inventory is not connected certification',()=>{
  it('requires the ten approved read handlers, metadata, catalog rows and automated test files',()=>{
    expect(D2_EVIDENCE).toHaveLength(10);
    expect(validateD2Code(registry,catalog)).toEqual([]);
    expect(new Set(d2CatalogNames(catalog))).toEqual(new Set(D2_EVIDENCE.map(([name])=>name)));
  });
  it('refuses a missing or write-enabled runtime handler',()=>{
    const handlers={...registry.handlers};
    delete handlers.vercel_deploy_get_file;
    expect(validateD2Code({...registry,handlers},catalog))
      .toContain('vercel_deploy_get_file: implementation handler is missing');
    const tools=registry.tools.map(t=>t.name==='vercel_deploy_get_file'?{...t,writes:true}:t);
    expect(validateD2Code({...registry,tools},catalog))
      .toContain('vercel_deploy_get_file: cannot qualify as a strictly read-only tool');
  });
  it('refuses contradictory profile/area declarations and missing scoped read metadata',()=>{
    const tools=registry.tools.map(t=>t.name==='vercel_deploy_wait'?
      {...t,area:'projects',annotations:{readOnlyHint:false}}:t);
    const errors=validateD2Code({...registry,tools},catalog);
    expect(errors).toContain('vercel_deploy_wait: wrong account-scoped diagnostic area');
    expect(errors).toContain('vercel_deploy_wait: cannot qualify as a strictly read-only tool');
  });
  it('refuses missing evidence paths',()=>{
    expect(validateD2Code(registry,catalog,p=>p!=='tests/unit/runtime-logs.test.js'))
      .toContain('vercel_deploy_get_runtime_logs: evidence test file missing: tests/unit/runtime-logs.test.js');
  });
  it('refuses a removed or unapproved catalog operation',()=>{
    const missing=catalog.replace(/^\| `vercel_deploy_get_file`.*\n/m,'');
    expect(validateD2Code(registry,missing).join(' ')).toContain('missing from authoritative catalog');
    const inserted=catalog.replace('## Deployments: changes',
      '| `vercel_unsafe_extra` | unauthorized | — | — | — | — | D-2 |\n\n## Deployments: changes');
    expect(validateD2Code(registry,inserted).join(' '))
      .toContain('Unexpected D-2 catalog operation');
  });
});
