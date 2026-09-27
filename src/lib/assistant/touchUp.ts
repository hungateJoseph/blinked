/**
 * The automatic touch-up: what happens when a photo is sent to the assistant.
 *
 * It is the same pipeline the AI Image Cleanup tool runs — local sharpness
 * check, the model's scan, a plan, apply — but with no questions asked, because
 * the photographer is at a wedding and wants the picture back, not a
 * questionnaire. The plan makes sensible assumptions and says what they were.
 *
 * Everything it produces is stored the normal way (an analysis row with the
 * plan, an edited copy on the photo), so the photo page shows exactly what
 * was done and Revert works as usual.
 */
import {
  analyzePhotoWithAi,
  hasAdjustments,
  isAiConfigured,
  planTouchUpWithAi,
  type Adjustments,
  type CleanupPlan,
  type PhotoAnalysis,
} from "../ai";
import { describeAdjustments } from "../adjustments";
import type { PhotoRow } from "../db";
import {
  applyAdjustments,
  describeSharpness,
  measureSharpness,
  prepareForAi,
  readPhotoFile,
  writeEditedPhoto,
} from "../photos";
import {
  buildLocalAnalysis,
  buildLocalPlan,
  getPhoto,
  insertAnalysis,
  photoToView,
  saveAnswersAndPlan,
  saveEditedPhoto,
  type PhotoView,
} from "../photoStore";
import { applyPreset, type StylePreset } from "./catalog";

export interface TouchUpResult {
  photo: PhotoView;
  /** False when the plan found nothing this app can change itself. */
  edited: boolean;
  quality: PhotoAnalysis["overallQuality"];
  summary: string;
  issues: { category: string; severity: string; description: string; location: string }[];
  /** The adjustments applied, in words ("Exposure +12"). */
  applied: string[];
  /** Steps that need a real editor — never silently dropped. */
  manualSteps: { title: string; detail: string }[];
  /** The assumptions the plan made. */
  notes: string;
  source: "ai" | "local";
}

export async function touchUpPhoto(input: {
  userId: string;
  photo: PhotoRow;
  style: StylePreset;
  allowCrop: boolean;
  /** What the photographer said with the photo, if anything. */
  instructions: string;
  /** The standing notes on the photo skill. */
  notes: string;
  assistantName: string;
}): Promise<TouchUpResult> {
  const { userId, photo } = input;
  const original = await readPhotoFile(photo);
  const sharpness = await measureSharpness(original);

  let analysis: PhotoAnalysis;
  let plan: CleanupPlan;
  let source: "ai" | "local";

  if (isAiConfigured()) {
    const image = await prepareForAi(original);
    analysis = await analyzePhotoWithAi({
      imageBase64: image.base64,
      mediaType: image.mediaType,
      fileName: photo.original_name,
      width: photo.width,
      height: photo.height,
      sharpness,
      sharpnessLabel: describeSharpness(sharpness),
    });
    plan = await planTouchUpWithAi({
      imageBase64: image.base64,
      mediaType: image.mediaType,
      analysis,
      allowCrop: input.allowCrop,
      instructions: input.instructions,
      photographerNotes: input.notes,
    });
    source = "ai";
  } else {
    analysis = buildLocalAnalysis(sharpness);
    plan = buildLocalPlan(analysis, {});
    source = "local";
  }

  // The look is layered on deterministically rather than asked of the model,
  // so "bright & airy" means the same thing on every photo.
  const adjustments: Adjustments = applyPreset(plan.adjustments, input.style);
  if (!input.allowCrop) adjustments.crop = null;
  const finalPlan: CleanupPlan = { ...plan, adjustments };

  // Recorded like any other plan, with the "answers" explaining that nobody
  // was asked — the photo page shows it under the scan as usual.
  const stored = insertAnalysis({ photoId: photo.id, sharpness, analysis, source });
  saveAnswersAndPlan(
    userId,
    stored.id,
    { automatic: `Touched up automatically by ${input.assistantName} (style: ${input.style}).` },
    finalPlan,
  );

  let edited = false;
  if (hasAdjustments(adjustments)) {
    const bytes = await applyAdjustments(original, adjustments);
    const file = await writeEditedPhoto(photo, bytes);
    saveEditedPhoto(userId, photo.id, file, adjustments);
    edited = true;
  }

  const updated = getPhoto(userId, photo.id) ?? photo;
  return {
    photo: photoToView(updated),
    edited,
    quality: analysis.overallQuality,
    summary: analysis.summary,
    issues: analysis.issues.map((i) => ({
      category: i.category,
      severity: i.severity,
      description: i.description,
      location: i.location,
    })),
    applied: describeAdjustments(adjustments),
    manualSteps: finalPlan.steps
      .filter((s) => !s.automatic && !/^no edits needed$/i.test(s.title))
      .map((s) => ({ title: s.title, detail: s.detail })),
    notes: finalPlan.notes,
    source,
  };
}
