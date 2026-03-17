import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  retries: 1,
  reporter: 'list',
  use: {
    baseURL: 'https://rrmacademy.org',
    // No need to launch a local dev server -- tests run against production
  },
  projects: [
    {
      name: 'desktop-chrome',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'iphone-se',
      use: { ...devices['iPhone SE'] }, // 375px
    },
    {
      name: 'iphone-xr',
      use: { ...devices['iPhone XR'] }, // 414px
    },
  ],
});
