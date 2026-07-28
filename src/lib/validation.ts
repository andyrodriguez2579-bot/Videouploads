import { z } from "zod";

import {
  ASSET_KINDS,
  CAPTION_MODES,
  LICENSE_TYPES,
  NARRATION_MODES,
  PUBLISH_MODES,
  SCENE_PLAN_MODES,
  SCENE_TEMPLATES,
  SOURCE_TYPES,
  VERIFICATION_STATUSES,
} from "@/domain/types";

const trimmed = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) =>
  trimmed(max)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined));

export const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers and hyphens only.");

export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    // Strip combining diacritics so "Duarte y Sánchez" becomes "duarte-y-sanchez".
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

/** Historical years may be BCE, so negative values are legitimate. */
const yearSchema = z.coerce.number().int().min(-4000).max(3000).optional();

export const episodeCreateSchema = z.object({
  seriesId: z.string().uuid("Pick a series."),
  title: trimmed(200).min(3, "Title must be at least 3 characters."),
  slug: slugSchema.optional(),
  episodeNumber: z.coerce.number().int().min(0).max(9999).optional(),
  synopsis: optionalText(2000),
  language: z.enum(["es", "en"]).default("es"),
  // long_form = the 4–6 minute YouTube cut; short_form = a standalone social bite.
  primaryFormat: z.enum(["long_form", "short_form"]).default("long_form"),
  periodLabel: optionalText(120),
  periodStartYear: yearSchema,
  periodEndYear: yearSchema,
  narrationMode: z.enum(NARRATION_MODES).default("upload"),
  captionMode: z.enum(CAPTION_MODES).default("upload"),
  scenePlanMode: z.enum(SCENE_PLAN_MODES).default("manual"),
  publishMode: z.enum(PUBLISH_MODES).default("manual_upload"),
  targetDurationSeconds: z.coerce.number().int().min(15).max(36000).optional(),
});

export const episodeUpdateSchema = episodeCreateSchema.partial().extend({
  id: z.string().uuid(),
});

export const scriptSaveSchema = z.object({
  episodeId: z.string().uuid(),
  title: trimmed(200).min(3),
  scriptBody: z.string().min(1, "The script cannot be empty.").max(500_000),
  scriptFormat: z.enum(["markdown", "plaintext"]).default("markdown"),
  changeNote: optionalText(500),
});

export const researchSourceSchema = z.object({
  episodeId: z.string().uuid(),
  citation: trimmed(1000).min(4, "Enter the full citation."),
  sourceType: z.enum(SOURCE_TYPES).default("secondary"),
  author: optionalText(200),
  publisher: optionalText(200),
  publicationYear: yearSchema,
  url: z.union([z.string().url(), z.literal("")]).optional(),
  archiveReference: optionalText(300),
  supportsClaim: optionalText(1000),
  pageReference: optionalText(120),
  verification: z.enum(VERIFICATION_STATUSES).default("unverified"),
  notes: optionalText(2000),
});

export const sceneSchema = z.object({
  episodeId: z.string().uuid(),
  heading: trimmed(200).min(2, "Give the scene a heading."),
  narrationText: optionalText(20_000),
  onScreenText: optionalText(2000),
  visualDirection: optionalText(4000),
  template: z.enum(SCENE_TEMPLATES).default("archival_still"),
  estimatedSeconds: z.coerce.number().min(0).max(7200).optional(),
  notes: optionalText(2000),
});

export const sceneReorderSchema = z.object({
  episodeId: z.string().uuid(),
  sceneId: z.string().uuid(),
  direction: z.enum(["up", "down"]),
});

export const licenseSchema = z.object({
  name: trimmed(200).min(2, "Name this licence record."),
  licenseType: z.enum(LICENSE_TYPES),
  isCleared: z.coerce.boolean().default(false),
  requiresAttribution: z.coerce.boolean().default(true),
  attributionText: optionalText(500),
  rightsHolder: optionalText(200),
  sourceUrl: z.union([z.string().url(), z.literal("")]).optional(),
  licenseUrl: z.union([z.string().url(), z.literal("")]).optional(),
  territory: optionalText(120),
  notes: optionalText(2000),
});

export const assetCreateSchema = z.object({
  episodeId: z.union([z.string().uuid(), z.literal("")]).optional(),
  licenseId: z.union([z.string().uuid(), z.literal("")]).optional(),
  kind: z.enum(ASSET_KINDS),
  title: trimmed(200).min(2, "Give the asset a title."),
  description: optionalText(2000),
  creditLine: optionalText(500),
  tags: z
    .string()
    .optional()
    .transform((v) =>
      (v ?? "")
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(0, 25),
    ),
});

export const transitionSchema = z.object({
  episodeId: z.string().uuid(),
  action: z.enum([
    "submit_for_review",
    "approve",
    "request_changes",
    "reject",
    "reopen",
    "schedule",
    "mark_published",
    "mark_failed",
  ]),
  reason: optionalText(1000),
});

export const signInSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
});

/** Flattens a Zod error into `{ field: message }` for form rendering. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_form";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}
