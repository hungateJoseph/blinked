/**
 * GET /api/enquiries?archived=1 — the photographer's enquiries.
 */
import { NextResponse } from "next/server";
import { unauthorized } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import { countUnread, listEnquiries } from "@/lib/enquiries";

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const includeArchived = new URL(request.url).searchParams.get("archived") === "1";
  return NextResponse.json({
    enquiries: listEnquiries(user.id, includeArchived),
    unread: countUnread(user.id),
  });
}
