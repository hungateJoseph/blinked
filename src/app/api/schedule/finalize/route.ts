/**
 * POST /api/schedule/finalize  { scheduleId, slots }
 *
 * The photographer has reviewed (and possibly edited) the draft. Publish it as
 * the final schedule that the public availability page shows.
 */
import { NextResponse } from "next/server";
import { jsonError, readJson, unauthorized } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import { isIsoDate } from "@/lib/dates";
import { isDayPart } from "@/lib/parts";
import type { ScheduleSlot } from "@/lib/schedule";
import { finalizeDraft } from "@/lib/scheduleStore";

/** Keep only well-formed slots from the request body. */
function parseSlots(value: unknown): ScheduleSlot[] {
  if (!Array.isArray(value)) return [];
  const slots: ScheduleSlot[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) continue;
    const { date, part, status, reason } = item as Record<string, unknown>;
    if (!isIsoDate(date)) continue;
    if (status !== "available" && status !== "blocked") continue;
    if (!isDayPart(part)) continue;
    slots.push({
      date,
      part,
      status,
      reason: typeof reason === "string" ? reason.slice(0, 200) : "",
    });
  }
  return slots;
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body = await readJson(request);
  if (typeof body.scheduleId !== "string") {
    return jsonError("Missing scheduleId.");
  }
  const slots = parseSlots(body.slots);
  if (slots.length === 0) {
    return jsonError("The schedule has no dates to publish.");
  }

  const schedule = finalizeDraft(user.id, body.scheduleId, slots);
  if (!schedule) {
    return jsonError("No draft schedule to finalize. Generate one first.", 404);
  }
  return NextResponse.json({ schedule });
}
