/**
 * GET /api/billing — the signed-in photographer's credit: balance, ledger, and
 * whether billing is switched on at all.
 */
import { NextResponse } from "next/server";
import { unauthorized } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import { TOPUP_AMOUNTS_CENTS, billingStatus, listLedger } from "@/lib/billing";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  return NextResponse.json({
    ...billingStatus(user.id),
    ledger: listLedger(user.id),
    topUpAmounts: TOPUP_AMOUNTS_CENTS,
  });
}
