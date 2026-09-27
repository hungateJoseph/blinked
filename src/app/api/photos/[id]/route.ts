/**
 * GET    /api/photos/:id — the photo's details plus its latest analysis (if any)
 * DELETE /api/photos/:id — remove the photo, its file and its analyses
 */
import { NextResponse } from "next/server";
import { jsonError, unauthorized } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import { deletePhotoRow, getLatestAnalysis, getPhoto, photoToView } from "@/lib/photoStore";
import { deleteEditedPhoto, deletePhotoFile } from "@/lib/photos";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const { id } = await params;
  const photo = getPhoto(user.id, id);
  if (!photo) return jsonError("Photo not found.", 404);

  return NextResponse.json({
    photo: photoToView(photo),
    analysis: getLatestAnalysis(user.id, photo.id),
  });
}

export async function DELETE(_request: Request, { params }: Context) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const { id } = await params;
  const photo = getPhoto(user.id, id);
  if (!photo) return jsonError("Photo not found.", 404);

  deletePhotoRow(user.id, photo.id);
  await deletePhotoFile(photo);
  // An applied cleanup plan leaves a second file, which would otherwise sit on
  // the disk forever with nothing pointing at it.
  if (photo.edited_name) await deleteEditedPhoto(photo, photo.edited_name);
  return NextResponse.json({ ok: true });
}
