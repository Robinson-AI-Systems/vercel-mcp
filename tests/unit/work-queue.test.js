import {describe, it, expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {ownerInputStates, validateWorkQueue, dueWork} from '../../scripts/validate-work-queue.mjs';

const states = ownerInputStates(`| ID | Status | Other |
|---|---|---|
| IN-07 | **ANSWERED 2026-10-12** | yes |
| IN-08 | **ANSWERED 2026-10-12** | yes |
| IN-09 | Awaiting owner | no |`);
const inProgress = () => ({id:'D-1',status:'IN_PROGRESS',ownerInputs:['IN-07','IN-08'],
  dependencies:[],revisit:{
    reason:'Owner decisions were made but acceptance remains pending',
    trigger:'owner-input-resolved',ownerInputRefs:['IN-07','IN-08'],
    resolution:'Both owner policies are answered; verify engineering and acceptance',
    nextAction:'Inventory D-1 operations and update truthful completion evidence',
    owner:'next Vercel MCP development implementer',checkpoint:'next substantive PR',
    evidenceNeeded:'Finite D-1 code inventory and separate live acceptance artifacts',
    eligibilityCondition:'IN-07 and IN-08 both answered, and no other code dependency',
    dependencies:[]
  }});
describe('blocked-work roadmap safety', () => {
  it('parses actual owner decision statuses without treating pending as answered', () => {
    expect(states.get('IN-07')).toBe('answered');
    expect(states.get('IN-09')).toBe('pending');
  });
  it('rejects unfinished work silently missing a return trigger', () => {
    const item=inProgress();delete item.revisit;
    expect(validateWorkQueue({cards:[item]},states).join(' ')).toContain('unfinished work');
  });
  it('rejects a blocked card after every recorded owner input is answered', () => {
    const item=inProgress();item.status='BLOCKED';
    expect(validateWorkQueue({cards:[item]},states).join(' ')).toContain('cannot stay blocked');
  });
  it('requires explicit reconciliation when an owner decision becomes answered', () => {
    const item=inProgress();delete item.revisit.resolution;
    expect(validateWorkQueue({cards:[item]},states).join(' ')).toContain('recorded resolution');
  });
  it('requires known owned inputs rather than untracked IDs', () => {
    const item=inProgress();item.revisit.ownerInputRefs=['IN-09'];
    expect(validateWorkQueue({cards:[item]},states).join(' ')).toContain('untracked');
  });
  it('preserves dependency edges but permits only documented read-only exceptions', () => {
    const base=inProgress();
    const read={id:'D-2',status:'APPROVED',dependencies:['D-1'],
      earlyReadException:{prerequisite:'D-1',scope:'read_only',
        evidence:'D-1 card section explicitly allows independent read-only D-2',
        nextAction:'Implement deployment list and detail via scoped REST reads',
        restrictions:'No writes, production activation or assumed external acceptance'}};
    expect(validateWorkQueue({cards:[base,read]},states)).toEqual([]);
    read.earlyReadException.scope='full';
    expect(validateWorkQueue({cards:[base,read]},states).join(' ')).toContain('invalid');
  });
  it('rejects a parked card without evidence, eligibility or tracked dependencies',()=>{
    const item=inProgress();delete item.revisit.evidenceNeeded;
    expect(validateWorkQueue({cards:[item]},states).join(' ')).toContain('evidenceNeeded');
    item.revisit.evidenceNeeded='Real acceptance evidence required';
    item.revisit.dependencies=['UNTRACKED'];
    expect(validateWorkQueue({cards:[item]},states).join(' ')).toContain('dependencies');
  });
  it('requeues owner-resolved cards but respects prerequisites and read exceptions',()=>{
    const item=inProgress(), d2={id:'D-2',status:'IN_PROGRESS',
      dependencies:['D-1'],earlyReadException:{prerequisite:'D-1',scope:'read_only'},
      revisit:{trigger:'next-implementation-slice',
        nextAction:'Build protected deployment diagnostics without producer mutations'}};
    expect(dueWork({cards:[item,d2]},states).map(x=>x.id)).toEqual(['D-1','D-2']);
    delete d2.earlyReadException;
    expect(dueWork({cards:[item,d2]},states).map(x=>x.id)).toEqual(['D-1']);
  });
  it('validates the repository queue and its recorded owner decisions', () => {
    const queue=JSON.parse(readFileSync('docs/pr-cards/work-index.json','utf8'));
    const decisions=ownerInputStates(readFileSync('docs/OWNER-INPUTS.md','utf8'));
    expect(validateWorkQueue(queue,decisions)).toEqual([]);
  });
});
