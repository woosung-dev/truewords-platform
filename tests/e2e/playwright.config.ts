import path from "node:path";
import { defineConfig } from "@playwright/test";

const repoRoot = path.resolve(__dirname, "../..");
const webOrigin = process.env.E2E_WEB_ORIGIN || "http://127.0.0.1:3000";
const adminOrigin = process.env.E2E_ADMIN_ORIGIN || "http://localhost:3001";
const apiOrigin = process.env.E2E_API_ORIGIN || "http://127.0.0.1:8000";
// 시연 관리자 게이트 계정. API(DEMO_ADMIN_EMAIL)·admin 빌드(NEXT_PUBLIC_DEMO_ADMIN_EMAIL)·스펙이 같은 값을 본다.
const adminEmail = process.env.E2E_ADMIN_EMAIL || "demo-admin@example.com";

export default defineConfig({
  testDir: ".",
  timeout: 30_000,
  retries: 0,
  workers: 1,
  use: { headless: true, screenshot: "only-on-failure" },
  projects: [
    {
      name: "admin-chromium",
      testMatch: ["admin-flow.spec.ts", "data-source-delete.spec.ts", "hoondok-curation.spec.ts"],
      use: { browserName: "chromium", baseURL: adminOrigin },
    },
    {
      name: "web-chromium",
      testMatch: "web-flow.spec.ts",
      use: { browserName: "chromium", baseURL: webOrigin },
    },
    {
      name: "split-apps-chromium",
      testMatch: "split-apps.spec.ts",
      use: { browserName: "chromium", baseURL: webOrigin },
    },
    {
      name: "ui-theme-chromium",
      testMatch: "ui-theme.spec.ts",
      use: { browserName: "chromium", baseURL: webOrigin },
    },
    {
      name: "hoondok-chromium",
      testMatch: [
        "hoondok.spec.ts",
        "hoondok-garden.spec.ts",
        "hoondok-settings.spec.ts",
        "hoondok-jeongseong.spec.ts",
        "hoondok-ask.spec.ts",
        "hoondok-preview.spec.ts",
      ],
      use: { browserName: "chromium", baseURL: webOrigin },
    },
  ],
  // 기존 운영 DB를 사용하지 않는다. 별도 Compose 프로젝트/seed는 README 참조.
  webServer:
    process.env.E2E_EXTERNAL_SERVERS === "1"
      ? undefined
      : [
          {
            command: "uv run --frozen uvicorn e2e_app:app --app-dir tests --host 127.0.0.1 --port 8000",
            cwd: path.join(repoRoot, "apps/api"),
            url: `${apiOrigin}/health`,
            // 시연 관리자 게이트 계정. 스펙의 E2E_ADMIN_EMAIL 기본값과 같아야 한다.
            env: { DEMO_ADMIN_EMAIL: adminEmail },
            reuseExistingServer: false,
            timeout: 60_000,
          },
          ...(["web", "admin"] as const).map((app) => ({
            command: `pnpm --filter @truewords/${app} dev`,
            cwd: repoRoot,
            url: `${app === "web" ? webOrigin : adminOrigin}/login`,
            env: {
              NEXT_PUBLIC_API_URL: apiOrigin,
              NEXT_PUBLIC_WEB_URL: webOrigin,
              NEXT_PUBLIC_ADMIN_URL: adminOrigin,
              NEXT_PUBLIC_DEMO_ADMIN_EMAIL: adminEmail,
              // 훈독 라우트는 플래그 ON 에서만 존재한다. OFF 404 는 Vitest 가 검증한다.
              NEXT_PUBLIC_HOONDOK_ENABLED: "1",
              // 프리뷰 셸(말씀·가정예배·가족)은 두 번째 플래그 뒤에 있다 — 운영 이미지에는 넣지 않는다(PLAN-HD-002 §2).
              NEXT_PUBLIC_HOONDOK_PREVIEW: "1",
            },
            reuseExistingServer: false,
            timeout: 60_000,
          })),
        ],
});
