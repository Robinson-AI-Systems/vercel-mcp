import {describe, it, expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {ownerInputStates, validateWorkQueue} from '../../scripts/validate-work-queue.mjs';

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
    owner:'next Vercel MCP development implementer',checkpoint:'next substantive PR'
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
  it('validates the repository queue and its recorded owner decisions', () => {
    const queue=JSON.parse(readFileSync('docs/pr-cards/work-index.json','utf8'));
    const decisions=ownerInputStates(readFileSync('docs/OWNER-INPUTS.md','utf8'));
    expect(validateWorkQueue(queue,decisions)).toEqual([]);
  });
});
