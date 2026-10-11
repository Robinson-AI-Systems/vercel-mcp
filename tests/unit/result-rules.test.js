import {describe,it,expect} from 'vitest';
import {fieldPaths,projectFields,prepareResult} from '../../src/core/result-rules.js';
import {summarizeObject,SUMMARY_FIELDS} from '../../src/tools/summaries.js';
describe('C-1 safe summary and projection rules',()=>{
  it('summarizes provider objects using explicit allowlists, shortened commits and host names',()=>{
    const d=summarizeObject('deployment',{id:'dpl_FAKE',url:'example.test',target:'preview',
      commitSha:'123456789abcdef',commitMessage:'First line\nSecret second line',
      value:'vcp_FAKE_NEVER_SHOW',internalDebug:'PRIVATE'});
    expect(d.commitSha).toBe('1234567');
    expect(d.commitMessage).toBe('First line');
    expect(d).not.toHaveProperty('value');
    expect(d).not.toHaveProperty('internalDebug');
    expect(summarizeObject('webhook',{host:'https://hooks.example.test/path?secret=hidden'}).host)
      .toBe('hooks.example.test');
    expect(SUMMARY_FIELDS.env).not.toContain('value');
  });
  it('drops secret keys even for full env/detail and 100 provider items',()=>{
    const rows=Array.from({length:100},(_,i)=>({key:'KEY_'+i,kind:'encrypted',
      value:'not-for-chat',decryptedValue:'vcp_FAKE_NEVER_SHOW',token:'vcp_FAKE_KEY',
      targets:['preview'],updatedAt:1760000000000}));
    for(const detail of ['full','summary']){
      const view=prepareResult(rows,{kind:'env',detail,summaryMapper:summarizeObject});
      expect(view.result).toHaveLength(100);
      expect(JSON.stringify(view.result)).not.toContain('not-for-chat');
      expect(JSON.stringify(view.result)).not.toContain('vcp_FAKE_KEY');
      expect(view.result[0]).not.toHaveProperty('value');
    }
  });
  it('projects nested dotted paths with unknown-path reporting',()=>{
    const src={id:'prj_FAKE',git:{repo:'demo',branch:'preview'},count:12};
    expect(projectFields(src,'id,git.branch,missing')).toEqual({
      result:{id:'prj_FAKE',git:{branch:'preview'}},unknownFields:['missing']
    });
    expect(prepareResult(src,{detail:'full',fields:'git.repo'}).result)
      .toEqual({git:{repo:'demo'}});
  });
  it('refuses invalid paths, prototype pollution, unbounded selectors and invalid detail',()=>{
    for(const x of ['__proto__.constructor','a..b','a[0]','a,'.repeat(30),123])
      expect(()=>fieldPaths(x)).toThrow();
    expect(()=>prepareResult({a:1},{detail:'verbose'})).toThrow();
    expect(()=>prepareResult({payload:'x'.repeat(1048577)},{detail:'full'})).toThrow();
  });
});
