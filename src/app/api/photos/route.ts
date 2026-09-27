/**
 * GET  /api/photos — the signed-in user's uploaded photos, newest first
 * POST /api/photos — upload ONE photo (multipart form field "photo")
 *
 * Beta limit: exactly one file per request. The uploader in the browser also
 * disables itself while an upload is in flight, so uploads happen one at a time.
 */
import { NextResponse } from "next/server";
import { jsonError, unauthorized } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import { insertPhoto, listPhotos, photoToView } from "@/lib/photoStore";
import { PhotoValidationError, storeUploadedPhoto } from "@/lib/photos";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  return NextResponse.json({ photos: listPhotos(user.id).map(photoToView) });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonError("Expected a multipart form upload.");
  }

  const files = form.getAll("photo").filter((value): value is File => value instanceof File);
  if (files.length !== 1) {
    return jsonError("Please upload exactly one photo at a time (beta limit).");
  }

  try {
    const row = await storeUploadedPhoto(user.id, files[0]);
    insertPhoto(row);
    return NextResponse.json({ photo: photoToView(row) }, { status: 201 });
  } catch (error) {
    if (error instanceof PhotoValidationError) return jsonError(error.message);
    throw error;
  }
}
