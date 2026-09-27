/**
 * Face detection in the browser.
 *
 * Everything here runs on the photographer's own machine. A photo is drawn to
 * a canvas, the model finds faces and turns each into 128 numbers, and only
 * those numbers are sent to the server — never a face image, and never to
 * anyone else.
 *
 * The library and its weights are ~13 MB, so they are imported lazily: nothing
 * is downloaded until someone actually opens the People page and starts a scan.
 */
import type * as FaceApi from "@vladmandic/face-api";
import type { DetectedFace } from "./faces";

/** Served from our own origin, so no third-party request is made. */
const MODEL_URL = "/face-models";

let loading: Promise<typeof FaceApi> | null = null;

/**
 * Load the library and its weights once, reusing the same promise if two
 * things ask at the same time.
 */
export function loadFaceEngine(): Promise<typeof FaceApi> {
  if (!loading) {
    loading = (async () => {
      const faceapi = await import("@vladmandic/face-api");
      // No backend juggling needed: in a browser TensorFlow.js selects WebGL
      // when it can and falls back to plain JavaScript when it cannot.
      await Promise.all([
        faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL),
        faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
        faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
      ]);
      return faceapi;
    })().catch((error) => {
      loading = null; // let a later attempt retry rather than fail forever
      throw error;
    });
  }
  return loading;
}

/** Load an image element from a URL, ready to be scanned. */
function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load that image."));
    img.src = url;
  });
}

/** Find every face in an image and describe each one. */
export async function detectFaces(source: string | HTMLImageElement): Promise<DetectedFace[]> {
  const faceapi = await loadFaceEngine();
  const image = typeof source === "string" ? await loadImage(source) : source;

  const results = await faceapi
    .detectAllFaces(image, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.4 }))
    .withFaceLandmarks()
    .withFaceDescriptors();

  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;

  return results.map((r) => ({
    descriptor: Array.from(r.descriptor),
    // Stored as fractions so a box still makes sense if the photo is resized.
    box: {
      x: r.detection.box.x / width,
      y: r.detection.box.y / height,
      width: r.detection.box.width / width,
      height: r.detection.box.height / height,
    },
    confidence: r.detection.score,
  }));
}
