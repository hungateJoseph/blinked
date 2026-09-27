"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import FaceThumb from "./FaceThumb";
import ProgressBar from "./ProgressBar";
import { errorFrom } from "@/lib/clientApi";
import { detectFaces } from "@/lib/faceClient";
import type { FaceRef } from "@/lib/faces";
import type { PhotoView } from "@/lib/photoStore";

/**
 * The people in this photo, each with a way to find every other photo of them.
 *
 * This is the shortest path to "show me all the ones with her": you are
 * already looking at a photo containing the person, so you point at them here
 * rather than going to find a separate picture of them.
 */
export default function PhotoFaces({
  photo,
  initialFaces,
}: {
  photo: PhotoView;
  initialFaces: FaceRef[];
}) {
  const router = useRouter();
  const [faces, setFaces] = useState(initialFaces);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanned, setScanned] = useState(initialFaces.length > 0);

  // Scanning needs a browser, so it cannot have happened during the render on
  // the server. If this photo has never been scanned, do it once on arrival.
  useEffect(() => {
    if (scanned || scanning) return;
    let cancelled = false;

    (async () => {
      setScanning(true);
      setError(null);
      try {
        const detected = await detectFaces(photo.fileUrl);
        if (cancelled) return;
        const res = await fetch(`/api/photos/${photo.id}/faces`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ faces: detected }),
        });
        if (!res.ok) throw new Error(await errorFrom(res));
        // Re-read from the server so each face has the id the search needs.
        const listed = await fetch(`/api/photos/${photo.id}/faces`);
        const data = (await listed.json()) as { faces: FaceRef[] };
        if (!cancelled) setFaces(data.faces ?? []);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not scan this photo.");
      } finally {
        if (!cancelled) {
          setScanning(false);
          setScanned(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [photo.id, photo.fileUrl, scanned, scanning]);

  if (scanning) {
    return (
      <section className="card space-y-2">
        <h2 className="text-lg font-semibold">People in this photo</h2>
        <ProgressBar indeterminate label="Looking for faces…" />
      </section>
    );
  }

  if (error) {
    return (
      <section className="card space-y-2">
        <h2 className="text-lg font-semibold">People in this photo</h2>
        <p className="text-sm text-red-600">{error}</p>
      </section>
    );
  }

  if (faces.length === 0) {
    return (
      <section className="card space-y-2">
        <h2 className="text-lg font-semibold">People in this photo</h2>
        <p className="text-sm text-stone-500">No faces were found here.</p>
      </section>
    );
  }

  return (
    <section className="card space-y-3">
      <div>
        <h2 className="text-lg font-semibold">People in this photo</h2>
        <p className="mt-1 text-sm text-stone-600">
          Click someone to find every other photo they appear in.
        </p>
      </div>
      <ul className="flex flex-wrap gap-3">
        {faces.map((face) => (
          <li key={face.id}>
            <button
              type="button"
              onClick={() => router.push(`/people?face=${encodeURIComponent(face.id)}`)}
              className="w-20 space-y-1 rounded-lg border border-stone-200 p-1 hover:border-rose-300"
              title="Find every photo of this person"
            >
              <FaceThumb
                src={photo.fileUrl}
                box={face.box}
                alt="A person in this photo"
                className="rounded"
              />
              <span className="block text-center text-[11px] text-rose-700">Find them</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
