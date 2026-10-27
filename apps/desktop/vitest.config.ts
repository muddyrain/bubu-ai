import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}', '*.test.ts'],
    maxWorkers: 2,
    clearMocks: true,
    restoreMocks: true,
  },
});
