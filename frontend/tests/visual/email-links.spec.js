import { expect, test } from "@playwright/test";
import { openDashboard, openSignedOut } from "./mocks";

// PLAN.md milestone 9: forgot password, the reset screen, what a
// confirmation link did, and the "check your inbox" screens open signup
// added. Each state gets a baseline at both viewports, because the sign-in
// screen and the strip under the header both change layout at 760px.

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

test.describe("confirmation link, signed in", () => {
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

  // #117: the link was for an account someone else just made, opened in a
  // browser signed in as demo@example.com.
  test("a confirmation link for another account", async ({ page }) => {
    await openDashboard(page, "/?verify=visual-verify-token", {
      routes: async (p) => {
        await p.route("**/verify-email", (route) =>
          route.fulfill({ json: { email: "other@example.com" } }),
        );
        await p.route("**/me", (route) =>
          route.fulfill({ json: { email: "demo@example.com", email_verified: true } }),
        );
      },
    });

    await expect(page.locator(".email-strip")).toContainText(
      "other@example.com is confirmed. You're signed in as demo@example.com; log out to log in as other@example.com.",
    );
  });
});

test.describe("signing up and confirming", () => {
  // Open signup: an account can't sign in until its address is confirmed.

  test("signing up has no invite code, and ends on check your inbox", async ({ page }) => {
    await openSignedOut(page, "/", {
      routes: (p) => p.route("**/register", (route) => route.fulfill({ status: 202, body: "" })),
    });
    await page.getByRole("button", { name: "Need an account? Sign up" }).click();
    await expect(page.getByLabel("Invite code")).toHaveCount(0);

    await page.getByLabel("Email").fill("new@example.com");
    await page.getByLabel("Password").fill("password123");
    await page.getByRole("button", { name: "Sign up" }).click();

    await expect(page.getByText(/We've emailed new@example.com/)).toBeVisible();
    await expect(page.locator(".login")).toHaveScreenshot("signup-check-inbox.png");
  });

  test("an unconfirmed sign-in is asked to confirm, and can send the link again", async ({ page }) => {
    let resent = null;
    await openSignedOut(page, "/", {
      routes: async (p) => {
        await p.route("**/token", (route) =>
          route.fulfill({ status: 403, json: { detail: "email_not_verified" } }),
        );
        await p.route("**/verification", (route) => {
          resent = route.request().postDataJSON();
          route.fulfill({ status: 204 });
        });
      },
    });
    await page.getByLabel("Email").fill("new@example.com");
    await page.getByLabel("Password").fill("password123");
    await page.getByRole("button", { name: "Log in" }).click();

    await expect(page.getByText("Confirm new@example.com before you log in.", { exact: false })).toBeVisible();
    await expect(page.locator(".login")).toHaveScreenshot("confirm-first.png");

    await page.getByRole("button", { name: "Send the link again" }).click();
    await expect(page.getByText("Sent. Check new@example.com")).toBeVisible();
    expect(resent).toEqual({ email: "new@example.com", password: "password123" });

    await page.getByRole("button", { name: "Back to log in" }).click();
    await expect(page.getByLabel("Email")).toHaveValue("new@example.com");
  });
});
