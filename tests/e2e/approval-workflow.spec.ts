import { expect, test, type Page } from "@playwright/test";

/**
 * End-to-end coverage of the one workflow the product's safety rests on:
 * an episode cannot reach a publishable state without a human approving it,
 * and approval is refused while sources or licences are outstanding.
 *
 * Requires a migrated + seeded database:
 *   npm run db:migrate && npm run db:seed
 */

const OWNER = { email: "owner@historia.local", password: "historia-dev" };
const EDITOR = { email: "editor@historia.local", password: "historia-dev" };

/**
 * Next injects an always-empty `role="alert"` route announcer at body level, so
 * a bare getByRole("alert") is ambiguous. Every alert we assert on is rendered
 * inside the page's <main>, which the announcer sits outside of.
 */
function blocker(page: Page) {
  return page.getByRole("main").getByRole("alert");
}

async function signIn(page: Page, user: { email: string; password: string }) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);
}

async function createEpisode(page: Page, title: string) {
  await page.goto("/episodes/new");
  await page.getByLabel("Title", { exact: true }).fill(title);
  await page.getByRole("button", { name: "Create episode" }).click();
  await expect(page).toHaveURL(/\/episodes\/[0-9a-f-]{36}/);
  return page.url();
}

test.describe("episode approval workflow", () => {
  test("redirects an anonymous visitor to sign in", async ({ page }) => {
    await page.goto("/episodes");
    await expect(page).toHaveURL(/\/login/);
  });

  test("a new episode cannot be submitted without a script and scenes", async ({ page }) => {
    await signIn(page, OWNER);
    await createEpisode(page, `Test — empty episode ${Date.now()}`);

    await page.getByRole("button", { name: "Submit for review" }).click();

    await expect(blocker(page)).toContainText("blocked");
    await expect(blocker(page)).toContainText("script");
  });

  test("an episode moves draft → review → approved only when it is complete", async ({ page }) => {
    await signIn(page, OWNER);
    const episodeUrl = await createEpisode(page, `Test — full workflow ${Date.now()}`);

    // 1. Script — saving creates an immutable version.
    await page.goto(`${episodeUrl}?tab=script`);
    await page
      .getByLabel("Script", { exact: true })
      .fill("Placeholder narration for the end-to-end test. ".repeat(40));
    await page.getByRole("button", { name: "Save new version" }).click();
    await expect(page.getByRole("status")).toContainText("version 1");

    // 2. A scene.
    await page.goto(`${episodeUrl}?tab=scenes`);
    await page.getByLabel("Heading", { exact: true }).fill("Opening");
    await page.getByRole("button", { name: "Add scene" }).click();
    await expect(page.getByRole("status")).toContainText("Scene added");

    // 3. Submitting now succeeds.
    await page.goto(episodeUrl);
    await page.getByRole("button", { name: "Submit for review" }).click();
    await expect(page.getByRole("status")).toContainText("in review");

    // 4. Approval is refused: no source has been verified yet.
    await page.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(blocker(page)).toContainText("verified");

    // 5. Add a source and verify it.
    await page.goto(`${episodeUrl}?tab=sources`);
    await page.getByLabel("Full citation").fill("Placeholder citation for the automated test.");
    await page.getByRole("button", { name: "Add source" }).click();
    await expect(page.getByRole("status")).toContainText("Source added");

    const verificationSelect = page.locator('select[name="verification"]').first();
    await verificationSelect.selectOption("verified");
    await page.getByRole("button", { name: "Set" }).first().click();

    // 6. Approval now succeeds and pins the script version.
    await page.goto(episodeUrl);
    await page.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("approved");
    await expect(page.getByText(/Approved: script version 1/)).toBeVisible();
  });

  test("editing an approved script withdraws the approval", async ({ page }) => {
    await signIn(page, OWNER);
    const episodeUrl = await createEpisode(page, `Test — approval withdrawal ${Date.now()}`);

    await page.goto(`${episodeUrl}?tab=script`);
    await page.getByLabel("Script", { exact: true }).fill("First draft. ".repeat(60));
    await page.getByRole("button", { name: "Save new version" }).click();

    await page.goto(`${episodeUrl}?tab=scenes`);
    await page.getByLabel("Heading", { exact: true }).fill("Only scene");
    await page.getByRole("button", { name: "Add scene" }).click();

    await page.goto(`${episodeUrl}?tab=sources`);
    await page.getByLabel("Full citation").fill("Placeholder citation.");
    await page.getByRole("button", { name: "Add source" }).click();
    await page.locator('select[name="verification"]').first().selectOption("verified");
    await page.getByRole("button", { name: "Set" }).first().click();

    await page.goto(episodeUrl);
    await page.getByRole("button", { name: "Submit for review" }).click();
    await page.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(page.getByText(/Approved: script version/)).toBeVisible();

    // Changing the script must revoke the approval, not silently keep it.
    await page.goto(`${episodeUrl}?tab=script`);
    await page.getByLabel("Script", { exact: true }).fill("Rewritten draft. ".repeat(60));
    await page.getByRole("button", { name: "Save new version" }).click();
    await expect(page.getByRole("status")).toContainText("approval was withdrawn");

    await page.goto(episodeUrl);
    await expect(page.getByText("Draft", { exact: true })).toBeVisible();
    await expect(page.getByText(/Approved: script version/)).toBeHidden();
  });

  test("an editor cannot approve", async ({ page }) => {
    await signIn(page, OWNER);
    const episodeUrl = await createEpisode(page, `Test — role gate ${Date.now()}`);

    await page.goto(`${episodeUrl}?tab=script`);
    await page.getByLabel("Script", { exact: true }).fill("Draft text. ".repeat(60));
    await page.getByRole("button", { name: "Save new version" }).click();

    await page.goto(`${episodeUrl}?tab=scenes`);
    await page.getByLabel("Heading", { exact: true }).fill("Scene one");
    await page.getByRole("button", { name: "Add scene" }).click();

    await page.goto(episodeUrl);
    await page.getByRole("button", { name: "Submit for review" }).click();
    await signOut(page);

    await signIn(page, EDITOR);
    await page.goto(episodeUrl);
    await expect(page.getByText("Approve — needs an owner or reviewer.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve", exact: true })).toBeHidden();
  });
});
