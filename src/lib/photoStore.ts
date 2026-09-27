/**
 * Database access for photos and their AI Image Cleanup analyses, plus the
 * "local only" fallbacks used when no AI key is configured.
 */
import { NO_ADJUSTMENTS, type Adjustments, type CleanupPlan, type PhotoAnalysis, type PhotoIssue } from "./ai";
import { getDb, type PhotoAnalysisRow, type PhotoRow } from "./db";
import { describeSharpness } from "./photos";
import { newId, nowIso } from "./util";

/** A photo as the browser sees it. */
export interface PhotoView {
  id: string;
  originalName: string;
  mime: string;
  size: number;
  width: number;
  height: number;
  createdAt: string;
  /** URL that serves the original image bytes (owner only). */
  fileUrl: string;
  /** The edited copy, when a cleanup plan has been applied. */
  edited: {
    url: string;
    width: number;
    height: number;
    size: number;
    adjustments: Adjustments;
    editedAt: string;
  } | null;
}

/** One analysis run as the browser sees it. */
export interface AnalysisView {
  id: string;
  photoId: string;
  sharpness: number;
  sharpnessLabel: string;
  analysis: PhotoAnalysis;
  answers: Record<string, string> | null;
  plan: CleanupPlan | null;
  source: PhotoAnalysisRow["source"];
  createdAt: string;
  updatedAt: string;
}

export function photoToView(row: PhotoRow): PhotoView {
  return {
    id: row.id,
    originalName: row.original_name,
    mime: row.mime,
    size: row.size,
    width: row.width,
    height: row.height,
    createdAt: row.created_at,
    fileUrl: `/api/photos/${row.id}/file`,
    edited: row.edited_name
      ? {
          // The query string is what makes the browser fetch this instead of
          // the cached original after an edit is applied or reverted.
          url: `/api/photos/${row.id}/file?v=edited&t=${encodeURIComponent(row.edited_at ?? "")}`,
          width: row.edited_width ?? row.width,
          height: row.edited_height ?? row.height,
          size: row.edited_size ?? 0,
          adjustments: row.edits_json
            ? (JSON.parse(row.edits_json) as Adjustments)
            : NO_ADJUSTMENTS,
          editedAt: row.edited_at ?? "",
        }
      : null,
  };
}

/** Record an edited copy against a photo. */
export function saveEditedPhoto(
  userId: string,
  photoId: string,
  file: { storedName: string; width: number; height: number; size: number },
  adjustments: Adjustments,
): void {
  getDb()
    .prepare(
      `UPDATE photos
       SET edited_name = ?, edited_width = ?, edited_height = ?, edited_size = ?,
           edits_json = ?, edited_at = ?
       WHERE id = ? AND user_id = ?`,
    )
    .run(
      file.storedName,
      file.width,
      file.height,
      file.size,
      JSON.stringify(adjustments),
      nowIso(),
      photoId,
      userId,
    );
}

/** Forget an edited copy. The caller removes the file. */
export function clearEditedPhoto(userId: string, photoId: string): void {
  getDb()
    .prepare(
      `UPDATE photos
       SET edited_name = NULL, edited_width = NULL, edited_height = NULL,
           edited_size = NULL, edits_json = NULL, edited_at = NULL
       WHERE id = ? AND user_id = ?`,
    )
    .run(photoId, userId);
}

function analysisToView(row: PhotoAnalysisRow): AnalysisView {
  return {
    id: row.id,
    photoId: row.photo_id,
    sharpness: row.sharpness,
    sharpnessLabel: describeSharpness(row.sharpness),
    analysis: JSON.parse(row.analysis_json) as PhotoAnalysis,
    answers: row.answers_json ? (JSON.parse(row.answers_json) as Record<string, string>) : null,
    plan: row.plan_json ? (JSON.parse(row.plan_json) as CleanupPlan) : null,
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// --- Photos -----------------------------------------------------------------

export function listPhotos(userId: string): PhotoRow[] {
  return getDb()
    .prepare("SELECT * FROM photos WHERE user_id = ? ORDER BY created_at DESC")
    .all(userId) as PhotoRow[];
}

/** A single photo, only if it belongs to this user. */
export function getPhoto(userId: string, photoId: string): PhotoRow | null {
  const row = getDb()
    .prepare("SELECT * FROM photos WHERE id = ? AND user_id = ?")
    .get(photoId, userId) as PhotoRow | undefined;
  return row ?? null;
}

export function insertPhoto(row: PhotoRow): void {
  getDb()
    .prepare(
      `INSERT INTO photos (id, user_id, original_name, stored_name, mime, size, width, height, created_at)
       VALUES (@id, @user_id, @original_name, @stored_name, @mime, @size, @width, @height, @created_at)`,
    )
    .run(row);
}

/** Delete the database row (analyses cascade). The caller removes the file. */
export function deletePhotoRow(userId: string, photoId: string): void {
  getDb().prepare("DELETE FROM photos WHERE id = ? AND user_id = ?").run(photoId, userId);
}

// --- Analyses ---------------------------------------------------------------
//
// Every function here takes the user id and joins through `photos`, so one
// photographer can never read or change another's analysis. Checking ownership
// in the caller would work too, but only for as long as every caller
// remembers; doing it in the query makes it impossible to forget.

export function getLatestAnalysis(userId: string, photoId: string): AnalysisView | null {
  const row = getDb()
    .prepare(
      `SELECT a.* FROM photo_analyses a
       JOIN photos p ON p.id = a.photo_id
       WHERE a.photo_id = ? AND p.user_id = ?
       ORDER BY a.created_at DESC LIMIT 1`,
    )
    .get(photoId, userId) as PhotoAnalysisRow | undefined;
  return row ? analysisToView(row) : null;
}

export function insertAnalysis(input: {
  photoId: string;
  sharpness: number;
  analysis: PhotoAnalysis;
  source: PhotoAnalysisRow["source"];
}): AnalysisView {
  const now = nowIso();
  const row: PhotoAnalysisRow = {
    id: newId(),
    photo_id: input.photoId,
    sharpness: input.sharpness,
    analysis_json: JSON.stringify(input.analysis),
    answers_json: null,
    plan_json: null,
    source: input.source,
    created_at: now,
    updated_at: now,
  };
  getDb()
    .prepare(
      `INSERT INTO photo_analyses (id, photo_id, sharpness, analysis_json, answers_json, plan_json, source, created_at, updated_at)
       VALUES (@id, @photo_id, @sharpness, @analysis_json, @answers_json, @plan_json, @source, @created_at, @updated_at)`,
    )
    .run(row);
  return analysisToView(row);
}

/** Store the photographer's answers and the resulting plan on an analysis. */
export function saveAnswersAndPlan(
  userId: string,
  analysisId: string,
  answers: Record<string, string>,
  plan: CleanupPlan,
): AnalysisView | null {
  const db = getDb();
  const owned = `id = ? AND photo_id IN (SELECT id FROM photos WHERE user_id = ?)`;

  const result = db
    .prepare(
      `UPDATE photo_analyses SET answers_json = ?, plan_json = ?, updated_at = ? WHERE ${owned}`,
    )
    .run(JSON.stringify(answers), JSON.stringify(plan), nowIso(), analysisId, userId);
  if (result.changes === 0) return null;

  const row = db.prepare(`SELECT * FROM photo_analyses WHERE ${owned}`).get(analysisId, userId) as
    | PhotoAnalysisRow
    | undefined;
  return row ? analysisToView(row) : null;
}

// --- Fallbacks when no AI key is configured ---------------------------------

/**
 * An analysis built only from the local sharpness metric. It deliberately
 * mirrors the shape Claude returns so the UI works identically either way.
 */
export function buildLocalAnalysis(sharpness: number): PhotoAnalysis {
  const label = describeSharpness(sharpness);
  const analysis: PhotoAnalysis = {
    overallQuality: label === "sharp" ? "good" : label === "a little soft" ? "fair" : "poor",
    summary:
      `Local check only (no ANTHROPIC_API_KEY configured): the image looks ${label} ` +
      `(sharpness score ${sharpness}). Add an API key to enable the full AI scan for ` +
      `cut-off faces, closed eyes, exposure, colour and composition problems.`,
    issues: [],
    questions: [],
  };

  if (label !== "sharp") {
    analysis.issues.push({
      id: "issue-1",
      category: "blur",
      severity: label === "likely blurry" ? "high" : "low",
      description: `The sharpness check scored ${sharpness} (${label}); fine detail may be soft.`,
      location: "whole frame",
    });
    analysis.questions.push({
      id: "q-1",
      issueId: "issue-1",
      question: "Was any softness or motion blur intentional (an artistic effect)?",
      options: ["No — please fix it", "Yes — keep it", "Only partly"],
    });
  }
  analysis.questions.push({
    id: "q-general",
    issueId: "",
    question: "Is there anything specific you want cleaned up in this photo?",
    options: [],
  });
  return analysis;
}

/** Standard advice per issue category, used when no AI is available. */
const CATEGORY_ADVICE: Record<PhotoIssue["category"], { title: string; detail: string; toolHint: string }> = {
  blur: {
    title: "Sharpen the image",
    detail:
      "Apply moderate sharpening (amount 60–90, radius 1.0, masking ~40), then check at 100% zoom for halos around edges.",
    toolHint: "Lightroom: Detail > Sharpening",
  },
  face_cutoff: {
    title: "Recompose or crop",
    detail:
      "Crop so the subject sits comfortably inside the frame, or use generative fill to rebuild the missing edge.",
    toolHint: "Lightroom: Crop · Photoshop: Generative Fill",
  },
  closed_eyes: {
    title: "Swap in open eyes",
    detail:
      "Take the eyes from a neighbouring frame in the same burst and blend them in; match grain and skin tone afterwards.",
    toolHint: "Photoshop: layer mask",
  },
  exposure: {
    title: "Correct the exposure",
    detail:
      "Adjust exposure, then recover highlights and lift shadows. Watch the histogram for clipping at either end.",
    toolHint: "Lightroom: Basic > Tone",
  },
  color: {
    title: "Fix the colour cast",
    detail:
      "Set white balance from a neutral surface (a white dress or shirt works well), then fine-tune tint and vibrance.",
    toolHint: "Lightroom: Basic > White Balance",
  },
  composition: {
    title: "Straighten and recompose",
    detail: "Level the horizon, then crop to place the subject on a stronger line.",
    toolHint: "Lightroom: Crop > Angle",
  },
  noise: {
    title: "Reduce noise",
    detail: "Apply luminance noise reduction, keeping detail high enough that skin does not go waxy.",
    toolHint: "Lightroom: Detail > Noise Reduction",
  },
  distraction: {
    title: "Remove the distraction",
    detail: "Clone or heal the distracting element out, matching the surrounding texture.",
    toolHint: "Lightroom: Healing · Photoshop: Clone Stamp",
  },
  other: {
    title: "Review this manually",
    detail: "This one needs your judgement — see the description below.",
    toolHint: "",
  },
};

/**
 * Build a cleanup plan without AI, from whatever analysis is on hand.
 *
 * This runs against AI analyses as well as local ones (if the API key is
 * removed or rate-limited between the scan and the answers), so it works from
 * the issues and questions themselves rather than from any fixed question ids.
 */
export function buildLocalPlan(
  analysis: PhotoAnalysis,
  answers: Record<string, string>,
): CleanupPlan {
  const steps: CleanupPlan["steps"] = [];
  // Without AI the only thing measured is sharpness, so that is the only
  // adjustment that can honestly be proposed.
  const adjustments: Adjustments = { ...NO_ADJUSTMENTS };

  // An answer like "Yes — keep it" means the photographer wants it left alone.
  const wantsToKeep = (answer: string | undefined) =>
    Boolean(answer && /\bkeep\b/i.test(answer) && !/\bdon'?t keep\b/i.test(answer));

  for (const issue of analysis.issues) {
    const question = analysis.questions.find((q) => q.issueId === issue.id);
    if (question && wantsToKeep(answers[question.id])) continue;

    const advice = CATEGORY_ADVICE[issue.category];
    // Only softness can be acted on from a local measurement, and only gently
    // — sharpening cannot rescue a genuinely out-of-focus frame.
    const automatic = issue.category === "blur";
    if (automatic) adjustments.sharpen = issue.severity === "high" ? 45 : 25;

    steps.push({
      title: advice.title,
      detail: `${issue.description} (${issue.location}). ${advice.detail}`.trim(),
      toolHint: advice.toolHint,
      automatic,
    });
  }

  // Free-text answers are requests in their own right, so each becomes a step.
  for (const question of analysis.questions) {
    if (question.options.length > 0) continue;
    const answer = answers[question.id]?.trim();
    if (answer) {
      steps.push({
        title: "Your requested edit",
        detail: answer,
        toolHint: "Manual edit",
        automatic: false,
      });
    }
  }

  if (steps.length === 0) {
    steps.push({
      title: "No edits needed",
      detail: "Nothing in the findings needs fixing, or you chose to keep it as it is.",
      toolHint: "",
      automatic: false,
    });
  }

  return {
    steps,
    adjustments,
    notes: "Standard advice, written without AI. Add an ANTHROPIC_API_KEY for a photo-specific plan.",
  };
}
