// The versioned front-door membership (packet AUD-C, design D-C, ruling OP-1):
// the single home is front-door.json next to this loader — {version, basis,
// tools}. Membership changes only by PR, with the measurement quoted in the PR.
// The first membership is a labelled SEED (basis 'seed-2026-10-27'): no
// journal/change-log call counts were queryable at build time, so the seed is
// judgement-based from the C-2 compact core plus the everyday-profile core
// set, pending the first measurement refresh over journaled call counts.
import { readFileSync } from 'node:fs';

const parsed = JSON.parse(readFileSync(new URL('./front-door.json', import.meta.url), 'utf8'));
if (!parsed || !Number.isInteger(parsed.version) || typeof parsed.basis !== 'string' ||
  !Array.isArray(parsed.tools) || parsed.tools.some((name) => typeof name !== 'string')) {
  throw new Error('Invalid front-door membership artifact: src/data/front-door.json');
}
export const FRONT_DOOR = Object.freeze({
  version: parsed.version,
  basis: parsed.basis,
  tools: Object.freeze([...parsed.tools])
});
export const FRONT_DOOR_TOOLS = FRONT_DOOR.tools;
