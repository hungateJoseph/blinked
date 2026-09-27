/**
 * POST /api/photos/:id/analyze — run the AI Image Cleanup scan.
 *
 * Always measures sharpness locally. With an API key, Claude then looks at the
 * photo for irregularities and writes the follow-up questions; without one, a
 * smaller local-only analysis is returned instead.
 */
import { NextResponse } from "next/server";
import { AiError, analyzePhotoWithAi, isAiConfigured } from "@/lib/ai";
import { jsonError, unauthorized } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import { buildLocalAnalysis, getPhoto, insertAnalysis } from "@/lib/photoStore";
import { describeSharpness, measureSharpness, prepareForAi, readPhotoFile } from "@/lib/photos";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const { id } = await params;
  const photo = getPhoto(user.id, id);
  if (!photo) return jsonError("Photo not found.", 404);

  try {
    // Inside the try: reading the file or decoding it can fail (a file removed
    // from disk, a corrupt image), and that should come back as a readable
    // JSON error rather than an HTML 500 the browser cannot parse.
    const original = await readPhotoFile(photo);
    const sharpness = await measureSharpness(original);

    if (!isAiConfigured()) {
      const analysis = insertAnalysis({
        photoId: photo.id,
        sharpness,
        analysis: buildLocalAnalysis(sharpness),
        source: "local",
      });
      return NextResponse.json({ analysis });
    }

    const image = await prepareForAi(original);
    const result = await analyzePhotoWithAi({
      imageBase64: image.base64,
      mediaType: image.mediaType,
      fileName: photo.original_name,
      width: photo.width,
      height: photo.height,
      sharpness,
      sharpnessLabel: describeSharpness(sharpness),
    });

    const analysis = insertAnalysis({ photoId: photo.id, sharpness, analysis: result, source: "ai" });
    return NextResponse.json({ analysis });
  } catch (error) {
    if (error instanceof AiError) return jsonError(error.message, 502);
    console.error(`[analyze] photo ${photo.id}:`, error);
    return jsonError("Could not read that photo. It may have been moved or removed.", 500);
  }
}
