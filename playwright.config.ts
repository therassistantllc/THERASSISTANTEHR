import { defineConfig, devices } from '@playwright/test';

declare const process: {
  env: Record<string, string | undefined>;
};

const env = process.env;

const port = Number(env.PLAYWRIGHT_PORT ?? 5173);

const baseURL =
  env.PLAYWRIGHT_BASE_URL ??
  env.BASE_URL ??
  `http://127.0.0.1:${port}`;

const shouldStartWebServer =
  !env.PLAYWRIGHT_BASE_URL && !env.BASE_URL;

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  workers: 1,
  retries: env.CI ? 1 : 0,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
  ],
  use: {
    baseURL,
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: shouldStartWebServer
    ? {
        command: 'pnpm dev',
        url: baseURL,
        reuseExistingServer: !env.CI,
        timeout: 120_000,
        env: {
          PORT: String(port),
          NEXT_TELEMETRY_DISABLED: '1',
        },
      }
    : undefined,
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
      },
    },
  ],
});