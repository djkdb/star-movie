import { defineConfig } from 'vitest/config';

const common = {
  globals: true,
  clearMocks: true,
  restoreMocks: true,
  passWithNoTests: true,
} as const;

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          ...common,
          name: 'unit',
          environment: 'node',
          include: ['src/**/*.test.ts', 'tests/unit/**/*.test.ts'],
          exclude: ['**/*.component.test.ts', '**/*.pbt.test.ts'],
        },
      },
      {
        test: {
          ...common,
          name: 'component',
          environment: 'jsdom',
          setupFiles: ['./tests/setup/component.ts'],
          include: ['src/**/*.component.test.{ts,tsx}', 'tests/component/**/*.test.{ts,tsx}'],
        },
      },
      {
        test: {
          ...common,
          name: 'pbt',
          environment: 'node',
          include: ['src/**/*.pbt.test.ts', 'tests/pbt/**/*.test.ts'],
          testTimeout: 30_000,
        },
      },
    ],
  },
});
