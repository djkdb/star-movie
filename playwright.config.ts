import { defineConfig, devices } from '@playwright/test';

const appUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:4173';

export default defineConfig({
  testDir: './tests/browser',
  outputDir: './test-results/playwright',
  // The fullscreen WebGL sky is expensive under headless software rendering.
  timeout: 90_000,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['line']] : 'list',
  use: {
    baseURL: appUrl,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'headless-integration',
      testMatch: '**/*.integration.spec.ts',
      use: { ...devices['Desktop Chrome'], headless: true },
    },
    {
      name: 'visual-chromium',
      testMatch: '**/*.visual.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        headless: true,
        viewport: { width: 1920, height: 1080 },
        deviceScaleFactor: 1,
      },
    },
    {
      name: 'performance-chromium',
      testMatch: '**/*.performance.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        headless: true,
        viewport: { width: 1920, height: 1080 },
        deviceScaleFactor: 1,
      },
    },
  ],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: 'npm run dev -- --host 127.0.0.1 --port 4173',
        url: appUrl,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
