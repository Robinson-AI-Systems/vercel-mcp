import { defineConfig } from 'vitest/config';
// Emulator suite: Vercel Labs' `emulate` on localhost (scripts/emulate.sh starts and stops it, sets VERCEL_API_BASE).
export default defineConfig({
  test: { include: ['tests/emulate/**/*.test.js'], environment: 'node', testTimeout: 15000, fileParallelism: false }
});
