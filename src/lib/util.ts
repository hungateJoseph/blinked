/**
 * Small helpers shared across the server-side code.
 */
import { randomUUID } from "node:crypto";

/** A new unique id for a database row. */
export function newId(): string {
  return randomUUID();
}

/** The current time as an ISO-8601 string — the format we store in SQLite. */
export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Build the URL-safe slug for someone's public availability page, e.g.
 * "jane-doe-4f2a". The random suffix keeps two photographers with the same
 * name apart.
 *
 * Deliberately built from the display name and never from the email address:
 * the slug ends up in a link the photographer shares publicly, and a mailbox
 * name does not belong there. Someone who signed up with only an email gets
 * the neutral "photographer-<suffix>".
 */
export function newPublicSlug(displayName?: string | null): string {
  const base = (displayName ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  const suffix = randomUUID().slice(0, 4);
  return `${base || "photographer"}-${suffix}`;
}

/** Very small email sanity check — enough for a beta sign-in form. */
export function looksLikeEmail(value: unknown): value is string {
  return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
