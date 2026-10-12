import { describe, it, expect, vi } from 'vitest';
import { visibleToProfile, listProfileTools, profileToolCounts } from '../../src/core/profiles.js';
import { listMcpTools, profileToolCounts as runtimeCounts,
  dispatchReadOnlyTool } from '../../src/core/mcp-server.js';

const tools = [
  { name: 'vercel_read', writes: false, profiles: ['read_only','everyday','full'],
    description: 'Read safe resources', inputSchema: {} },
  { name: 'vercel_everyday_read', writes: false, profiles: ['everyday','full'],
    description: 'Read operator details', inputSchema: {} },
  { name: 'vercel_enable_production', writes: true, localAdmin: true, profiles: ['full'],
    writeContract: { production: true, targets: true }, inputSchema: {} },
  { name: 'vercel_unsafe_write', writes: true, profiles: ['read_only','everyday','full'],
    inputSchema: {} },
  { name: 'vercel_undeclared', profiles: ['read_only','everyday','full'],
    inputSchema: {} }
];
const registry = { tools, handlers: Object.fromEntries(tools.map(t =>
  [t.name, vi.fn(async () => ({ content: [{ type: 'text', text: 'ran' }] }))])) };

describe('B-6 strict profile filtering', () => {
  it('never exposes any write in read_only or allows a direct named invocation', async () => {
    const opts = { localOwnerTools: ['vercel_enable_production'] };
    expect(listProfileTools(registry, 'read_only', opts).map(t=>t.name)).toEqual(['vercel_read']);
    expect(visibleToProfile(tools[3], 'read_only', opts)).toBe(false);
    const connection = { account: 'team_fixture', mode: 'preview', profile: 'read_only' };
    for (const name of ['vercel_enable_production', 'vercel_unsafe_write','vercel_undeclared']) {
      expect((await dispatchReadOnlyTool({ registry, name, connection })).isError).toBe(true);
      expect(registry.handlers[name]).not.toHaveBeenCalled();
    }
  });
  it('restricts local owner operations to the full connection and a static allowlist', async () => {
    const read = listMcpTools(registry, { profile: 'read_only' }).map(t=>t.name);
    const everyday = listMcpTools(registry, { profile: 'everyday' }).map(t=>t.name);
    const full = listMcpTools(registry, { profile: 'full' }).map(t=>t.name);
    expect(read).toEqual(['vercel_read']);
    expect(everyday).toEqual(['vercel_read', 'vercel_everyday_read']);
    expect(full).toContain('vercel_enable_production');
    expect(full).not.toContain('vercel_unsafe_write');
    const r=await dispatchReadOnlyTool({registry,name:'vercel_enable_production',
      connection:{account:'fixture',mode:'preview',profile:'full'}});
    expect(r.content[0].text).toBe('ran');
  });
  it('preserves only the audited guarded vercel_call meta delegate exception',()=>{
    const delegate={name:'vercel_call',writes:false,
      profiles:['read_only','everyday','full'],
      annotations:{readOnlyHint:false}};
    expect(visibleToProfile(delegate,'read_only')).toBe(true);
    expect(visibleToProfile({...delegate,writeContract:{spend:true}},'full')).toBe(false);
    expect(visibleToProfile({...delegate,annotations:{
      readOnlyHint:false,destructiveHint:true}},'full')).toBe(false);
    expect(visibleToProfile({...delegate,name:'vercel_arbitrary_call'},'read_only')).toBe(false);
  });
  it('hides internal tool safety metadata in lists', () => {
    const listed=listMcpTools(registry,{profile:'full'}).find(t=>t.name==='vercel_enable_production');
    expect(listed).not.toHaveProperty('writes');
    expect(listed).not.toHaveProperty('profiles');
    expect(listed).not.toHaveProperty('localAdmin');
    expect(listed).not.toHaveProperty('writeContract');
  });
  it('denies contradictory read declarations through all profiles and named calls',async()=>{
    const variants=[
      {writeContract:{production:true,targets:true,spend:true}},
      {guardedWrite:true},{localAdmin:true},{secretIn:true},{secretOut:true},
      {annotations:{readOnlyHint:false}},{annotations:{destructiveHint:true}}
    ];
    for(let i=0;i<variants.length;i++){
      const name='vercel_conflicted_'+i;
      const handler=vi.fn(async()=>({content:[{type:'text',text:'unsafe'}]}));
      const fixture={tools:[{name,writes:false,profiles:['read_only','everyday','full'],
        area:'server',...variants[i]}],handlers:{[name]:handler}};
      for(const profile of ['read_only','everyday','full']){
        expect(listProfileTools(fixture,profile)).toHaveLength(0);
        expect(listMcpTools(fixture,{profile})).toHaveLength(0);
        expect((await dispatchReadOnlyTool({registry:fixture,name,
          connection:{account:'team_FAKE',mode:'preview',profile}})).isError).toBe(true);
      }
      expect(handler).not.toHaveBeenCalled();
    }
  });
  it('reports exactly the profile counts shown by the home page using runtime access rules', () => {
    expect(runtimeCounts(registry)).toEqual({ read_only: 1, everyday: 2, full: 3 });
    expect(profileToolCounts(registry, {localOwnerTools:['vercel_enable_production']}))
      .toEqual(runtimeCounts(registry));
    expect(listMcpTools(registry,{profile:'unknown'})).toEqual([]);
  });
});
