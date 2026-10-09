import type { ReactNode } from "react";
import { Snowflake } from "lucide-react";
import { LEAD_STATUSES, type LeadStatus } from "./types";

export function PageHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-primary">
          <Snowflake size={14} />
          {eyebrow}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          {title}
        </h1>
        {description && (
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}

export function StatusPill({ status }: { status: LeadStatus }) {
  const label =
    LEAD_STATUSES.find((item) => item.value === status)?.label ?? status;
  const tones: Record<LeadStatus, string> = {
    new: "border-primary/40 bg-primary/10 text-primary",
    in_progress: "border-blue-400/30 bg-blue-400/10 text-blue-300",
    supplier: "border-violet-400/30 bg-violet-400/10 text-violet-300",
    sale: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
    rejected: "border-muted-foreground/30 bg-muted text-muted-foreground",
  };
  return (
    <span
      className={
        "inline-flex rounded-full border px-2.5 py-1 text-xs font-medium " +
        tones[status]
      }
    >
      {label}
    </span>
  );
}

export function formatDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Vladivostok",
  }).format(new Date(value));
}

export function formatPrice(value: number | null) {
  return value == null
    ? "Цена по запросу"
    : new Intl.NumberFormat("ru-RU", {
        style: "currency",
        currency: "RUB",
        maximumFractionDigits: 0,
      }).format(value);
}

export function ErrorNotice({ message }: { message: string }) {
  return (
    <p
      className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
      role="alert"
    >
      {message}
    </p>
  );
}
