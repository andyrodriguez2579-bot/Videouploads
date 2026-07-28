-- Bilingual episodes (Spanish + English) and per-series duration targets.
--
-- Decision: a translation is its OWN episode row, not a language column on a
-- shared row. Reasons:
--   * Each language needs its own human approval — a translation can be wrong
--     in ways the original is not, and the approval gate must be per-language.
--   * Script versions, narration, captions and renders differ per language, and
--     all of those already hang off episode_id.
--   * Scenes may legitimately diverge (an idiom that needs two scenes in one
--     language and one in the other).
-- The two rows are linked by translation_of_id so the UI can show them together.

-- ---------------------------------------------------------------------------
-- series: duration targets
-- ---------------------------------------------------------------------------
-- Targets are advisory, not enforced: they drive a warning in the review panel
-- when the scene plan drifts outside the window, and will size the Remotion
-- compositions in Milestone 2.
ALTER TABLE series
  ADD COLUMN long_form_target_min_seconds  INTEGER NOT NULL DEFAULT 240,
  ADD COLUMN long_form_target_max_seconds  INTEGER NOT NULL DEFAULT 360,
  ADD COLUMN short_form_target_min_seconds INTEGER NOT NULL DEFAULT 50,
  ADD COLUMN short_form_target_max_seconds INTEGER NOT NULL DEFAULT 90;

ALTER TABLE series
  ADD CONSTRAINT series_long_form_window_valid
    CHECK (long_form_target_min_seconds > 0
           AND long_form_target_max_seconds >= long_form_target_min_seconds),
  ADD CONSTRAINT series_short_form_window_valid
    CHECK (short_form_target_min_seconds > 0
           AND short_form_target_max_seconds >= short_form_target_min_seconds);

-- ---------------------------------------------------------------------------
-- episodes: translation linkage
-- ---------------------------------------------------------------------------
-- NULL translation_of_id = an original. Non-NULL = a translation of that row.
ALTER TABLE episodes
  ADD COLUMN translation_of_id UUID REFERENCES episodes(id) ON DELETE SET NULL;

-- At most one translation per language per original.
CREATE UNIQUE INDEX episodes_translation_language_key
  ON episodes (translation_of_id, language)
  WHERE translation_of_id IS NOT NULL;

CREATE INDEX episodes_translation_of_idx ON episodes (translation_of_id);

-- A translation may not itself be translated: keep the graph one level deep so
-- "the original" is always unambiguous.
ALTER TABLE episodes
  ADD CONSTRAINT episodes_translation_not_self
    CHECK (translation_of_id IS NULL OR translation_of_id <> id);

-- ---------------------------------------------------------------------------
-- episodes: which cut this row is for
-- ---------------------------------------------------------------------------
-- The series produces a 4–6 minute YouTube cut and 50–90 second social bites.
-- Shorts are derived from the long-form timeline in Milestone 2 (renders.kind =
-- 'short_form'), so this column records the intent of the episode itself.
ALTER TABLE episodes
  ADD COLUMN primary_format TEXT NOT NULL DEFAULT 'long_form'
    CHECK (primary_format IN ('long_form', 'short_form'));

-- Existing rows keep the default; the seed sets targets explicitly.
UPDATE episodes SET target_duration_seconds = 300 WHERE target_duration_seconds IS NULL;
