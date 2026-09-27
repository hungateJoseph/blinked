/**
 * PATCH  /api/enquiries/:id  { read?, archived? } — mark read or archive
 * DELETE /api/enquiries/:id                       — delete it outright
 *
 * Deleting really deletes: an enquiry holds a couple's name and contact
 * details, so the photographer needs a way to get rid of them for good.
 */
import { NextResponse } from "next/server";
import { jsonError, readJson, unauthorized } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import { countUnread, deleteEnquiry, updateEnquiry } from "@/lib/enquiries";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Context) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const { id } = await params;
  const body = await readJson(request);
  const changes: { read?: boolean; archived?: boolean } = {};
  if (typeof body.read === "boolean") changes.read = body.read;
  if (typeof body.archived === "boolean") changes.archived = body.archived;

  const enquiry = updateEnquiry(user.id, id, changes);
  if (!enquiry) return jsonError("Enquiry not found.", 404);

  return NextResponse.json({ enquiry, unread: countUnread(user.id) });
}

export async function DELETE(_request: Request, { params }: Context) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const { id } = await params;
  if (!deleteEnquiry(user.id, id)) return jsonError("Enquiry not found.", 404);

  return NextResponse.json({ ok: true, unread: countUnread(user.id) });
}
