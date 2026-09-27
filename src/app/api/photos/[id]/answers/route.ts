/**
 * POST /api/photos/:id/answers  { answers: { [questionId]: "answer" } }
 *
 * The photographer has answered the follow-up questions from the scan. Store
 * the answers and produce the cleanup plan (Claude, or the local fallback).
 */
import { NextResponse } from "next/server";
import { AiError, isAiConfigured, planCleanupWithAi } from "@/lib/ai";
import { jsonError, readJson, unauthorized } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import { buildLocalPlan, getLatestAnalysis, getPhoto, saveAnswersAndPlan } from "@/lib/photoStore";
import { prepareForAi, readPhotoFile } from "@/lib/photos";

/** Keep only string answers, trimmed and capped, keyed by question id. */
function parseAnswers(value: unknown): Record<string, string> {
  const answers: Record<string, string> = {};
  if (typeof value !== "object" || value === null) return answers;
  for (const [key, answer] of Object.entries(value as Record<string, unknown>)) {
    if (typeof answer === "string") answers[key] = answer.trim().slice(0, 1000);
  }
  return answers;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const { id } = await params;
  const photo = getPhoto(user.id, id);
  if (!photo) return jsonError("Photo not found.", 404);

  const latest = getLatestAnalysis(user.id, photo.id);
  if (!latest) return jsonError("Run the AI Image Cleanup scan first.", 409);

  const body = await readJson(request);
  const answers = parseAnswers(body.answers);

  try {
    // Claude can plan from any analysis, including one the local check
    // produced, so this depends only on whether a key is configured right now.
    let plan;
    if (isAiConfigured()) {
      const image = await prepareForAi(await readPhotoFile(photo));
      plan = await planCleanupWithAi({
        imageBase64: image.base64,
        mediaType: image.mediaType,
        analysis: latest.analysis,
        answers,
      });
    } else {
      plan = buildLocalPlan(latest.analysis, answers);
    }

    const analysis = saveAnswersAndPlan(user.id, latest.id, answers, plan);
    if (!analysis) return jsonError("That analysis no longer exists.", 404);
    return NextResponse.json({ analysis });
  } catch (error) {
    if (error instanceof AiError) return jsonError(error.message, 502);
    console.error(`[answers] photo ${photo.id}:`, error);
    return jsonError("Could not build the cleanup plan. Please try again.", 500);
  }
}
