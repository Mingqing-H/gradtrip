import { defineConfig } from '@playwright/test';
const baseURL = 'http://127.0.0.1:4173' + (process.env.VITE_BASE_PATH || '/gradtrip/');
export default defineConfig({
  testDir: './tests/e2e/full-flow',
  fullyParallel: false,
  workers: 1,
  use: { baseURL, channel: 'chrome', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop-1440', use: { viewport: { width: 1440, height: 900 } } },
    { name: 'tablet-768', use: { viewport: { width: 768, height: 1024 } } },
    { name: 'mobile-375', use: { viewport: { width: 375, height: 812 } } },
  ],
  webServer: { command: 'npm run preview', url: baseURL, reuseExistingServer: !process.env.CI },
});
