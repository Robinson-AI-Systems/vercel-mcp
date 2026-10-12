import {describe,it,expect,vi,beforeEach} from 'vitest';
import {makeFakeVercel} from '../../test/helpers/fake-vercel.js';
import {deploymentReadTools} from '../../src/tools/deployments.js';
import {dispatchReadOnlyTool} from '../../src/core/mcp-server.js';
import {mergeNamespaces} from '../../src/core/registry.js';
import {loadToken} from '../../src/vercel/tokens.js';
import {readBoundedJson} from '../../src/vercel/bounded-json.js';

vi.mock('../../src/vercel/tokens.js',async m=>({...await m(),loadToken:vi.fn()}));
const registry=mergeNamespaces([deploymentReadTools]);
const connection={account:'acct_1',profile:'read_only',mode:'preview',listing:'catalog'};
const db={getAccountCredential:async()=>({})};
const deployment='dpl_ABC123',project='prj_ONE',fileId='a'.repeat(40);
const invoke=(args,fetchImpl)=>dispatchReadOnlyTool({registry,name:'vercel_deploy_get_file',
  args,connection,db,fetchImpl});
const read=r=>JSON.parse(r.content[0].text);
const encode=text=>Buffer.from(text).toString('base64');

function provider({projectId=project,path='README.md',file=fileId,response}={}){
  const f=makeFakeVercel();
  f.when('GET','/v13/deployments/{idOrUrl}').resolves({uid:deployment,projectId});
  f.when('GET','/v6/deployments/{id}/files').resolves([{name:path,type:'file',uid:file}]);
  f.when('GET','/v8/deployments/{id}/files/{fileId}').resolves(response??{
    content:encode('Plain public documentation.'),encoding:'base64',
    deploymentId:deployment,fileId:file,path
  });
  return f;
}

describe('D-2 bounded project-verified file reads',()=>{
  beforeEach(()=>{vi.clearAllMocks();loadToken.mockResolvedValue({
    token:'vcp_FAKE',account:{id:'acct_1',team_id:'team_1',
      scope:'project',project_id:project}
  });});
  it('returns a small verified text file through exactly three pinned read-only GETs',async()=>{
    const f=provider();
    const value=read(await invoke({deployment,fileId},f.fetch));
    expect(value).toMatchObject({project,deployment,fileId,path:'README.md',
      content:'Plain public documentation.',bytes:27});
    expect(f.calls.map(c=>c.method)).toEqual(['GET','GET','GET']);
    expect(f.calls[2].query).toMatchObject({teamId:'team_1',path:'README.md'});
    f.verify();
  });
  it('rejects cross-project deployment identity before listing or fetching contents',async()=>{
    const f=provider({projectId:'prj_OTHER'});
    expect((await invoke({deployment,fileId},f.fetch)).isError).toBe(true);
    expect(f.calls).toHaveLength(1);
  });
  it('requires the exact file ID to be independently present in the source tree',async()=>{
    const f=provider({file:'b'.repeat(40)});
    expect((await invoke({deployment,fileId},f.fetch)).isError).toBe(true);
    expect(f.calls).toHaveLength(2);
  });
  it('rejects sensitive file paths before requesting content',async()=>{
    const f=provider({path:'.env'});
    expect((await invoke({deployment,fileId},f.fetch)).isError).toBe(true);
    expect(f.calls).toHaveLength(2);
  });
  it('does not reveal credential-shaped or password-bearing text',async()=>{
    for(const content of ['token=vcp_FAKE_secret','password=super-secret']){
      const f=provider({response:{content:encode(content),encoding:'base64'}});
      expect((await invoke({deployment,fileId},f.fetch)).isError).toBe(true);
      f.verify();
    }
  });
  it('fails closed for undocumented fields, wrong file identity, malformed base64 and binary',async()=>{
    for(const response of [
      {data:encode('not documented')},
      {content:encode('safe'),fileId:'b'.repeat(40)},
      {content:'**not-base64**'},
      {content:Buffer.from([0xff,0xfe,0x00]).toString('base64')}
    ]){
      const f=provider({response});
      expect((await invoke({deployment,fileId},f.fetch)).isError).toBe(true);
      f.verify();
    }
  });
  it('refuses valid UTF-8 containing binary control bytes, even for verified files',async()=>{
    for(const content of ['public\u0000tail','first\u0001second','line\u007fbreak']){
      const f=provider({response:{content:encode(content),encoding:'base64'}});
      expect((await invoke({deployment,fileId},f.fetch)).isError).toBe(true);
      f.verify();
    }
  });
  it('rejects oversized declared HTTP JSON length and conceals invalid upstream JSON',async()=>{
    const signal=AbortSignal.timeout(1000);
    const response=(body,headers={})=>new Response(body,{
      headers:{'content-type':'application/json',...headers}});
    await expect(readBoundedJson(response('{}',{'content-length':'9000'}),signal))
      .rejects.toThrow('unsafe byte length');
    await expect(readBoundedJson(response('{"content":"vcp_FAKE_SAMPLE"'),signal))
      .rejects.toThrow('Invalid provider file JSON');
    try{await readBoundedJson(response('{"content":"vcp_FAKE_SAMPLE"'),signal);}
    catch(error){expect(error.message).not.toContain('vcp_FAKE_SAMPLE');}
  });
  it('caps the original HTTP JSON response and decoded file bytes without silent truncation',async()=>{
    for(const response of [
      {content:'A'.repeat(10000)},
      {content:encode('a'.repeat(2500))}
    ]){
      const f=provider({response});
      expect((await invoke({deployment,fileId},f.fetch)).isError).toBe(true);
    }
  });
  it('rejects malformed file IDs and caller team overrides before provider traffic',async()=>{
    const f=makeFakeVercel();
    for(const args of [
      {deployment,fileId:'../secret'},
      {deployment,fileId,project:'prj_OTHER'},
      {deployment,fileId,teamId:'team_OTHER'},
      {deployment}
    ])expect((await invoke(args,f.fetch)).isError).toBe(true);
    expect(f.calls).toHaveLength(0);
  });
});
