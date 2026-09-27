/**
 * GET    /api/faces  — what has been scanned so far
 * DELETE /api/faces  — erase every face descriptor this photographer holds
 *
 * The delete exists because these descriptors describe other people. Someone
 * who asks to be removed from a photographer's records should be removable,
 * and the simplest honest answer is a button that wipes the lot.
 */
import { NextResponse } from "next/server";
import { unauthorized } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import { clearFaces, countFaces, indexedPhotoIds } from "@/lib/faces";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  return NextResponse.json({
    ...countFaces(user.id),
    indexedPhotoIds: indexedPhotoIds(user.id),
  });
}

export async function DELETE() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  return NextResponse.json({ deleted: clearFaces(user.id) });
}
