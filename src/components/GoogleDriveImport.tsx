"use client";

import Script from "next/script";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import ProgressBar from "./ProgressBar";

/**
 * Import photos from Google Drive.
 *
 * Uses Google's own file picker with the `drive.file` scope, which grants
 * access to nothing except the files you choose in that picker — not your
 * Drive, not a folder, just those files. (The scope that can list a whole
 * Drive is "restricted" and needs a Google security review; it would also be
 * far more access than importing a few photos warrants.)
 *
 * The files travel Drive → this browser → Blinked. Going straight from Drive
 * to the server would be one hop fewer, but it would mean handing the server a
 * Google access token; this way the token never leaves the browser, and the
 * upload reuses exactly the same path as choosing a file from disk.
 */
export default function GoogleDriveImport({
  clientId,
  apiKey,
}: {
  clientId: string;
  apiKey: string;
}) {
  const router = useRouter();
  const [pickerReady, setPickerReady] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; name: string } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [imported, setImported] = useState<number | null>(null);
  const [failures, setFailures] = useState<{ name: string; reason: string }[]>([]);
  const tokenClient = useRef<{ requestAccessToken: (o?: { prompt?: string }) => void } | null>(null);

  /** The Picker library loads separately from the rest of gapi. */
  const onGapiLoaded = useCallback(() => {
    window.gapi?.load("picker", () => setPickerReady(true));
  }, []);

  /** Fetch one file's bytes from Drive and hand them to our upload endpoint. */
  async function importFile(
    doc: { id: string; name: string; mimeType: string },
    token: string,
  ): Promise<void> {
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(doc.id)}?alt=media`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) {
      throw new Error(res.status === 403 ? "Blinked was not granted access to that file." : `Drive returned ${res.status}.`);
    }
    const blob = await res.blob();

    const form = new FormData();
    form.append("photo", new File([blob], doc.name, { type: doc.mimeType || blob.type }));
    const upload = await fetch("/api/photos", { method: "POST", body: form });
    if (!upload.ok) {
      const data = (await upload.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error ?? `Upload failed (${upload.status}).`);
    }
  }

  /** Walk the chosen files one at a time, keeping going past any failure. */
  async function importAll(docs: { id: string; name: string; mimeType: string }[], token: string) {
    const failed: { name: string; reason: string }[] = [];
    for (const [i, doc] of docs.entries()) {
      setProgress({ done: i, total: docs.length, name: doc.name });
      try {
        await importFile(doc, token);
      } catch (e) {
        failed.push({ name: doc.name, reason: e instanceof Error ? e.message : "Failed." });
      }
    }
    setProgress(null);
    setFailures(failed);
    setImported(docs.length - failed.length);
    router.refresh();
  }

  function openPicker(token: string) {
    const picker = window.google?.picker;
    if (!picker) {
      setError("Google's file picker did not load. Refresh and try again.");
      return;
    }

    const view = new picker.DocsView(picker.ViewId.DOCS_IMAGES)
      .setIncludeFolders(true)
      .setSelectFolderEnabled(false)
      .setMimeTypes("image/jpeg,image/png,image/webp");

    new picker.PickerBuilder()
      .addView(view)
      .setOAuthToken(token)
      .setDeveloperKey(apiKey)
      // The project number, which is the first part of the client id. With the
      // drive.file scope the picker needs it, or chosen files stay unreachable.
      .setAppId(clientId.split("-")[0])
      .enableFeature(picker.Feature.MULTISELECT_ENABLED)
      .setTitle("Choose wedding photos")
      .setCallback((response) => {
        if (response.action !== picker.Action.PICKED) return;
        const docs = response.docs ?? [];
        if (docs.length > 0) void importAll(docs, token);
      })
      .build()
      .setVisible(true);
  }

  function startImport() {
    setError(null);
    setImported(null);
    setFailures([]);

    if (!tokenClient.current) {
      const oauth2 = window.google?.accounts.oauth2;
      if (!oauth2) {
        setError("Google's library did not load. Refresh and try again.");
        return;
      }
      tokenClient.current = oauth2.initTokenClient({
        client_id: clientId,
        // The narrowest scope that works: only the files picked below.
        scope: "https://www.googleapis.com/auth/drive.file",
        callback: (response) => {
          if (response.error || !response.access_token) {
            setError(
              response.error === "access_denied"
                ? "Blinked was not given access to Google Drive."
                : (response.error_description ?? "Could not get permission from Google."),
            );
            return;
          }
          openPicker(response.access_token);
        },
      });
    }
    tokenClient.current.requestAccessToken();
  }

  const busy = progress !== null;

  return (
    <section className="card space-y-3">
      <Script src="https://accounts.google.com/gsi/client" strategy="afterInteractive" />
      <Script src="https://apis.google.com/js/api.js" strategy="afterInteractive" onLoad={onGapiLoaded} />

      <h2 className="text-lg font-semibold">Import from Google Drive</h2>
      <p className="text-sm text-stone-600">
        Pick photos from your Drive instead of your computer. Blinked is given access only to the
        files you choose — not the rest of your Drive.
      </p>

      {busy ? (
        <ProgressBar
          value={(progress.done / progress.total) * 100}
          label={`Importing ${progress.done + 1} of ${progress.total} — ${progress.name}`}
        />
      ) : (
        <button type="button" className="btn-secondary" onClick={startImport} disabled={!pickerReady}>
          {pickerReady ? "Choose from Google Drive" : "Loading Google Drive…"}
        </button>
      )}

      {imported !== null && imported > 0 && (
        <p className="text-sm text-emerald-700">
          Imported {imported} photo{imported === 1 ? "" : "s"} from Drive.
        </p>
      )}

      {failures.length > 0 && (
        <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-medium">
            {failures.length} could not be imported — the rest came through:
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

      {error && <p className="text-sm text-red-600">{error}</p>}
    </section>
  );
}
