import base from "./playwright.config";
export default {
  ...base,
  testDir: __dirname,
  use: { ...base.use, launchOptions: { executablePath: "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome" } },
};
