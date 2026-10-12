import {describe,it,expect,vi,beforeEach} from 'vitest';
import {makeFakeVercel} from '../../test/helpers/fake-vercel.js';
import {registry} from '../../src/tools/index.js';
import {dispatchReadOnlyTool} from '../../src/core/mcp-server.js';
import {loadToken} from '../../src/vercel/tokens.js';
vi.mock('../../src/vercel/tokens.js',async old=>({...await old(),loadToken:vi.fn()}));
const connection={account:'acct_FAKE',mode:'preview',profile:'everyday',listing:'catalog'};
const token={token:'vcp_FAKE_project',account:{id:'acct_FAKE',team_id:'team_FAKE',scope:'team'}};
function fixture(){
  const fake=makeFakeVercel(),rows=new Map();
  const db={
    getAccountCredential:async()=>({}),listProtectedResources:async()=>[],
    recordChange:async()=>{},
    requestReplayStore:()=>({
      claim:async({key})=>{
        if(rows.has(key))return rows.get(key);
        rows.set(key,{state:'pending'});return {state:'claimed',claimId:'FAKE'};
      },
      complete:async({key,result})=>rows.set(key,{state:'completed',result})
    })
  };
  const call=(args,c=connection)=>dispatchReadOnlyTool({registry,
    name:'vercel_project_update_settings',args,db,connection:c,fetchImpl:fake.fetch});
  return {fake,call,rows};
}
const parse=r=>JSON.parse(r.content[0].text);
const before={id:'prj_FAKE_OLD',name:'old-site',framework:'nextjs',hasDeployments:false};
describe('D-1g guarded project settings',()=>{
  beforeEach(()=>loadToken.mockResolvedValue(token));
  it('renames a non-live project with exact PATCH and independent GET verification',async()=>{
    const f=fixture();
    f.fake.when('GET','/v9/projects/{idOrName}').resolves(before)
      .resolves({...before,name:'new-site'});
    f.fake.when('PATCH','/v9/projects/{idOrName}').resolves({...before,name:'new-site'});
    const r=parse(await f.call({project:'prj_FAKE_OLD',name:'new-site',confirm:true}));
    expect(r).toMatchObject({status:'applied',confirmed:true});
    expect(f.fake.calls.map(x=>x.method)).toEqual(['GET','PATCH','GET']);
    expect(f.fake.calls[1].body).toEqual({name:'new-site'});
    expect(f.fake.calls[1].query.teamId).toBe('team_FAKE');
    expect(f.rows.size).toBe(2);
    f.fake.verify();
  });
  it('groups command and directory changes in one guarded PATCH and independent read-back',async()=>{
    const f=fixture(),change={buildCommand:'npm run build:site',
      installCommand:'npm ci --ignore-scripts',devCommand:'npm run dev:site',
      commandForIgnoringBuildStep:'git diff --quiet HEAD~1',
      outputDirectory:'dist/site',rootDirectory:'apps/site'};
    f.fake.when('GET','/v9/projects/{idOrName}').resolves(before)
      .resolves({...before,...change});
    f.fake.when('PATCH','/v9/projects/{idOrName}').resolves({...before,...change});
    const result=parse(await f.call({project:before.id,...change,confirm:true}));
    expect(result).toMatchObject({status:'applied',confirmed:true});
    expect(f.fake.calls.map(x=>x.method)).toEqual(['GET','PATCH','GET']);
    expect(f.fake.calls[1].body).toEqual(change);
    expect(JSON.stringify(result)).not.toContain('npm run build:site');
    expect(f.rows.size).toBe(2);
    f.fake.verify();
  });
  it('keeps raw command values out of preview, audit and read-only discovery',async()=>{
    const f=fixture();
    f.fake.when('GET','/v9/projects/{idOrName}').resolves(before);
    const changed={project:before.id,buildCommand:'npm run build:private'};
    const preview=parse(await f.call({...changed,dryRun:true}));
    expect(preview.status).toBe('preview');
    expect(JSON.stringify(preview)).not.toContain(changed.buildCommand);
    expect(f.fake.calls.map(x=>x.method)).toEqual(['GET']);
    f.fake.verify();
  });
  it('rejects unsafe directories, control characters and all-unchanged command settings',async()=>{
    const f=fixture();
    for(const value of ['../outside','/etc','folder//sub','folder\\outside']){
      const response=await f.call({project:before.id,rootDirectory:value,confirm:true});
      expect(response.isError||parse(response).status==='refused_by_guard').toBe(true);
    }
    expect((await f.call({project:before.id,buildCommand:'build\nsecret'})).isError).toBe(true);
    expect(f.fake.calls).toHaveLength(0);
    f.fake.when('GET','/v9/projects/{idOrName}')
      .resolves({...before,buildCommand:'npm run build'});
    expect(parse(await f.call({project:before.id,buildCommand:'npm run build',confirm:true})).status)
      .toBe('refused_by_guard');
    f.fake.verify();
  });
  it('requires production mode for a project serving or possibly serving live traffic',async()=>{
    for(const live of [true,undefined]){
      const f=fixture();
      f.fake.when('GET','/v9/projects/{idOrName}')
        .resolves({...before,hasDeployments:live});
      const r=parse(await f.call({project:'prj_FAKE_OLD',framework:'vite',confirm:true}));
      expect(r.status).toBe('refused_by_guard');
      expect(f.fake.calls.map(x=>x.method)).toEqual(['GET']);
    }
  });
  it('accepts the full pinned framework vocabulary and permits explicit null clearing',async()=>{
    const f=fixture();
    f.fake.when('GET','/v9/projects/{idOrName}').resolves(before)
      .resolves({...before,framework:'remix'});
    f.fake.when('PATCH','/v9/projects/{idOrName}').resolves({...before,framework:'remix'});
    const result=parse(await f.call({project:'prj_FAKE_OLD',framework:'remix',confirm:true}));
    expect(result.status).toBe('applied');
    expect(f.fake.calls[1].body).toEqual({framework:'remix'});
  });
  it('refuses mutation for absent confirmation or dry-run and blocks protected rename',async()=>{
    const f=fixture();
    f.fake.when('GET','/v9/projects/{idOrName}').resolves(before);
    expect(parse(await f.call({project:'prj_FAKE_OLD',framework:'vite'})).status).toBe('needs_confirmation');
    expect(parse(await f.call({project:'prj_FAKE_OLD',framework:'vite',dryRun:true})).status).toBe('preview');
    expect(parse(await f.call({project:'prj_FAKE_OLD',name:'vercel-mcp',confirm:true})).status)
      .toBe('refused_by_guard');
    expect(f.fake.calls.every(x=>x.method==='GET')).toBe(true);
  });
  it('rejects scope override, unsafe identifiers, empty/no-op change before PATCH',async()=>{
    const f=fixture();
    for(const args of [{project:'../evil',name:'demo'}, {project:'prj_FAKE_OLD'},
      {project:'prj_FAKE_OLD',name:'demo',teamId:'other'}]){
      const r=await f.call(args);expect(r.isError||parse(r).status==='refused_by_guard').toBe(true);
    }
    loadToken.mockResolvedValue({...token,account:{...token.account,scope:'project',project_id:'prj_FAKE_ONLY'}});
    expect(parse(await f.call({project:'prj_FAKE_OLD',name:'new-site',confirm:true})).status)
      .toBe('refused_by_guard');
    expect(f.fake.calls).toHaveLength(0);
  });
  it('advertises null resets and a 256-character maximum for all six PATCH fields',()=>{
    const props=registry.tools.find(x=>x.name==='vercel_project_update_settings').inputSchema.properties;
    for(const key of ['buildCommand','installCommand','devCommand',
      'commandForIgnoringBuildStep','rootDirectory','outputDirectory']){
      expect(props[key].anyOf).toEqual([
        {type:'string',minLength:1,maxLength:256},{type:'null'}]);
    }
  });
  it('clears grouped command and directory overrides with explicit null and omitted read-back',async()=>{
    const f=fixture(),keys=['buildCommand','installCommand','devCommand',
      'commandForIgnoringBuildStep','rootDirectory','outputDirectory'];
    const old=Object.fromEntries(keys.map(key=>[key,key==='rootDirectory'?'apps/site':'custom']));
    const reset=Object.fromEntries(keys.map(key=>[key,null]));
    f.fake.when('GET','/v9/projects/{idOrName}')
      .resolves({...before,...old}).resolves(before);
    f.fake.when('PATCH','/v9/projects/{idOrName}')
      .resolves({...before,...reset});
    const result=parse(await f.call({project:before.id,...reset,confirm:true}));
    expect(result).toMatchObject({status:'applied',confirmed:true});
    expect(f.fake.calls.map(x=>x.method)).toEqual(['GET','PATCH','GET']);
    expect(f.fake.calls[1].body).toEqual(reset);
    expect(f.rows.size).toBe(2);
    f.fake.verify();
  });
  it('treats absent/null defaults as unchanged, rather than sending a reset PATCH',async()=>{
    const f=fixture();
    f.fake.when('GET','/v9/projects/{idOrName}').resolves(before);
    const response=parse(await f.call({project:before.id,buildCommand:null,confirm:true}));
    expect(response.status).toBe('refused_by_guard');
    expect(f.fake.calls.map(x=>x.method)).toEqual(['GET']);
    f.fake.verify();
  });
  it('accepts 256 characters and rejects 257 before any provider I/O for every config key',async()=>{
    for(const key of ['buildCommand','installCommand','devCommand',
      'commandForIgnoringBuildStep','rootDirectory','outputDirectory']){
      const over=fixture();
      const invalid=await over.call({project:before.id,[key]:'a'.repeat(257),confirm:true});
      expect(invalid.isError||parse(invalid).status==='refused_by_guard').toBe(true);
      expect(over.fake.calls).toHaveLength(0);
      const good=fixture(),value='a'.repeat(256);
      good.fake.when('GET','/v9/projects/{idOrName}')
        .resolves(before).resolves({...before,[key]:value});
      good.fake.when('PATCH','/v9/projects/{idOrName}')
        .resolves({...before,[key]:value});
      const result=parse(await good.call({project:before.id,[key]:value,confirm:true}));
      expect(result).toMatchObject({status:'applied',confirmed:true});
      expect(good.fake.calls[1].body).toEqual({[key]:value});
      good.fake.verify();
    }
  });

});
