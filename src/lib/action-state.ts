/**
 * Uniform result shape for every server action, so forms render errors,
 * warnings and success the same way everywhere.
 *
 * Lives outside any "use server" module: files marked "use server" may only
 * export async functions.
 */
export interface ActionState {
  ok?: boolean;
  message?: string;
  /** A single top-level failure message. */
  error?: string;
  /** Non-blocking notes shown alongside a successful action. */
  warnings?: string[];
  /** Reasons a workflow transition was refused. */
  blocked?: string[];
  /** Per-field validation messages, keyed by input name. */
  fields?: Record<string, string>;
}

export const emptyActionState: ActionState = {};
