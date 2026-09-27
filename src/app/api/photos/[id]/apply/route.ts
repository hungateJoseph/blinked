/**
 * POST /api/photos/:id/apply    — apply the cleanup plan's adjustments
 * DELETE /api/photos/:id/apply  — throw the edited copy away
 *
 * Applying writes a second file and leaves the original untouched, so this is
 * always reversible and can be re-run after a new scan.
 */
import { NextResponse } from "next/server";
import { hasAdjustments } from "@/lib/ai";
import { jsonError, unauthorized } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import {
  clearEditedPhoto,
  getLatestAnalysis,
  getPhoto,
  photoToView,
  saveEditedPhoto,
} from "@/lib/photoStore";
import {
  applyAdjustments,
  deleteEditedPhoto,
  readPhotoFile,
  writeEditedPhoto,
} from "@/lib/photos";

type Context = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: Context) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const { id } = await params;
  const photo = getPhoto(user.id, id);
  if (!photo) return jsonError("Photo not found.", 404);

  const analysis = getLatestAnalysis(user.id, photo.id);
  if (!analysis?.plan) {
    return jsonError("Build a cleanup plan first.", 409);
  }
  const adjustments = analysis.plan.adjustments;
  if (!hasAdjustments(adjustments)) {
    return jsonError(
      "This plan has nothing Blinked can apply on its own — every step needs a full editor.",
      409,
    );
  }

  try {
    const edited = await applyAdjustments(await readPhotoFile(photo), adjustments);
    const file = await writeEditedPhoto(photo, edited);
    saveEditedPhoto(user.id, photo.id, file, adjustments);

    const updated = getPhoto(user.id, photo.id);
    return NextResponse.json({ photo: updated ? photoToView(updated) : null });
  } catch (error) {
    console.error(`[apply] photo ${photo.id}:`, error);
    return jsonError("Could not apply the edits to that photo.", 500);
  }
}

export async function DELETE(_request: Request, { params }: Context) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const { id } = await params;
  const photo = getPhoto(user.id, id);
  if (!photo) return jsonError("Photo not found.", 404);
  if (!photo.edited_name) return jsonError("This photo has no edited copy.", 404);

  clearEditedPhoto(user.id, photo.id);
  await deleteEditedPhoto(photo, photo.edited_name);

  const updated = getPhoto(user.id, photo.id);
  return NextResponse.json({ photo: updated ? photoToView(updated) : null });
}
