/**
 * POST /api/billing/checkout  { amountCents }
 *
 * Start a top-up: create a Stripe Checkout session and hand back its URL.
 * The card is entered on Stripe's page, never here. The credit itself is
 * added when Stripe's webhook confirms payment (see ../webhook), not when
 * the photographer lands back on the site — landing pages can be faked,
 * signed webhooks cannot.
 */
import { NextResponse } from "next/server";
import { jsonError, readJson, unauthorized } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import { TOPUP_AMOUNTS_CENTS, billingEnabled, getStripe, siteOrigin } from "@/lib/billing";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!billingEnabled()) return jsonError("Top-ups are not set up on this server yet.", 503);

  const body = await readJson(request);
  const amountCents = Number(body.amountCents);
  if (!TOPUP_AMOUNTS_CENTS.includes(amountCents as (typeof TOPUP_AMOUNTS_CENTS)[number])) {
    return jsonError("Pick one of the top-up amounts.");
  }

  const origin = siteOrigin(request);
  try {
    const session = await getStripe().checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: amountCents,
            product_data: {
              name: `Blinked analysis credit — $${(amountCents / 100).toFixed(2)}`,
              description: "Prepaid credit for Smart Photographer workflow analyses.",
            },
          },
        },
      ],
      // Who to credit, carried through to the webhook.
      client_reference_id: user.id,
      metadata: { userId: user.id },
      customer_email: user.email,
      success_url: `${origin}/assistant/credit?status=success`,
      cancel_url: `${origin}/assistant/credit?status=cancelled`,
    });
    if (!session.url) return jsonError("Stripe did not return a checkout page.", 502);
    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error("[billing] checkout:", error);
    return jsonError("Could not start the top-up. Please try again.", 502);
  }
}
