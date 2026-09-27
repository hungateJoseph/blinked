/**
 * GET    /api/assistant — the signed-in photographer's Smart Photographer configuration
 * PUT    /api/assistant — create or replace it (the whole configuration, validated)
 * DELETE /api/assistant — remove it, along with the conversation
 */
import { NextResponse } from "next/server";
import { jsonError, readJson, unauthorized } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import { parseAssistantConfig } from "@/lib/assistant/catalog";
import { deleteAssistant, getAssistant, saveAssistant } from "@/lib/assistant/store";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  return NextResponse.json({ assistant: getAssistant(user.id) });
}

export async function PUT(request: Request) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const config = parseAssistantConfig(await readJson(request));
  if (!config) return jsonError("That configuration is not valid — check the lengths of the notes.");

  saveAssistant(user.id, config);
  return NextResponse.json({ assistant: config });
}

export async function DELETE() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  deleteAssistant(user.id);
  return NextResponse.json({ ok: true });
}
