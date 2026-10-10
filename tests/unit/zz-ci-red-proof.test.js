import { expect, it } from 'vitest';

// TEMPORARY (A-1 acceptance): proves a failing test turns the unit job and the `ci` gate red. Removed in the next push.
it('deliberately fails to prove CI goes red', () => {
  expect(1 + 1).toBe(3);
});
