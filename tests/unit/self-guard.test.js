import { describe,it,expect } from 'vitest';
import { checkTargets,checkProtected } from '../../src/tools/self-guard.js';
import { checkApp } from '../../src/tools/app-guard.js';
import { registry } from '../../src/tools/index.js';
import { dispatchReadOnlyTool } from '../../src/core/mcp-server.js';
const rules=[{kind:'project',match:'stripe-mcp',note:'protected'},{kind:'project',match:'prj_PROTECTED',note:'Sensitive project'}];
const ctx={selfProjectId:'prj_THIS_SERVER',selfTokenId:'tok_THIS_SERVER'};
const block=(targets)=>checkTargets(targets,rules,ctx);
describe('B-3 protected-resource guard',()=>{
  it('denies protected project itself and descendant DNS, domain, env, store and alias',()=>{
    for(const target of [
      {kind:'project',id:'prj_PROTECTED',name:'stripe-mcp'},
      {kind:'domain',id:'dom_1',projectName:'stripe-mcp'},
      {kind:'dns_record',id:'record_1',projectId:'prj_PROTECTED'},
      {kind:'env',id:'env_1',parentProjectId:'prj_PROTECTED'},
      {kind:'store',id:'store_1',projectName:'stripe-mcp'},
      {kind:'alias',id:'alias_1',projectName:'stripe-mcp'}
    ])expect(block([target]).blocked).toBe(true);
  });
  it('protects this server and its token even if not listed in db',()=>{
    expect(block([{kind:'project',id:'prj_THIS_SERVER'}]).blocked).toBe(true);
    expect(block([{kind:'token',id:'tok_THIS_SERVER'}]).blocked).toBe(true);
    expect(block([{kind:'token',id:'new_token',isServerToken:true}]).blocked).toBe(true);
    expect(block([{kind:'project',id:'prj_X',name:'robinsons-toolkit-hub'}]).blocked).toBe(true);
  });
  it('fails closed when project ownership, target list or DB is unknown',async()=>{
    expect(block([{kind:'domain',id:'dom_unknown'}]).blocked).toBe(true);
    expect(block([]).blocked).toBe(true);
    expect(block([{kind:'unregistered',id:'1'}]).blocked).toBe(true);
    expect(checkTargets([{kind:'project',id:'prj_FAKE'}],null).blocked).toBe(true);
    const denied=await checkProtected([{kind:'project',id:'prj_FAKE'}],
      {db:{listProtectedResources:async()=>{throw Error('offline');}},connection:{account:'team_FAKE'}});
    expect(denied.blocked).toBe(true);
  });
  it('allows known unprotected projects and keeps pre-profile hook stable',async()=>{
    expect(block([{kind:'project',id:'prj_ALLOWED'}])).toEqual({blocked:false});
    expect((await checkApp([{kind:'project',id:'prj_ALLOWED'}],{})).blocked).toBe(false);
  });
  it('exposes the protected list as read-only, excluding internal secrets',async()=>{
    const db={listProtectedResources:async()=>rules.map(r=>({...r,source:'default',token_enc:'must_not_leak'}))};
    const conn={account:'team_FAKE',profile:'read_only'};
    const r=await dispatchReadOnlyTool({registry,name:'vercel_list_protected_resources',connection:conn,db});
    expect(JSON.parse(r.content[0].text).resources).toHaveLength(2);
    expect(r.content[0].text).not.toContain('must_not_leak');
  });
});
