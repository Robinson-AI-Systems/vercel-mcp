import {describe,it,expect,vi} from 'vitest';
import {shapeStoredMcpResult} from '../../src/vercel/result-delivery.js';
import {dispatchReadOnlyTool,listMcpTools} from '../../src/core/mcp-server.js';
import {registry} from '../../src/tools/index.js';
const owner='resown_'+'a'.repeat(64),other='resown_'+'b'.repeat(64);
const conn={account:'team_ALPHA',clientId:'same-client',profile:'read_only',mode:'preview',
  listing:'catalog',resultOwner:owner};
const out=body=>({content:[{type:'text',text:JSON.stringify(body)}]});
const parse=r=>JSON.parse(r.content[0].text);
function fixture(){
  const map=new Map();
  const db={
    putResult:vi.fn(async ({account,owner,body,summary})=>{
      const handle='res_'+'a'.repeat(32);
      map.set(handle,{account,owner,body,summary});
      return {handle,expiresAt:'2026-10-12T00:00:00Z'};
    }),
    getResult:vi.fn(async ({account,owner,handle})=>{
      const row=map.get(handle);
      return row?.owner===owner && row.account===account?row:null;
    })
  };
  return {db,map};
}
describe('C-1c read handles and discovery metadata',()=>{
  it('stores oversized sanitized output then pages it only for the same bearer',async()=>{
    const {db}=fixture();
    const entries=Array.from({length:100},(_,i)=>({id:'id_'+i,name:'fixture'+i,
      token:'vcp_FAKE_secret',description:'x'.repeat(150)}));
    const shaped=await shapeStoredMcpResult(out(entries),{
      connection:conn,db,readOnly:true,tool:'vercel_projects_list'
    });
    const receipt=parse(shaped);
    expect(receipt.status).toBe('stored');
    expect(receipt.count).toBe(100);
    expect(db.putResult).toHaveBeenCalledTimes(1);
    const stored=db.putResult.mock.calls[0][0].body;
    expect(stored[0]).not.toHaveProperty('token');
    const first=await dispatchReadOnlyTool({registry,name:'vercel_get_result',
      args:{handle:receipt.handle,page:0,fields:'id,name'},connection:conn,db});
    expect(parse(first).records).toHaveLength(20);
    expect(parse(first).records[0]).toEqual({id:'id_0',name:'fixture0'});
    expect(parse(first).hasMore).toBe(true);
    const forbidden=await dispatchReadOnlyTool({registry,name:'vercel_get_result',
      args:{handle:receipt.handle},connection:{...conn,resultOwner:other},db});
    expect(forbidden.isError).toBe(true);
  });
  it('rejects caller supplied owner, forged handle and negative page',async()=>{
    const {db}=fixture();
    for(const args of [{handle:'res_'+'a'.repeat(32),owner:owner},
      {handle:'res_bad'},{handle:'res_'+'a'.repeat(32),page:-1}]){
      const result=await dispatchReadOnlyTool({registry,name:'vercel_get_result',
        args,connection:conn,db});
      expect(result.isError).toBe(true);
    }
    expect(db.getResult).not.toHaveBeenCalled();
  });
  it('adds centralized read view fields and annotations without widening write access',()=>{
    const reads=listMcpTools(registry,conn);
    const who=reads.find(x=>x.name==='vercel_whoami');
    expect(who.inputSchema.properties.detail.enum).toEqual(['summary','full']);
    expect(who.annotations).toMatchObject({readOnlyHint:true,idempotentHint:true});
    expect(reads.map(x=>x.name)).not.toContain('vercel_revoke_connection');
    expect(listMcpTools(registry,{...conn,profile:'full'}).find(x=>x.name==='vercel_revoke_connection')
      .annotations.readOnlyHint).toBe(false);
  });
  it('redacts credential-bearing plain text that is not valid JSON',async()=>{
    const {db}=fixture();
    for(const credential of ['vcp_FAKE_credential',
      '%2576cp_FAKE_credential','rtc_pass_FAKE_readonly'] ){
      const shaped=await shapeStoredMcpResult({
        content:[{type:'text',text:'unstructured '+credential+' data'}]},{
        connection:conn,db,readOnly:true,tool:'vercel_fixture_read'});
      expect(JSON.stringify(shaped)).not.toContain(credential);
      expect(shaped.content[0].text).toBe('[hidden]');
    }
    expect(db.putResult).not.toHaveBeenCalled();
  });
  it('fails closed for binary, image or malformed read parts on MCP and RTC-compatible dispatch',async()=>{
    const {db}=fixture();
    const invalid=[
      {type:'image',data:'vcp_FAKE_hidden_image',mimeType:'image/png'},
      {type:'resource',resource:{uri:'file:///vcp_FAKE_hidden'}},
      {type:'text',text:123},
      null
    ];
    for(const part of invalid){
      const handler=vi.fn(async()=>({content:[
        {type:'text',text:JSON.stringify({safe:true})},part]}));
      const r={tools:[{name:'vercel_broken_read',writes:false,profiles:['read_only'],
        inputSchema:{type:'object',properties:{}}}],
        handlers:{vercel_broken_read:handler}};
      const result=await dispatchReadOnlyTool({registry:r,name:'vercel_broken_read',
        args:{},connection:conn,db,shapeResult:shapeStoredMcpResult});
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result)).not.toContain('vcp_FAKE');
      expect(db.putResult).not.toHaveBeenCalled();
    }
  });
describe('AUD-D stored-result symmetry (VMCP-008/010/011)',()=>{
  const writeConn={...conn,profile:'everyday'};
  const bigWrite=()=>({status:'applied',confirmed:true,mode:'PREVIEW',
    requestKey:'rmcp_FAKE_write_key',preview:'Apply the fixture change',
    records:Array.from({length:300},(_,i)=>({id:'id_'+i,name:'fixture'+i,
      description:'x'.repeat(120)}))});
  it('stores an oversized write result and returns the verified receipt plus a handle',async()=>{
    const {db}=fixture();
    const payload=bigWrite();
    expect(Buffer.byteLength(JSON.stringify(payload))).toBeGreaterThan(8192);
    const shaped=await shapeStoredMcpResult(out(payload),{
      connection:writeConn,db,readOnly:false,tool:'vercel_fixture_write'
    });
    const receipt=parse(shaped);
    expect(receipt.status).toBe('applied');
    expect(receipt.confirmed).toBe(true);
    expect(receipt.requestKey).toBe('rmcp_FAKE_write_key');
    expect(receipt.resultHandle).toMatch(/^res_[a-f0-9]{32}$/);
    expect(receipt.count).toBe(1);
    expect(JSON.stringify(receipt)).not.toContain('x'.repeat(120));
    expect(db.putResult).toHaveBeenCalledTimes(1);
    expect(db.putResult.mock.calls[0][0].body).toEqual(payload);
  });
  it('stores the audit oversized-write probe payload (300 records) and pages it via vercel_get_result only for the same bearer',async()=>{
    const {db}=fixture();
    const entries=Array.from({length:300},(_,i)=>({id:'id_'+i,name:'fixture'+i,
      description:'x'.repeat(120)}));
    const shaped=await shapeStoredMcpResult(out(entries),{
      connection:writeConn,db,readOnly:false,tool:'vercel_fixture_write'
    });
    const receipt=parse(shaped);
    expect(receipt.resultHandle).toMatch(/^res_[a-f0-9]{32}$/);
    expect(receipt.count).toBe(300);
    const first=await dispatchReadOnlyTool({registry,name:'vercel_get_result',
      args:{handle:receipt.resultHandle,page:0,fields:'id,name'},connection:writeConn,db});
    expect(parse(first).records).toHaveLength(20);
    expect(parse(first).count).toBe(300);
    expect(parse(first).hasMore).toBe(true);
    const forbidden=await dispatchReadOnlyTool({registry,name:'vercel_get_result',
      args:{handle:receipt.resultHandle},connection:{...writeConn,resultOwner:other},db});
    expect(forbidden.isError).toBe(true);
  });
  it('answers outcome_unknown instead of throwing when an oversized write result cannot be stored',async()=>{
    const failing={putResult:vi.fn(async()=>{throw new Error('store down');})};
    const shaped=await shapeStoredMcpResult(out(bigWrite()),{
      connection:writeConn,db:failing,readOnly:false,tool:'vercel_fixture_write'
    });
    const receipt=parse(shaped);
    expect(receipt.status).toBe('outcome_unknown');
    expect(receipt.confirmed).toBe(null);
    const noStore=await shapeStoredMcpResult(out(bigWrite()),{
      connection:writeConn,db:{},readOnly:false,tool:'vercel_fixture_write'
    });
    expect(parse(noStore).status).toBe('outcome_unknown');
  });
  it('returns small write results inline, unchanged and unstored',async()=>{
    const {db}=fixture();
    const small={status:'applied',confirmed:true,mode:'PREVIEW',requestKey:'rmcp_FAKE_small'};
    const shaped=await shapeStoredMcpResult(out(small),{
      connection:writeConn,db,readOnly:false,tool:'vercel_fixture_write'
    });
    expect(parse(shaped)).toEqual(small);
    expect(db.putResult).not.toHaveBeenCalled();
  });
  it('carries the production banner on a stored write receipt',async()=>{
    const {db}=fixture();
    const shaped=await shapeStoredMcpResult(out(bigWrite()),{
      connection:{...writeConn,mode:'production'},db,readOnly:false,
      tool:'vercel_fixture_write'
    });
    const receipt=parse(shaped);
    expect(receipt.mode).toBe('PRODUCTION');
    expect(receipt.result.resultHandle).toMatch(/^res_[a-f0-9]{32}$/);
    expect(receipt.result.status).toBe('applied');
  });
});
  it('passes validated view settings only to presentation, not read handler',async()=>{
    const handler=vi.fn(async()=>out({nested:{value:'hidden',keep:'safe'},id:'item'}));
    const r={tools:[{name:'vercel_read',writes:false,profiles:['read_only'],
      inputSchema:{type:'object',properties:{},additionalProperties:false}}],
      handlers:{vercel_read:handler}};
    const res=await dispatchReadOnlyTool({registry:r,name:'vercel_read',
      args:{fields:'id',detail:'full'},connection:conn,db:{},
      shapeResult:shapeStoredMcpResult});
    expect(parse(res)).toEqual({id:'item'});
    expect(handler).toHaveBeenCalledWith({},expect.any(Object));
  });
});
