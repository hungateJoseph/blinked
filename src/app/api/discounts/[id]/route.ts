/**
 * DELETE /api/discounts/:id — remove a standing discount rule.
 *
 * Already-published schedules keep the tags they were saved with, because a
 * couple who saw "20% off" on your page should not find it quietly withdrawn.
 * Generate and publish again to drop them.
 */
import { NextResponse } from "next/server";
import { jsonError, unauthorized } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import { deleteDiscount } from "@/lib/scheduleStore";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const { id } = await params;
  if (!deleteDiscount(user.id, id)) return jsonError("Discount not found.", 404);

  return NextResponse.json({ ok: true });
}
