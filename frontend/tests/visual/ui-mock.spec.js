import { expect, test } from "@playwright/test";

test("published UI mock uses the app and updates sample figures", async ({ page }) => {
  test.skip(test.info().project.name === "mobile", "Desktop add form flow");
  const externalApiRequests = [];
  page.on("request", (request) => {
    if (request.url().includes(":8000/")) externalApiRequests.push(request.url());
  });
  await page.addInitScript(() => localStorage.setItem("token", "real-dev-token"));

  await page.goto("/ui.html");
  await expect(page.getByText("Current UI mock")).toBeVisible();
  await expect(page.locator(".hero-total")).toHaveText("€25.98");
  expect(await page.evaluate(() => localStorage.getItem("token"))).toBe("real-dev-token");
  await expect(page.getByText("Netflix").first()).toBeVisible();

  await page.getByRole("button", { name: "Yearly" }).click();
  await expect(page.getByText("Annual spend · 2026")).toBeVisible();
  await page.getByRole("button", { name: "Monthly" }).click();

  const form = page.locator("#add");
  await form.getByRole("textbox", { name: "Service" }).fill("Test plan");
  await form.getByRole("spinbutton", { name: "Cost" }).fill("4.50");
  await form.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.locator(".hero-total")).toHaveText("€30.48");
  await expect(page.getByText("Test plan").first()).toBeVisible();
  await page.getByRole("button", { name: "Reset sample" }).click();
  await expect(page.locator(".hero-total")).toHaveText("€25.98");
  expect(externalApiRequests).toEqual([]);
});

test("mobile mock opens the real add sheet", async ({ page }) => {
  test.skip(test.info().project.name !== "mobile", "Mobile sheet flow");
  await page.goto("/ui.html");
  await expect(page.locator(".hero-total")).toHaveText("€25.98");

  await page.locator(".mobile-action-bar").getByRole("button", { name: "Add subscription" }).click();
  const sheet = page.getByRole("dialog", { name: "Add a subscription" });
  await expect(sheet).toBeVisible();
  await sheet.getByRole("textbox", { name: "Service" }).fill("Test plan");
  await sheet.getByRole("spinbutton", { name: "Cost" }).fill("4.50");
  await sheet.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.locator(".hero-total")).toHaveText("€30.48");
  await expect(sheet).not.toBeVisible();
});
