import { expect, test } from "@playwright/test";
import { openDashboard, openSignedOut } from "./mocks";

// PLAN.md milestone 9: forgot password, the reset screen, what a
// confirmation link did, and the nudge for an unconfirmed address. Each
// state gets a baseline at both viewports, because the sign-in screen and
// the strip under the header both change layout at 760px.

const expired = (route) => route.fulfill({ status: 400, json: { detail: "expired" } });

test.describe("forgot password", () => {
  test("the request form", async ({ page }) => {
    await openSignedOut(page);
    await page.getByRole("button", { name: "Forgot your password?" }).click();

    await expect(page.getByRole("button", { name: "Send reset link" })).toBeVisible();
    await expect(page.locator(".login")).toHaveScreenshot("forgot-form.png");
  });

  test("after sending, the same answer whether or not there is an account", async ({ page }) => {
    await openSignedOut(page, "/", {
      routes: (p) => p.route("**/password-reset", (route) => route.fulfill({ status: 202, body: "" })),
    });
    await page.getByRole("button", { name: "Forgot your password?" }).click();
    await page.getByLabel("Email").fill("demo@example.com");
    await page.getByRole("button", { name: "Send reset link" }).click();

    await expect(page.getByText(/If there's an account for demo@example.com/)).toBeVisible();
    await expect(page.locator(".login")).toHaveScreenshot("forgot-sent.png");
  });
});

test.describe("reset link", () => {
  test("lands on the new-password form and leaves no token in the URL", async ({ page }) => {
    await openSignedOut(page, "/?reset=visual-reset-token");

    await expect(page.getByRole("heading", { name: "New password." })).toBeVisible();
    expect(new URL(page.url()).search).toBe("");
    await expect(page.locator(".login")).toHaveScreenshot("reset-form.png");
  });

  test("a spent link goes back to the request form with a reason", async ({ page }) => {
    await openSignedOut(page, "/?reset=visual-reset-token", {
      routes: (p) => p.route("**/password-reset/confirm", expired),
    });
    await page.getByLabel("New password", { exact: true }).fill("new-password");
    await page.getByLabel("Repeat new password").fill("new-password");
    await page.getByRole("button", { name: "Set password and log in" }).click();

    await expect(page.getByText(/That reset link has expired or was already used/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Send reset link" })).toBeVisible();
    await expect(page.locator(".login")).toHaveScreenshot("reset-expired.png");
  });

  test("a working link signs straight in and says what happened", async ({ page }) => {
    await openSignedOut(page, "/?reset=visual-reset-token", {
      routes: (p) =>
        p.route("**/password-reset/confirm", (route) =>
          route.fulfill({ json: { access_token: "visual-test-token", token_type: "bearer" } }),
        ),
    });
    await page.getByLabel("New password", { exact: true }).fill("new-password");
    await page.getByLabel("Repeat new password").fill("new-password");
    await page.getByRole("button", { name: "Set password and log in" }).click();

    await page.getByText("Netflix").first().waitFor();
    await expect(page.getByText("Password changed. Every other device has been signed out.")).toBeVisible();
  });
});

test.describe("confirmation link, signed out", () => {
  test("confirmed", async ({ page }) => {
    await openSignedOut(page, "/?verify=visual-verify-token", {
      routes: (p) =>
        p.route("**/verify-email", (route) => route.fulfill({ json: { email: "demo@example.com" } })),
    });

    await expect(page.getByText("demo@example.com is confirmed. Log in to continue.")).toBeVisible();
    await expect(page.getByLabel("Email")).toHaveValue("demo@example.com");
    await expect(page.locator(".login")).toHaveScreenshot("verify-signed-out.png");
  });

  test("expired", async ({ page }) => {
    await openSignedOut(page, "/?verify=visual-verify-token", {
      routes: (p) => p.route("**/verify-email", expired),
    });

    await expect(page.getByText(/That confirmation link has expired/)).toBeVisible();
    await expect(page.locator(".login")).toHaveScreenshot("verify-expired-signed-out.png");
  });
});

test.describe("unconfirmed address, signed in", () => {
  test("the nudge under the header, and sending the link again", async ({ page }) => {
    await openDashboard(page, "/", {
      me: { email_verified: false },
      routes: (p) => p.route("**/me/verification", (route) => route.fulfill({ status: 204 })),
    });

    const strip = page.locator(".email-strip");
    await expect(strip).toHaveScreenshot("nudge.png");

    await strip.getByRole("button", { name: "Send the link again" }).click();
    await expect(strip).toContainText("Sent. Check demo@example.com");
    await expect(strip).toHaveScreenshot("nudge-sent.png");
  });

  test("dismissing the nudge sticks across a reload", async ({ page }) => {
    await openDashboard(page, "/", { me: { email_verified: false } });
    await page.locator(".email-strip").getByRole("button", { name: "Dismiss" }).click();
    await expect(page.locator(".email-strip")).toHaveCount(0);

    await page.reload();
    await page.getByText("Netflix").first().waitFor();
    await expect(page.locator(".email-strip")).toHaveCount(0);
  });

  test("the Account dialog keeps the status", async ({ page }) => {
    await openDashboard(page, "/", { me: { email_verified: false } });
    await page.getByRole("button", { name: /^Account/ }).click();

    const identity = page.getByRole("dialog", { name: "Account" }).locator(".account-identity");
    await expect(identity).toContainText("Not confirmed yet.");
    await expect(identity).toHaveScreenshot("account-unconfirmed.png");
  });

  test("a confirmation link opened while signed in", async ({ page }) => {
    let verified = false;
    await openDashboard(page, "/?verify=visual-verify-token", {
      routes: async (p) => {
        await p.route("**/verify-email", (route) => {
          verified = true;
          route.fulfill({ json: { email: "demo@example.com" } });
        });
        await p.route("**/me", (route) =>
          route.fulfill({ json: { email: "demo@example.com", email_verified: verified } }),
        );
      },
    });

    const strip = page.locator(".email-strip");
    await expect(strip).toContainText("demo@example.com is confirmed.");
    await expect(strip).toHaveScreenshot("verify-signed-in.png");
  });
});

test("a confirmed address shows no nudge", async ({ page }) => {
  await openDashboard(page, "/", { me: { email_verified: true } });
  await expect(page.locator(".email-strip")).toHaveCount(0);
});
