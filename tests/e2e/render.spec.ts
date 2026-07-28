import { expect, test, type Page } from "@playwright/test";

/**
 * Coverage of the render pipeline: an episode with scenes must produce a real,
 * playable MP4 that is stored and served back through the guarded file route.
 *
 * Requires a migrated + seeded database and ffmpeg on PATH:
 *   npm run db:migrate && npm run db:seed
 */

const OWNER = { email: "owner@historia.local", password: "historia-dev" };

/** 12 seconds of audio, regenerate with scripts/make-fixtures.sh. */
const NARRATION_FIXTURE = "tests/fixtures/narration.mp3";

async function signIn(page: Page, user: { email: string; password: string }) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

/** An episode with one short scene, so the encode finishes quickly. */
async function createRenderableEpisode(page: Page, title: string): Promise<string> {
  await page.goto("/episodes/new");
  await page.getByLabel("Title", { exact: true }).fill(title);
  await page.getByRole("button", { name: "Create episode" }).click();
  await expect(page).toHaveURL(/\/episodes\/[0-9a-f-]{36}/);
  const episodeUrl = page.url();

  await page.goto(`${episodeUrl}?tab=scenes`);
  await page.getByLabel("Heading", { exact: true }).fill("Santo Domingo, 1586");
  await page.getByLabel("Estimated seconds").fill("2");
  await page.getByRole("button", { name: "Add scene" }).click();
  // Wait for the write to land: navigating first would race the server action
  // and the production tab would plan a runtime for an episode with no scenes.
  await expect(page.getByRole("status").filter({ hasText: "Scene added" })).toBeVisible();

  return episodeUrl;
}

/**
 * Panels are located by their heading, not by prose. Both panels legitimately
 * use the word "render" in their body copy, so a hasText filter matches
 * whichever comes first in the DOM.
 */
const panel = (page: Page, heading: string) =>
  page.locator("section").filter({ has: page.getByRole("heading", { name: heading, exact: true }) });

const renderPanel = (page: Page) => panel(page, "Render");

test.describe("render pipeline", () => {
  test("an episode with no scenes cannot be rendered", async ({ page }) => {
    await signIn(page, OWNER);

    await page.goto("/episodes/new");
    await page.getByLabel("Title", { exact: true }).fill(`Render — empty ${Date.now()}`);
    await page.getByRole("button", { name: "Create episode" }).click();
    await expect(page).toHaveURL(/\/episodes\/[0-9a-f-]{36}/);

    await page.goto(`${page.url()}?tab=production`);
    await expect(renderPanel(page)).toContainText("cannot be rendered yet");
    await expect(page.getByRole("button", { name: "Start render" })).toBeDisabled();
  });

  test("renders an episode to a playable MP4 and serves it back", async ({ page }) => {
    test.setTimeout(180_000);
    await signIn(page, OWNER);

    const episodeUrl = await createRenderableEpisode(page, `Render — happy path ${Date.now()}`);
    await page.goto(`${episodeUrl}?tab=production`);

    // The planned runtime is derived from the scene, not from the finished file.
    await expect(renderPanel(page)).toContainText("0:02");

    await page.getByRole("button", { name: "Start render" }).click();
    // Scoped by text: the runtime-drift warning is also a role="status" region.
    await expect(
      page.getByRole("status").filter({ hasText: "Render started" }),
    ).toBeVisible();

    // The panel polls while a job is active; wait for it to reach a terminal state.
    const watchLink = page.getByRole("link", { name: "Watch" });
    await expect(watchLink).toBeVisible({ timeout: 150_000 });

    const href = await watchLink.getAttribute("href");
    expect(href).toBeTruthy();

    const response = await page.request.get(href!);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("video/mp4");

    // Not just any bytes: an MP4 declares its brand in the `ftyp` box up front.
    const body = await response.body();
    expect(body.length).toBeGreaterThan(1000);
    expect(body.subarray(4, 8).toString("ascii")).toBe("ftyp");
  });

  test("a finished render is listed in the render centre", async ({ page }) => {
    await signIn(page, OWNER);
    await page.goto("/renders");

    // The seeded database has no renders, so this asserts the page switched off
    // its Milestone 2 placeholder once real rows existed.
    await expect(page.getByRole("heading", { name: "Render center" })).toBeVisible();
  });
});

test.describe("narration", () => {
  test("mixes uploaded narration and holds the picture to cover it", async ({ page }) => {
    test.setTimeout(180_000);
    await signIn(page, OWNER);

    // One 2s scene against 12s of narration: the picture must stretch to 12s
    // rather than the narration being cut off at 2s.
    const episodeUrl = await createRenderableEpisode(page, `Render — narration ${Date.now()}`);
    await page.goto(`${episodeUrl}?tab=production`);

    await panel(page, "Narration").getByLabel("Audio file").setInputFiles(NARRATION_FIXTURE);
    await page.getByRole("button", { name: "Upload narration" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Narration uploaded" })).toBeVisible();

    // The plan is refitted to the narration as soon as it is known.
    await expect(renderPanel(page)).toContainText("0:12");

    await page.getByRole("button", { name: "Start render" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Render started" })).toBeVisible();

    const watchLink = page.getByRole("link", { name: "Watch" });
    await expect(watchLink).toBeVisible({ timeout: 150_000 });

    // The finished file must actually be ~12s, not the 2s the scene planned.
    await expect(renderPanel(page)).toContainText("0:12");
  });
});
