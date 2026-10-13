import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateEvidence} from './check-developer-evidence.mjs';
const doc=record=>({version:1,repository:'owner/custom',service:'custom',records:[record]});
const verified={layer:'provider',status:'verified',source:'custom_service',service:'custom',commit:'a'.repeat(40),origin:'https://custom.example',transport:'native_mcp',observations:['provider_readback']};
test('standard connector cannot stand in for custom acceptance',()=>assert.ok(validateEvidence(doc({...verified,source:'standard_connector'})).length));
test('reference and mocked probes are automated evidence only',()=>assert.ok(validateEvidence(doc({...verified,source:'reference_server'})).length));
test('wrong service, missing revision and token-bearing origins fail',()=>{
 for(const patch of [{service:'other'},{commit:'main'},{origin:'https://user:secret@custom.example'}])assert.ok(validateEvidence(doc({...verified,...patch})).length);
});
test('native initialize is not provider readback',()=>assert.ok(validateEvidence(doc({...verified,observations:['initialize']})).length));
test('generic denial is not same-pass revocation',()=>assert.ok(validateEvidence(doc({...verified,layer:'revocation',observations:['401']})).length));
test('valid independently collected custom observations and truthful pending layers accepted',()=>{
 assert.deepEqual(validateEvidence(doc(verified)),[]);assert.deepEqual(validateEvidence(doc({layer:'provider',status:'unverified'})),[]);
});
