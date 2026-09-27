/**
 * PUT /api/photos/:id/faces  { faces: [...] }
 *
 * Records the faces the photographer's browser found in one photo. The body is
 * a list of 128-number descriptors and boxes — no image data.
 *
 * PUT rather than POST because it replaces whatever was recorded before, so
 * re-scanning a photo is safe to repeat.
 */
import { NextResponse } from "next/server";
import { jsonError, readJson, unauthorized } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import { listFaces, parseDetectedFace, saveFaces } from "@/lib/faces";
import { getPhoto } from "@/lib/photoStore";

/** GET — the faces already recorded in this photo, with their ids. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const { id } = await params;
  const photo = getPhoto(user.id, id);
  if (!photo) return jsonError("Photo not found.", 404);

  return NextResponse.json({ faces: listFaces(user.id).filter((f) => f.photoId === photo.id) });
}

/** A crowd scene can hold a lot of faces, but not this many. */
const MAX_FACES = 100;

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const { id } = await params;
  const photo = getPhoto(user.id, id);
  if (!photo) return jsonError("Photo not found.", 404);

  const body = await readJson(request);
  if (!Array.isArray(body.faces)) return jsonError("Expected a list of faces.");
  if (body.faces.length > MAX_FACES) return jsonError("Too many faces in one photo.");

  const faces = [];
  for (const item of body.faces) {
    const face = parseDetectedFace(item);
    if (!face) return jsonError("A face descriptor was not in the expected shape.");
    faces.push(face);
  }

  return NextResponse.json({ saved: saveFaces(user.id, photo.id, faces) });
}
