"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import ProgressBar from "./ProgressBar";
import { errorFrom, readBody } from "@/lib/clientApi";
import type { PhotoIssue } from "@/lib/ai";
import { describeAdjustments } from "@/lib/adjustments";
import type { AnalysisView, PhotoView } from "@/lib/photoStore";

interface PhotoCleanupProps {
  photo: PhotoView;
  initialAnalysis: AnalysisView | null;
  aiConfigured: boolean;
}

/** Messages cycled under the progress bar while the AI scan runs. */
const SCAN_STEPS = [
  "Measuring sharpness…",
  "Sending the photo to the AI…",
  "Scanning for blur, cut-off faces and exposure problems…",
  "Writing follow-up questions…",
];

/** Bytes as a readable size. Anything under a megabyte reads better in KB. */
function formatFileSize(bytes: number): string {
  const kb = bytes / 1024;
  return kb < 1024 ? `${Math.round(kb)} KB` : `${(kb / 1024).toFixed(1)} MB`;
}

const SEVERITY_STYLES: Record<PhotoIssue["severity"], string> = {
  low: "bg-stone-200 text-stone-700",
  medium: "bg-amber-100 text-amber-800",
  high: "bg-red-100 text-red-800",
};

const CATEGORY_LABELS: Record<PhotoIssue["category"], string> = {
  blur: "Blur",
  face_cutoff: "Face cut off",
  closed_eyes: "Closed eyes",
  exposure: "Exposure",
  color: "Colour",
  composition: "Composition",
  noise: "Noise",
  distraction: "Distraction",
  other: "Other",
};

/**
 * The AI Image Cleanup tool for one photo:
 *   1. run the scan,
 *   2. show the irregularities found,
 *   3. collect the photographer's answers to the follow-up questions,
 *   4. show the resulting cleanup plan.
 */
export default function PhotoCleanup({
  photo: initialPhoto,
  initialAnalysis,
  aiConfigured,
}: PhotoCleanupProps) {
  const router = useRouter();
  const [photo, setPhoto] = useState(initialPhoto);
  const [analysis, setAnalysis] = useState(initialAnalysis);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanStep, setScanStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>(initialAnalysis?.answers ?? {});
  const [planning, setPlanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Rotate the step message every few seconds while scanning.
  useEffect(() => {
    if (!scanning) return;
    setScanStep(0);
    const timer = setInterval(() => setScanStep((s) => Math.min(s + 1, SCAN_STEPS.length - 1)), 3000);
    return () => clearInterval(timer);
  }, [scanning]);

  async function runScan() {
    setScanning(true);
    setError(null);
    const res = await fetch(`/api/photos/${photo.id}/analyze`, { method: "POST" });
    setScanning(false);
    const data = await readBody<{ analysis: AnalysisView }>(res);
    if (!res.ok || !data.analysis) {
      setError(data.error ?? (await errorFrom(res)));
      return;
    }
    setAnalysis(data.analysis);
    setAnswers({});
  }

  async function submitAnswers(event: FormEvent) {
    event.preventDefault();
    setPlanning(true);
    setError(null);
    const res = await fetch(`/api/photos/${photo.id}/answers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answers }),
    });
    setPlanning(false);
    const data = await readBody<{ analysis: AnalysisView }>(res);
    if (!res.ok || !data.analysis) {
      setError(data.error ?? (await errorFrom(res)));
      return;
    }
    setAnalysis(data.analysis);
  }

  /** Apply the plan's adjustments to the photo, server-side. */
  async function applyEdits() {
    setApplying(true);
    setApplyError(null);
    const res = await fetch(`/api/photos/${photo.id}/apply`, { method: "POST" });
    setApplying(false);
    const data = await readBody<{ photo: PhotoView }>(res);
    if (!res.ok || !data.photo) {
      setApplyError(data.error ?? (await errorFrom(res)));
      return;
    }
    setPhoto(data.photo);
  }

  /** Throw the edited copy away. The original was never touched. */
  async function revertEdits() {
    setApplying(true);
    setApplyError(null);
    const res = await fetch(`/api/photos/${photo.id}/apply`, { method: "DELETE" });
    setApplying(false);
    const data = await readBody<{ photo: PhotoView }>(res);
    if (!res.ok || !data.photo) {
      setApplyError(data.error ?? (await errorFrom(res)));
      return;
    }
    setPhoto(data.photo);
  }

  async function deletePhoto() {
    if (!confirm("Delete this photo and its analysis?")) return;
    await fetch(`/api/photos/${photo.id}`, { method: "DELETE" });
    router.push("/photos");
    router.refresh();
  }

  const issues = analysis?.analysis.issues ?? [];
  const questions = analysis?.analysis.questions ?? [];
  const adjustmentLines = analysis?.plan ? describeAdjustments(analysis.plan.adjustments) : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <Link href="/photos" className="text-sm text-stone-500 hover:text-rose-700">
            ← All photos
          </Link>
          <h1 className="text-2xl font-bold">{photo.originalName}</h1>
          <p className="text-sm text-stone-500">
            {photo.width}×{photo.height}px · {formatFileSize(photo.size)}
          </p>
        </div>
        <button type="button" className="btn-secondary" onClick={deletePhoto}>
          Delete photo
        </button>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* The photo — before and after, once a plan has been applied */}
        <div className="space-y-3">
          <div className="card p-2">
            {photo.edited && <p className="px-1 pb-2 text-xs font-medium text-stone-500">Before</p>}
            <img src={photo.fileUrl} alt={photo.originalName} className="w-full rounded-lg" />
          </div>

          {photo.edited && (
            <div className="card space-y-2 p-2">
              <p className="px-1 text-xs font-medium text-emerald-700">After</p>
              <img
                src={photo.edited.url}
                alt={`${photo.originalName}, cleaned up`}
                className="w-full rounded-lg"
              />
              <div className="flex flex-wrap items-center gap-2 px-1 pb-1">
                <a
                  className="btn-primary"
                  href={`${photo.fileUrl}?v=edited&download=1`}
                  download
                >
                  Download
                </a>
                <button type="button" className="btn-secondary" onClick={revertEdits} disabled={applying}>
                  Revert to original
                </button>
                <span className="text-xs text-stone-500">
                  {photo.edited.width}×{photo.edited.height}px · {formatFileSize(photo.edited.size)}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* The tool */}
        <div className="space-y-6">
          <section className="card space-y-3">
            <h2 className="text-lg font-semibold">AI Image Cleanup</h2>
            <p className="text-sm text-stone-600">
              Scans the photo for obvious irregularities and asks you what to do about them.
              {!aiConfigured && " No ANTHROPIC_API_KEY is set, so only the local blur check will run."}
            </p>
            {scanning ? (
              <ProgressBar indeterminate label={SCAN_STEPS[aiConfigured ? scanStep : 0]} />
            ) : (
              <button type="button" className="btn-primary" onClick={runScan}>
                {analysis ? "Scan again" : "Run scan"}
              </button>
            )}
            {error && <p className="text-sm text-red-600">{error}</p>}
          </section>

          {analysis && (
            <section className="card space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold">Findings</h2>
                <span className={`badge ${analysis.analysis.overallQuality === "good" ? "bg-emerald-100 text-emerald-800" : analysis.analysis.overallQuality === "fair" ? "bg-amber-100 text-amber-800" : "bg-red-100 text-red-800"}`}>
                  overall: {analysis.analysis.overallQuality}
                </span>
                <span className="badge bg-stone-200 text-stone-700">
                  sharpness {analysis.sharpness} · {analysis.sharpnessLabel}
                </span>
                <span className={`badge ${analysis.source === "ai" ? "bg-violet-100 text-violet-700" : "bg-stone-200 text-stone-700"}`}>
                  {analysis.source === "ai" ? "AI scan" : "local check"}
                </span>
              </div>
              <p className="text-sm text-stone-700">{analysis.analysis.summary}</p>

              {issues.length === 0 ? (
                <p className="text-sm text-emerald-700">No irregularities found. 🎉</p>
              ) : (
                <ul className="space-y-3">
                  {issues.map((issue) => (
                    <li key={issue.id} className="rounded-lg border border-stone-200 p-3 text-sm">
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <strong>{CATEGORY_LABELS[issue.category]}</strong>
                        <span className={`badge ${SEVERITY_STYLES[issue.severity]}`}>{issue.severity}</span>
                        <span className="text-stone-500">{issue.location}</span>
                      </div>
                      <p className="text-stone-700">{issue.description}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {analysis && questions.length > 0 && (
            <section className="card space-y-4">
              <h2 className="text-lg font-semibold">A few questions before we plan the edits</h2>
              <form onSubmit={submitAnswers} className="space-y-5">
                {questions.map((q) => (
                  <fieldset key={q.id} className="space-y-2">
                    <legend className="text-sm font-medium text-stone-800">{q.question}</legend>
                    {q.options.length > 0 ? (
                      q.options.map((option) => (
                        <label key={option} className="flex items-center gap-2 text-sm">
                          <input
                            type="radio"
                            name={q.id}
                            value={option}
                            checked={answers[q.id] === option}
                            onChange={() => setAnswers({ ...answers, [q.id]: option })}
                          />
                          {option}
                        </label>
                      ))
                    ) : (
                      <textarea
                        rows={2}
                        className="input"
                        value={answers[q.id] ?? ""}
                        onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
                      />
                    )}
                  </fieldset>
                ))}
                {planning ? (
                  <ProgressBar indeterminate label="Planning the cleanup…" />
                ) : (
                  <button type="submit" className="btn-primary">
                    {analysis.plan ? "Update the plan" : "Build the cleanup plan"}
                  </button>
                )}
              </form>
            </section>
          )}

          {analysis?.plan && (
            <section className="card space-y-3">
              <h2 className="text-lg font-semibold">Cleanup plan</h2>
              <ol className="list-decimal space-y-3 pl-5 text-sm">
                {analysis.plan.steps.map((step, i) => (
                  <li key={i}>
                    <strong>{step.title}</strong>
                    {step.automatic ? (
                      <span className="badge ml-2 bg-emerald-100 text-emerald-800">
                        Blinked can do this
                      </span>
                    ) : (
                      <span className="badge ml-2 bg-stone-200 text-stone-600">needs an editor</span>
                    )}
                    <p className="text-stone-700">{step.detail}</p>
                    {step.toolHint && <p className="text-xs text-stone-500">{step.toolHint}</p>}
                  </li>
                ))}
              </ol>
              {analysis.plan.notes && <p className="text-sm text-stone-600">{analysis.plan.notes}</p>}
            </section>
          )}

          {analysis?.plan && adjustmentLines.length > 0 && (
            <section className="card space-y-3">
              <h2 className="text-lg font-semibold">Apply it here</h2>
              <p className="text-sm text-stone-600">
                These are the changes Blinked can make to the photo itself. Your original is kept, so
                you can revert at any time.
              </p>
              <ul className="flex flex-wrap gap-2">
                {adjustmentLines.map((line) => (
                  <li key={line} className="badge bg-stone-100 text-stone-700">
                    {line}
                  </li>
                ))}
              </ul>

              {applyError && <p className="text-sm text-red-600">{applyError}</p>}

              {applying ? (
                <ProgressBar indeterminate label="Applying the edits…" />
              ) : (
                <button type="button" className="btn-primary" onClick={applyEdits}>
                  {photo.edited ? "Apply again" : "Apply these edits"}
                </button>
              )}

              <p className="text-xs text-stone-500">
                Edits are applied to the uploaded JPEG, which has less latitude than a RAW file.
                Anything generative — rebuilding a cut-off head, removing an object, swapping eyes —
                still needs a full editor.
              </p>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
