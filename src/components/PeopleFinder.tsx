"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import FaceThumb from "./FaceThumb";
import ProgressBar from "./ProgressBar";
import { errorFrom, readBody } from "@/lib/clientApi";
import { detectFaces, loadFaceEngine } from "@/lib/faceClient";
import type { FaceMatch, FaceRef } from "@/lib/faces";
import type { PhotoView } from "@/lib/photoStore";

interface MatchResult extends FaceMatch {
  photo: PhotoView;
}

interface Person {
  representative: FaceRef;
  faceCount: number;
  photoCount: number;
  photo: PhotoView;
}

/**
 * Find every photo containing a particular person.
 *
 * Scanning turns each face in the library into 128 numbers, on this machine.
 * Those are then grouped into people, so the photographer picks a guest out of
 * their own photographs — nobody has to supply a headshot of every guest.
 * Uploading a reference photo is still available for someone who is not in the
 * library yet.
 */
export default function PeopleFinder({
  photos,
  initialIndexed,
  initialCounts,
  initialFaceId,
}: {
  photos: PhotoView[];
  initialIndexed: string[];
  initialCounts: { faces: number; photos: number };
  /** A face picked on a photo's own page, to search for straight away. */
  initialFaceId?: string;
}) {
  const [indexed, setIndexed] = useState<Set<string>>(new Set(initialIndexed));
  const [counts, setCounts] = useState(initialCounts);
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [people, setPeople] = useState<Person[] | null>(null);
  const [loadingPeople, setLoadingPeople] = useState(false);
  const [chosen, setChosen] = useState<Person | null>(null);

  const [matches, setMatches] = useState<MatchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [decisions, setDecisions] = useState<Record<string, "yes" | "no">>({});
  const [showUncertain, setShowUncertain] = useState(false);

  const [showUpload, setShowUpload] = useState(false);
  const [referenceUrl, setReferenceUrl] = useState<string | null>(null);
  const referenceInput = useRef<HTMLInputElement>(null);

  const unindexed = photos.filter((p) => !indexed.has(p.id));

  /** Load the grouped people whenever there is something to group. */
  async function loadPeople() {
    setLoadingPeople(true);
    const res = await fetch("/api/faces/people");
    setLoadingPeople(false);
    if (!res.ok) {
      setError(await errorFrom(res));
      return;
    }
    const data = await readBody<{ people: Person[] }>(res);
    setPeople(data.people ?? []);
  }

  useEffect(() => {
    if (counts.faces > 0 && people === null) void loadPeople();
    // Only on first arrival with faces already on file.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [counts.faces]);

  // Arriving from a face clicked on a photo's page: run that search at once,
  // so the click there leads straight to the answer.
  const [handledInitial, setHandledInitial] = useState(false);
  useEffect(() => {
    if (!initialFaceId || handledInitial) return;
    setHandledInitial(true);
    void searchByFaceId(initialFaceId, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFaceId, handledInitial]);

  useEffect(() => {
    return () => {
      if (referenceUrl) URL.revokeObjectURL(referenceUrl);
    };
  }, [referenceUrl]);

  async function scanLibrary() {
    setScanning(true);
    setError(null);
    setScanned(0);
    try {
      setStatus("Loading the face model (about 13 MB, once per visit)…");
      await loadFaceEngine();

      for (const [i, photo] of unindexed.entries()) {
        setStatus(`Scanning ${photo.originalName} (${i + 1} of ${unindexed.length})…`);
        const faces = await detectFaces(photo.fileUrl);
        const res = await fetch(`/api/photos/${photo.id}/faces`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ faces }),
        });
        if (!res.ok) throw new Error(await errorFrom(res));
        setIndexed((current) => new Set(current).add(photo.id));
        setScanned(i + 1);
      }
      setStatus(null);

      const res = await fetch("/api/faces");
      const data = await readBody<{ faces: number; photos: number }>(res);
      if (data.faces !== undefined && data.photos !== undefined) {
        setCounts({ faces: data.faces, photos: data.photos });
      }
      await loadPeople();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The scan failed.");
      setStatus(null);
    } finally {
      setScanning(false);
    }
  }

  /** Search using a face already found in the photographer's own photos. */
  async function searchByFaceId(faceId: string, person: Person | null) {
    setChosen(person);
    setSearching(true);
    setError(null);
    setMatches(null);
    setDecisions({});
    setShowUncertain(false);

    const res = await fetch("/api/faces/match", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ faceId }),
    });
    setSearching(false);
    if (!res.ok) {
      setError(await errorFrom(res));
      return;
    }
    const data = await readBody<{ matches: MatchResult[] }>(res);
    setMatches(data.matches ?? []);
  }

  const findByFace = (person: Person) => searchByFaceId(person.representative.id, person);

  /** Fallback: search using a photo the photographer supplies. */
  async function findByUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setChosen(null);
    setSearching(true);
    setError(null);
    setMatches(null);
    setDecisions({});
    setShowUncertain(false);

    if (referenceUrl) URL.revokeObjectURL(referenceUrl);
    const url = URL.createObjectURL(file);
    setReferenceUrl(url);

    try {
      await loadFaceEngine();
      const faces = await detectFaces(url);
      if (faces.length === 0) {
        setError("No face was found in that photo. Try a clearer, front-on picture.");
        return;
      }
      const subject = faces.reduce((a, b) =>
        a.box.width * a.box.height >= b.box.width * b.box.height ? a : b,
      );
      const res = await fetch("/api/faces/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ descriptor: subject.descriptor }),
      });
      if (!res.ok) throw new Error(await errorFrom(res));
      const data = await readBody<{ matches: MatchResult[] }>(res);
      setMatches(data.matches ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The search failed.");
    } finally {
      setSearching(false);
      if (referenceInput.current) referenceInput.current.value = "";
    }
  }

  async function forgetFaces() {
    const res = await fetch("/api/faces", { method: "DELETE" });
    if (!res.ok) {
      setError(await errorFrom(res));
      return;
    }
    setIndexed(new Set());
    setCounts({ faces: 0, photos: 0 });
    setPeople([]);
    setMatches(null);
    setChosen(null);
  }

  const likely = matches?.filter((m) => m.likely) ?? [];
  const uncertain = matches?.filter((m) => !m.likely) ?? [];
  const shown = showUncertain ? [...likely, ...uncertain] : likely;
  const confirmed = matches?.filter((m) => decisions[m.photoId] === "yes") ?? [];

  return (
    <div className="space-y-6">
      {/* 1. Scan */}
      <section className="card space-y-3">
        <h2 className="text-lg font-semibold">1. Scan your photos</h2>
        <p className="text-sm text-stone-600">
          Each photo is opened here, in your browser, and any face in it becomes 128 numbers. Those
          numbers are all that is stored — no face image is uploaded, and nothing goes to anyone
          else. Scanning is only needed once per photo.
        </p>
        <p className="text-sm">
          <strong>{counts.photos}</strong> of <strong>{photos.length}</strong> photos scanned,{" "}
          <strong>{counts.faces}</strong> faces on file.
          {unindexed.length > 0 && ` ${unindexed.length} still to scan.`}
        </p>

        {scanning ? (
          <ProgressBar
            value={unindexed.length ? (scanned / unindexed.length) * 100 : 0}
            label={status ?? "Scanning…"}
          />
        ) : (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-primary"
              onClick={scanLibrary}
              disabled={unindexed.length === 0}
            >
              {unindexed.length === 0
                ? "All photos scanned"
                : `Scan ${unindexed.length} photo${unindexed.length === 1 ? "" : "s"}`}
            </button>
            {counts.faces > 0 && (
              <button type="button" className="btn-secondary" onClick={forgetFaces}>
                Delete all face data
              </button>
            )}
          </div>
        )}
      </section>

      {/* 2. Pick a guest out of the photos */}
      <section className="card space-y-4">
        <div>
          <h2 className="text-lg font-semibold">2. Pick who you are looking for</h2>
          <p className="mt-1 text-sm text-stone-600">
            Everyone found in your photos. Click a face to see every photo they appear in — no need
            to go and find a picture of each guest.
          </p>
        </div>

        {counts.faces === 0 ? (
          <p className="text-sm text-stone-500">Scan some photos first.</p>
        ) : loadingPeople ? (
          <ProgressBar indeterminate label="Grouping the faces…" />
        ) : people && people.length > 0 ? (
          <ul className="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-8">
            {people.map((person) => {
              const isChosen = chosen?.representative.id === person.representative.id;
              return (
                <li key={person.representative.id}>
                  <button
                    type="button"
                    onClick={() => findByFace(person)}
                    disabled={searching}
                    className={`w-full space-y-1 rounded-lg border p-1 text-left transition-colors ${
                      isChosen
                        ? "border-rose-500 bg-rose-50"
                        : "border-stone-200 hover:border-rose-300"
                    }`}
                    title={`Appears in ${person.photoCount} photo${person.photoCount === 1 ? "" : "s"}`}
                  >
                    <FaceThumb
                      src={person.photo.fileUrl}
                      box={person.representative.box}
                      alt="A guest found in your photos"
                      className="rounded"
                    />
                    <span className="block text-center text-[11px] text-stone-600">
                      {person.photoCount} photo{person.photoCount === 1 ? "" : "s"}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-stone-500">No faces were found in your photos.</p>
        )}

        <div className="border-t border-stone-200 pt-3">
          {showUpload ? (
            <div className="space-y-2">
              <p className="text-sm text-stone-600">
                Looking for someone who is not above? Upload a clear photo of them. It is used here
                and then discarded — it is never uploaded.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <input
                  ref={referenceInput}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  disabled={searching || counts.faces === 0}
                  onChange={findByUpload}
                  className="block text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-rose-600 file:px-4 file:py-2 file:font-medium file:text-white hover:file:bg-rose-700 disabled:opacity-50"
                />
                {referenceUrl && (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={referenceUrl} alt="" className="h-14 w-14 rounded-lg object-cover" />
                )}
                <button type="button" className="btn-secondary" onClick={() => setShowUpload(false)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="btn-secondary" onClick={() => setShowUpload(true)}>
              Someone not shown here?
            </button>
          )}
        </div>
      </section>

      {searching && <ProgressBar indeterminate label="Looking through your photos…" />}
      {error && <p className="card border-red-200 bg-red-50 text-sm text-red-700">{error}</p>}

      {/* 3. Results */}
      {matches && !searching && (
        <section className="card space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              {chosen && (
                <FaceThumb
                  src={chosen.photo.fileUrl}
                  box={chosen.representative.box}
                  alt="The person you picked"
                  className="w-12 shrink-0 rounded"
                />
              )}
              <h2 className="text-lg font-semibold">
                {likely.length === 0
                  ? "No likely matches"
                  : `${likely.length} likely match${likely.length === 1 ? "" : "es"}`}
              </h2>
            </div>
            {confirmed.length > 0 && (
              <span className="text-sm text-stone-600">{confirmed.length} confirmed by you</span>
            )}
          </div>

          {shown.length === 0 ? (
            <p className="text-sm text-stone-600">
              Nobody in your scanned photos clearly looks like that person.
            </p>
          ) : (
            <>
              <p className="text-sm text-stone-600">
                Sorted by similarity. These are suggestions — the model is good but not certain, so
                confirm each one yourself.
              </p>
              <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                {shown.map((m) => {
                  const decision = decisions[m.photoId];
                  return (
                    <li
                      key={m.photoId}
                      className={`space-y-2 rounded-lg border p-2 ${
                        decision === "yes"
                          ? "border-emerald-400 bg-emerald-50"
                          : decision === "no"
                            ? "border-stone-200 opacity-50"
                            : "border-stone-200"
                      }`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={m.photo.fileUrl}
                        alt={m.photo.originalName}
                        className="aspect-square w-full rounded object-cover"
                      />
                      <div className="flex items-center justify-between text-xs">
                        <span className="truncate text-stone-600">{m.photo.originalName}</span>
                        <span
                          className={`badge ${m.likely ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}
                        >
                          {m.confidence}%
                        </span>
                      </div>
                      {!m.likely && (
                        <p className="text-[11px] text-amber-700">Less certain — check carefully</p>
                      )}
                      <div className="flex gap-1">
                        <button
                          type="button"
                          className="btn-secondary flex-1 px-2 py-1 text-xs"
                          onClick={() =>
                            setDecisions((d) => ({
                              ...d,
                              [m.photoId]: d[m.photoId] === "yes" ? "no" : "yes",
                            }))
                          }
                        >
                          {decision === "yes" ? "✓ Them" : "Confirm"}
                        </button>
                        <button
                          type="button"
                          className="btn-secondary px-2 py-1 text-xs"
                          onClick={() => setDecisions((d) => ({ ...d, [m.photoId]: "no" }))}
                        >
                          Not them
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}

          {uncertain.length > 0 && (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setShowUncertain((v) => !v)}
            >
              {showUncertain
                ? `Hide ${uncertain.length} less certain`
                : `Show ${uncertain.length} less certain match${uncertain.length === 1 ? "" : "es"}`}
            </button>
          )}
        </section>
      )}
    </div>
  );
}
