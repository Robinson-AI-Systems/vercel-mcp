import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {registry} from '../../src/tools/index.js';
import {D1_EVIDENCE,d1CatalogNames,validateD1Code} from '../../scripts/check-d1-acceptance.mjs';

const catalog=readFileSync('docs/TOOL-CATALOG.md','utf8');
describe('D-1 finite code acceptance independently of owner-connected acceptance',()=>{
  it('covers every one of the 15 approved operations with a registered handler, safety metadata and test path',()=>{
    expect(D1_EVIDENCE).toHaveLength(15);
    expect(validateD1Code(registry,catalog)).toEqual([]);
    expect(new Set(d1CatalogNames(catalog))).toEqual(new Set(D1_EVIDENCE.map(([name])=>name)));
  });
  it('detects missing approved runtime handlers rather than claiming code completeness',()=>{
    const name='vercel_project_delete';
    const handlers={...registry.handlers};
    delete handlers[name];
    expect(validateD1Code({...registry,handlers},catalog))
      .toContain(name+': implementation handler is missing');
  });
  it('refuses an attempted classification change from guarded write to free read',()=>{
    const tools=registry.tools.map(x=>x.name==='vercel_project_transfer'?
      {...x,writes:false}:x);
    expect(validateD1Code({...registry,tools},catalog))
      .toContain('vercel_project_transfer: incorrect read/write classification');
  });
  it('refuses a write declaration no longer bound to the guarded write infrastructure',()=>{
    const tools=registry.tools.map(x=>x.name==='vercel_project_create'?
      {...x,guardedWrite:false}:x);
    expect(validateD1Code({...registry,tools},catalog))
      .toContain('vercel_project_create: write is not bound to the guarded-write origin');
  });
  it('refuses missing verification files as a code acceptance evidence gap',()=>{
    const errors=validateD1Code(registry,catalog,path=>path!=='tests/unit/git.test.js');
    expect(errors).toContain('vercel_git_search_repos: evidence test file missing: tests/unit/git.test.js');
  });
  it('refuses unauthorized additions or silent removal of an approved D-1 catalog row',()=>{
    const remove=catalog.replace(/^\| \x60vercel_git_search_repos\x60.*\n/m,'');
    expect(validateD1Code(registry,remove).join(' ')).toContain('missing from authoritative catalog');
    const extra=catalog.replace('## Deployments: reads','| '+
      String.fromCharCode(96)+'vercel_unsafe_new_operation'+String.fromCharCode(96)+
      ' | unauthorized | — | — | — | — | D-1 |\n\n## Deployments: reads');
    expect(validateD1Code(registry,extra).join(' ')).toContain('Unexpected D-1 catalog operation');
  });
});
