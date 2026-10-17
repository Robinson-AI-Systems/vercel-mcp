import {describe,it,expect} from 'vitest';
import {registry} from '../../src/tools/index.js';
import {dispatchReadOnlyTool,listMcpTools} from '../../src/core/mcp-server.js';
const names=['vercel_dev_sandbox_create','vercel_dev_sandbox_run',
  'vercel_dev_sandbox_write_files','vercel_dev_sandbox_read_file',
  'vercel_dev_sandbox_stop','vercel_dev_send_test_webhook'];
function fetchOnly(){throw new Error('No provider transport should be attempted');}
const parse=result=>{try{return JSON.parse(result.content?.[0]?.text??'{}');}catch{return {};}}
function call(name,args,profile,mode='production'){
  return dispatchReadOnlyTool({registry,name,args,
    connection:{account:'acct_Fixture',profile,mode,listing:'catalog'},
    db:{},fetchImpl:fetchOnly,env:{}});
}
describe('V-4/V-5 real registry, direct and broker authorization doors',()=>{
  it('advertises all six tools for builders but never write tools to read-only users',()=>{
    const builder=listMcpTools(registry,{profile:'everyday',listing:'catalog'});
    expect(names.every(name=>builder.some(tool=>tool.name===name))).toBe(true);
    const reader=listMcpTools(registry,{profile:'read_only',listing:'catalog'});
    expect(reader.some(t=>t.name==='vercel_dev_sandbox_read_file')).toBe(true);
    for(const name of names.filter(x=>x!=='vercel_dev_sandbox_read_file'))
      expect(reader.some(tool=>tool.name===name)).toBe(false);
  });
  it('denies direct and broker writes from read-only before any provider access',async()=>{
    for(const name of names.filter(x=>x!=='vercel_dev_sandbox_read_file')){
      const direct=await call(name,{},'read_only');
      const broker=await call('vercel_call',{name,args:{}},'read_only');
      expect(direct.isError).toBe(true);
      expect(broker.isError).toBe(true);
    }
  });
  it('refuses production mode before provider access for every new write family',async()=>{
    const args={runId:'run_20261016_abcd1234',project:'prj_test123',
      session:'sbx_test123',deployment:'dpl_test123',
      minutes:10,requestKey:'fixed_mock_key123',
      action:'send',event:'deployment.succeeded',
      url:'https://test.vercel.app/api/webhook',command:'node',
      files:[{path:'a.txt',content:'safe'}]};
    for(const name of names.filter(x=>x!=='vercel_dev_sandbox_read_file')){
      const exact=Object.fromEntries(Object.keys(registry.tools.find(t=>t.name===name).inputSchema.properties)
        .filter(k=>Object.hasOwn(args,k)).map(k=>[k,args[k]]));
      // Production refusal must be reached with a valid per-tool schema.
      // The run tool supports start/inspect, not the webhook send action.
      if(name==='vercel_dev_sandbox_run')exact.action='start';
      const direct=await call(name,exact,'full');
      const delegated=await call('vercel_call',{name,args:exact},'full');
      expect(parse(direct).status).toBe('refused_by_guard');
      expect(parse(delegated).status).toBe('refused_by_guard');
    }
  });
});
