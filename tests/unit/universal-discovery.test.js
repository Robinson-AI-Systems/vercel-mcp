import {describe,it,expect} from 'vitest';
import {apiIndex,searchApi,describeApi} from '../../src/vercel/openapi-index.js';
import {universalTools} from '../../src/tools/universal.js';
describe('U-1 bounded public API discovery',()=>{
 it('indexes every pinned operation and discovers feature flags and KMS issuers',()=>{
   expect(apiIndex()).toHaveLength(451);
   expect(searchApi({query:'feature flag'}).total).toBeGreaterThan(0);
   expect(searchApi({query:'kms issuer'}).total).toBeGreaterThan(0);
 });
 it('paginates deterministically without claiming execution authority',()=>{
   const one=searchApi({query:'project',limit:2}),two=searchApi({query:'project',limit:2,offset:2});
   expect(one.nextOffset).toBe(2);expect(two.operations.map(x=>x.op)).not.toEqual(one.operations.map(x=>x.op));
   expect(one.operations[0].risk.authorization).toMatch(/Metadata only/);
 });
 it('describes the pinned team security schema without examples or credentials',()=>{
   const row=apiIndex().find(x=>x.method==='PATCH'&&x.path==='/v2/teams/{teamId}');
   const detail=describeApi({op:row.op,bodyField:'saml.enforced'});
   expect(detail.schema.type).toBe('boolean');
   expect(JSON.stringify(detail)).not.toMatch(/example|bearerToken/);
   expect(describeApi({op:row.op}).body.fields).toContain('saml');
   expect(describeApi({op:row.op}).note).toMatch(/Trimmed schema/);
 });
 it('refuses unknown op, field, arguments and malicious selectors without I/O',async()=>{
   for(const v of [{op:'https://evil.example'},{op:'does_not_exist'},{op:'patchTeam',bodyField:'../secret'}])
     expect(()=>describeApi(v)).toThrow();
   await expect(universalTools.handlers.vercel_api_search({query:'flag',teamId:'other'})).rejects.toThrow();
   expect(()=>searchApi({query:'!!!'})).toThrow();
 });
 it('keeps every default description within the response budget or explains specific-field inspection',async()=>{
   for(const row of apiIndex()){
     try{
       const value=await universalTools.handlers.vercel_api_describe({op:row.op});
       expect(Buffer.byteLength(value.content[0].text)).toBeLessThanOrEqual(7600);
     }catch(e){expect(e.message).toMatch(/too large/);}
   }
 });
});
