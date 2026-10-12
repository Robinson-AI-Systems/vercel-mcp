import {describe,it,expect} from 'vitest';
import {registry} from '../../src/tools/index.js';
import {rtcManifest,rtcCatalog,rtcMetadata} from '../../src/core/rtc-contract.js';
import contract from '../../api/contract.js';
import openapi from '../../api/rtc-openapi.js';
function response(){
  return {statusCode:0,headers:{},setHeader(k,v){this.headers[k]=v;return this;},
    status(n){this.statusCode=n;return this;},send(v){this.body=JSON.parse(v);return this;}};
}
describe('RTC 1 public manifest and scoped catalog',()=>{
  it('advertises independently countable tools and narrow metadata',()=>{
    const m=rtcManifest(registry),full=rtcCatalog(registry,{profile:'full',listing:'catalog'});
    expect(m).toMatchObject({rtc:1,prefix:'vercel',devTools:false,
      counts:{tools:full.length}});
    expect(m.counts.writes).toBe(full.filter(x=>x.writes).length);
    for(const tool of full){
      expect(tool.name).toMatch(/^vercel_/);
      expect(tool.description.length).toBeLessThanOrEqual(160);
      expect(tool.annotations.readOnlyHint).toBe(!tool.writes);
      expect(tool.annotations.destructiveHint).toBe(tool.destructive);
      expect(tool.profiles.length).toBeGreaterThan(0);
    }
  });
  it('marks delegated call as write-capable; no pass can mistake it for a read',()=>{
    const full=rtcCatalog(registry,{profile:'full',listing:'catalog'});
    expect(full.find(x=>x.name==='vercel_call')).toMatchObject({
      writes:true,annotations:{readOnlyHint:false}});
    expect(full.find(x=>x.name==='vercel_project_set_build_resources')).toMatchObject({
      writes:true,money:true});
    expect(()=>rtcMetadata({name:'unauthorized_name'},{})).toThrow();
    const tool={name:'vercel_future_capability',description:'Unknown future operation',
      inputSchema:{type:'object',properties:{}}};
    for(const missing of [undefined,{}, {writes:false},
      {writes:false,area:'../wrong'},
      {writes:false,area:'server',annotations:{readOnlyHint:false}},
      {writes:true,area:'server'}]){
      const metadata=rtcMetadata(tool,missing);
      expect(metadata.writes).toBe(true);
      expect(metadata.annotations.readOnlyHint).toBe(false);
    }
    expect(rtcMetadata(tool,{writes:false,area:'server'})).toMatchObject({
      writes:false,area:'server',annotations:{readOnlyHint:true}});
    expect(rtcMetadata({...tool,annotations:{readOnlyHint:false}},
      {writes:false,area:'server'}).writes).toBe(true);
  });
  it('public endpoints expose only manifest/openapi and do not need database or credentials',()=>{
    const res=response();contract({method:'GET'},res);
    expect(res.statusCode).toBe(200);expect(res.body.rtc).toBe(1);
    expect(JSON.stringify(res.body)).not.toContain('secret');
    const schema=response();openapi({method:'GET'},schema);
    expect(schema.statusCode).toBe(200);
    expect(schema.body.openapi).toMatch(/^3/);
    expect(Object.values(schema.body.paths)
      .flatMap(x=>Object.keys(x).filter(k=>['get','post'].includes(k))).length)
      .toBeLessThanOrEqual(30);
    const denied=response();contract({method:'POST'},denied);expect(denied.statusCode).toBe(405);
  });
});
