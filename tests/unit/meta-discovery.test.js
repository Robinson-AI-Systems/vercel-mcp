import {describe,it,expect} from 'vitest';
import {searchVisibleTools,describeVisibleTool} from '../../src/core/meta.js';
import {listMcpTools,dispatchReadOnlyTool} from '../../src/core/mcp-server.js';
import {registry} from '../../src/tools/index.js';
const conn={account:'team_ALPHA',mode:'preview',profile:'read_only',listing:'compact'};
const parse=r=>JSON.parse(r.content[0].text);
describe('C-2a safe compact tool discovery',()=>{
  it('shows a small set in compact and preserves authorized catalog discovery',()=>{
    const compact=listMcpTools(registry,conn).map(x=>x.name);
    expect(compact).toContain('vercel_search_tools');
    expect(compact).toContain('vercel_whoami');
    expect(compact).not.toContain('vercel_list_connections');
    expect(compact).not.toContain('vercel_revoke_connection');
    const full=listMcpTools(registry,{...conn,listing:'catalog'}).map(x=>x.name);
    expect(full).toContain('vercel_list_connections');
  });
  it('searches read-only catalog without revealing a hidden owner write',async()=>{
    const result=parse(await dispatchReadOnlyTool({registry,name:'vercel_search_tools',
      args:{query:'connections'},connection:conn,db:{}}));
    expect(result.tools.some(x=>x.name==='vercel_list_connections')).toBe(true);
    const hidden=parse(await dispatchReadOnlyTool({registry,name:'vercel_search_tools',
      args:{query:'revoke'},connection:conn,db:{}}));
    expect(hidden.tools.some(x=>x.name==='vercel_revoke_connection')).toBe(false);
    const owner=parse(await dispatchReadOnlyTool({registry,name:'vercel_search_tools',
      args:{query:'revoke'},connection:{...conn,profile:'full'},db:{}}));
    expect(owner.tools.some(x=>x.name==='vercel_revoke_connection')).toBe(true);
  });
  it('describes only exact eligible schemas and never leaks internal write metadata',async()=>{
    const ok=parse(await dispatchReadOnlyTool({registry,name:'vercel_describe_tool',
      args:{name:'vercel_list_connections'},connection:conn,db:{}}));
    expect(ok.name).toBe('vercel_list_connections');
    expect(ok).not.toHaveProperty('writeContract');
    expect((await dispatchReadOnlyTool({registry,name:'vercel_describe_tool',
      args:{name:'vercel_revoke_connection'},connection:conn,db:{}})).isError).toBe(true);
  });
  it('denies malformed search and query filters without executing handlers',async()=>{
    for(const args of [{query:' '},{query:'a',limit:100},{query:'hello',isOwner:true}]){
      expect((await dispatchReadOnlyTool({registry,name:'vercel_search_tools',
        args,connection:conn,db:{}})).isError).toBe(true);
    }
    expect(()=>searchVisibleTools([],{query:'x',limit:21})).toThrow();
    expect(()=>describeVisibleTool([],'unsafe')).toThrow();
  });
});
