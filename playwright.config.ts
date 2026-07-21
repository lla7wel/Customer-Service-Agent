import { defineConfig, devices } from '@playwright/test';

/**
 * Browser tests for the admin app.
 *
 * They run against a REAL server backed by a throwaway database that the
 * global setup creates, migrates and seeds with SYNTHETIC data — never the
 * owner's data, and never with provider credentials, so no test can reach a
 * live Meta account or a paid API.
 *
 * Run: npm run test:e2e
 */
const PORT = Number(process.env.E2E_PORT ?? 3210);
const BASE_URL = `http://127.0.0.1:${PORT}`;

// webServer.env is captured when this config loads — BEFORE globalSetup runs —
// so the database and media locations must be deterministic, not generated.
const ADMIN_URL = process.env.TEST_DATABASE_ADMIN_URL || 'postgres://localhost/postgres';
export const E2E_DB_NAME = 'eh_e2e_playwright';
export const E2E_DATABASE_URL = ADMIN_URL.replace(/\/[^/]*$/, `/${E2E_DB_NAME}`);
export const E2E_MEDIA_ROOT = '/tmp/eh-e2e-playwright-media';

export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  globalTeardown: './tests/e2e/global-teardown.ts',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  use: {
    baseURL: BASE_URL,
    locale: 'ar-LY',
    // Exercises the reduced-motion path we ship, and keeps decorative
    // animations from making controls perpetually 'unstable'.
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 900 } } },
    { name: 'tablet', use: { ...devices['Desktop Chrome'], viewport: { width: 768, height: 1024 } } },
    // The three compact widths in the acceptance brief.
    { name: 'phone-360', use: { ...devices['Pixel 5'], viewport: { width: 360, height: 740 } } },
    { name: 'phone-390', use: { ...devices['Pixel 5'], viewport: { width: 390, height: 844 } } },
    { name: 'phone-430', use: { ...devices['Pixel 5'], viewport: { width: 430, height: 932 } } },
  ],
  webServer: {
    // Runs the real production standalone server (output: 'standalone'),
    // assembled by `npm run e2e:assemble`.
    command: `node admin-app/.next/standalone/admin-app/server.js`,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATABASE_URL: E2E_DATABASE_URL,
      SESSION_SECRET: 'e2e-session-secret-with-at-least-32-characters',
      MEDIA_ROOT: E2E_MEDIA_ROOT,
      PUBLIC_MEDIA_BASE_URL: 'http://127.0.0.1:9/media',
      NEXT_PUBLIC_DEFAULT_LOCALE: 'ar',
      NODE_ENV: 'production',
      PORT: String(PORT),
      HOSTNAME: '127.0.0.1',
    },
  },
});
