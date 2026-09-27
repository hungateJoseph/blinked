/**
 * POST /api/assistant/skills/assess  { brief, skillsOn }
 *
 * The photographer's brief — everything they wrote to add to or change their
 * assistant — is split into items by Claude and each is checked against the
 * fixed list of what the assistant can and cannot do. Nothing is saved here:
 * the browser shows the result and stores it with the configuration, tied to
 * the exact text it was made for.
 */
import { NextResponse } from "next/server";
import { AiError, isAiConfigured, understandBriefWithAi } from "@/lib/ai";
import { jsonError, readJson, unauthorized } from "@/lib/api";
import { LIMITS, SKILLS, type Understanding } from "@/lib/assistant/catalog";
import { getCurrentUser } from "@/lib/auth";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!isAiConfigured()) {
    return jsonError("Checking the brief needs ANTHROPIC_API_KEY to be configured on the server.", 503);
  }

  const body = await readJson(request);
  const brief = typeof body.brief === "string" ? body.brief.trim().slice(0, LIMITS.brief) : "";
  if (brief.length < 5) return jsonError("Write what you want added or changed first.");

  const known = new Set<string>(SKILLS.map((s) => s.name));
  const skillsOn = Array.isArray(body.skillsOn)
    ? body.skillsOn.filter((s): s is string => typeof s === "string" && known.has(s))
    : [];

  try {
    const items = await understandBriefWithAi({ brief, skillsOn });
    const understanding: Understanding = { brief, items, checkedAt: new Date().toISOString() };
    return NextResponse.json({ understanding });
  } catch (error) {
    if (error instanceof AiError) return jsonError(error.message, 502);
    console.error("[assistant] assess:", error);
    return jsonError("Could not check the brief right now. Please try again.", 500);
  }
}
