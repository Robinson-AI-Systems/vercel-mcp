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
    expect(checkTargets([{kind:'project',id:'prj_THIS_SERVER'}],[],ctx).blocked).toBe(false);
    expect(block([{kind:'token',id:'tok_THIS_SERVER'}]).blocked).toBe(true);
    expect(block([{kind:'token',id:'new_token',isServerToken:true}]).blocked).toBe(true);
    expect(block([{kind:'project',id:'prj_X',name:'robinsons-toolkit-hub'}]).blocked).toBe(false);
  });
  it('allows every MCP project name without an owner exclusion, without unlocking the server token',()=>{
    for(const name of ['vercel-mcp','stripe-mcp','neon-mcp','github-mcp','robinsons-toolkit-hub']){
      expect(checkTargets([{kind:'project',id:'prj_FAKE',name}],[],ctx).blocked).toBe(false);
    }
    expect(checkTargets([{kind:'token',id:'tok_THIS_SERVER'}],[],ctx).blocked).toBe(true);
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
  it('allows known unprotected projects; the profile hook fails closed without data (P-1)',async()=>{
    expect(block([{kind:'project',id:'prj_ALLOWED'}])).toEqual({blocked:false});
    // B-3's stub allowed because no profiles could exist. Since P-1 the
    // hook enforces real profiles, so — like checkProtected — it refuses
    // when profile data is unavailable rather than silently allowing.
    expect((await checkApp([{kind:'project',id:'prj_ALLOWED'}],{})).blocked).toBe(true);
    const noProfiles={db:{listKnownApps:async()=>[]},connection:{account:'team_FAKE'}};
    expect((await checkApp([{kind:'project',id:'prj_ALLOWED'}],noProfiles)).blocked).toBe(false);
  });
  it('exposes the protected list as read-only, excluding internal secrets',async()=>{
    const db={listProtectedResources:async()=>rules.map(r=>({...r,source:'default',token_enc:'must_not_leak'}))};
    const conn={account:'team_FAKE',profile:'read_only'};
    const r=await dispatchReadOnlyTool({registry,name:'vercel_list_protected_resources',connection:conn,db});
    expect(JSON.parse(r.content[0].text).resources).toHaveLength(2);
    expect(r.content[0].text).not.toContain('must_not_leak');
  });
});
