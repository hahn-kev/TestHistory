import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Resolve @testhistory/shared to its source so tests run without a build step.
const sharedSrc = fileURLToPath(new URL('../shared/src/index.ts', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@testhistory/shared': sharedSrc,
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
