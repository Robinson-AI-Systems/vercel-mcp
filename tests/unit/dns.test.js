import {describe,it,expect,vi,beforeEach} from 'vitest';
import {registry} from '../../src/tools/index.js';
import {dispatchReadOnlyTool,listMcpTools} from '../../src/core/mcp-server.js';
import {makeFakeVercel} from '../../test/helpers/fake-vercel.js';
import {loadToken} from '../../src/vercel/tokens.js';
vi.mock('../../src/vercel/tokens.js',async old=>({...await old(),loadToken:vi.fn()}));

const domain='example.test';
const connection={account:'acct_FAKE',mode:'preview',profile:'full',listing:'catalog'};
const production={...connection,mode:'production'};
const everyday={...production,profile:'everyday'};
const saved={token:'vcp_FAKE_dns',account:{
  id:'acct_FAKE',team_id:'team_FAKE',scope:'team',project_id:null}};
// Contract-shaped record rows (pinned snapshot: full required field set).
const row=(over={})=>({id:'rec_FAKE_A',name:'www',type:'A',value:'192.0.2.10',
  slug:domain,creator:'user_FAKE',ttl:3600,created:1700000000000,
  updated:1700000000000,createdAt:1700000000000,updatedAt:1700000000000,...over});
const aRow=row();
const mxRow=row({id:'rec_FAKE_MX',name:'',type:'MX',value:'mail.example.net',
  mxPriority:10});
const spfRow=row({id:'rec_FAKE_TXT',name:'',type:'TXT',
  value:'v=spf1 include:_spf.example.net -all'});
const blogRow=row({id:'rec_FAKE_CN',name:'blog',type:'CNAME',
  value:'blog.example.net'});
const zoneReply=(records,over={})=>({records,
  pagination:{count:records.length,next:null,prev:null},...over});
const certRow={id:'cert_FAKE_ONE',cns:[domain,'www.'+domain],autoRenew:true,
  createdAt:1700000000000,expiresAt:1800000000000};
const certsReply=(certs=[certRow])=>({certs,
  pagination:{count:certs.length,next:null,prev:null}});
const value=result=>JSON.parse(result.content[0].text);
function fixture(){
  const fake=makeFakeVercel(),audits=[],claims=[],replay=new Map();
  const db={
    getAccountCredential:async()=>({}),listProtectedResources:async()=>[],
    recordChange:async item=>audits.push(item),
    requestReplayStore:()=>({
      claim:async claim=>{
        claims.push(claim);
        if(replay.has(claim.key))
          return {state:'completed',result:replay.get(claim.key)};
        return {state:'claimed',claimId:claim.key};
      },
      complete:async ({key,result})=>{replay.set(key,result);},
      release:async()=>true
    })
  };
  const call=(name,parameters,conn=connection)=>dispatchReadOnlyTool({
    registry,name,args:parameters,connection:conn,db,fetchImpl:fake.fetch
  });
  return {fake,db,call,audits,claims};
}
describe('N-2 DNS and certificates',()=>{
  beforeEach(()=>{vi.clearAllMocks();loadToken.mockResolvedValue(saved);});
  it('registers nine DNS/cert tools with catalog profiles and write contracts',()=>{
    const tools=registry.tools.filter(x=>x.name.startsWith('vercel_dns_')||
      x.name.startsWith('vercel_cert_'));
    expect(tools.map(x=>x.name)).toEqual(['vercel_dns_list','vercel_dns_get_record',
      'vercel_dns_create_record','vercel_dns_update_record','vercel_dns_delete_record',
      'vercel_dns_replace_zone','vercel_cert_list','vercel_cert_issue','vercel_cert_remove']);
    for(const tool of tools){
      expect(tool.description.length).toBeLessThanOrEqual(160);
      expect(tool.writeContract??{production:true,targets:true,spend:false,
        access:false,secretOut:false,secretIn:false})
        .toMatchObject({production:true,targets:true,spend:false,access:false});
    }
    expect(tools.filter(x=>x.writes).map(x=>x.name)).toEqual([
      'vercel_dns_create_record','vercel_dns_update_record','vercel_dns_delete_record',
      'vercel_dns_replace_zone','vercel_cert_issue','vercel_cert_remove']);
    expect(listMcpTools(registry,{...connection,profile:'read_only'})
      .map(x=>x.name).filter(x=>x.startsWith('vercel_dns_')||x.startsWith('vercel_cert_')))
      .toEqual(['vercel_dns_list','vercel_dns_get_record','vercel_cert_list']);
    expect(listMcpTools(registry,{...connection,profile:'everyday'})
      .map(x=>x.name).filter(x=>x.startsWith('vercel_dns_')||x.startsWith('vercel_cert_')))
      .toEqual(['vercel_dns_list','vercel_dns_get_record','vercel_dns_create_record',
        'vercel_dns_update_record','vercel_cert_list','vercel_cert_issue']);
  });
  it('lists a zone across documented timestamp pagination, proven complete',async()=>{
    const f=fixture();
    f.fake.when('GET','/v5/domains/{domain}/records')
      .resolves({records:[aRow],pagination:{count:2,next:1700000001000,prev:null}})
      .resolves(zoneReply([mxRow]));
    const result=value(await f.call('vercel_dns_list',{domain}));
    expect(result.complete).toBe(true);
    expect(result.records.map(r=>r.id)).toEqual(['rec_FAKE_A','rec_FAKE_MX']);
    expect(result.records[1]).toMatchObject({type:'MX',mxPriority:10});
    expect(f.fake.calls[1].query).toMatchObject({since:'1700000001000'});
    f.fake.verify();
  });
  it('gets one record and shapes the get-by-id type fields',async()=>{
    const f=fixture();
    f.fake.when('GET','/domains/records/{recordId}').resolves({
      id:'rec_FAKE_MX',name:'',recordType:'MX',type:'MX',
      value:'mail.example.net',creator:'user_FAKE',domain,mxPriority:10});
    const result=value(await f.call('vercel_dns_get_record',{recordId:'rec_FAKE_MX'}));
    expect(result.record).toMatchObject({type:'MX',value:'mail.example.net'});
    expect(result.domain).toBe(domain);
    f.fake.verify();
  });
  it('creates an A record with preview, byte-exact body and read-back',async()=>{
    const f=fixture();
    const created=row({id:'rec_FAKE_NEW',name:'api',value:'192.0.2.20'});
    f.fake.when('GET','/v5/domains/{domain}/records')
      .resolves(zoneReply([aRow,mxRow,spfRow]))
      .resolves(zoneReply([aRow,mxRow,spfRow]))
      .resolves(zoneReply([aRow,mxRow,spfRow]))
      .resolves(zoneReply([aRow,mxRow,spfRow,created]));
    f.fake.when('POST','/v2/domains/{domain}/records').resolves({uid:'rec_FAKE_NEW'});
    const args={domain,name:'api',type:'A',value:'192.0.2.20',outsideApp:true};
    const preview=value(await f.call('vercel_dns_create_record',
      {...args,dryRun:true},production));
    expect(preview).toMatchObject({status:'preview',mode:'PRODUCTION'});
    expect(preview.preview).toContain('api');
    expect(f.fake.calls.filter(x=>x.method==='POST')).toHaveLength(0);
    const applied=value(await f.call('vercel_dns_create_record',
      {...args,confirm:true},production));
    expect(applied).toMatchObject({status:'applied',confirmed:true});
    expect(f.fake.calls.find(x=>x.method==='POST').body)
      .toEqual({type:'A',name:'api',value:'192.0.2.20'});
    f.fake.verify();
  });
  it('creates SRV and MX records with their documented body shapes',async()=>{
    const f=fixture();
    const srvRow=row({id:'rec_FAKE_SRV',name:'_sip',type:'SRV',
      value:'10 60 5060 sip.example.net'});
    f.fake.when('GET','/v5/domains/{domain}/records')
      .resolves(zoneReply([aRow]))
      .resolves(zoneReply([aRow]))
      .resolves(zoneReply([aRow,srvRow]));
    f.fake.when('POST','/v2/domains/{domain}/records')
      .resolves({uid:'rec_FAKE_SRV'}).resolves({uid:'rec_FAKE_MX2'});
    const srv=value(await f.call('vercel_dns_create_record',
      {domain,name:'_sip',type:'SRV',
        srv:{target:'sip.example.net',weight:60,port:5060,priority:10},
        outsideApp:true,confirm:true},production));
    expect(srv).toMatchObject({status:'applied',confirmed:true});
    expect(f.fake.calls.find(x=>x.method==='POST').body).toEqual(
      {type:'SRV',name:'_sip',
        srv:{target:'sip.example.net',weight:60,port:5060,priority:10}});
    // The MX create joins the existing set: the preview names it first.
    const g=fixture();
    g.fake.when('GET','/v5/domains/{domain}/records')
      .resolves(zoneReply([mxRow]));
    const mxPreview=value(await g.call('vercel_dns_create_record',
      {domain,name:'',type:'MX',value:'mail2.example.net',mxPriority:20,
        outsideApp:true,dryRun:true},production));
    expect(mxPreview.preview).toContain('single MX set');
    f.fake.verify();g.fake.verify();
  });
  it('refuses a CNAME over other records and any record over a CNAME',async()=>{
    const f=fixture();
    f.fake.when('GET','/v5/domains/{domain}/records')
      .resolves(zoneReply([aRow,blogRow]));
    const over=value(await f.call('vercel_dns_create_record',
      {domain,name:'www',type:'CNAME',value:'other.example.net',
        outsideApp:true,confirm:true},production));
    expect(over.status).toBe('refused_by_guard');
    expect(over.reason).toMatch(/CNAME cannot share/);
    const under=value(await f.call('vercel_dns_create_record',
      {domain,name:'blog',type:'A',value:'192.0.2.30',
        outsideApp:true,confirm:true},production));
    expect(under.status).toBe('refused_by_guard');
    expect(under.reason).toMatch(/already holds a CNAME/);
    expect(f.fake.calls.filter(x=>x.method==='POST')).toHaveLength(0);
    f.fake.verify();
  });
  it('warns on a duplicate SPF in the preview and creates a named TXT record',async()=>{
    const f=fixture();
    f.fake.when('GET','/v5/domains/{domain}/records')
      .resolves(zoneReply([spfRow]));
    f.fake.when('POST','/v2/domains/{domain}/records').resolves({uid:'rec_FAKE_TXT2'});
    const preview=value(await f.call('vercel_dns_create_record',
      {domain,name:'',type:'TXT',value:'v=spf1 include:other.example.net -all',
        outsideApp:true,dryRun:true},production));
    expect(preview.preview).toContain('breaks mail authentication');
    // The snapshot's TXT branch requires `name` but omits it from
    // properties (dossier §4.1): the scoped validator exemption lets
    // the documented body through, pinned byte-exact here.
    const named=value(await f.call('vercel_dns_create_record',
      {domain,name:'_vercel',type:'TXT',value:'vc-domain-verify=FAKE',
        outsideApp:true,confirm:true},production));
    expect(named.status).toBe('applied');
    expect(f.fake.calls.find(x=>x.method==='POST').body)
      .toEqual({type:'TXT',name:'_vercel',value:'vc-domain-verify=FAKE'});
    f.fake.verify();
  });
  it('updates a record with a byte-exact PATCH and the discriminator-shaped reply',async()=>{
    const f=fixture();
    f.fake.when('GET','/v5/domains/{domain}/records')
      .resolves(zoneReply([aRow]));
    f.fake.when('PATCH','/v1/domains/records/{recordId}').resolves({
      id:'rec_FAKE_A',name:'www',recordType:'A',type:'record',
      value:'192.0.2.11',creator:'user_FAKE',domain,ttl:3600});
    f.fake.when('GET','/domains/records/{recordId}').resolves({
      id:'rec_FAKE_A',name:'www',recordType:'A',type:'A',
      value:'192.0.2.11',creator:'user_FAKE',domain,ttl:3600});
    const applied=value(await f.call('vercel_dns_update_record',
      {domain,recordId:'rec_FAKE_A',value:'192.0.2.11',
        outsideApp:true,confirm:true},production));
    expect(applied).toMatchObject({status:'applied',confirmed:true});
    expect(f.fake.calls.find(x=>x.method==='PATCH').body)
      .toEqual({value:'192.0.2.11'});
    f.fake.verify();
  });
  it('deletes an MX record and its journal inverse re-creates it exactly',async()=>{
    const f=fixture();
    f.fake.when('GET','/v5/domains/{domain}/records')
      .resolves(zoneReply([aRow,mxRow]))
      .resolves(zoneReply([aRow,mxRow]))
      .resolves(zoneReply([aRow]));
    f.fake.when('DELETE','/v2/domains/{domain}/records/{recordId}').resolves({});
    const applied=value(await f.call('vercel_dns_delete_record',
      {domain,recordId:'rec_FAKE_MX',outsideApp:true,confirm:true},production));
    expect(applied).toMatchObject({status:'applied',confirmed:true});
    const inverse=f.audits.find(entry=>entry.inverse)?.inverse;
    expect(inverse).toMatchObject({undo:'Re-create the deleted record',
      record:{type:'MX',name:'',recordValue:'mail.example.net',mxPriority:10}});
    // Batch X's undo, exercised: the inverse feeds the create tool
    // (recordValue is the inverse format's name for the record value —
    // the output shaper hides fields literally named `value` in
    // stored copies, so the journal carries it under this name).
    const g=fixture();
    g.fake.when('GET','/v5/domains/{domain}/records')
      .resolves(zoneReply([aRow]))
      .resolves(zoneReply([aRow]))
      .resolves(zoneReply([aRow,mxRow]));
    g.fake.when('POST','/v2/domains/{domain}/records').resolves({uid:'rec_FAKE_MX'});
    const restored=value(await g.call('vercel_dns_create_record',
      {domain,type:inverse.record.type,name:inverse.record.name,
        value:inverse.record.recordValue,mxPriority:inverse.record.mxPriority,
        ttl:inverse.record.ttl,outsideApp:true,confirm:true},production));
    expect(restored).toMatchObject({status:'applied',confirmed:true});
    expect(g.fake.calls.find(x=>x.method==='POST').body).toEqual(
      {type:'MX',name:'',value:'mail.example.net',mxPriority:10,ttl:3600});
    f.fake.verify();g.fake.verify();
  });
  it('replaces a zone: preview lists every add, change and removal; no PUT is sent',async()=>{
    const f=fixture();
    const desired=[
      {name:'www',type:'A',value:'192.0.2.10',ttl:7200},
      {name:'',type:'MX',value:'mail.example.net',mxPriority:10},
      {name:'shop',type:'CNAME',value:'shop.example.net'}];
    f.fake.when('GET','/v5/domains/{domain}/records')
      .resolves(zoneReply([aRow,mxRow,spfRow]))
      .resolves(zoneReply([aRow,mxRow,spfRow]))
      .resolves(zoneReply([aRow,mxRow,spfRow]))
      .resolves(zoneReply([
        row({ttl:7200}),mxRow,
        row({id:'rec_FAKE_SHOP',name:'shop',type:'CNAME',value:'shop.example.net'})]));
    f.fake.when('DELETE','/v2/domains/{domain}/records/{recordId}').resolves({});
    f.fake.when('PATCH','/v1/domains/records/{recordId}').resolves({
      id:'rec_FAKE_A',name:'www',recordType:'A',type:'record',
      value:'192.0.2.10',creator:'user_FAKE',domain,ttl:7200});
    f.fake.when('POST','/v2/domains/{domain}/records').resolves({uid:'rec_FAKE_SHOP'});
    const args={domain,records:desired,outsideApp:true};
    const preview=value(await f.call('vercel_dns_replace_zone',
      {...args,dryRun:true},production));
    expect(preview.status).toBe('preview');
    expect(preview.preview).toContain('REMOVE TXT');
    expect(preview.preview).toContain('CHANGE A www');
    expect(preview.preview).toContain('ADD CNAME shop');
    const applied=value(await f.call('vercel_dns_replace_zone',
      {...args,confirm:true},production));
    expect(applied).toMatchObject({status:'applied',confirmed:true});
    expect(applied.receipt).toMatchObject({removed:1,changed:1,added:1});
    expect(f.fake.calls.some(x=>x.method==='PUT')).toBe(false);
    f.fake.verify();
  });
  it('refuses writes on a preview connection, below profile, and on an unprovable zone',async()=>{
    const f=fixture();
    f.fake.when('GET','/v5/domains/{domain}/records')
      .resolves(zoneReply([aRow]));
    const previewConn=value(await f.call('vercel_dns_create_record',
      {domain,name:'api',type:'A',value:'192.0.2.20',
        outsideApp:true,confirm:true},connection));
    expect(previewConn.status).toBe('refused_by_guard');
    expect(previewConn.reason).toMatch(/preview connection/i);
    const belowProfile=await f.call('vercel_dns_delete_record',
      {domain,recordId:'rec_FAKE_A',outsideApp:true,confirm:true},everyday);
    // A full-profile-only tool is not offered to an everyday connection
    // at all; the guarded refusal below profile is covered by the
    // create-on-preview case above and the profile pin test.
    expect(belowProfile.isError).toBe(true);
    const g=fixture();
    g.fake.when('GET','/v5/domains/{domain}/records')
      .resolves({records:[aRow],pagination:{count:2,next:1700000001000,prev:null}})
      .resolves({records:'not-a-list'});
    const unprovable=value(await g.call('vercel_dns_create_record',
      {domain,name:'api',type:'A',value:'192.0.2.20',
        outsideApp:true,confirm:true},production));
    expect(unprovable.status).toBe('refused_by_guard');
    expect(g.fake.calls.filter(x=>x.method==='POST')).toHaveLength(0);
    f.fake.verify();g.fake.verify();
  });
  it('lists certificates with exactly the documented fields and honest completeness',async()=>{
    const f=fixture();
    f.fake.when('GET','/v8/certs').resolves(certsReply());
    const result=value(await f.call('vercel_cert_list',{}));
    expect(result.certificates).toEqual([certRow]);
    expect(result.complete).toBe(true);
    expect(result.certificates[0]).not.toHaveProperty('issuer');
    f.fake.verify();
  });
  it('issues a certificate with read-back and removes one with absence proof',async()=>{
    const f=fixture();
    f.fake.when('GET','/v8/certs').resolves(certsReply([]));
    f.fake.when('POST','/v8/certs').resolves(certRow);
    f.fake.when('GET','/v8/certs/{id}').resolves(certRow);
    const issued=value(await f.call('vercel_cert_issue',
      {cns:[domain,'www.'+domain],confirm:true},production));
    expect(issued).toMatchObject({status:'applied',confirmed:true});
    expect(f.fake.calls.find(x=>x.method==='POST').body)
      .toEqual({cns:[domain,'www.'+domain]});
    const g=fixture();
    g.fake.when('GET','/v8/certs/{id}').resolves(certRow).resolves(certRow).rejects(404);
    g.fake.when('DELETE','/v8/certs/{id}').resolves({});
    const removed=value(await g.call('vercel_cert_remove',
      {certId:'cert_FAKE_ONE',outsideApp:true,confirm:true},production));
    expect(removed).toMatchObject({status:'applied',confirmed:true});
    f.fake.verify();g.fake.verify();
  });
});
