/**
 * POST /api/billing/webhook — Stripe tells us a payment went through.
 *
 * The body is verified against Stripe's signature before anything is
 * believed, and the ledger entry is keyed on the session id, so a retried
 * webhook cannot credit twice. No session cookie here: Stripe is the caller.
 */
import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { jsonError } from "@/lib/api";
import { addLedgerEntry, billingEnabled, getStripe } from "@/lib/billing";
import { getDb } from "@/lib/db";

export async function POST(request: Request) {
  if (!billingEnabled()) return jsonError("Billing is not configured.", 503);

  const signature = request.headers.get("stripe-signature") ?? "";
  const raw = await request.text();

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(raw, signature, process.env.STRIPE_WEBHOOK_SECRET ?? "");
  } catch (error) {
    console.warn("[billing] webhook rejected:", error instanceof Error ? error.message : error);
    return jsonError("Bad signature.", 400);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const userId = session.client_reference_id ?? session.metadata?.userId ?? null;
    const amount = session.amount_total ?? 0;
    if (session.payment_status === "paid" && userId && amount > 0) {
      // A session for a user that no longer exists would fail the foreign key;
      // acknowledge it anyway so Stripe stops retrying.
      const exists = getDb().prepare("SELECT 1 FROM users WHERE id = ?").get(userId);
      if (exists) {
        const entry = addLedgerEntry({
          userId,
          kind: "topup",
          amountCents: amount,
          description: `Credit top-up ($${(amount / 100).toFixed(2)})`,
          reference: `stripe:${session.id}`,
        });
        if (entry) console.log(`[billing] credited ${amount}¢ to ${userId} (${session.id})`);
      }
    }
  }

  return NextResponse.json({ received: true });
}
