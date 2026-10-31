import {describe,it,expect} from 'vitest';
import {explainVercelError,vercelErrorResult} from '../../src/tools/errors.js';
describe('B-4 plain-language Vercel provider errors',()=>{
 const cases=[
  ['invalid_token','token','enrollment'],
  ['forbidden','permission','role'],
  ['not_found','not found','List'],
  ['rate_limited','limited','Wait'],
  ['price_mismatch','price changed','quote'],
  ['not_available','not currently available','dashboard'],
  ['conflict_aliases','alias','Inspect'],
  ['custom_domain_needs_upgrade','custom-domain','pricing'],
  ['env_invalid_target','environment-variable','variable'],
  ['missing_files','build files','Review'],
  ['no_files','build files','Review'],
  ['runtime_log_stream_invalid','runtime logs','bounded read']
 ];
 for(const [code,word,action] of cases) it('maps '+code+' to an actionable safe explanation',()=>{
   const obj=explainVercelError({code,status:400});
   expect(obj.what.toLowerCase()).toContain(word.toLowerCase());
   expect(obj.next.toLowerCase()).toContain(action.toLowerCase());
   expect(obj.technical).toContain('HTTP 400');
 });
 it('redacts hostile stream errors while retaining safe HTTP classification',()=>{
   const rendered=JSON.stringify(vercelErrorResult({code:'runtime_log_stream_invalid',status:200,
     message:'vcp_FAKE_must_not_leak',body:'private event'}));
   expect(rendered).toContain('runtime logs');
   expect(rendered).toContain('HTTP 200');
   expect(rendered).not.toContain('vcp_FAKE_must_not_leak');
   expect(rendered).not.toContain('private event');
 });
 it('identifies project scope vs insufficient owner permissions',()=>{
   const a=explainVercelError({code:'forbidden',status:403},{projectScoped:true,project:'project_FAKE'});
   expect(a.why).toContain('project_FAKE');
   const b=explainVercelError({code:'forbidden',status:403});
   expect(b.why).toContain('Owner');
 });
 it('shows an unambiguous rate-limit reset in Denver time',()=>{
   const response=explainVercelError({code:'rate_limited',status:429},{resetAtMs:1791738000000});
   expect(response.why).toMatch(/MDT|MST/);
   expect(response.next).toContain('Wait');
 });
 it('never copies raw provider messages, token-looking context or upstream payloads',()=>{
   const raw={error:{code:'unknown_code',message:'vcp_FAKE_secret_example_value'},status:500,
     body:{password:'bad-password'}};
   const output=JSON.stringify(vercelErrorResult(raw,{team:'sk_live_SECRET'}));
   expect(output).not.toContain('vcp_FAKE_secret_example_value');
   expect(output).not.toContain('sk_live_SECRET');
   expect(output).not.toContain('bad-password');
   expect(output).toContain('What to do');
 });
 it('does not echo untrusted codes or credential-shaped labels',()=>{
   const raw={error:{code:'vcp_FAKE_long_secret_identifier',message:'private'},status:401};
   const value=JSON.stringify(vercelErrorResult(raw,{team:'vcp_SECRET'}));
   expect(value).not.toContain('vcp_FAKE_long_secret_identifier');
   expect(value).not.toContain('vcp_SECRET');
   expect(explainVercelError({code:'forbidden',status:403},{projectScoped:true,project:'sk_live_SECRET'}).why)
     .not.toContain('sk_live_SECRET');
 });
 it('shows safe operation context without untrusted input',()=>{
   expect(explainVercelError({code:'not_found',status:404},{operation:'vercel_project_get'}).technical)
     .toContain('vercel_project_get');
   expect(explainVercelError({code:'not_found',status:404},{operation:'secret://credential'}).technical)
     .not.toContain('credential');
 });
 it('handles absent body, malformed codes, and not found without exposing raw IDs',()=>{
   expect(explainVercelError(null).technical).toBe('Vercel unknown_error');
   expect(explainVercelError({code:'<?xml secret>'}).technical).toBe('Vercel unknown_error');
   const s=JSON.stringify(vercelErrorResult({code:'not_found'}, {team:'vcp_SECRET'}));
   expect(s).not.toContain('vcp_SECRET');
 });
});

describe('VMCP-030: the tools own validation errors are legible',()=>{
 it('surfaces a curated TypeError as invalid_request with its own message',()=>{
   const obj=explainVercelError(new TypeError('Deployment outside requested project — deployment reads are keyed by the exact project ID (prj_…), not a project name'));
   expect(obj.technical).toContain('invalid_request');
   expect(obj.what).toContain('Deployment outside requested project');
   expect(obj.what).toContain('exact project ID');
   expect(obj.why).toContain('Vercel did not refuse it');
   expect(JSON.stringify(obj)).not.toContain('did not return a recognized safe error code');
 });
 it('never surfaces a TypeError message carrying credential-shaped content',()=>{
   const obj=explainVercelError(new TypeError('bad token vcp_FAKEFAKEFAKEFAKE12 in selection'));
   expect(obj.technical).toContain('invalid_request');
   expect(JSON.stringify(obj)).not.toContain('vcp_FAKE');
   expect(obj.what).toBe('The request did not match what this tool requires.');
 });
 it('keeps generic errors and provider errors on their existing classes',()=>{
   expect(explainVercelError(new Error('boom')).technical).toContain('unknown_error');
   expect(explainVercelError({code:'not_found',status:404}).technical).toContain('not_found');
   const rendered=JSON.stringify(vercelErrorResult(new TypeError('Invalid deployment identifier')));
   expect(rendered).toContain('Invalid deployment identifier');
   expect(rendered).not.toContain('unknown_error');
 });
});
