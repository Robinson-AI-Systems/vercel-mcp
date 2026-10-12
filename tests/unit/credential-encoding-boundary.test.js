import {describe,it,expect} from 'vitest';
import {credentialLike,compact} from '../../src/core/util.js';
describe('P1: complete inspection after exactly eight percent-decodes',()=>{
  const fake='Abcdefghijklmnopqrstuvwxyz012345';
  const nested=Array.from({length:8}).reduce(value=>value.replace(/%/g,'%25'),'%41'+fake.slice(1));
  it('detects and hides a high-entropy generic credential at the eighth boundary',()=>{
    expect(decodeURIComponent(Array.from({length:7}).reduce(
      value=>value.replace(/%25/g,'%'),nested))).toBe(fake);
    expect(credentialLike(nested)).toBe(true);
    expect(compact({projectName:nested,gitRepo:nested,items:[nested]})).toEqual({
      projectName:'[hidden]',gitRepo:'[hidden]',items:['[hidden]']
    });
  });
  it('does not censor harmless ordinary metadata',()=>{
    expect(credentialLike('ordinary-project')).toBe(false);
    expect(compact({projectName:'ordinary-project'})).toEqual({projectName:'ordinary-project'});
  });
});
