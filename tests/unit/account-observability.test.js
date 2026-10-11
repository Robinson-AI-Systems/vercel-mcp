import { describe, it, expect, vi } from 'vitest';
import { dispatchReadOnlyTool } from '../../src/core/mcp-server.js';
import { registry } from '../../src/tools/index.js';
import { findSettingGuide } from '../../src/data/dashboard-map.js';

const connection = { account: 'team_FAKE_a', mode:'preview', profile:'read_only', listing:'catalog' };
const db = {
  listAccountConnections:vi.fn(async () => [{
    id:'conn_fixture_1', client_id:'client_fixture', mode:'preview', profile:'read_only',
    listing:'catalog', kind:'connector',created_at:'2026-10-11T08:00:00.000Z',
    last_used_at:null,expires_at:'2026-10-12T08:00:00.000Z',revoked_at:null,
    token_hash:'DO_NOT_LEAK_TOKEN_HASH',refresh_hash:'DO_NOT_LEAK_REFRESH_HASH'
  }]),
  listRecentChanges:vi.fn(async () => [{
    id:42,at:'2026-10-11T07:00:00.000Z',tool:'vercel_project_get',mode:'preview',
    project_id:'prj_FAKE',summary:'Read metadata',dry_run:false,production:false,
    spend_cents:null,before:{token:'DO_NOT_LEAK'},after:{token:'DO_NOT_LEAK'}
  }])
};
const call=(name,args={},conn=connection) => dispatchReadOnlyTool({
  registry,name,args,connection:conn,db
});
const payload=async(name,args={})=>JSON.parse((await call(name,args)).content[0].text);

describe('B-8a account-safe reads and dashboard guidance',()=>{
  it('lists only public connection metadata and uses authenticated account',async()=>{
    const result=await payload('vercel_list_connections',{limit:5,includeRevoked:true});
    expect(result.count).toBe(1);
    expect(result.connections[0].id).toBe('conn_fixture_1');
    expect(db.listAccountConnections).toHaveBeenCalledWith({
      account:'team_FAKE_a',limit:5,includeRevoked:true
    });
    expect(JSON.stringify(result)).not.toContain('DO_NOT_LEAK');
    expect(JSON.stringify(result)).not.toContain('token_hash');
  });
  it('filters changes without exposing sensitive audit before/after data',async()=>{
    const result=await payload('vercel_recent_changes',{
      tool:'vercel_project_get', mode:'preview',since:'2026-10-01T00:00:00Z',
      includePreviews:true,limit:4
    });
    expect(result.count).toBe(1);
    expect(result.changes[0].summary).toBe('Read metadata');
    expect(db.listRecentChanges).toHaveBeenCalledWith({
      account:'team_FAKE_a',tool:'vercel_project_get',projectId:null,mode:'preview',
      since:'2026-10-01T00:00:00Z',includePreviews:true,limit:4
    });
    expect(JSON.stringify(result)).not.toContain('before');
    expect(JSON.stringify(result)).not.toContain('DO_NOT_LEAK');
  });
  it('returns dashboard directions and does not claim automatic verification where unavailable',async()=>{
    const production=await payload('vercel_where_is_setting',{setting:'production branch'});
    expect(production.found).toBe(true);
    expect(production.dashboardUrl).toBe('https://vercel.com/dashboard');
    expect(production.steps.length).toBeGreaterThan(2);
    expect(production.readBack).toContain('vercel_project_get');
    const spend=await payload('vercel_where_is_setting',{setting:'spend management'});
    expect(spend.readBack).toContain('Dashboard-only');
    const unknown=findSettingGuide('unrecognized new setting');
    expect(unknown.found).toBe(false);
    expect(unknown.readBack).toContain('no automated');
  });
  it('keeps every new tool within read-only profile and rejects unsafe inputs',async()=>{
    const names=registry.tools.filter(t=>[
      'vercel_list_connections','vercel_recent_changes','vercel_where_is_setting'
    ].includes(t.name));
    expect(names).toHaveLength(3);
    for(const t of names){
      expect(t.writes).toBe(false);
      expect(t.profiles).toContain('read_only');
    }
    expect(()=>findSettingGuide('x')).toThrow(/2/);
    expect(()=>findSettingGuide('x'.repeat(121))).toThrow(/120/);
  });
});
