import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@integrations': path.resolve(__dirname, 'integrations'),
      '@': path.resolve(__dirname, 'admin-app/src'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    // Strips real provider credentials so no test can reach a live account.
    setupFiles: ['tests/setup-env.ts'],
    // Integration tests share one throwaway Postgres database and must not
    // interleave transactions across files.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
