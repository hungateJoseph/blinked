/**
 * GET /api/faces/people
 *
 * The distinct people found across the photographer's photos, each with one
 * face to show for them. This is what lets someone pick a guest out of their
 * own photographs rather than having to find a headshot of them.
 */
import { NextResponse } from "next/server";
import { unauthorized } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import { groupIntoPeople } from "@/lib/faces";
import { getPhoto, photoToView } from "@/lib/photoStore";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const people = groupIntoPeople(user.id)
    .map((person) => {
      const photo = getPhoto(user.id, person.representative.photoId);
      return photo ? { ...person, photo: photoToView(photo) } : null;
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);

  return NextResponse.json({ people });
}
