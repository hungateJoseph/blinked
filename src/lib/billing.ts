/**
 * Prepaid credit for the workflow analysis.
 *
 * Money in: Stripe Checkout, a hosted page — the card never touches this
 * site — and a signed webhook that credits the ledger, idempotently on the
 * session id. Money out: the actual API cost of each analysis pass, from the
 * usage the API reports, rounded up to the cent. A run is refused before it
 * starts when the balance could not cover it.
 *
 * With no Stripe keys configured, billing is simply off: runs are free and
 * the credit page says so. That is what lets the site work locally and before
 * the keys are set, without a special case anywhere else.
 */
import Stripe from "stripe";
import { getDb, type CreditLedgerRow } from "./db";
import { newId, nowIso } from "./util";
import type { AnalysisUsage } from "./assistant/catalog";

/** What can be bought in one go. Small top-ups are not worth Stripe's fixed fee. */
export const TOPUP_AMOUNTS_CENTS = [500, 1000, 2000] as const;

/** A Standard run costs a few cents; this much must be there before one starts. */
export const MIN_BALANCE_FOR_RUN_CENTS = 5;

export function billingEnabled(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET);
}

export function getStripe(): Stripe {
  return new Stripe(process.env.STRIPE_SECRET_KEY ?? "");
}

/** Dollars of API cost → cents charged: rounded up, never less than a cent. */
export function costToCents(usd: number): number {
  if (usd <= 0) return 0;
  return Math.max(1, Math.ceil(usd * 100 - 1e-9));
}

export interface LedgerEntry {
  id: string;
  kind: CreditLedgerRow["kind"];
  amountCents: number;
  description: string;
  createdAt: string;
}

function toView(row: CreditLedgerRow): LedgerEntry {
  return {
    id: row.id,
    kind: row.kind,
    amountCents: row.amount_cents,
    description: row.description,
    createdAt: row.created_at,
  };
}

export function balanceCents(userId: string): number {
  const row = getDb()
    .prepare("SELECT COALESCE(SUM(amount_cents), 0) AS total FROM credit_ledger WHERE user_id = ?")
    .get(userId) as { total: number };
  return row.total;
}

/** Newest first. */
export function listLedger(userId: string, limit = 100): LedgerEntry[] {
  const rows = getDb()
    .prepare("SELECT * FROM credit_ledger WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?")
    .all(userId, limit) as CreditLedgerRow[];
  return rows.map(toView);
}

/**
 * Write one entry. A `reference` makes it idempotent: a second entry with the
 * same reference (a webhook Stripe retried) is ignored and null is returned.
 */
export function addLedgerEntry(input: {
  userId: string;
  kind: CreditLedgerRow["kind"];
  amountCents: number;
  description: string;
  reference?: string;
}): LedgerEntry | null {
  const row: CreditLedgerRow = {
    id: newId(),
    user_id: input.userId,
    kind: input.kind,
    amount_cents: Math.round(input.amountCents),
    description: input.description,
    reference: input.reference ?? null,
    created_at: nowIso(),
  };
  const result = getDb()
    .prepare(
      `INSERT OR IGNORE INTO credit_ledger (id, user_id, kind, amount_cents, description, reference, created_at)
       VALUES (@id, @user_id, @kind, @amount_cents, @description, @reference, @created_at)`,
    )
    .run(row);
  return result.changes > 0 ? toView(row) : null;
}

/** Charge one analysis pass. Returns the cents taken (0 when billing is off). */
export function chargeAnalysis(userId: string, usage: AnalysisUsage, label: string): number {
  if (!billingEnabled()) return 0;
  const cents = costToCents(usage.costUsd);
  if (cents === 0) return 0;
  addLedgerEntry({
    userId,
    kind: "charge",
    amountCents: -cents,
    description: `${label} (${usage.model})`,
  });
  return cents;
}

export interface BillingStatus {
  enabled: boolean;
  balanceCents: number;
  minimumCents: number;
}

export function billingStatus(userId: string): BillingStatus {
  return {
    enabled: billingEnabled(),
    balanceCents: billingEnabled() ? balanceCents(userId) : 0,
    minimumCents: MIN_BALANCE_FOR_RUN_CENTS,
  };
}

/** True when a run may start: billing off, or enough credit for a Standard run. */
export function canAffordRun(userId: string): boolean {
  return !billingEnabled() || balanceCents(userId) >= MIN_BALANCE_FOR_RUN_CENTS;
}

/** "$4.82" */
export function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * The site's own origin, for Stripe's return URLs. Behind Render (and
 * Cloudflare) the request's own URL is the internal one, so the forwarded
 * headers are what the browser actually used.
 */
export function siteOrigin(request: Request): string {
  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  return host ? `${proto}://${host}` : new URL(request.url).origin;
}
