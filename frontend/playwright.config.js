// Visual regression config. These tests never talk to a real backend --
// tests/visual/mocks.js intercepts every API call with fixed fixture data, so
// a run needs nothing but `npm run dev` and produces the same screenshot
// whether it's run today or next year. See tests/visual/README.md.
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/visual",
  fullyParallel: true,
  // A snapshot diff is meaningless if the same run produced two different
  // answers, so a flake here must be investigated rather than papered over
  // with a retry -- CI still gets one retry for genuine infra hiccups
  // (a slow container on first boot), local dev gets none so a real problem
  // fails immediately instead of hiding behind a second, passing attempt.
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
  },
  // No {platform} component: baselines are generated inside the same Linux
  // container CI uses (see README), so the OS is constant and doesn't need
  // to be part of the filename. Leaving it in would make a mac-generated
  // baseline invisible to a Linux CI run and vice versa.
  snapshotPathTemplate: "{testDir}/{testFileDir}/__screenshots__/{arg}-{projectName}{ext}",
  // Chromium only. A visual diff is about layout/CSS, not JS engine quirks,
  // and one browser's font rendering is one less axis of noise in the
  // baselines -- see the README for what to do if a WebKit-only bug shows up.
  projects: [
    {
      name: "mobile",
      use: { ...devices["iPhone 13"] },
    },
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } },
      // The nav-overflow and edit-sheet regressions only exist at mobile
      // widths (isMobile is false at 1280px, so .mobile-row never renders) --
      // only the full dashboard screenshot is meaningful at desktop width.
      testMatch: /dashboard\.spec\.js/,
    },
  ],
  webServer: {
    command: "npm run dev -- --port 5173 --strictPort",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
  },
});
