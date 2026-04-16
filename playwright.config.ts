import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",

  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:3002",
    trace: "on-first-retry",
    // Required for SharedArrayBuffer / WASM (COEP/COOP headers)
    bypassCSP: false,
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-chrome",
      use: { ...devices["Pixel 5"] },
    },
  ],

  // Start the dev server automatically before running tests.
  // Set E2E_SKIP_SERVER=1 to skip if a dev server is already running.
  ...(process.env.E2E_SKIP_SERVER
    ? {}
    : {
        webServer: {
          command: "npm run dev",
          url: process.env.BASE_URL ?? "http://localhost:3002",
          reuseExistingServer: true,
          timeout: 120_000,
        },
      }),
});
