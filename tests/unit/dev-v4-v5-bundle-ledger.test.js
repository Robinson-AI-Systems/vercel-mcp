import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {readBundlePlan,assessBundleDelivery} from '../../scripts/bundle-plan.mjs';

describe('V-4/V-5 frozen original bundle accounting',()=>{
  const card=readFileSync(new URL('../../docs/pr-cards/V-4.md',import.meta.url),'utf8');
  const report=JSON.parse(readFileSync(new URL('../../docs/pr-cards/V-4-delivery.json',import.meta.url),'utf8'));
  const planned=readBundlePlan(card);
  it('preserves both pre-coded roadmap units and all eight unchanged acceptance strings',()=>{
    expect(planned.baseRevision).toMatch(/^[a-f0-9]{40}$/);
    expect(planned.subsections.map(x=>x.id)).toEqual(['V-4','V-5']);
    expect(planned.subsections.map(x=>x.acceptance.length)).toEqual([4,4]);
    expect(report.subsections.map(x=>x.criteria.length)).toEqual([4,4]);
    for(let i=0;i<2;i++)
      expect(report.subsections[i].criteria.map(x=>x.criterion))
        .toEqual(planned.subsections[i].acceptance);
  });
  it('validates complete delivery evidence and reports the measured meaningful production scope',()=>{
    expect(assessBundleDelivery(planned,report)).toMatchObject({
      status:'SCOPE_ACCOUNTING_CHECKED',underGuide:false,
      plannedSubsections:['V-4','V-5']
    });
    expect(report.productionAdded).toBeGreaterThan(400);
    expect(report.relatedWorkDecision).toMatch(/V-4 and V-5/);
    expect(report.planComparison).toMatch(/PENDING/);
  });
});
