import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateEvidence} from './check-developer-evidence.mjs';
const doc=record=>({version:1,repository:'owner/custom',service:'custom',records:['source','automated','deployed','custom_transport','provider','hub','revocation','cleanup'].map(layer=>layer===record.layer?record:{layer,status:'unverified'})});
const verified={layer:'provider',status:'verified',source:'custom_service',service:'custom',commit:'a'.repeat(40),origin:'https://custom.example',transport:'native_mcp',observations:['permitted_read','permitted_write','denied_resource_access','denied_identity_access','provider_readback']};
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

test('deployment metadata cannot certify runtime acceptance',()=>{
 for(const layer of ['custom_transport','provider','hub','revocation','cleanup'])assert.ok(validateEvidence(doc({...verified,layer,transport:'deployment_api'})).length);
 assert.deepEqual(validateEvidence(doc({...verified,layer:'deployed',source:'deployment_provider',transport:'deployment_api'})),[]);
});
test('all layers must remain explicitly tracked once',()=>{
 const empty=doc(verified);empty.records=[];assert.ok(validateEvidence(empty).length);
 const duplicate=doc(verified);duplicate.records.push(verified);assert.ok(validateEvidence(duplicate).length);
});
test('a provider read alone is partial proof, not full provider acceptance',()=>assert.ok(validateEvidence(doc({...verified,observations:['provider_readback']})).length));
