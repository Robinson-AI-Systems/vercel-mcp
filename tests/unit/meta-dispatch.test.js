import {describe,it,expect,vi} from 'vitest';
import {mergeNamespaces} from '../../src/core/registry.js';
import {dispatchReadOnlyTool,listMcpTools} from '../../src/core/mcp-server.js';
import {metaTools} from '../../src/tools/meta.js';
import {registry as productionRegistry} from '../../src/tools/index.js';
const conn={account:'team_ALPHA',profile:'read_only',mode:'preview',listing:'compact'};
const parse=r=>JSON.parse(r.content[0].text);
function fixture(){
  const read=vi.fn(async args=>({content:[{type:'text',text:JSON.stringify({label:args.label||'ok'})}]}));
  const write=vi.fn(async()=>({content:[{type:'text',text:'should not run'}]}));
  const custom={tools:[
    {name:'vercel_fixture_read',writes:false,profiles:['read_only','everyday','full'],
      description:'Fixture read',inputSchema:{type:'object',properties:{}}},
    // Deliberate non-provider owner fixture: unauthenticated arbitrary routine
    // handlers are now rejected by mergeNamespaces at construction time.
    {name:'vercel_fixture_write',writes:true,profiles:['full'],localAdmin:true,
      description:'Fixture blocked owner write',inputSchema:{type:'object',properties:{}}}
  ],handlers:{vercel_fixture_read:read,vercel_fixture_write:write}};
  const registry=mergeNamespaces([custom,metaTools]);
  const call=(name,args,connection=conn)=>dispatchReadOnlyTool({
    registry,name,args,connection,db:{}
  });
  return {read,write,registry,call};
}
describe('C-2b guarded meta invocation',()=>{
  it('uses the same wrapped authorization path for named read calls',async()=>{
    const f=fixture();
    const result=await f.call('vercel_call',{name:'vercel_fixture_read',args:{label:'safe'}});
    expect(parse(result)).toEqual({label:'safe'});
    expect(f.read).toHaveBeenCalledTimes(1);
    expect(listMcpTools(f.registry,conn).map(x=>x.name)).toContain('vercel_call');
  });
  it('denies hidden owner writes and recursive meta calls',async()=>{
    const f=fixture();
    for(const name of ['vercel_fixture_write','vercel_call','vercel_batch','vercel_missing']){
      const reply=await f.call('vercel_call',{name,args:{confirm:true}});
      expect(reply.isError).toBe(true);
    }
    expect(f.write).not.toHaveBeenCalled();
  });
  it('refuses an entire batch when any write/unknown or more than ten calls occurs',async()=>{
    const f=fixture();
    const x={name:'vercel_fixture_read',args:{label:'x'}};
    for(const calls of [[x,{name:'vercel_fixture_write'}],
      Array.from({length:11},()=>x),[x,{name:'vercel_missing'}]]){
      const reply=await f.call('vercel_batch',{calls});
      expect(reply.isError).toBe(true);
    }
    expect(f.read).not.toHaveBeenCalled();
    expect(f.write).not.toHaveBeenCalled();
  });
  it('refuses a batch containing vercel_call even when it only wraps a read',async()=>{
    const f=fixture();
    const reply=await f.call('vercel_batch',{calls:[
      {name:'vercel_fixture_read',args:{label:'x'}},
      {name:'vercel_call',args:{name:'vercel_fixture_read',args:{label:'y'}}}
    ]});
    expect(reply.isError).toBe(true);
    expect(f.read).not.toHaveBeenCalled();
  });
  it('executes up to ten read-only items using the wrapped dispatch',async()=>{
    const f=fixture(),calls=Array.from({length:10},(_,i)=>({
      name:'vercel_fixture_read',args:{label:String(i)}
    }));
    const reply=parse(await f.call('vercel_batch',{calls}));
    expect(reply.count).toBe(10);
    expect(reply.results).toHaveLength(10);
    expect(f.read).toHaveBeenCalledTimes(10);
    expect(parse(reply.results[9].result).label).toBe('9');
  });
  it('still refuses owner mutation via meta from a preview/full connector',async()=>{
    const db={listVercelAccounts:vi.fn(async()=>[{id:'team_ALPHA'}]),
      listProtectedResources:vi.fn(async()=>[]),
      requestReplayStore:()=>({claim:vi.fn(),complete:vi.fn()}),
      recordChange:vi.fn()};
    const result=await dispatchReadOnlyTool({
      registry:productionRegistry,name:'vercel_call',
      args:{name:'vercel_set_spend_limit',args:{limitCents:1125,confirm:true}},
      connection:{...conn,profile:'full'},db,env:{VERCEL_ENV:'production'}
    });
    expect(parse(result).status).toBe('refused_by_guard');
    expect(db.recordChange).not.toHaveBeenCalled();
  });
});
