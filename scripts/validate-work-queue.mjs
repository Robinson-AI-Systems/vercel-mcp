// Enforce a durable return path for any work paused behind an owner or external gate.
// Read-only validation: never contacts providers, reads credentials or changes deployment.
import {readFileSync} from 'node:fs';

export function ownerInputStates(markdown) {
  const states = new Map();
  for (const line of markdown.split('\n')) {
    const row = /^\|\s*(IN-\d{2})\s*\|\s*([^|]+)\|/.exec(line);
    if (row) states.set(row[1], /\banswered\b/i.test(row[2]) ? 'answered' : 'pending');
  }
  return states;
}

export function dueWork(data, ownerStates) {
  const statuses=new Map((data?.cards||[]).map(x=>[x.id,x.status]));
  return (data?.cards||[]).filter(card=>{
    const v=card.revisit;
    if(!v||!['IN_PROGRESS','BLOCKED','WAITING_FOR_OWNER'].includes(card.status))return false;
    const required=(card.dependencies||[]).filter(id=>
      !(card.earlyReadException?.scope==='read_only'&&
        card.earlyReadException.prerequisite===id));
    if(required.some(id=>statuses.get(id)!=='MERGED'))return false;
    if(v.trigger==='owner-input-resolved')
      return v.ownerInputRefs?.length>0&&
        v.ownerInputRefs.every(id=>ownerStates.get(id)==='answered');
    return v.trigger==='next-implementation-slice';
  }).map(card=>({id:card.id,nextAction:card.revisit.nextAction}));
}

export function validateWorkQueue(data, ownerStates) {
  const errors = [], cards = data?.cards;
  if (!Array.isArray(cards)) return ['Work index must contain cards'];
  const byId = new Map(cards.map(card => [card.id, card]));
  const needsRevisit = new Set(['IN_PROGRESS', 'BLOCKED', 'WAITING_FOR_OWNER']);
  const triggers = new Set(['owner-input-resolved', 'dependency-merged',
    'external-acceptance', 'next-implementation-slice', 'design-amendment']);
  const filled = value => typeof value === 'string' && value.trim().length >= 12;
  for (const card of cards) {
    if (needsRevisit.has(card.status)) {
      const next = card.revisit;
      if (!next || !filled(next.reason) || !filled(next.nextAction) ||
          !filled(next.owner) || !filled(next.checkpoint) ||
          !triggers.has(next.trigger) || !filled(next.evidenceNeeded) ||
          !filled(next.eligibilityCondition) ||
          !Array.isArray(next.dependencies) ||
          next.dependencies.some(id=>typeof id!=='string'||!(card.dependencies||[]).includes(id))) {
        errors.push(card.id + ': unfinished work requires reason, evidenceNeeded, eligibilityCondition, dependencies, owner, checkpoint, trigger and nextAction');
        continue;
      }
      if (next.trigger === 'owner-input-resolved') {
        if (!Array.isArray(next.ownerInputRefs) || !next.ownerInputRefs.length) {
          errors.push(card.id + ': owner-input revisit requires IN-xx references');
          continue;
        }
        const unknown = next.ownerInputRefs.filter(id => !ownerStates.has(id) ||
          !(card.ownerInputs || []).includes(id));
        if (unknown.length) errors.push(card.id + ': untracked owner inputs: ' + unknown.join(', '));
        const answered = next.ownerInputRefs.filter(id => ownerStates.get(id) === 'answered');
        if (answered.length && !filled(next.resolution)) {
          errors.push(card.id + ': answered input needs recorded resolution and next action');
        }
        if (card.status === 'BLOCKED' && answered.length === next.ownerInputRefs.length) {
          errors.push(card.id + ': all owner inputs are answered; cannot stay blocked on them');
        }
      }
    }
    const exception = card.earlyReadException;
    if (exception) {
      const prerequisite = byId.get(exception.prerequisite);
      if (!prerequisite || !(card.dependencies || []).includes(exception.prerequisite) ||
          exception.scope !== 'read_only' || !filled(exception.evidence) ||
          !filled(exception.nextAction) || !filled(exception.restrictions)) {
        errors.push(card.id + ': invalid scoped read-only dependency exception');
      }
      if (card.status === 'MERGED') {
        errors.push(card.id + ': merged card must retire its early-read exception');
      }
    }
  }
  return errors;
}

if (process.argv[1] && import.meta.url === new URL('file://' + process.argv[1]).href) {
  const index = JSON.parse(readFileSync('docs/pr-cards/work-index.json', 'utf8'));
  const states = ownerInputStates(readFileSync('docs/OWNER-INPUTS.md', 'utf8'));
  const errors = validateWorkQueue(index, states);
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exitCode = 1;
  } else {
    console.log('Blocked-work revisit and early-read exceptions OK');
    if(process.argv.includes('--eligible'))for(const due of dueWork(index,states))
      console.log('ELIGIBLE '+due.id+': '+due.nextAction);
  }
}
