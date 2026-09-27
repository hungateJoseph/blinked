/**
 * POST /api/faces/match  { descriptor: number[128] }
 *
 * Ranks the photographer's photos by how closely any face in them matches the
 * reference face, which their browser described from a photo of the person
 * they are looking for.
 *
 * Only arithmetic happens here: the distance between two vectors. The results
 * are a suggestion for the photographer to confirm, never a verdict — the gap
 * between "same person" and "different person" is real but narrow, so the app
 * must not pretend otherwise.
 */
import { NextResponse } from "next/server";
import { jsonError, readJson, unauthorized } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import { DESCRIPTOR_LENGTH, getDescriptor, matchFaces } from "@/lib/faces";
import { getPhoto, photoToView } from "@/lib/photoStore";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body = await readJson(request);

  // Two ways to say who to look for: a face already found in the
  // photographer's own photos (the usual way), or a descriptor their browser
  // computed from a photo they supplied.
  let reference: number[] | null = null;

  if (typeof body.faceId === "string") {
    reference = getDescriptor(user.id, body.faceId);
    if (!reference) return jsonError("That face is no longer on file.", 404);
  } else {
    const descriptor = body.descriptor;
    if (
      !Array.isArray(descriptor) ||
      descriptor.length !== DESCRIPTOR_LENGTH ||
      !descriptor.every((n) => typeof n === "number" && Number.isFinite(n))
    ) {
      return jsonError("That reference face was not in the expected shape.");
    }
    reference = descriptor as number[];
  }

  const matches = matchFaces(user.id, reference);

  // Attach what the browser needs to show each photo, dropping any whose row
  // has since gone.
  const results = matches
    .map((match) => {
      const photo = getPhoto(user.id, match.photoId);
      return photo ? { ...match, photo: photoToView(photo) } : null;
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  return NextResponse.json({ matches: results });
}
