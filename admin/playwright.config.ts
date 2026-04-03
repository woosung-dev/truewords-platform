import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: "http://localhost:3000",
    headless: true,
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
  // 백엔드 + 프론트엔드를 동시에 띄움
  webServer: [
    {
      command: "cd ../backend && uv run uvicorn main:app --port 8000",
      port: 8000,
      reuseExistingServer: true,
      timeout: 30_000,
    },
    {
      command: "npm run dev -- --port 3000",
      port: 3000,
      reuseExistingServer: true,
      timeout: 30_000,
    },
  ],
});
