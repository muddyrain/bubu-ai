import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', '*.test.ts'],
    maxWorkers: 2,
    clearMocks: true,
    restoreMocks: true,
  },
});
