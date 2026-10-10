import { defineConfig } from 'vitest/config';
// Unit suite: no network, no database. `npm test` or `npx vitest run tests/unit/<file>.test.js`.
export default defineConfig({
  test: { include: ['tests/unit/**/*.test.js'], environment: 'node', testTimeout: 15000 }
});
