/**
 * GET  /api/discounts  — the photographer's standing discount rules
 * POST /api/discounts  — add one
 */
import { NextResponse } from "next/server";
import { jsonError, readJson, unauthorized } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import { parseRule } from "@/lib/discounts";
import { addDiscount, listDiscounts } from "@/lib/scheduleStore";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  return NextResponse.json({ discounts: listDiscounts(user.id) });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const rule = parseRule(await readJson(request));
  if (!rule) {
    return jsonError("Give the discount a short label, such as “20% off”.");
  }
  if (rule.dateStart && rule.dateEnd && rule.dateEnd < rule.dateStart) {
    return jsonError("The end date is before the start date.");
  }

  return NextResponse.json({ discount: addDiscount(user.id, rule) }, { status: 201 });
}
