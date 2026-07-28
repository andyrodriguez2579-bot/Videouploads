-- Historia Dominicana Studio — initial schema
--
-- Design notes:
--  * Status/enum-like columns are TEXT + CHECK rather than Postgres ENUM types.
--    Adding a value to a CHECK is a cheap migration; adding one to an ENUM in a
--    transaction is not. The workflow states are expected to grow (M2–M5).
--  * `details` JSONB columns hold platform-specific or provider-specific payloads
--    only. Anything the owner filters, sorts, or reviews on is a real column.
--  * Every table that a human can change is covered by audit_log.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------
CREATE TABLE users (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email          TEXT NOT NULL UNIQUE,
  display_name   TEXT NOT NULL,
  -- NULL when auth_provider = 'supabase' (no local password is ever stored).
  password_hash  TEXT,
  auth_provider  TEXT NOT NULL DEFAULT 'local'
                 CHECK (auth_provider IN ('local', 'supabase')),
  -- external_id maps to the Supabase auth.users id when that provider is on.
  external_id    TEXT UNIQUE,
  role           TEXT NOT NULL DEFAULT 'editor'
                 CHECK (role IN ('owner', 'editor', 'reviewer', 'viewer')),
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- series
-- ---------------------------------------------------------------------------
CREATE TABLE series (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug              TEXT NOT NULL UNIQUE,
  title             TEXT NOT NULL,
  description       TEXT,
  language          TEXT NOT NULL DEFAULT 'es',
  -- Branding used by the Remotion templates in Milestone 2.
  brand_primary     TEXT NOT NULL DEFAULT '#4338ca',
  brand_secondary   TEXT NOT NULL DEFAULT '#f7f4ed',
  default_attribution TEXT,
  created_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- episodes
-- ---------------------------------------------------------------------------
CREATE TABLE episodes (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  series_id          UUID NOT NULL REFERENCES series(id) ON DELETE CASCADE,
  episode_number     INTEGER,
  slug               TEXT NOT NULL,
  title              TEXT NOT NULL,
  synopsis           TEXT,
  language           TEXT NOT NULL DEFAULT 'es',

  -- Historical coverage window. Text, not dates: "c. 600 CE" has no ISO form.
  period_label       TEXT,
  period_start_year  INTEGER,
  period_end_year    INTEGER,

  status             TEXT NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft','in_review','approved','rejected',
                                       'scheduled','published','failed')),

  -- Per-episode production choices. Cost-control: 'upload' and 'local' cost $0.
  narration_mode     TEXT NOT NULL DEFAULT 'upload'
                     CHECK (narration_mode IN ('upload','local_tts','hosted_tts')),
  caption_mode       TEXT NOT NULL DEFAULT 'upload'
                     CHECK (caption_mode IN ('upload','local_asr','hosted_asr')),
  scene_plan_mode    TEXT NOT NULL DEFAULT 'manual'
                     CHECK (scene_plan_mode IN ('manual','ai_assisted')),
  publish_mode       TEXT NOT NULL DEFAULT 'manual_upload'
                     CHECK (publish_mode IN ('manual_upload','api')),

  -- Points at the episode_versions row the owner signed off on. Set on approve,
  -- cleared on any status move back to draft.
  approved_version_id UUID,
  approved_by         UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_at         TIMESTAMPTZ,
  rejection_reason    TEXT,

  target_duration_seconds INTEGER,
  created_by         UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (series_id, slug)
);

CREATE INDEX episodes_status_idx ON episodes (status);
CREATE INDEX episodes_series_idx ON episodes (series_id, episode_number);

-- ---------------------------------------------------------------------------
-- episode_versions — immutable snapshots of the script
-- ---------------------------------------------------------------------------
-- A row is written on every save of the script body. Rows are never UPDATEd
-- after creation; that is what makes an approved script provable after the fact.
CREATE TABLE episode_versions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id     UUID NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  title          TEXT NOT NULL,
  script_body    TEXT NOT NULL,
  script_format  TEXT NOT NULL DEFAULT 'markdown'
                 CHECK (script_format IN ('markdown','plaintext')),
  word_count     INTEGER NOT NULL DEFAULT 0,
  -- sha256 of script_body; lets the review screen prove the rendered script is
  -- byte-identical to the approved one.
  content_hash   TEXT NOT NULL,
  -- 'human' vs 'ai_draft' — surfaced in the UI so AI text is never mistaken
  -- for owner-approved copy.
  authorship     TEXT NOT NULL DEFAULT 'human'
                 CHECK (authorship IN ('human','ai_draft','ai_edited')),
  ai_provider    TEXT,
  change_note    TEXT,
  created_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (episode_id, version_number)
);

ALTER TABLE episodes
  ADD CONSTRAINT episodes_approved_version_fk
  FOREIGN KEY (approved_version_id) REFERENCES episode_versions(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- research_sources
-- ---------------------------------------------------------------------------
CREATE TABLE research_sources (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id        UUID NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  citation          TEXT NOT NULL,
  source_type       TEXT NOT NULL DEFAULT 'secondary'
                    CHECK (source_type IN ('primary','secondary','tertiary','archive','interview','other')),
  author            TEXT,
  publisher         TEXT,
  publication_year  INTEGER,
  url               TEXT,
  archive_reference TEXT,
  -- The claim in the script this source backs up.
  supports_claim    TEXT,
  page_reference    TEXT,
  -- Fact-check state is deliberately explicit: 'unverified' is the default so
  -- an unchecked claim can never look verified.
  verification      TEXT NOT NULL DEFAULT 'unverified'
                    CHECK (verification IN ('unverified','verified','disputed','rejected')),
  verified_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  verified_at       TIMESTAMPTZ,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX research_sources_episode_idx ON research_sources (episode_id);

-- ---------------------------------------------------------------------------
-- asset_licenses
-- ---------------------------------------------------------------------------
CREATE TABLE asset_licenses (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name               TEXT NOT NULL,
  license_type       TEXT NOT NULL
                     CHECK (license_type IN ('public_domain','cc0','cc_by','cc_by_sa',
                                             'rights_managed','royalty_free','editorial_only',
                                             'owner_created','permission_granted','unknown')),
  -- Held false until someone records real proof. Assets whose license is not
  -- cleared are blocked from an episode approval.
  is_cleared         BOOLEAN NOT NULL DEFAULT FALSE,
  requires_attribution BOOLEAN NOT NULL DEFAULT TRUE,
  attribution_text   TEXT,
  rights_holder      TEXT,
  source_url         TEXT,
  license_url        TEXT,
  -- Storage key of the receipt / permission email / license PDF.
  proof_object_key   TEXT,
  valid_from         DATE,
  valid_until        DATE,
  territory          TEXT,
  notes              TEXT,
  created_by         UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- media_assets
-- ---------------------------------------------------------------------------
CREATE TABLE media_assets (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL episode_id = shared library asset reusable across the series.
  episode_id     UUID REFERENCES episodes(id) ON DELETE SET NULL,
  license_id     UUID REFERENCES asset_licenses(id) ON DELETE SET NULL,
  kind           TEXT NOT NULL
                 CHECK (kind IN ('image','video','audio','music','map','document','font','other')),
  title          TEXT NOT NULL,
  description    TEXT,
  storage_driver TEXT NOT NULL DEFAULT 'local'
                 CHECK (storage_driver IN ('local','s3')),
  object_key     TEXT NOT NULL,
  mime_type      TEXT,
  byte_size      BIGINT,
  checksum_sha256 TEXT,
  width          INTEGER,
  height         INTEGER,
  duration_seconds NUMERIC(10,3),
  credit_line    TEXT,
  tags           TEXT[] NOT NULL DEFAULT '{}',
  details        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX media_assets_episode_idx ON media_assets (episode_id);
CREATE INDEX media_assets_kind_idx ON media_assets (kind);

-- ---------------------------------------------------------------------------
-- scenes
-- ---------------------------------------------------------------------------
CREATE TABLE scenes (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id        UUID NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  position          INTEGER NOT NULL,
  heading           TEXT NOT NULL,
  narration_text    TEXT,
  on_screen_text    TEXT,
  visual_direction  TEXT,
  -- Remotion template id, resolved in Milestone 2.
  template          TEXT NOT NULL DEFAULT 'archival_still'
                    CHECK (template IN ('title_card','archival_still','map_sequence',
                                        'lower_third','quote_card','source_credits','outro_card')),
  estimated_seconds NUMERIC(8,2),
  start_seconds     NUMERIC(10,3),
  -- Set when a scene is proposed by an AI provider (M3). Blocks approval until
  -- a human clears it.
  is_ai_suggested   BOOLEAN NOT NULL DEFAULT FALSE,
  ai_provider       TEXT,
  human_reviewed    BOOLEAN NOT NULL DEFAULT FALSE,
  notes             TEXT,
  details           JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (episode_id, position) DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX scenes_episode_idx ON scenes (episode_id, position);

-- Which assets appear in which scene, and in what order.
CREATE TABLE scene_assets (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scene_id   UUID NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
  asset_id   UUID NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
  position   INTEGER NOT NULL DEFAULT 0,
  role       TEXT NOT NULL DEFAULT 'primary'
             CHECK (role IN ('primary','background','overlay','map','music','sfx')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (scene_id, asset_id, role)
);

-- Which sources back which scene. This is the join that lets the review screen
-- show "this scene is source-backed" vs "this scene has no citation".
CREATE TABLE scene_sources (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scene_id   UUID NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
  source_id  UUID NOT NULL REFERENCES research_sources(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (scene_id, source_id)
);

-- ---------------------------------------------------------------------------
-- voiceovers
-- ---------------------------------------------------------------------------
CREATE TABLE voiceovers (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id       UUID NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  -- NULL = full-episode narration; set = per-scene narration.
  scene_id         UUID REFERENCES scenes(id) ON DELETE CASCADE,
  source           TEXT NOT NULL DEFAULT 'upload'
                   CHECK (source IN ('upload','local_tts','hosted_tts')),
  provider         TEXT,
  voice_id         TEXT,
  language         TEXT NOT NULL DEFAULT 'es',
  storage_driver   TEXT NOT NULL DEFAULT 'local'
                   CHECK (storage_driver IN ('local','s3')),
  object_key       TEXT,
  mime_type        TEXT,
  byte_size        BIGINT,
  duration_seconds NUMERIC(10,3),
  -- Post-FFmpeg loudness measurement (M2). NULL until normalised.
  loudness_lufs    NUMERIC(6,2),
  status           TEXT NOT NULL DEFAULT 'ready'
                   CHECK (status IN ('pending','processing','ready','failed')),
  error_message    TEXT,
  is_selected      BOOLEAN NOT NULL DEFAULT FALSE,
  details          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX voiceovers_episode_idx ON voiceovers (episode_id);

-- ---------------------------------------------------------------------------
-- captions
-- ---------------------------------------------------------------------------
CREATE TABLE captions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id     UUID NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  voiceover_id   UUID REFERENCES voiceovers(id) ON DELETE SET NULL,
  language       TEXT NOT NULL DEFAULT 'es',
  format         TEXT NOT NULL DEFAULT 'srt'
                 CHECK (format IN ('srt','vtt','json')),
  source         TEXT NOT NULL DEFAULT 'upload'
                 CHECK (source IN ('upload','local_asr','hosted_asr','manual')),
  provider       TEXT,
  storage_driver TEXT NOT NULL DEFAULT 'local'
                 CHECK (storage_driver IN ('local','s3')),
  object_key     TEXT,
  -- Inline copy for short caption files, so the review screen can diff them
  -- without a storage round-trip.
  content        TEXT,
  cue_count      INTEGER,
  status         TEXT NOT NULL DEFAULT 'ready'
                 CHECK (status IN ('pending','processing','ready','failed')),
  error_message  TEXT,
  human_reviewed BOOLEAN NOT NULL DEFAULT FALSE,
  is_selected    BOOLEAN NOT NULL DEFAULT FALSE,
  created_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX captions_episode_idx ON captions (episode_id);

-- ---------------------------------------------------------------------------
-- renders  (populated in Milestone 2; schema defined now so the model is stable)
-- ---------------------------------------------------------------------------
CREATE TABLE renders (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id       UUID NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  episode_version_id UUID REFERENCES episode_versions(id) ON DELETE SET NULL,
  kind             TEXT NOT NULL
                   CHECK (kind IN ('long_form','short_form','thumbnail','audio_master')),
  aspect_ratio     TEXT NOT NULL DEFAULT '16:9'
                   CHECK (aspect_ratio IN ('16:9','9:16','1:1')),
  template         TEXT,
  label            TEXT,
  status           TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','queued','running','succeeded','failed','cancelled')),
  storage_driver   TEXT NOT NULL DEFAULT 'local'
                   CHECK (storage_driver IN ('local','s3')),
  object_key       TEXT,
  mime_type        TEXT,
  byte_size        BIGINT,
  duration_seconds NUMERIC(10,3),
  width            INTEGER,
  height           INTEGER,
  -- Clip window for short-form cuts taken out of the long-form timeline.
  clip_start_seconds NUMERIC(10,3),
  clip_end_seconds   NUMERIC(10,3),
  human_reviewed   BOOLEAN NOT NULL DEFAULT FALSE,
  error_message    TEXT,
  details          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX renders_episode_idx ON renders (episode_id);
CREATE INDEX renders_status_idx ON renders (status);

-- ---------------------------------------------------------------------------
-- render_jobs  (BullMQ mirror; Milestone 2)
-- ---------------------------------------------------------------------------
CREATE TABLE render_jobs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  render_id      UUID NOT NULL REFERENCES renders(id) ON DELETE CASCADE,
  queue_name     TEXT NOT NULL DEFAULT 'renders',
  -- BullMQ job id. Unique so a re-enqueue cannot silently double-run.
  external_job_id TEXT UNIQUE,
  status         TEXT NOT NULL DEFAULT 'queued'
                 CHECK (status IN ('queued','running','succeeded','failed','cancelled','retrying')),
  attempt        INTEGER NOT NULL DEFAULT 0,
  max_attempts   INTEGER NOT NULL DEFAULT 3,
  progress       INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  stage          TEXT,
  log            TEXT,
  error_message  TEXT,
  started_at     TIMESTAMPTZ,
  finished_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX render_jobs_render_idx ON render_jobs (render_id);
CREATE INDEX render_jobs_status_idx ON render_jobs (status);

-- ---------------------------------------------------------------------------
-- social_accounts  (Milestone 4)
-- ---------------------------------------------------------------------------
CREATE TABLE social_accounts (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform             TEXT NOT NULL
                       CHECK (platform IN ('youtube','tiktok','instagram','facebook','linkedin','x')),
  account_label        TEXT NOT NULL,
  external_account_id  TEXT,
  handle               TEXT,
  -- Tokens are stored encrypted at rest (AES-256-GCM, key from TOKEN_ENCRYPTION_KEY).
  -- Plaintext tokens must never be written to these columns.
  access_token_encrypted  TEXT,
  refresh_token_encrypted TEXT,
  token_expires_at     TIMESTAMPTZ,
  scopes               TEXT[] NOT NULL DEFAULT '{}',
  connection_status    TEXT NOT NULL DEFAULT 'disconnected'
                       CHECK (connection_status IN ('disconnected','connected','expired','error','mock')),
  last_checked_at      TIMESTAMPTZ,
  last_error           TEXT,
  details              JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (platform, external_account_id)
);

-- ---------------------------------------------------------------------------
-- social_posts  (Milestone 4)
-- ---------------------------------------------------------------------------
CREATE TABLE social_posts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id        UUID NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  render_id         UUID REFERENCES renders(id) ON DELETE SET NULL,
  social_account_id UUID REFERENCES social_accounts(id) ON DELETE SET NULL,
  platform          TEXT NOT NULL
                    CHECK (platform IN ('youtube','tiktok','instagram','facebook','linkedin','x')),
  title             TEXT,
  body              TEXT,
  hashtags          TEXT[] NOT NULL DEFAULT '{}',
  privacy           TEXT NOT NULL DEFAULT 'private'
                    CHECK (privacy IN ('private','unlisted','public')),
  status            TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','in_review','approved','rejected',
                                      'scheduled','publishing','published','failed','cancelled')),
  -- Copy generated by an AI provider stays flagged until a human approves it.
  copy_authorship   TEXT NOT NULL DEFAULT 'human'
                    CHECK (copy_authorship IN ('human','ai_draft','ai_edited')),
  scheduled_for     TIMESTAMPTZ,
  published_at      TIMESTAMPTZ,
  external_post_id  TEXT,
  post_url          TEXT,
  approved_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_at       TIMESTAMPTZ,
  -- Stable key derived from (episode, platform, render, scheduled slot). The
  -- publisher refuses to send twice for the same key.
  idempotency_key   TEXT UNIQUE,
  last_error        TEXT,
  details           JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX social_posts_episode_idx ON social_posts (episode_id);
CREATE INDEX social_posts_schedule_idx ON social_posts (scheduled_for);
CREATE INDEX social_posts_status_idx ON social_posts (status, platform);

-- A post can only be scheduled or published once a human has approved it.
-- Enforced in the database as well as the application layer.
ALTER TABLE social_posts
  ADD CONSTRAINT social_posts_requires_approval
  CHECK (
    status NOT IN ('scheduled','publishing','published')
    OR (approved_by IS NOT NULL AND approved_at IS NOT NULL)
  );

-- ---------------------------------------------------------------------------
-- publishing_attempts  (Milestone 4)
-- ---------------------------------------------------------------------------
CREATE TABLE publishing_attempts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  social_post_id    UUID NOT NULL REFERENCES social_posts(id) ON DELETE CASCADE,
  attempt_number    INTEGER NOT NULL DEFAULT 1,
  status            TEXT NOT NULL DEFAULT 'started'
                    CHECK (status IN ('started','succeeded','failed','rate_limited','cancelled')),
  request_summary   TEXT,
  response_code     INTEGER,
  external_post_id  TEXT,
  error_message     TEXT,
  retry_after_seconds INTEGER,
  is_manual_retry   BOOLEAN NOT NULL DEFAULT FALSE,
  triggered_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  details           JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at       TIMESTAMPTZ,

  UNIQUE (social_post_id, attempt_number)
);

-- ---------------------------------------------------------------------------
-- analytics_snapshots  (Milestone 5)
-- ---------------------------------------------------------------------------
CREATE TABLE analytics_snapshots (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  social_post_id UUID NOT NULL REFERENCES social_posts(id) ON DELETE CASCADE,
  captured_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  views          BIGINT,
  likes          BIGINT,
  comments       BIGINT,
  shares         BIGINT,
  watch_time_seconds BIGINT,
  average_view_duration_seconds NUMERIC(10,3),
  followers_gained INTEGER,
  details        JSONB NOT NULL DEFAULT '{}'::jsonb,

  UNIQUE (social_post_id, captured_at)
);

CREATE INDEX analytics_snapshots_post_idx ON analytics_snapshots (social_post_id, captured_at DESC);

-- ---------------------------------------------------------------------------
-- audit_log
-- ---------------------------------------------------------------------------
CREATE TABLE audit_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  -- Denormalised so the trail survives a user deletion.
  actor_email  TEXT,
  action       TEXT NOT NULL,
  entity_type  TEXT NOT NULL,
  entity_id    UUID,
  episode_id   UUID REFERENCES episodes(id) ON DELETE SET NULL,
  summary      TEXT,
  before_state JSONB,
  after_state  JSONB,
  ip_address   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX audit_log_entity_idx  ON audit_log (entity_type, entity_id);
CREATE INDEX audit_log_episode_idx ON audit_log (episode_id, created_at DESC);
CREATE INDEX audit_log_created_idx ON audit_log (created_at DESC);
