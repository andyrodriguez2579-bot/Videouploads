import { expect, test, type Page } from "@playwright/test";

/**
 * Coverage of browsing a Wikimedia Commons category and importing from it.
 *
 * This test talks to the live Commons API. That is deliberate: the thing worth
 * checking is that the app copes with what Commons actually returns, and a
 * mocked response would only confirm the fixture matches itself. It is skipped
 * when the network is unavailable rather than failing the suite.
 *
 * Requires a migrated + seeded database:
 *   npm run db:migrate && npm run db:seed
 */

const OWNER = { email: "owner@historia.local", password: "historia-dev" };

const CATEGORY_URL =
  "https://commons.wikimedia.org/wiki/Category:Historical_images_of_the_Dominican_Republic";

async function signIn(page: Page, user: { email: string; password: string }) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

/**
 * Located by heading. Locating by prose has bitten this suite before — the
 * single-URL import panel also contains the words "Commons" and "licence".
 */
function browser(page: Page) {
  return page.locator("section").filter({
    has: page.getByRole("heading", { name: "Browse a Commons category" }),
  });
}

test.describe("browsing a Commons category", () => {
  test("lists the files in a category with their licences", async ({ page }) => {
    await signIn(page, OWNER);
    await page.goto("/assets");

    const panel = browser(page);
    await expect(panel).toHaveCount(1);

    await panel.getByLabel("Category URL").fill(CATEGORY_URL);
    await panel.getByRole("button", { name: "Browse" }).click();

    const checkboxes = panel.locator('input[type="checkbox"][name="url"]');
    await expect(checkboxes.first()).toBeVisible({ timeout: 30_000 });
    expect(await checkboxes.count()).toBeGreaterThan(0);

    // Every file must show a licence, because that is the judgement the
    // person is being asked to make before ticking anything.
    const rows = panel.locator('li:has(input[type="checkbox"][name="url"])');
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i += 1) {
      await expect(rows.nth(i)).toContainText(/CC |Public domain|licence not stated/);
    }

    // Sub-categories are offered as links, never followed automatically.
    await expect(
      panel.getByRole("link", { name: "Historical images of Fortaleza Ozama" }),
    ).toBeVisible();
  });

  test("a category URL pasted into the single-file box says where it belongs", async ({ page }) => {
    await signIn(page, OWNER);
    await page.goto("/assets");

    const importPanel = page.locator("section").filter({
      has: page.getByRole("heading", { name: "Import from an archive" }),
    });

    await importPanel.getByLabel("Archive URL").fill(CATEGORY_URL);
    await importPanel.getByRole("button", { name: "Import" }).click();

    await expect(importPanel).toContainText("Browse a Commons category", { timeout: 30_000 });
  });

  test("imports a ticked file with an uncleared licence", async ({ page }) => {
    await signIn(page, OWNER);
    await page.goto("/assets");

    const panel = browser(page);
    await panel.getByLabel("Category URL").fill(CATEGORY_URL);
    await panel.getByRole("button", { name: "Browse" }).click();

    const first = panel.locator('input[type="checkbox"][name="url"]').first();
    await expect(first).toBeVisible({ timeout: 30_000 });
    await first.check();

    await panel.getByRole("button", { name: "Import selected" }).click();

    // The uncleared warning is the point of the whole import path.
    await expect(panel).toContainText("NOT cleared", { timeout: 60_000 });
  });
});
