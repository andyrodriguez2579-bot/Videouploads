/**
 * Seeds a local owner account, the series, and one demo episode.
 *
 * IMPORTANT: every piece of editorial content created here is PLACEHOLDER
 * scaffolding, marked as such in the text itself. No historical claim, citation
 * or licence in this file should be treated as researched or verified — the
 * point is to exercise the workflow, not to supply facts. Replace it all.
 *
 *   npm run db:seed
 */
import { createHash } from "node:crypto";

import "dotenv/config";
import bcrypt from "bcryptjs";
import postgres from "postgres";

const PLACEHOLDER = "[PLACEHOLDER — replace before any real production use]";

const SCRIPT_BODY = `# ${PLACEHOLDER} Episode 1 — Working title

> This script is demo scaffolding created by \`npm run db:seed\`. It contains no
> researched historical content. Delete it and paste your approved script.

## Cold open

${PLACEHOLDER} Opening narration goes here. Two or three sentences that set the
period and the question the episode answers.

## Segment 1 — Setting the scene

${PLACEHOLDER} Narration. Each factual claim in the finished script should have a
matching entry on the Sources tab, and each scene should cite at least one of
them before the episode is submitted for review.

## Segment 2 — The turn

${PLACEHOLDER} Narration.

## Close

${PLACEHOLDER} Closing narration, then the source-credits card.
`;

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set. Copy .env.example to .env first.");
    process.exit(1);
  }

  const sql = postgres(url, { max: 1 });

  try {
    const ownerEmail = process.env.SEED_OWNER_EMAIL ?? "owner@historia.local";
    const ownerPassword = process.env.SEED_OWNER_PASSWORD ?? "historia-dev";
    const passwordHash = await bcrypt.hash(ownerPassword, 12);

    const [owner] = await sql<{ id: string }[]>`
      insert into users (email, display_name, password_hash, auth_provider, role)
      values (${ownerEmail}, 'Series Owner', ${passwordHash}, 'local', 'owner')
      on conflict (email) do update
        set display_name = excluded.display_name,
            password_hash = excluded.password_hash,
            role = 'owner'
      returning id
    `;
    const ownerId = owner!.id;

    // A second account demonstrates the editor/approver split: an editor can
    // prepare an episode but cannot sign it off.
    await sql`
      insert into users (email, display_name, password_hash, auth_provider, role)
      values ('editor@historia.local', 'Staff Editor',
              ${await bcrypt.hash("historia-dev", 12)}, 'local', 'editor')
      on conflict (email) do nothing
    `;

    // Duration windows: a 4–6 minute YouTube cut, and 50–90 second social bites.
    const [series] = await sql<{ id: string }[]>`
      insert into series (
        slug, title, description, language, default_attribution, created_by,
        long_form_target_min_seconds, long_form_target_max_seconds,
        short_form_target_min_seconds, short_form_target_max_seconds
      )
      values (
        'historia-of-dominicana',
        'Historia of Dominicana',
        ${`${PLACEHOLDER} Documentary series covering the history of the Dominican Republic from its earliest period to the present. Produced in Spanish and English.`},
        'es',
        ${`${PLACEHOLDER} Series attribution line`},
        ${ownerId},
        240, 360, 50, 90
      )
      on conflict (slug) do update set
        title = excluded.title,
        long_form_target_min_seconds = excluded.long_form_target_min_seconds,
        long_form_target_max_seconds = excluded.long_form_target_max_seconds,
        short_form_target_min_seconds = excluded.short_form_target_min_seconds,
        short_form_target_max_seconds = excluded.short_form_target_max_seconds
      returning id
    `;
    const seriesId = series!.id;

    const existing = await sql<{ id: string }[]>`
      select id from episodes where series_id = ${seriesId} and slug = 'demo-episode-01'
    `;
    if (existing.length > 0) {
      console.log("Demo episode already present — leaving it untouched.");
      console.log(`Sign in as ${ownerEmail} / ${ownerPassword}`);
      return;
    }

    const [episode] = await sql<{ id: string }[]>`
      insert into episodes (
        series_id, episode_number, slug, title, synopsis, language, primary_format,
        period_label, narration_mode, caption_mode, scene_plan_mode, publish_mode,
        target_duration_seconds, created_by
      )
      values (
        ${seriesId}, 1, 'demo-episode-01',
        ${`${PLACEHOLDER} Demo Episode 1`},
        ${`${PLACEHOLDER} Synopsis. This episode exists to demonstrate the review workflow end to end.`},
        'es', 'long_form',
        ${`${PLACEHOLDER} Period label`},
        'upload', 'upload', 'manual', 'manual_upload',
        300, ${ownerId}
      )
      returning id
    `;
    const episodeId = episode!.id;

    const contentHash = createHash("sha256").update(SCRIPT_BODY, "utf8").digest("hex");
    const words = SCRIPT_BODY.split(/\s+/).filter(Boolean).length;

    await sql`
      insert into episode_versions (
        episode_id, version_number, title, script_body, script_format,
        word_count, content_hash, authorship, change_note, created_by
      )
      values (
        ${episodeId}, 1, ${`${PLACEHOLDER} Demo Episode 1`}, ${SCRIPT_BODY}, 'markdown',
        ${words}, ${contentHash}, 'human', 'Seeded placeholder script', ${ownerId}
      )
    `;

    // Two sources: one marked verified so the approval gate can be demonstrated,
    // one left unverified so the warning path is visible too. Both are openly
    // labelled placeholders — neither is a real citation.
    const [verifiedSource] = await sql<{ id: string }[]>`
      insert into research_sources (
        episode_id, citation, source_type, supports_claim, verification, verified_by, verified_at, notes
      )
      values (
        ${episodeId},
        ${`${PLACEHOLDER} Citation — replace with a real, checked reference (author, title, publisher, year, page).`},
        'secondary',
        ${`${PLACEHOLDER} The claim this source is supposed to support.`},
        'verified', ${ownerId}, now(),
        'Seeded as verified only so the approval gate can be demonstrated. Not a real source.'
      )
      returning id
    `;

    await sql`
      insert into research_sources (episode_id, citation, source_type, supports_claim, verification, notes)
      values (
        ${episodeId},
        ${`${PLACEHOLDER} A second citation, deliberately left unverified.`},
        'primary',
        ${`${PLACEHOLDER} A claim awaiting fact-check.`},
        'unverified',
        'Seeded unverified to show the reviewer warning.'
      )
    `;

    const scenes = [
      { heading: `${PLACEHOLDER} Opening title card`, template: "title_card", seconds: 8 },
      { heading: `${PLACEHOLDER} Setting the scene`, template: "archival_still", seconds: 95 },
      { heading: `${PLACEHOLDER} Where this happened`, template: "map_sequence", seconds: 40 },
      { heading: `${PLACEHOLDER} A contemporary voice`, template: "quote_card", seconds: 25 },
      { heading: `${PLACEHOLDER} The turn`, template: "archival_still", seconds: 120 },
      { heading: "Source credits", template: "source_credits", seconds: 15 },
      { heading: `${PLACEHOLDER} Closing card`, template: "outro_card", seconds: 10 },
    ];

    let position = 1;
    const sceneIds: string[] = [];
    for (const scene of scenes) {
      const [row] = await sql<{ id: string }[]>`
        insert into scenes (
          episode_id, position, heading, narration_text, visual_direction,
          template, estimated_seconds, is_ai_suggested, human_reviewed
        )
        values (
          ${episodeId}, ${position}, ${scene.heading},
          ${`${PLACEHOLDER} Narration for this scene.`},
          ${`${PLACEHOLDER} Visual direction: which still, map or motion this scene uses.`},
          ${scene.template}, ${scene.seconds}, false, true
        )
        returning id
      `;
      sceneIds.push(row!.id);
      position += 1;
    }

    // Cite the verified source on the first content scene so the demo episode
    // starts with at least one source-backed scene.
    if (sceneIds[1]) {
      await sql`
        insert into scene_sources (scene_id, source_id)
        values (${sceneIds[1]}, ${verifiedSource!.id})
        on conflict do nothing
      `;
    }

    // A licence record that is explicitly NOT cleared, so the owner can see the
    // approval blocker before attaching anything to it.
    await sql`
      insert into asset_licenses (
        name, license_type, is_cleared, requires_attribution, notes, created_by
      )
      values (
        ${`${PLACEHOLDER} Example licence record`},
        'unknown', false, true,
        'Seeded uncleared on purpose: an asset pointing at this licence will block approval.',
        ${ownerId}
      )
    `;

    // The English version of the same episode. It is a separate row with its own
    // approval; the scene skeleton and sources are copied, the script is not.
    const [translation] = await sql<{ id: string }[]>`
      insert into episodes (
        series_id, episode_number, slug, title, synopsis, language, primary_format,
        translation_of_id, period_label, narration_mode, caption_mode,
        scene_plan_mode, publish_mode, target_duration_seconds, created_by
      )
      values (
        ${seriesId}, 1, 'demo-episode-01-en',
        ${`${PLACEHOLDER} Demo Episode 1`},
        ${`${PLACEHOLDER} Synopsis, English version.`},
        'en', 'long_form', ${episodeId},
        ${`${PLACEHOLDER} Period label`},
        'upload', 'upload', 'manual', 'manual_upload',
        300, ${ownerId}
      )
      returning id
    `;
    const translationId = translation!.id;

    await sql`
      insert into research_sources (
        episode_id, citation, source_type, author, publisher, publication_year,
        url, archive_reference, supports_claim, page_reference, verification,
        verified_by, verified_at, notes
      )
      select ${translationId}, citation, source_type, author, publisher, publication_year,
             url, archive_reference, supports_claim, page_reference, verification,
             verified_by, verified_at, notes
      from research_sources where episode_id = ${episodeId}
    `;

    await sql`
      insert into scenes (
        episode_id, position, heading, on_screen_text, visual_direction,
        template, estimated_seconds, is_ai_suggested, human_reviewed, notes
      )
      select ${translationId}, position, heading, on_screen_text, visual_direction,
             template, estimated_seconds, false, true, notes
      from scenes where episode_id = ${episodeId}
    `;

    // A standalone social bite, to show the 50–90 second target window in use.
    const [short] = await sql<{ id: string }[]>`
      insert into episodes (
        series_id, episode_number, slug, title, synopsis, language, primary_format,
        period_label, narration_mode, caption_mode, scene_plan_mode, publish_mode,
        target_duration_seconds, created_by
      )
      values (
        ${seriesId}, 1, 'demo-short-01',
        ${`${PLACEHOLDER} Demo Social Bite 1`},
        ${`${PLACEHOLDER} A 50–90 second vertical cut.`},
        'es', 'short_form',
        ${`${PLACEHOLDER} Period label`},
        'upload', 'upload', 'manual', 'manual_upload',
        70, ${ownerId}
      )
      returning id
    `;

    await sql`
      insert into scenes (episode_id, position, heading, narration_text, template, estimated_seconds, human_reviewed)
      values
        (${short!.id}, 1, ${`${PLACEHOLDER} Hook`}, ${`${PLACEHOLDER} Narration.`}, 'title_card', 5, true),
        (${short!.id}, 2, ${`${PLACEHOLDER} The point`}, ${`${PLACEHOLDER} Narration.`}, 'archival_still', 55, true),
        (${short!.id}, 3, ${`${PLACEHOLDER} Close`}, ${`${PLACEHOLDER} Narration.`}, 'outro_card', 8, true)
    `;

    await sql`
      insert into audit_log (actor_id, actor_email, action, entity_type, entity_id, episode_id, summary)
      values (
        ${ownerId}, ${ownerEmail}, 'seed.create', 'episode', ${episodeId}, ${episodeId},
        'Seeded the demo episodes with placeholder content'
      )
    `;

    console.log("Seed complete.");
    console.log(`  Owner:  ${ownerEmail} / ${ownerPassword}   (can approve)`);
    console.log("  Editor: editor@historia.local / historia-dev   (cannot approve)");
    console.log("  Series: Historia of Dominicana — long form 4–6 min, shorts 50–90 s");
    console.log("  Episodes: Spanish demo (313 s planned) + its English version + one social bite.");
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error("Seed failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
