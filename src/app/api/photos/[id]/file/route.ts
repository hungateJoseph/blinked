/**
 * GET /api/photos/:id/file             — the original image bytes
 * GET /api/photos/:id/file?v=edited    — the edited copy, when one exists
 * GET /api/photos/:id/file?download=1  — same bytes, as a file download
 *
 * Owner only. Uploads live outside the public folder on purpose: this route is
 * the only way to view them, and it checks who is asking.
 */
import { jsonError, unauthorized } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import { getPhoto } from "@/lib/photoStore";
import { readEditedPhoto, readPhotoFile } from "@/lib/photos";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const { id } = await params;
  const photo = getPhoto(user.id, id);
  if (!photo) return jsonError("Photo not found.", 404);

  const url = new URL(request.url);
  const wantsEdited = url.searchParams.get("v") === "edited";
  if (wantsEdited && !photo.edited_name) {
    return jsonError("This photo has no edited copy.", 404);
  }

  const bytes = wantsEdited
    ? await readEditedPhoto(photo, photo.edited_name!)
    : await readPhotoFile(photo);

  const headers: Record<string, string> = {
    "Content-Type": wantsEdited ? "image/jpeg" : photo.mime,
    "Content-Length": String(bytes.length),
    "Cache-Control": "private, max-age=3600",
  };

  if (url.searchParams.get("download") === "1") {
    // Offer a name the photographer will recognise next to the original.
    const base = photo.original_name.replace(/\.[^.]+$/, "");
    const name = wantsEdited ? `${base}-cleaned.jpg` : photo.original_name;
    headers["Content-Disposition"] = `attachment; filename="${name.replace(/"/g, "")}"`;
  }

  return new Response(new Uint8Array(bytes), { headers });
}
