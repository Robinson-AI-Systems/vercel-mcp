import {describe,it,expect} from 'vitest';
import {gunzipSync} from 'node:zlib';
import {sandboxTar,safeSandboxPath,parseSandboxCommandLogs} from '../../src/vercel/sandbox-binary.js';
import {dayDenver,boundedSandboxMinutes,sandboxShape,sandboxCreateBody,
  sandboxSizeText,sandboxNetworkText} from '../../src/tools/dev-sandbox.js';
import {registry} from '../../src/tools/index.js';
import {operation} from '../../src/vercel/operations.js';
import {validateRequest} from '../../src/vercel/openapi-validation.js';

describe('V-4 isolated Sandbox primitives',()=>{
  it('recognizes five separately exposed Sandbox operations and exact profiles',()=>{
    for(const name of ['vercel_dev_sandbox_create','vercel_dev_sandbox_run',
      'vercel_dev_sandbox_write_files','vercel_dev_sandbox_stop']){
      const tool=registry.tools.find(x=>x.name===name);
      expect(tool).toMatchObject({area:'developer',writes:true,guardedWrite:true,
        profiles:['everyday','full'],writeContract:{production:true,targets:true}});
    }
    expect(registry.tools.find(x=>x.name==='vercel_dev_sandbox_create')
      .writeContract.spend).toBe(true);
    expect(registry.tools.find(x=>x.name==='vercel_dev_sandbox_read_file'))
      .toMatchObject({area:'developer',writes:false,profiles:['read_only','everyday','full']});
  });
  it('never accepts traversal or hidden, empty, absolute, unicode or control paths',()=>{
    for(const path of ['..','../x','./a','a/../b','a//b','/tmp/demo','.env/../x',
      'a\\b','abc\nxyz','a/ ','','a'.repeat(129)]){
      expect(safeSandboxPath(path)).toBe(false);
    }
    for(const path of ['index.js','src/app/page.tsx','README.md','a/.env'])
      expect(safeSandboxPath(path)).toBe(true);
  });
  it('writes a bounded USTAR archive with exact unmodified bytes',()=>{
    const files=[{path:'src/test.js',content:'console.log("sandbox test");\n'},
      {path:'README.md',content:'# Preview\n'}];
    const archive=sandboxTar(files);
    const tar=gunzipSync(archive);
    expect(tar.subarray(0,100).toString().replaceAll('\0','')).toBe('src/test.js');
    expect(tar.subarray(257,263).toString()).toBe('ustar\0');
    expect(tar.includes(Buffer.from(files[0].content))).toBe(true);
    expect(tar.includes(Buffer.from(files[1].content))).toBe(true);
    expect(tar.length%512).toBe(0);
    for(const bad of [[{path:'../escape',content:'bad'}],
      [{path:'a',content:'x'.repeat(4097)}],
      [{path:'a',content:'one'},{path:'a',content:'two'}],[]]){
      expect(()=>sandboxTar(bad)).toThrow();
    }
  });
  it('selects the America/Denver quota day at a UTC date boundary',()=>{
    expect(dayDenver(Date.parse('2026-10-17T04:00:00Z'))).toBe('2026-10-16');
    expect(dayDenver(Date.parse('2026-10-17T07:00:00Z'))).toBe('2026-10-17');
  });
});

describe('V-4 pinned provider contract',()=>{
  it('supports the exact v4 creation and v2 session/command/stop request shapes',()=>{
    expect(operation('sandbox_create')).toMatchObject({method:'POST',path:'/v4/sandboxes'});
    expect(operation('sandbox_session_get')).toMatchObject({
      method:'GET',path:'/v2/sandboxes/sessions/{sessionId}'});
    expect(operation('sandbox_command_run')).toMatchObject({
      method:'POST',path:'/v2/sandboxes/sessions/{sessionId}/cmd'});
    expect(operation('sandbox_stop')).toMatchObject({
      method:'POST',path:'/v2/sandboxes/sessions/{sessionId}/stop'});
    expect(()=>validateRequest('sandbox_create',{
      body:{projectId:'prj_synthetic',name:'rtc-run-20261016-abcdef-synthetic',
        persistent:false,timeout:600000,
        resources:{vcpus:1,memory:2048},networkPolicy:{mode:'deny-all'},
        tags:{rtc_run:'run_20261016_abcdef'}}})).not.toThrow();
    expect(()=>validateRequest('sandbox_session_get',{
      path:{sessionId:'sbx_synthetic123'}})).not.toThrow();
    expect(()=>validateRequest('sandbox_command_run',{
      path:{sessionId:'sbx_synthetic123'},
      body:{command:'node',args:['-v'],timeout:45000,wait:false,logs:false}
    })).not.toThrow();
    expect(()=>validateRequest('sandbox_command_get',{
      path:{sessionId:'sbx_synthetic123',cmdId:'cmd_fake123'}})).not.toThrow();
    expect(()=>validateRequest('sandbox_stop',{
      path:{sessionId:'sbx_synthetic123'}})).not.toThrow();
  });
});

describe('V-4 authoritative response envelopes',()=>{
  it('keeps provider session and command identities nested, never inferred from top-level fields',()=>{
    // The frozen OpenAPI describes nested required fields, not top-level IDs.
    const session={session:{id:'sbx_fake123',projectId:'prj_fixture',
      sourceSandboxName:'rtc-run-20261016-abcdef-fixture',status:'running'},routes:[]};
    expect(session.session.id).toMatch(/^sbx_/);
    expect(session.id).toBeUndefined();
    const command={command:{id:'cmd_fake123',sessionId:'sbx_fake123',
      name:'node',args:['-v'],cwd:'/vercel/sandbox',startedAt:0,exitCode:null}};
    expect(command.command.sessionId).toBe(session.session.id);
    expect(command.id).toBeUndefined();
  });
});

describe('V-4 bounded native command logs',()=>{
  it('accepts only bounded stdout/stderr provider NDJSON entries',()=>{
    const valid=Buffer.from('{"stream":"stdout","data":"test"}\\n'.replace('\\n','\n'));
    expect(parseSandboxCommandLogs(valid)).toEqual([{stream:'stdout',data:'test'}]);
    expect(()=>parseSandboxCommandLogs(Buffer.from('bad\\n'))).toThrow();
    expect(()=>parseSandboxCommandLogs(Buffer.from('{"stream":"system","data":"test"}\\n'))).toThrow();
    expect(()=>parseSandboxCommandLogs(Buffer.alloc(12289))).toThrow();
  });
});

describe('V-4 approved Sandbox lifetime defaults',()=>{
  it('defaults to ten minutes and follows the documented provider session maximum',()=>{
    expect(boundedSandboxMinutes()).toBe(10);
    expect(boundedSandboxMinutes(undefined)).toBe(10);
    expect(boundedSandboxMinutes(60)).toBe(60);
    expect(boundedSandboxMinutes(1440)).toBe(1440);
    for(const bad of [0,-1,1441,0.5,'10',NaN,Infinity])
      expect(()=>boundedSandboxMinutes(bad)).toThrow();
  });
});

describe('V-6 configurable Sandbox shape (UA-08)',()=>{
  it('reproduces the historical V-4 shape when every new argument is omitted',()=>{
    expect(sandboxShape({})).toEqual({vcpus:1,memoryMb:2048,network:'deny-all',
      networkPolicy:{mode:'deny-all'}});
  });
  it('derives memory at 2 GB per vCPU for every supported size',()=>{
    for(const vcpus of [1,2,4,6,8]){
      const shape=sandboxShape({vcpus});
      expect(shape.memoryMb).toBe(vcpus*2048);
    }
    expect(sandboxSizeText(sandboxShape({}))).toBe('1 vCPU / 2 GB');
    expect(sandboxSizeText(sandboxShape({vcpus:8}))).toBe('8 vCPUs / 16 GB');
  });
  it('refuses odd, out-of-range and non-integer sizes',()=>{
    for(const bad of [0,3,5,7,9,10,-2,1.5,'4',NaN])
      expect(()=>sandboxShape({vcpus:bad})).toThrow(/1, 2, 4, 6 or 8 vCPUs/);
  });
  it('maps network choices to the exact provider networkPolicy',()=>{
    expect(sandboxShape({network:'allow-all'}).networkPolicy)
      .toEqual({mode:'allow-all'});
    expect(sandboxNetworkText(sandboxShape({network:'allow-all'})))
      .toBe('external network is fully allowed');
    expect(sandboxNetworkText(sandboxShape({})))
      .toBe('external network is denied');
    expect(()=>sandboxShape({network:'open'})).toThrow(/deny-all, allow-all or custom/);
  });
  it('requires domains exactly for a custom network and canonicalizes them',()=>{
    const shape=sandboxShape({network:'custom',
      allowedDomains:['*.npmjs.org','api.github.com','api.github.com']});
    expect(shape.networkPolicy).toEqual({mode:'custom',
      allowedDomains:['*.npmjs.org','api.github.com']});
    expect(sandboxNetworkText(shape))
      .toBe('external network is limited to 2 allowed domain pattern(s)');
    expect(()=>sandboxShape({network:'custom'})).toThrow(/1 to 20 allowed domain/);
    expect(()=>sandboxShape({network:'custom',allowedDomains:[]}))
      .toThrow(/1 to 20 allowed domain/);
    expect(()=>sandboxShape({allowedDomains:['api.github.com']}))
      .toThrow(/only when the Sandbox network is custom/);
    expect(()=>sandboxShape({network:'allow-all',allowedDomains:['x.io']}))
      .toThrow(/only when the Sandbox network is custom/);
    for(const bad of ['not a domain','https://x.io','*.','a'.repeat(254)+'.io',
      'foo_bar.io','-bad.io'])
      expect(()=>sandboxShape({network:'custom',allowedDomains:[bad]}))
        .toThrow(/allowed domain/);
  });
  it('builds the byte-identical default provider body and valid sized bodies',()=>{
    const base={project:'prj_synthetic',name:'rtc-run-x',runId:'run_20261030_abcdef',
      minutes:10};
    expect(sandboxCreateBody({...base,...sandboxShape({})})).toEqual({
      projectId:'prj_synthetic',name:'rtc-run-x',persistent:false,timeout:600000,
      resources:{vcpus:1,memory:2048},networkPolicy:{mode:'deny-all'},
      tags:{rtc_run:'run_20261030_abcdef'}});
    const sized=sandboxCreateBody({...base,...sandboxShape({vcpus:4})});
    expect(sized.resources).toEqual({vcpus:4,memory:8192});
    expect(()=>validateRequest('sandbox_create',{body:sized})).not.toThrow();
    const custom=sandboxCreateBody({...base,...sandboxShape({network:'custom',
      allowedDomains:['api.github.com','*.npmjs.org']})});
    expect(custom.networkPolicy).toEqual({mode:'custom',
      allowedDomains:['*.npmjs.org','api.github.com']});
    expect(()=>validateRequest('sandbox_create',{body:custom})).not.toThrow();
    const open=sandboxCreateBody({...base,...sandboxShape({network:'allow-all'})});
    expect(()=>validateRequest('sandbox_create',{body:open})).not.toThrow();
  });
  it('exposes the three optional arguments on the create tool schema',()=>{
    const tool=registry.tools.find(x=>x.name==='vercel_dev_sandbox_create');
    expect(tool.inputSchema.properties.vcpus).toMatchObject({type:'integer',
      minimum:1,maximum:8});
    expect(tool.inputSchema.properties.network.enum)
      .toEqual(['deny-all','allow-all','custom']);
    expect(tool.inputSchema.properties.allowedDomains.maxItems).toBe(20);
    expect(tool.inputSchema.required).not.toContain('vcpus');
    expect(tool.description).toContain('choice of vCPUs and network access');
    expect(tool.description.length).toBeLessThanOrEqual(160);
  });
});
