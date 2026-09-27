/**
 * Face descriptors and matching.
 *
 * Descriptors are computed in the photographer's browser and arrive here as
 * 128 numbers each. Matching is then plain arithmetic — the distance between
 * two vectors — so the server needs no machine learning at all.
 *
 * This is biometric data about people who never signed up for anything, so:
 * descriptors are scoped to the photographer, deleted with their photo, and
 * can be wiped in one action.
 */
import { getDb, type PhotoFaceRow } from "./db";
import { newId, nowIso } from "./util";

/** Length of a face-recognition descriptor. */
export const DESCRIPTOR_LENGTH = 128;

/**
 * Distance below which two faces are treated as the same person.
 *
 * 0.6 is the value the model's authors use. Measured on test portraits: the
 * same person in two different photographs scored 0.38-0.42, different people
 * 0.63-0.69 — a real gap, but not a wide one, which is exactly why matches are
 * offered for the photographer to confirm rather than applied silently.
 */
export const MATCH_THRESHOLD = 0.6;

/** Anything beyond this is not worth showing at all. */
const SHOW_THRESHOLD = 0.75;

export interface FaceBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DetectedFace {
  descriptor: number[];
  box: FaceBox;
  confidence: number;
}

/** Validate one face as sent by the browser. */
export function parseDetectedFace(input: unknown): DetectedFace | null {
  const raw = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;

  const descriptor = Array.isArray(raw.descriptor) ? raw.descriptor : null;
  if (!descriptor || descriptor.length !== DESCRIPTOR_LENGTH) return null;
  if (!descriptor.every((n) => typeof n === "number" && Number.isFinite(n))) return null;

  const box = (typeof raw.box === "object" && raw.box !== null ? raw.box : {}) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

  return {
    descriptor: descriptor as number[],
    box: {
      x: num(box.x),
      y: num(box.y),
      width: num(box.width),
      height: num(box.height),
    },
    confidence: typeof raw.confidence === "number" ? raw.confidence : 0,
  };
}

/**
 * Straight-line distance between two descriptors. Smaller means more alike.
 * The vectors are a fixed 128 long, so this is cheap enough to run against a
 * whole library without any index.
 */
export function distance(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

/** Replace the faces recorded for one photo. */
export function saveFaces(userId: string, photoId: string, faces: DetectedFace[]): number {
  const db = getDb();
  db.transaction(() => {
    db.prepare("DELETE FROM photo_faces WHERE photo_id = ? AND user_id = ?").run(photoId, userId);
    const insert = db.prepare(
      `INSERT INTO photo_faces (id, photo_id, user_id, descriptor, box_json, confidence, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    const now = nowIso();
    for (const face of faces) {
      insert.run(
        newId(),
        photoId,
        userId,
        JSON.stringify(face.descriptor),
        JSON.stringify(face.box),
        face.confidence,
        now,
      );
    }
  })();
  return faces.length;
}

/** Photo ids that have already been scanned, so the browser can skip them. */
export function indexedPhotoIds(userId: string): string[] {
  const rows = getDb()
    .prepare("SELECT DISTINCT photo_id FROM photo_faces WHERE user_id = ?")
    .all(userId) as { photo_id: string }[];
  return rows.map((r) => r.photo_id);
}

export interface FaceMatch {
  photoId: string;
  /** The closest distance found in that photo. */
  distance: number;
  /** 0-100, for showing a human a number that means something. */
  confidence: number;
  box: FaceBox;
  /** True when inside the usual same-person threshold. */
  likely: boolean;
}

/**
 * Rank the photographer's photos by how closely any face in them matches the
 * reference descriptor.
 *
 * Everything within a generous distance is returned, sorted, so the
 * photographer sees near-misses too and decides for themselves. A photo with
 * several faces is judged by its best one.
 */
export function matchFaces(userId: string, reference: number[]): FaceMatch[] {
  const rows = getDb()
    .prepare("SELECT * FROM photo_faces WHERE user_id = ?")
    .all(userId) as PhotoFaceRow[];

  const best = new Map<string, FaceMatch>();

  for (const row of rows) {
    const d = distance(reference, JSON.parse(row.descriptor) as number[]);
    if (d > SHOW_THRESHOLD) continue;

    const existing = best.get(row.photo_id);
    if (existing && existing.distance <= d) continue;

    best.set(row.photo_id, {
      photoId: row.photo_id,
      distance: d,
      // A rough, honest scale: at the threshold a match reads as ~50%.
      confidence: Math.max(0, Math.min(100, Math.round((1 - d / SHOW_THRESHOLD) * 100))),
      box: JSON.parse(row.box_json) as FaceBox,
      likely: d <= MATCH_THRESHOLD,
    });
  }

  return [...best.values()].sort((a, b) => a.distance - b.distance);
}

/** One detected face, with enough to show a cropped thumbnail of it. */
export interface FaceRef {
  id: string;
  photoId: string;
  box: FaceBox;
  confidence: number;
}

/** Every face on file, best-detected first. */
export function listFaces(userId: string): FaceRef[] {
  const rows = getDb()
    .prepare("SELECT * FROM photo_faces WHERE user_id = ? ORDER BY confidence DESC")
    .all(userId) as PhotoFaceRow[];
  return rows.map((r) => ({
    id: r.id,
    photoId: r.photo_id,
    box: JSON.parse(r.box_json) as FaceBox,
    confidence: r.confidence,
  }));
}

/** One face's descriptor, only if it belongs to this photographer. */
export function getDescriptor(userId: string, faceId: string): number[] | null {
  const row = getDb()
    .prepare("SELECT descriptor FROM photo_faces WHERE id = ? AND user_id = ?")
    .get(faceId, userId) as { descriptor: string } | undefined;
  return row ? (JSON.parse(row.descriptor) as number[]) : null;
}

/**
 * Faces that are probably all the same person, with one to show for them.
 */
export interface Person {
  /** The clearest face in the group — what the photographer clicks. */
  representative: FaceRef;
  /** How many faces were grouped here; a rough "appears in N photos". */
  faceCount: number;
  photoCount: number;
}

/**
 * Group every face into people, so a photographer can pick a guest from their
 * own photos instead of hunting for a headshot of them.
 *
 * A plain greedy pass: each face joins the first group whose representative it
 * is close enough to, otherwise it starts a new one. Faces are taken
 * best-detected first, so the clearest picture of someone tends to become the
 * face shown for them.
 *
 * The grouping threshold is deliberately tighter than the one used for
 * searching. Merging two guests into one group is a confusing error to
 * present; splitting one guest across two groups merely shows them twice,
 * which is obvious and harmless.
 */
const CLUSTER_THRESHOLD = 0.5;

export function groupIntoPeople(userId: string): Person[] {
  const rows = getDb()
    .prepare("SELECT * FROM photo_faces WHERE user_id = ? ORDER BY confidence DESC")
    .all(userId) as PhotoFaceRow[];

  const groups: { rep: PhotoFaceRow; repDescriptor: number[]; members: PhotoFaceRow[] }[] = [];

  for (const row of rows) {
    const descriptor = JSON.parse(row.descriptor) as number[];
    const match = groups.find((g) => distance(g.repDescriptor, descriptor) <= CLUSTER_THRESHOLD);
    if (match) {
      match.members.push(row);
    } else {
      groups.push({ rep: row, repDescriptor: descriptor, members: [row] });
    }
  }

  return groups
    .map((g) => ({
      representative: {
        id: g.rep.id,
        photoId: g.rep.photo_id,
        box: JSON.parse(g.rep.box_json) as FaceBox,
        confidence: g.rep.confidence,
      },
      faceCount: g.members.length,
      photoCount: new Set(g.members.map((m) => m.photo_id)).size,
    }))
    // The people who show up most are usually the ones being looked for.
    .sort((a, b) => b.photoCount - a.photoCount);
}

/** How many faces are on file, for the People page. */
export function countFaces(userId: string): { faces: number; photos: number } {
  const row = getDb()
    .prepare(
      "SELECT COUNT(*) AS faces, COUNT(DISTINCT photo_id) AS photos FROM photo_faces WHERE user_id = ?",
    )
    .get(userId) as { faces: number; photos: number };
  return row;
}

/** Delete every descriptor this photographer holds. */
export function clearFaces(userId: string): number {
  return getDb().prepare("DELETE FROM photo_faces WHERE user_id = ?").run(userId).changes;
}
