import { expect, test, type Page } from "@playwright/test";

/**
 * Coverage of the upload path: a file must reach storage, be described by a row,
 * be readable back only by a signed-in user, and be refused when it does not
 * match the declared kind.
 *
 * Requires a migrated + seeded database:
 *   npm run db:migrate && npm run db:seed
 */

const OWNER = { email: "owner@historia.local", password: "historia-dev" };

async function signIn(page: Page, user: { email: string; password: string }) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

/** The upload form, scoped so its fields cannot be confused with the filter bar. */
function uploadForm(page: Page) {
  return page.locator("section").filter({ hasText: "Upload an asset" });
}

test.describe("asset uploads", () => {
  test("the upload form's Kind control is the one its label points at", async ({ page }) => {
    // Regression: the filter bar and the upload form both used id="kind", so the
    // label bound to the filter and uploads silently kept the default kind.
    await signIn(page, OWNER);
    await page.goto("/assets");

    const uploadKind = uploadForm(page).getByLabel("Kind", { exact: true });
    await expect(uploadKind).toHaveCount(1);

    // Each label must point at its own control. The filter's select carries an
    // "All kinds" option; the upload form's does not — so if the upload form's
    // label resolves to a select with an empty-valued option, the ids collide.
    await expect(uploadKind.locator('option[value=""]')).toHaveCount(0);
    await expect(uploadKind).toHaveValue("image");

    const ids = await page.locator("[id]").evaluateAll((nodes) => nodes.map((n) => n.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("uploads a file, stores it, and warns when no licence is attached", async ({ page }) => {
    await signIn(page, OWNER);
    await page.goto("/assets");

    const title = `E2E upload ${Date.now()}`;
    const body = "end-to-end upload payload";

    await uploadForm(page).getByLabel("Title", { exact: true }).fill(title);
    await uploadForm(page).getByLabel("Kind", { exact: true }).selectOption("document");
    await uploadForm(page).getByLabel("File", { exact: true }).setInputFiles({
      name: "citation-notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(body),
    });
    await page.getByRole("button", { name: "Upload asset" }).click();

    // An asset with no licence must say plainly that it will block approval.
    await expect(page.getByRole("status")).toContainText("licence");

    const row = page.getByRole("row").filter({ hasText: title });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("No licence");
    await expect(row).toContainText("document");

    // The stored object is readable back through the guarded route.
    const href = await row.getByRole("link", { name: "Open" }).getAttribute("href");
    expect(href).toBeTruthy();
    const response = await page.request.get(href!);
    expect(response.status()).toBe(200);
    expect(await response.text()).toBe(body);
  });

  test("refuses a file whose extension does not match the declared kind", async ({ page }) => {
    await signIn(page, OWNER);
    await page.goto("/assets");

    await uploadForm(page).getByLabel("Title", { exact: true }).fill(`E2E bad extension ${Date.now()}`);
    await uploadForm(page).getByLabel("Kind", { exact: true }).selectOption("image");
    await uploadForm(page).getByLabel("File", { exact: true }).setInputFiles({
      name: "not-an-image.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("nope"),
    });
    await page.getByRole("button", { name: "Upload asset" }).click();

    await expect(uploadForm(page)).toContainText("must be one of");
  });

  test("refuses to serve a path with no matching asset row", async ({ page }) => {
    await signIn(page, OWNER);

    const response = await page.request.get("/api/files/library/shared/document/no-such-file.txt", {
      maxRedirects: 0,
    });
    expect(response.status()).toBe(404);
  });

  test("requires a session to read an uploaded object", async ({ page, context }) => {
    await signIn(page, OWNER);
    await page.goto("/assets");

    const title = `E2E session guard ${Date.now()}`;
    await uploadForm(page).getByLabel("Title", { exact: true }).fill(title);
    await uploadForm(page).getByLabel("Kind", { exact: true }).selectOption("document");
    await uploadForm(page).getByLabel("File", { exact: true }).setInputFiles({
      name: "guarded.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("guarded payload"),
    });
    await page.getByRole("button", { name: "Upload asset" }).click();

    const row = page.getByRole("row").filter({ hasText: title });
    const href = await row.getByRole("link", { name: "Open" }).getAttribute("href");
    expect(href).toBeTruthy();

    await context.clearCookies();
    const response = await page.request.get(href!, { maxRedirects: 0 });
    expect(response.status()).toBe(307);
    expect(response.headers()["location"]).toContain("/login");
  });
});
