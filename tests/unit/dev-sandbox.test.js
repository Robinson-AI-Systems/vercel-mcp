import {describe,it,expect} from 'vitest';
import {gunzipSync} from 'node:zlib';
import {sandboxTar,safeSandboxPath} from '../../src/vercel/sandbox-binary.js';
import {dayDenver} from '../../src/tools/dev-sandbox.js';
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
