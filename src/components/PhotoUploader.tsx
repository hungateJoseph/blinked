"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type ChangeEvent } from "react";
import ProgressBar from "./ProgressBar";

/**
 * Photo uploader.
 *
 * Several photos can be chosen at once, but they are sent one at a time: the
 * server takes exactly one file per request, and a queue keeps memory flat
 * whether you pick three photos or three hundred. Each upload reports real
 * progress, which only XMLHttpRequest provides — fetch() cannot.
 */
export default function PhotoUploader() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [queue, setQueue] = useState<{ total: number; done: number; name: string } | null>(null);
  const [fileProgress, setFileProgress] = useState(0);
  const [failures, setFailures] = useState<{ name: string; reason: string }[]>([]);

  /** Upload one file, resolving with its new id or rejecting with a reason. */
  function uploadOne(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const form = new FormData();
      form.append("photo", file);

      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/photos");
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) setFileProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          const { photo } = JSON.parse(xhr.responseText) as { photo: { id: string } };
          resolve(photo.id);
        } else {
          const data = JSON.parse(xhr.responseText || "{}") as { error?: string };
          reject(new Error(data.error ?? `Upload failed (${xhr.status}).`));
        }
      };
      xhr.onerror = () => reject(new Error("Upload failed — check your connection."));
      xhr.send(form);
    });
  }

  async function onFilesChosen(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])];
    if (files.length === 0) return;
    setFailures([]);

    const failed: { name: string; reason: string }[] = [];
    let lastId: string | null = null;

    for (const [i, file] of files.entries()) {
      setQueue({ total: files.length, done: i, name: file.name });
      setFileProgress(0);
      try {
        lastId = await uploadOne(file);
      } catch (e) {
        // One bad file should not abandon the rest of the batch.
        failed.push({ name: file.name, reason: e instanceof Error ? e.message : "Failed." });
      }
    }

    setQueue(null);
    setFileProgress(0);
    setFailures(failed);
    if (inputRef.current) inputRef.current.value = "";

    // One photo goes straight to it; a batch stays on the list.
    if (files.length === 1 && lastId) {
      router.push(`/photos/${lastId}`);
    }
    router.refresh();
  }

  const uploading = queue !== null;

  return (
    <section className="card space-y-3">
      <h2 className="text-lg font-semibold">Upload photos</h2>
      <p className="text-sm text-stone-600">
        JPEG, PNG or WebP, up to 15 MB each. Choose as many as you like — they are sent one at a
        time.
      </p>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp"
        disabled={uploading}
        onChange={onFilesChosen}
        className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-rose-600 file:px-4 file:py-2 file:font-medium file:text-white hover:file:bg-rose-700 disabled:opacity-50"
      />

      {queue && (
        <div className="space-y-2">
          <ProgressBar
            value={(queue.done / queue.total) * 100}
            label={`Photo ${queue.done + 1} of ${queue.total} — ${queue.name}`}
          />
          <ProgressBar value={fileProgress} label="This photo" />
        </div>
      )}

      {failures.length > 0 && (
        <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-medium">
            {failures.length} photo{failures.length === 1 ? "" : "s"} could not be uploaded — the
            rest went through:
          </p>
          <ul className="mt-1 list-disc pl-5">
            {failures.map((f) => (
              <li key={f.name}>
                {f.name} — {f.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
