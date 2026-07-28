import Link from "next/link";
import type { ReactNode } from "react";

import { REVIEW_STATUS_LABELS, type ReviewStatus } from "@/domain/types";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="font-serif text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="mt-1 max-w-2xl text-sm text-black/70">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}

/**
 * Status colours are paired with a text label, never used alone — colour is not
 * the only carrier of meaning.
 */
const STATUS_CLASSES: Record<ReviewStatus, string> = {
  draft: "bg-black/5 text-black/70 border-black/20",
  in_review: "bg-amber-50 text-amber-900 border-amber-300",
  approved: "bg-emerald-50 text-emerald-900 border-emerald-300",
  rejected: "bg-red-50 text-red-900 border-red-300",
  scheduled: "bg-indigo-50 text-indigo-800 border-indigo-200",
  published: "bg-sky-50 text-sky-900 border-sky-300",
  failed: "bg-red-100 text-red-900 border-red-400",
};

export function StatusBadge({ status }: { status: ReviewStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${STATUS_CLASSES[status]}`}
    >
      {REVIEW_STATUS_LABELS[status]}
    </span>
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "good" | "warn" | "bad" | "info";
}) {
  const tones = {
    neutral: "bg-black/5 text-black/70 border-black/15",
    good: "bg-emerald-50 text-emerald-900 border-emerald-300",
    warn: "bg-amber-50 text-amber-900 border-amber-300",
    bad: "bg-red-50 text-red-900 border-red-300",
    info: "bg-indigo-50 text-indigo-800 border-indigo-200",
  } as const;
  return (
    <span className={`inline-flex items-center rounded border px-2 py-0.5 text-xs ${tones[tone]}`}>
      {children}
    </span>
  );
}

/** Marks anything a machine produced. Required wherever AI output is shown. */
export function AiDraftBadge({ provider }: { provider?: string | null }) {
  return (
    <Badge tone="warn">
      AI draft — needs human approval{provider ? ` · ${provider}` : ""}
    </Badge>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-dashed border-black/20 bg-white/60 p-8 text-center">
      <p className="font-medium">{title}</p>
      {description ? <p className="mx-auto mt-1 max-w-md text-sm text-black/60">{description}</p> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function Alert({
  tone,
  title,
  items,
  children,
}: {
  tone: "error" | "warning" | "success" | "info";
  title?: string;
  items?: string[];
  children?: ReactNode;
}) {
  const tones = {
    error: "border-red-400 bg-red-50 text-red-900",
    warning: "border-amber-400 bg-amber-50 text-amber-900",
    success: "border-emerald-400 bg-emerald-50 text-emerald-900",
    info: "border-indigo-300 bg-indigo-50 text-indigo-900",
  } as const;
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`rounded-md border p-3 text-sm ${tones[tone]}`}
    >
      {title ? <p className="font-medium">{title}</p> : null}
      {items && items.length > 0 ? (
        <ul className="mt-1 list-disc space-y-0.5 pl-5">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : null}
      {children}
    </div>
  );
}

export function Field({
  label,
  name,
  error,
  hint,
  children,
}: {
  label: string;
  name: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}) {
  const hintId = hint ? `${name}-hint` : undefined;
  const errorId = error ? `${name}-error` : undefined;
  return (
    <div>
      <label className="label" htmlFor={name}>
        {label}
      </label>
      {children}
      {hint ? (
        <p id={hintId} className="mt-1 text-xs text-black/60">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="mt-1 text-xs font-medium text-red-800">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function StatTile({
  label,
  value,
  href,
  tone = "neutral",
}: {
  label: string;
  value: number | string;
  href?: string;
  tone?: "neutral" | "warn" | "bad";
}) {
  const tones = {
    neutral: "border-black/10",
    warn: "border-amber-400",
    bad: "border-red-400",
  } as const;
  const body = (
    <>
      <p className="text-sm text-black/60">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
    </>
  );
  const className = `card border-l-4 ${tones[tone]} ${href ? "block hover:bg-black/[0.02]" : ""}`;
  return href ? (
    <Link href={href} className={className}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

export function MilestoneNotice({ milestone, children }: { milestone: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-indigo-300 bg-indigo-50/60 p-6">
      <p className="text-xs font-semibold uppercase tracking-wide text-indigo-800">{milestone}</p>
      <div className="mt-2 text-sm text-indigo-950">{children}</div>
    </div>
  );
}
