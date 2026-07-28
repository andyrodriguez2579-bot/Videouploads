/**
 * Drizzle table definitions.
 *
 * This file mirrors `drizzle/*.sql`, which is the source of truth for the
 * database. Migrations are plain SQL applied by `scripts/migrate.ts`; Drizzle is
 * used for typed queries only. If you change one, change the other.
 */
import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import type {
  AssetKind,
  AuthProvider,
  Authorship,
  CaptionMode,
  ConnectionStatus,
  LicenseType,
  NarrationMode,
  Platform,
  PublishMode,
  RenderKind,
  RenderStatus,
  ReviewStatus,
  SceneTemplate,
  ScenePlanMode,
  SocialPostStatus,
  SourceType,
  UserRole,
  VerificationStatus,
} from "@/domain/types";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  displayName: text("display_name").notNull(),
  passwordHash: text("password_hash"),
  authProvider: text("auth_provider").$type<AuthProvider>().notNull().default("local"),
  externalId: text("external_id"),
  role: text("role").$type<UserRole>().notNull().default("editor"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const series = pgTable("series", {
  id: id(),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  description: text("description"),
  language: text("language").notNull().default("es"),
  brandPrimary: text("brand_primary").notNull().default("#4338ca"),
  brandSecondary: text("brand_secondary").notNull().default("#f7f4ed"),
  defaultAttribution: text("default_attribution"),
  // Advisory duration windows: 4–6 min YouTube cut, 50–90 s social bites.
  longFormTargetMinSeconds: integer("long_form_target_min_seconds").notNull().default(240),
  longFormTargetMaxSeconds: integer("long_form_target_max_seconds").notNull().default(360),
  shortFormTargetMinSeconds: integer("short_form_target_min_seconds").notNull().default(50),
  shortFormTargetMaxSeconds: integer("short_form_target_max_seconds").notNull().default(90),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const episodes = pgTable(
  "episodes",
  {
    id: id(),
    seriesId: uuid("series_id")
      .notNull()
      .references(() => series.id, { onDelete: "cascade" }),
    episodeNumber: integer("episode_number"),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    synopsis: text("synopsis"),
    language: text("language").notNull().default("es"),
    /** NULL = an original. Set = this row is a translation of that episode. */
    translationOfId: uuid("translation_of_id"),
    primaryFormat: text("primary_format").$type<"long_form" | "short_form">().notNull().default("long_form"),
    periodLabel: text("period_label"),
    periodStartYear: integer("period_start_year"),
    periodEndYear: integer("period_end_year"),
    status: text("status").$type<ReviewStatus>().notNull().default("draft"),
    narrationMode: text("narration_mode").$type<NarrationMode>().notNull().default("upload"),
    captionMode: text("caption_mode").$type<CaptionMode>().notNull().default("upload"),
    scenePlanMode: text("scene_plan_mode").$type<ScenePlanMode>().notNull().default("manual"),
    publishMode: text("publish_mode").$type<PublishMode>().notNull().default("manual_upload"),
    approvedVersionId: uuid("approved_version_id"),
    approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    rejectionReason: text("rejection_reason"),
    targetDurationSeconds: integer("target_duration_seconds"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({
    statusIdx: index("episodes_status_idx").on(t.status),
    seriesIdx: index("episodes_series_idx").on(t.seriesId, t.episodeNumber),
    slugUnique: uniqueIndex("episodes_series_id_slug_key").on(t.seriesId, t.slug),
    translationIdx: index("episodes_translation_of_idx").on(t.translationOfId),
  }),
);

export const episodeVersions = pgTable(
  "episode_versions",
  {
    id: id(),
    episodeId: uuid("episode_id")
      .notNull()
      .references(() => episodes.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    title: text("title").notNull(),
    scriptBody: text("script_body").notNull(),
    scriptFormat: text("script_format").$type<"markdown" | "plaintext">().notNull().default("markdown"),
    wordCount: integer("word_count").notNull().default(0),
    contentHash: text("content_hash").notNull(),
    authorship: text("authorship").$type<Authorship>().notNull().default("human"),
    aiProvider: text("ai_provider"),
    changeNote: text("change_note"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => ({
    versionUnique: uniqueIndex("episode_versions_episode_id_version_number_key").on(
      t.episodeId,
      t.versionNumber,
    ),
  }),
);

export const researchSources = pgTable(
  "research_sources",
  {
    id: id(),
    episodeId: uuid("episode_id")
      .notNull()
      .references(() => episodes.id, { onDelete: "cascade" }),
    citation: text("citation").notNull(),
    sourceType: text("source_type").$type<SourceType>().notNull().default("secondary"),
    author: text("author"),
    publisher: text("publisher"),
    publicationYear: integer("publication_year"),
    url: text("url"),
    archiveReference: text("archive_reference"),
    supportsClaim: text("supports_claim"),
    pageReference: text("page_reference"),
    verification: text("verification").$type<VerificationStatus>().notNull().default("unverified"),
    verifiedBy: uuid("verified_by").references(() => users.id, { onDelete: "set null" }),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({ episodeIdx: index("research_sources_episode_idx").on(t.episodeId) }),
);

export const assetLicenses = pgTable("asset_licenses", {
  id: id(),
  name: text("name").notNull(),
  licenseType: text("license_type").$type<LicenseType>().notNull(),
  isCleared: boolean("is_cleared").notNull().default(false),
  requiresAttribution: boolean("requires_attribution").notNull().default(true),
  attributionText: text("attribution_text"),
  rightsHolder: text("rights_holder"),
  sourceUrl: text("source_url"),
  licenseUrl: text("license_url"),
  proofObjectKey: text("proof_object_key"),
  validFrom: date("valid_from"),
  validUntil: date("valid_until"),
  territory: text("territory"),
  notes: text("notes"),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const mediaAssets = pgTable(
  "media_assets",
  {
    id: id(),
    episodeId: uuid("episode_id").references(() => episodes.id, { onDelete: "set null" }),
    licenseId: uuid("license_id").references(() => assetLicenses.id, { onDelete: "set null" }),
    kind: text("kind").$type<AssetKind>().notNull(),
    title: text("title").notNull(),
    description: text("description"),
    storageDriver: text("storage_driver").$type<"local" | "s3">().notNull().default("local"),
    objectKey: text("object_key").notNull(),
    mimeType: text("mime_type"),
    byteSize: bigint("byte_size", { mode: "number" }),
    checksumSha256: text("checksum_sha256"),
    width: integer("width"),
    height: integer("height"),
    durationSeconds: numeric("duration_seconds"),
    creditLine: text("credit_line"),
    tags: text("tags").array().notNull().default([]),
    details: jsonb("details").notNull().default({}),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({
    episodeIdx: index("media_assets_episode_idx").on(t.episodeId),
    kindIdx: index("media_assets_kind_idx").on(t.kind),
  }),
);

export const scenes = pgTable(
  "scenes",
  {
    id: id(),
    episodeId: uuid("episode_id")
      .notNull()
      .references(() => episodes.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    heading: text("heading").notNull(),
    narrationText: text("narration_text"),
    onScreenText: text("on_screen_text"),
    visualDirection: text("visual_direction"),
    template: text("template").$type<SceneTemplate>().notNull().default("archival_still"),
    estimatedSeconds: numeric("estimated_seconds"),
    startSeconds: numeric("start_seconds"),
    isAiSuggested: boolean("is_ai_suggested").notNull().default(false),
    aiProvider: text("ai_provider"),
    humanReviewed: boolean("human_reviewed").notNull().default(false),
    notes: text("notes"),
    details: jsonb("details").notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({ episodeIdx: index("scenes_episode_idx").on(t.episodeId, t.position) }),
);

export const sceneAssets = pgTable(
  "scene_assets",
  {
    id: id(),
    sceneId: uuid("scene_id")
      .notNull()
      .references(() => scenes.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => mediaAssets.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    role: text("role")
      .$type<"primary" | "background" | "overlay" | "map" | "music" | "sfx">()
      .notNull()
      .default("primary"),
    createdAt: createdAt(),
  },
  (t) => ({
    unique: uniqueIndex("scene_assets_scene_id_asset_id_role_key").on(t.sceneId, t.assetId, t.role),
  }),
);

export const sceneSources = pgTable(
  "scene_sources",
  {
    id: id(),
    sceneId: uuid("scene_id")
      .notNull()
      .references(() => scenes.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => researchSources.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => ({
    unique: uniqueIndex("scene_sources_scene_id_source_id_key").on(t.sceneId, t.sourceId),
  }),
);

export const voiceovers = pgTable(
  "voiceovers",
  {
    id: id(),
    episodeId: uuid("episode_id")
      .notNull()
      .references(() => episodes.id, { onDelete: "cascade" }),
    sceneId: uuid("scene_id").references(() => scenes.id, { onDelete: "cascade" }),
    source: text("source").$type<NarrationMode>().notNull().default("upload"),
    provider: text("provider"),
    voiceId: text("voice_id"),
    language: text("language").notNull().default("es"),
    storageDriver: text("storage_driver").$type<"local" | "s3">().notNull().default("local"),
    objectKey: text("object_key"),
    mimeType: text("mime_type"),
    byteSize: bigint("byte_size", { mode: "number" }),
    durationSeconds: numeric("duration_seconds"),
    loudnessLufs: numeric("loudness_lufs"),
    status: text("status").$type<"pending" | "processing" | "ready" | "failed">().notNull().default("ready"),
    errorMessage: text("error_message"),
    isSelected: boolean("is_selected").notNull().default(false),
    details: jsonb("details").notNull().default({}),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({ episodeIdx: index("voiceovers_episode_idx").on(t.episodeId) }),
);

export const captions = pgTable(
  "captions",
  {
    id: id(),
    episodeId: uuid("episode_id")
      .notNull()
      .references(() => episodes.id, { onDelete: "cascade" }),
    voiceoverId: uuid("voiceover_id").references(() => voiceovers.id, { onDelete: "set null" }),
    language: text("language").notNull().default("es"),
    format: text("format").$type<"srt" | "vtt" | "json">().notNull().default("srt"),
    source: text("source").$type<CaptionMode | "manual">().notNull().default("upload"),
    provider: text("provider"),
    storageDriver: text("storage_driver").$type<"local" | "s3">().notNull().default("local"),
    objectKey: text("object_key"),
    content: text("content"),
    cueCount: integer("cue_count"),
    status: text("status").$type<"pending" | "processing" | "ready" | "failed">().notNull().default("ready"),
    errorMessage: text("error_message"),
    humanReviewed: boolean("human_reviewed").notNull().default(false),
    isSelected: boolean("is_selected").notNull().default(false),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({ episodeIdx: index("captions_episode_idx").on(t.episodeId) }),
);

export const renders = pgTable(
  "renders",
  {
    id: id(),
    episodeId: uuid("episode_id")
      .notNull()
      .references(() => episodes.id, { onDelete: "cascade" }),
    episodeVersionId: uuid("episode_version_id").references(() => episodeVersions.id, {
      onDelete: "set null",
    }),
    kind: text("kind").$type<RenderKind>().notNull(),
    aspectRatio: text("aspect_ratio").$type<"16:9" | "9:16" | "1:1">().notNull().default("16:9"),
    template: text("template"),
    label: text("label"),
    status: text("status").$type<RenderStatus>().notNull().default("pending"),
    storageDriver: text("storage_driver").$type<"local" | "s3">().notNull().default("local"),
    objectKey: text("object_key"),
    mimeType: text("mime_type"),
    byteSize: bigint("byte_size", { mode: "number" }),
    durationSeconds: numeric("duration_seconds"),
    width: integer("width"),
    height: integer("height"),
    clipStartSeconds: numeric("clip_start_seconds"),
    clipEndSeconds: numeric("clip_end_seconds"),
    humanReviewed: boolean("human_reviewed").notNull().default(false),
    errorMessage: text("error_message"),
    details: jsonb("details").notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({
    episodeIdx: index("renders_episode_idx").on(t.episodeId),
    statusIdx: index("renders_status_idx").on(t.status),
  }),
);

export const renderJobs = pgTable(
  "render_jobs",
  {
    id: id(),
    renderId: uuid("render_id")
      .notNull()
      .references(() => renders.id, { onDelete: "cascade" }),
    queueName: text("queue_name").notNull().default("renders"),
    externalJobId: text("external_job_id"),
    status: text("status")
      .$type<"queued" | "running" | "succeeded" | "failed" | "cancelled" | "retrying">()
      .notNull()
      .default("queued"),
    attempt: integer("attempt").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    progress: integer("progress").notNull().default(0),
    stage: text("stage"),
    log: text("log"),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({
    renderIdx: index("render_jobs_render_idx").on(t.renderId),
    statusIdx: index("render_jobs_status_idx").on(t.status),
  }),
);

export const socialAccounts = pgTable("social_accounts", {
  id: id(),
  platform: text("platform").$type<Platform>().notNull(),
  accountLabel: text("account_label").notNull(),
  externalAccountId: text("external_account_id"),
  handle: text("handle"),
  accessTokenEncrypted: text("access_token_encrypted"),
  refreshTokenEncrypted: text("refresh_token_encrypted"),
  tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
  scopes: text("scopes").array().notNull().default([]),
  connectionStatus: text("connection_status").$type<ConnectionStatus>().notNull().default("disconnected"),
  lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
  lastError: text("last_error"),
  details: jsonb("details").notNull().default({}),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const socialPosts = pgTable(
  "social_posts",
  {
    id: id(),
    episodeId: uuid("episode_id")
      .notNull()
      .references(() => episodes.id, { onDelete: "cascade" }),
    renderId: uuid("render_id").references(() => renders.id, { onDelete: "set null" }),
    socialAccountId: uuid("social_account_id").references(() => socialAccounts.id, {
      onDelete: "set null",
    }),
    platform: text("platform").$type<Platform>().notNull(),
    title: text("title"),
    body: text("body"),
    hashtags: text("hashtags").array().notNull().default([]),
    privacy: text("privacy").$type<"private" | "unlisted" | "public">().notNull().default("private"),
    status: text("status").$type<SocialPostStatus>().notNull().default("draft"),
    copyAuthorship: text("copy_authorship").$type<Authorship>().notNull().default("human"),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    externalPostId: text("external_post_id"),
    postUrl: text("post_url"),
    approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    idempotencyKey: text("idempotency_key"),
    lastError: text("last_error"),
    details: jsonb("details").notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({
    episodeIdx: index("social_posts_episode_idx").on(t.episodeId),
    scheduleIdx: index("social_posts_schedule_idx").on(t.scheduledFor),
    statusIdx: index("social_posts_status_idx").on(t.status, t.platform),
  }),
);

export const publishingAttempts = pgTable(
  "publishing_attempts",
  {
    id: id(),
    socialPostId: uuid("social_post_id")
      .notNull()
      .references(() => socialPosts.id, { onDelete: "cascade" }),
    attemptNumber: integer("attempt_number").notNull().default(1),
    status: text("status")
      .$type<"started" | "succeeded" | "failed" | "rate_limited" | "cancelled">()
      .notNull()
      .default("started"),
    requestSummary: text("request_summary"),
    responseCode: integer("response_code"),
    externalPostId: text("external_post_id"),
    errorMessage: text("error_message"),
    retryAfterSeconds: integer("retry_after_seconds"),
    isManualRetry: boolean("is_manual_retry").notNull().default(false),
    triggeredBy: uuid("triggered_by").references(() => users.id, { onDelete: "set null" }),
    details: jsonb("details").notNull().default({}),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => ({
    unique: uniqueIndex("publishing_attempts_post_attempt_key").on(t.socialPostId, t.attemptNumber),
  }),
);

export const analyticsSnapshots = pgTable(
  "analytics_snapshots",
  {
    id: id(),
    socialPostId: uuid("social_post_id")
      .notNull()
      .references(() => socialPosts.id, { onDelete: "cascade" }),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
    views: bigint("views", { mode: "number" }),
    likes: bigint("likes", { mode: "number" }),
    comments: bigint("comments", { mode: "number" }),
    shares: bigint("shares", { mode: "number" }),
    watchTimeSeconds: bigint("watch_time_seconds", { mode: "number" }),
    averageViewDurationSeconds: numeric("average_view_duration_seconds"),
    followersGained: integer("followers_gained"),
    details: jsonb("details").notNull().default({}),
  },
  (t) => ({ postIdx: index("analytics_snapshots_post_idx").on(t.socialPostId, t.capturedAt) }),
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    actorEmail: text("actor_email"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),
    episodeId: uuid("episode_id").references(() => episodes.id, { onDelete: "set null" }),
    summary: text("summary"),
    beforeState: jsonb("before_state"),
    afterState: jsonb("after_state"),
    ipAddress: text("ip_address"),
    createdAt: createdAt(),
  },
  (t) => ({
    entityIdx: index("audit_log_entity_idx").on(t.entityType, t.entityId),
    episodeIdx: index("audit_log_episode_idx").on(t.episodeId, t.createdAt),
    createdIdx: index("audit_log_created_idx").on(t.createdAt),
  }),
);

export type User = typeof users.$inferSelect;
export type Series = typeof series.$inferSelect;
export type Episode = typeof episodes.$inferSelect;
export type EpisodeVersion = typeof episodeVersions.$inferSelect;
export type ResearchSource = typeof researchSources.$inferSelect;
export type AssetLicense = typeof assetLicenses.$inferSelect;
export type MediaAsset = typeof mediaAssets.$inferSelect;
export type Scene = typeof scenes.$inferSelect;
export type SceneAsset = typeof sceneAssets.$inferSelect;
export type Voiceover = typeof voiceovers.$inferSelect;
export type Caption = typeof captions.$inferSelect;
export type Render = typeof renders.$inferSelect;
export type RenderJob = typeof renderJobs.$inferSelect;
export type SocialAccount = typeof socialAccounts.$inferSelect;
export type SocialPost = typeof socialPosts.$inferSelect;
export type PublishingAttempt = typeof publishingAttempts.$inferSelect;
export type AnalyticsSnapshot = typeof analyticsSnapshots.$inferSelect;
export type AuditLogEntry = typeof auditLog.$inferSelect;
