import {describe,it,expect} from 'vitest';
import {gunzipSync} from 'node:zlib';
import {sandboxTar,safeSandboxPath} from '../../src/vercel/sandbox-binary.js';
import {dayDenver} from '../../src/tools/dev-sandbox.js';
import {registry} from '../../src/tools/index.js';

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
