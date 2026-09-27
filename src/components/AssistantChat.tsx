"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { LIMITS, type ChatMessage } from "@/lib/assistant/catalog";
import { errorFrom, readBody } from "@/lib/clientApi";
import ProgressBar from "./ProgressBar";

/**
 * The conversation with the Smart Photographer.
 *
 * Photos are uploaded through the ordinary /api/photos route first (so they
 * land in the library like any other upload), then the message is sent with
 * their ids. The reply comes back with any photos the assistant produced.
 */
export default function AssistantChat({
  assistantName,
  initialMessages,
  suggestions,
  aiConfigured,
  channel = "web",
  intro,
  quickAsks = [],
}: {
  assistantName: string;
  initialMessages: ChatMessage[];
  suggestions: string[];
  aiConfigured: boolean;
  /** "web" is the Smart Photographer chat; "agent" is the agent made from a workflow. */
  channel?: "web" | "agent";
  /** What the empty conversation says, instead of the default greeting. */
  intro?: string;
  /** Asks kept above the box the whole time — the workflow's steps, for the agent. */
  quickAsks?: string[];
}) {
  const [messages, setMessages] = useState(initialMessages);
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [phase, setPhase] = useState<null | { label: string; value?: number }>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // Keep the newest message in view.
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages.length, phase]);

  const busy = phase !== null;
  const canSend = aiConfigured && !busy && (text.trim().length > 0 || files.length > 0);

  function addFiles(list: FileList | null) {
    if (!list) return;
    setFiles((current) => [...current, ...Array.from(list)].slice(0, LIMITS.attachments));
    if (fileInput.current) fileInput.current.value = "";
  }

  /** Upload one file the normal way and return its photo id. */
  async function upload(file: File): Promise<string> {
    const form = new FormData();
    form.append("photo", file);
    const res = await fetch("/api/photos", { method: "POST", body: form });
    if (!res.ok) throw new Error(`${file.name}: ${await errorFrom(res)}`);
    const { photo } = await readBody<{ photo: { id: string } }>(res);
    if (!photo) throw new Error(`${file.name}: upload returned no photo.`);
    return photo.id;
  }

  async function send() {
    if (!canSend) return;
    setError(null);
    const outgoingText = text.trim();
    const outgoingFiles = files;

    try {
      const photoIds: string[] = [];
      for (const [i, file] of outgoingFiles.entries()) {
        setPhase({
          label: `Uploading ${i + 1} of ${outgoingFiles.length} — ${file.name}`,
          value: (i / outgoingFiles.length) * 100,
        });
        photoIds.push(await upload(file));
      }

      setPhase({
        label: photoIds.length > 0 ? `${assistantName} is looking at your photo…` : `${assistantName} is thinking…`,
      });
      const res = await fetch("/api/assistant/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: outgoingText, photoIds, channel }),
      });
      const body = await readBody<{ messages: ChatMessage[] }>(res);
      // Even a failed turn returns the message that was sent, so it stays visible.
      if (body.messages) setMessages((m) => [...m, ...body.messages!]);
      if (!res.ok) {
        setError(body.error ?? `Something went wrong (${res.status}).`);
        return;
      }
      setText("");
      setFiles([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setPhase(null);
    }
  }

  async function clear() {
    const res = await fetch(`/api/assistant/messages?channel=${channel}`, { method: "DELETE" });
    setConfirmClear(false);
    if (res.ok) setMessages([]);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  return (
    <div className="space-y-4">
      {!aiConfigured && (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          The assistant needs an <code>ANTHROPIC_API_KEY</code> on the server before it can answer.
        </p>
      )}

      <section className="card max-h-[60vh] min-h-64 space-y-4 overflow-y-auto" aria-live="polite">
        {messages.length === 0 && (
          <div className="space-y-3">
            <p className="text-sm text-stone-600">
              {intro ??
                `Hi, I'm ${assistantName}. Ask me about your calendar, or attach a photo and I'll touch it up.`}
              {suggestions.length > 0 && " A few things to try:"}
            </p>
            {suggestions.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {suggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className="rounded-full border border-stone-300 bg-white px-3 py-1 text-sm hover:bg-stone-100"
                    onClick={() => setText(s)}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[85%] space-y-2 rounded-2xl px-4 py-2 text-sm ${
                m.role === "user" ? "bg-rose-600 text-white" : "bg-stone-100 text-stone-900"
              }`}
            >
              {m.text && <p className="whitespace-pre-wrap">{m.text}</p>}
              {m.attachments.length > 0 && (
                <ul className="flex flex-wrap gap-2">
                  {m.attachments.map((a) => (
                    <li key={`${a.photoId}-${a.variant}`} className="relative">
                      <Link href={`/photos/${a.photoId}`} title={`Open ${a.name}`}>
                        {/* Served by our own API route, never a public URL. */}
                        <img
                          src={a.url}
                          alt={a.name}
                          className="h-40 max-w-full rounded-lg object-cover shadow-sm"
                        />
                      </Link>
                      {a.variant === "edited" && (
                        <span className="badge absolute left-1 top-1 bg-emerald-600 text-white">
                          edited
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ))}

        {phase && <ProgressBar label={phase.label} value={phase.value} indeterminate={phase.value === undefined} />}
        <div ref={bottom} />
      </section>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="card space-y-3">
        {quickAsks.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs text-stone-500">From your workflow — tap one to ask for it:</p>
            <div className="flex flex-wrap gap-2">
              {quickAsks.map((s) => (
                <button
                  key={s}
                  type="button"
                  className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-sm text-sky-950 hover:bg-sky-100"
                  onClick={() => setText(s)}
                  disabled={!aiConfigured || busy}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        <textarea
          className="input min-h-16"
          placeholder={aiConfigured ? "Ask something, or attach a photo…" : "Unavailable until the API key is set"}
          value={text}
          maxLength={LIMITS.message}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={!aiConfigured || busy}
        />

        {files.length > 0 && (
          <ul className="flex flex-wrap gap-2 text-xs">
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`} className="flex items-center gap-1 rounded-full bg-stone-100 px-2 py-1">
                {f.name}
                <button
                  type="button"
                  aria-label={`Remove ${f.name}`}
                  className="text-stone-500 hover:text-red-700"
                  onClick={() => setFiles((list) => list.filter((_, j) => j !== i))}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            className="hidden"
            onChange={(e) => addFiles(e.target.files)}
          />
          <button
            type="button"
            className="btn-secondary"
            onClick={() => fileInput.current?.click()}
            disabled={!aiConfigured || busy || files.length >= LIMITS.attachments}
          >
            Attach photo
          </button>
          <button type="button" className="btn-primary" onClick={send} disabled={!canSend}>
            Send
          </button>
          <span className="text-xs text-stone-500">Enter to send, Shift+Enter for a new line.</span>

          {messages.length > 0 && (
            <span className="ml-auto text-sm">
              {confirmClear ? (
                <span className="flex items-center gap-2">
                  <span className="text-stone-600">Clear the whole conversation?</span>
                  <button type="button" className="btn-secondary" onClick={clear}>
                    Yes, clear
                  </button>
                  <button type="button" className="btn-secondary" onClick={() => setConfirmClear(false)}>
                    Keep
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  className="text-stone-500 underline hover:text-stone-800"
                  onClick={() => setConfirmClear(true)}
                >
                  Clear conversation
                </button>
              )}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
