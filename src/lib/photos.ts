/**
 * Photo file storage and image processing.
 *
 * Uploaded files live on disk at ./uploads/<user_id>/<photo_id>.<ext>; only
 * metadata goes in the database. `sharp` does the image work: validating that
 * a file really is an image, reading dimensions, making a smaller copy for the
 * AI, and measuring blur.
 */
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { Adjustments } from "./ai";
import type { PhotoRow } from "./db";
import { newId, nowIso } from "./util";

// Like the database, uploaded photos must live on a disk that survives
// redeploys in production. Defaults to ./uploads for local development.
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(process.cwd(), "uploads");

/** Accepted upload types and the file extension we store them with. */
const ALLOWED_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024; // 15 MB

/** Thrown for problems the user can fix (wrong type, too large, ...). */
export class PhotoValidationError extends Error {}

/**
 * Validate an uploaded file, write it to disk and return the database row
 * describing it (the caller inserts the row).
 */
export async function storeUploadedPhoto(userId: string, file: File): Promise<PhotoRow> {
  const ext = ALLOWED_TYPES[file.type];
  if (!ext) {
    throw new PhotoValidationError("Please upload a JPEG, PNG or WebP image.");
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new PhotoValidationError("That file is larger than the 15 MB limit.");
  }

  const bytes = Buffer.from(await file.arrayBuffer());

  // sharp refuses to read anything that is not a real image, which protects
  // us from a renamed .exe pretending to be a .jpg.
  let width: number | undefined;
  let height: number | undefined;
  try {
    const meta = await sharp(bytes).metadata();
    width = meta.width;
    height = meta.height;
  } catch {
    throw new PhotoValidationError("That file does not look like a valid image.");
  }
  if (!width || !height) {
    throw new PhotoValidationError("Could not read the image dimensions.");
  }

  const id = newId();
  const storedName = `${id}.${ext}`;
  const dir = path.join(UPLOAD_DIR, userId);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, storedName), bytes);

  return {
    id,
    user_id: userId,
    original_name: file.name || `photo.${ext}`,
    stored_name: storedName,
    mime: file.type,
    size: file.size,
    width,
    height,
    created_at: nowIso(),
    // No cleanup plan has been applied yet.
    edited_name: null,
    edited_width: null,
    edited_height: null,
    edited_size: null,
    edits_json: null,
    edited_at: null,
  };
}

/** Absolute path of a stored photo. */
function photoPath(photo: PhotoRow): string {
  return path.join(UPLOAD_DIR, photo.user_id, photo.stored_name);
}

/** Read the original bytes back from disk. */
export function readPhotoFile(photo: PhotoRow): Promise<Buffer> {
  return fs.readFile(photoPath(photo));
}

/** Remove the file from disk (ignores a file that is already gone). */
export async function deletePhotoFile(photo: PhotoRow): Promise<void> {
  await fs.rm(photoPath(photo), { force: true });
}

/**
 * Make a version of the photo suitable to send to the model: rotated the right
 * way up (using the EXIF orientation), at most 1600px on the long side, and
 * JPEG-encoded. That keeps requests small and well under API image limits.
 */
export async function prepareForAi(
  original: Buffer,
): Promise<{ base64: string; mediaType: "image/jpeg" }> {
  const jpeg = await sharp(original)
    .rotate()
    .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
  return { base64: jpeg.toString("base64"), mediaType: "image/jpeg" };
}

/**
 * A simple, local blur measurement: the variance of the Laplacian.
 *
 * The Laplacian responds to edges. A sharp image has many strong edges, so
 * the values vary a lot (high variance); a blurry image has soft edges and a
 * low variance. This works with no AI at all and is also passed to the model as
 * a hint. Typical values: below ~50 is usually blurry, above ~150 is usually
 * sharp — but it depends on the subject, so treat it as a hint, not a verdict.
 */
export async function measureSharpness(original: Buffer): Promise<number> {
  const { data, info } = await sharp(original)
    .rotate()
    .resize({ width: 800, height: 800, fit: "inside", withoutEnlargement: true })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height } = info;
  let sum = 0;
  let sumOfSquares = 0;
  let count = 0;

  // Skip the 1px border so every pixel has four neighbours.
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const laplacian =
        4 * data[i] - data[i - 1] - data[i + 1] - data[i - width] - data[i + width];
      sum += laplacian;
      sumOfSquares += laplacian * laplacian;
      count++;
    }
  }
  if (count === 0) return 0;

  const mean = sum / count;
  const variance = sumOfSquares / count - mean * mean;
  return Math.round(variance * 10) / 10;
}

/** Put the sharpness number into words for the UI and for the model. */
export function describeSharpness(score: number): "likely blurry" | "a little soft" | "sharp" {
  if (score < 50) return "likely blurry";
  if (score < 150) return "a little soft";
  return "sharp";
}

// ---------------------------------------------------------------------------
// Applying a cleanup plan
// ---------------------------------------------------------------------------

/** Smooth 0→1 ramp between two edges, for weighting highlights and shadows. */
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Build a 256-entry lookup table per colour channel.
 *
 * sharp has no highlight or shadow slider, so the tonal work is done here as a
 * curve and applied to the raw pixels. A lookup table means the curve is
 * computed 256 times rather than once per pixel, which keeps a full-size photo
 * well under a tenth of a second.
 *
 * Order matters and matches how an editor works: exposure scales everything,
 * then highlights and shadows move their own ends of the range, then contrast
 * pivots around the middle. Temperature is a per-channel gain on top.
 */
function buildToneTables(adj: Adjustments): [Uint8Array, Uint8Array, Uint8Array] {
  const exposureScale = Math.pow(2, adj.exposure / 100); // ±1 stop at the extremes
  const contrast = 1 + adj.contrast / 100;

  // Warming raises red and lowers blue; cooling does the reverse. The divisor
  // keeps even a full-strength move believable rather than a colour filter.
  const warmth = adj.temperature / 300;
  const channelGain = [1 + warmth, 1, 1 - warmth];

  const tables = [new Uint8Array(256), new Uint8Array(256), new Uint8Array(256)];

  for (let v = 0; v < 256; v++) {
    let x = v / 255;

    x *= exposureScale;

    // Each control only moves its own end of the tonal range.
    if (adj.highlights !== 0) x += (adj.highlights / 100) * 0.5 * smoothstep(0.5, 1, x);
    if (adj.shadows !== 0) x += (adj.shadows / 100) * 0.5 * (1 - smoothstep(0, 0.5, x));

    x = 0.5 + (x - 0.5) * contrast;

    for (let c = 0; c < 3; c++) {
      const out = x * channelGain[c];
      tables[c][v] = Math.max(0, Math.min(255, Math.round(out * 255)));
    }
  }

  return tables as [Uint8Array, Uint8Array, Uint8Array];
}

/** True when the tonal part of the plan would actually change any pixel. */
function hasToneWork(adj: Adjustments): boolean {
  return [adj.exposure, adj.highlights, adj.shadows, adj.contrast, adj.temperature].some(
    (v) => Math.abs(v) >= 1,
  );
}

/**
 * Apply a cleanup plan's adjustments and return the edited JPEG.
 *
 * The original buffer is never modified and the caller writes the result to a
 * separate file, so applying a plan is always reversible.
 *
 * Steps run in the order an editor would: straighten and crop first so later
 * work is measured against the final frame, then tone, colour, noise, and
 * sharpening last — sharpening before a resize or a blur would fight itself.
 */
export async function applyAdjustments(original: Buffer, adj: Adjustments): Promise<Buffer> {
  // `rotate()` with no argument applies the EXIF orientation, so everything
  // below works on the image the right way up.
  let pipeline = sharp(original).rotate();

  if (Math.abs(adj.straighten) >= 0.1) {
    // A straighten leaves empty corners; filling them with a neutral grey is
    // honest, and a crop (if the plan includes one) usually removes them.
    pipeline = pipeline.rotate(adj.straighten, {
      background: { r: 250, g: 250, b: 249, alpha: 1 },
    });
  }

  if (adj.crop) {
    const meta = await pipeline.toBuffer({ resolveWithObject: true });
    const { width = 0, height = 0 } = meta.info;
    // Clamp into the frame: a model-supplied rectangle that runs off the edge
    // would make sharp throw rather than simply crop to what exists.
    const left = Math.round(Math.min(Math.max(adj.crop.left, 0), 0.95) * width);
    const top = Math.round(Math.min(Math.max(adj.crop.top, 0), 0.95) * height);
    const cropWidth = Math.max(16, Math.round(Math.min(adj.crop.width, 1) * width));
    const cropHeight = Math.max(16, Math.round(Math.min(adj.crop.height, 1) * height));
    pipeline = sharp(meta.data).extract({
      left,
      top,
      width: Math.min(cropWidth, width - left),
      height: Math.min(cropHeight, height - top),
    });
  }

  if (hasToneWork(adj)) {
    const { data, info } = await pipeline.raw().toBuffer({ resolveWithObject: true });
    const tables = buildToneTables(adj);
    const channels = info.channels;
    // Only the colour channels are mapped; an alpha channel is left alone.
    for (let i = 0; i < data.length; i += channels) {
      data[i] = tables[0][data[i]];
      data[i + 1] = tables[1][data[i + 1]];
      data[i + 2] = tables[2][data[i + 2]];
    }
    pipeline = sharp(data, { raw: { width: info.width, height: info.height, channels } });
  }

  if (Math.abs(adj.saturation) >= 1) {
    pipeline = pipeline.modulate({ saturation: Math.max(0, 1 + adj.saturation / 100) });
  }

  if (adj.denoise >= 1) {
    // median() takes a window size; 3 is a gentle clean-up, 5 is already heavy.
    pipeline = pipeline.median(adj.denoise > 50 ? 5 : 3);
  }

  if (adj.sharpen >= 1) {
    // Keep sigma in a range that sharpens detail without ringing on edges.
    pipeline = pipeline.sharpen({ sigma: 0.5 + (adj.sharpen / 100) * 1.5 });
  }

  return pipeline.jpeg({ quality: 92 }).toBuffer();
}

/** Write an edited copy next to the original and return its stored filename. */
export async function writeEditedPhoto(
  photo: PhotoRow,
  bytes: Buffer,
): Promise<{ storedName: string; width: number; height: number; size: number }> {
  const storedName = `${photo.id}-edited.jpg`;
  const dir = path.join(UPLOAD_DIR, photo.user_id);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, storedName), bytes);

  const meta = await sharp(bytes).metadata();
  return {
    storedName,
    width: meta.width ?? photo.width,
    height: meta.height ?? photo.height,
    size: bytes.length,
  };
}

/** Read an edited copy back. */
export function readEditedPhoto(photo: PhotoRow, storedName: string): Promise<Buffer> {
  return fs.readFile(path.join(UPLOAD_DIR, photo.user_id, storedName));
}

/** Remove an edited copy, leaving the original untouched. */
export async function deleteEditedPhoto(photo: PhotoRow, storedName: string): Promise<void> {
  await fs.rm(path.join(UPLOAD_DIR, photo.user_id, storedName), { force: true });
}
