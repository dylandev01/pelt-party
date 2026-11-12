import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests', testMatch: '**/*.spec.js', timeout: 45_000, retries: 0,
  use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:3000', trace: 'retain-on-failure' },
  webServer: { command: 'node src/server.js', url: 'http://localhost:3000/health', reuseExistingServer: !process.env.CI,
    env: { ...process.env, NODE_ENV: 'development', PUBLIC_ORIGIN: 'http://localhost:3000', PORT: '3000' }, timeout: 30_000 }
});
