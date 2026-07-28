/**
 * Shared domain vocabulary. These string unions are the single source of truth
 * for every enum-like column; the SQL CHECK constraints mirror them.
 */

export const REVIEW_STATUSES = [
  "draft",
  "in_review",
  "approved",
  "rejected",
  "scheduled",
  "published",
  "failed",
] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const REVIEW_STATUS_LABELS: Record<ReviewStatus, string> = {
  draft: "Draft",
  in_review: "In Review",
  approved: "Approved",
  rejected: "Rejected",
  scheduled: "Scheduled",
  published: "Published",
  failed: "Failed",
};

export const USER_ROLES = ["owner", "editor", "reviewer", "viewer"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export type AuthProvider = "local" | "supabase";

export const AUTHORSHIP = ["human", "ai_draft", "ai_edited"] as const;
export type Authorship = (typeof AUTHORSHIP)[number];

/** Cost-control: `upload` and `local_tts` require no paid service. */
export const NARRATION_MODES = ["upload", "local_tts", "hosted_tts"] as const;
export type NarrationMode = (typeof NARRATION_MODES)[number];

export const NARRATION_MODE_LABELS: Record<NarrationMode, string> = {
  upload: "Upload my own narration (free)",
  local_tts: "Local text-to-speech — Piper (free)",
  hosted_tts: "Hosted voice provider (paid)",
};

export const CAPTION_MODES = ["upload", "local_asr", "hosted_asr"] as const;
export type CaptionMode = (typeof CAPTION_MODES)[number];

export const CAPTION_MODE_LABELS: Record<CaptionMode, string> = {
  upload: "Upload SRT/VTT (free)",
  local_asr: "Local transcription — faster-whisper (free)",
  hosted_asr: "Hosted transcription provider (paid)",
};

export const SCENE_PLAN_MODES = ["manual", "ai_assisted"] as const;
export type ScenePlanMode = (typeof SCENE_PLAN_MODES)[number];

export const SCENE_PLAN_MODE_LABELS: Record<ScenePlanMode, string> = {
  manual: "I write the scene list (free)",
  ai_assisted: "AI drafts the scene list, I approve it (paid)",
};

export const PUBLISH_MODES = ["manual_upload", "api"] as const;
export type PublishMode = (typeof PUBLISH_MODES)[number];

export const PUBLISH_MODE_LABELS: Record<PublishMode, string> = {
  manual_upload: "I upload the file to each platform myself (free)",
  api: "Publish through connected platform APIs",
};

export const SOURCE_TYPES = [
  "primary",
  "secondary",
  "tertiary",
  "archive",
  "interview",
  "other",
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export const VERIFICATION_STATUSES = ["unverified", "verified", "disputed", "rejected"] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export const LICENSE_TYPES = [
  "public_domain",
  "cc0",
  "cc_by",
  "cc_by_sa",
  "rights_managed",
  "royalty_free",
  "editorial_only",
  "owner_created",
  "permission_granted",
  "unknown",
] as const;
export type LicenseType = (typeof LICENSE_TYPES)[number];

export const LICENSE_TYPE_LABELS: Record<LicenseType, string> = {
  public_domain: "Public domain",
  cc0: "CC0",
  cc_by: "CC BY",
  cc_by_sa: "CC BY-SA",
  rights_managed: "Rights managed",
  royalty_free: "Royalty free",
  editorial_only: "Editorial use only",
  owner_created: "Created by us",
  permission_granted: "Written permission on file",
  unknown: "Unknown — not cleared",
};

export const ASSET_KINDS = [
  "image",
  "video",
  "audio",
  "music",
  "map",
  "document",
  "font",
  "other",
] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

export const SCENE_TEMPLATES = [
  "title_card",
  "archival_still",
  "map_sequence",
  "lower_third",
  "quote_card",
  "source_credits",
  "outro_card",
] as const;
export type SceneTemplate = (typeof SCENE_TEMPLATES)[number];

export const SCENE_TEMPLATE_LABELS: Record<SceneTemplate, string> = {
  title_card: "Opening title card",
  archival_still: "Archival still / Ken Burns",
  map_sequence: "Map sequence",
  lower_third: "Historical lower-third",
  quote_card: "Quotation card",
  source_credits: "Source credits",
  outro_card: "Closing card",
};

export type RenderKind = "long_form" | "short_form" | "thumbnail" | "audio_master";
export type RenderStatus = "pending" | "queued" | "running" | "succeeded" | "failed" | "cancelled";

export const PLATFORMS = ["youtube", "tiktok", "instagram", "facebook", "linkedin", "x"] as const;
export type Platform = (typeof PLATFORMS)[number];

export type ConnectionStatus = "disconnected" | "connected" | "expired" | "error" | "mock";

export type SocialPostStatus =
  | "draft"
  | "in_review"
  | "approved"
  | "rejected"
  | "scheduled"
  | "publishing"
  | "published"
  | "failed"
  | "cancelled";
