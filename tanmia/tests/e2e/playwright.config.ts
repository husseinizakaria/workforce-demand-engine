import { defineConfig } from '@playwright/test';

// Runs against the local Supabase-compatible stack started by scripts/e2e/stack.sh.
export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.ts/,
  timeout: 60_000,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_WEB ?? 'http://127.0.0.1:4173',
    launchOptions: { executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
});
