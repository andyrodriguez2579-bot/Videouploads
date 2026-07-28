import "server-only";

import { db } from "@/db/client";
import { auditLog } from "@/db/schema";

import type { SessionUser } from "./auth/session";

export interface AuditInput {
  actor: SessionUser | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  episodeId?: string | null;
  summary?: string;
  before?: unknown;
  after?: unknown;
}

/**
 * Appends to the audit trail. Deliberately non-throwing: a failed audit write
 * must not roll back the editorial action the owner just took, but it must be
 * loud in the server log so the gap is visible.
 */
export async function recordAudit(input: AuditInput): Promise<void> {
  try {
    await db.insert(auditLog).values({
      actorId: input.actor?.id ?? null,
      actorEmail: input.actor?.email ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      episodeId: input.episodeId ?? null,
      summary: input.summary ?? null,
      beforeState: (input.before ?? null) as never,
      afterState: (input.after ?? null) as never,
    });
  } catch (error) {
    console.error("[audit] failed to write audit entry", { action: input.action, error });
  }
}
