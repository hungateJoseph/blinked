"use client";

import { useState } from "react";
import type { ChatMessage } from "@/lib/assistant/catalog";
import { errorFrom, readBody } from "@/lib/clientApi";

interface Status {
  enabled: boolean;
  configured: boolean;
  number: string | null;
  verified: boolean;
  pending: boolean;
  textTo: string | null;
}

/**
 * Link a mobile to the assistant: enter the number, get a code by text, type
 * it back. Once verified, texts from that number reach the assistant and it
 * can text back. The recent texts are shown underneath.
 */
export default function TextingSetup({
  initial,
  assistantName,
  recent,
}: {
  initial: Status;
  assistantName: string;
  recent: ChatMessage[];
}) {
  const [status, setStatus] = useState(initial);
  const [number, setNumber] = useState("");
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function call(method: "POST" | "PUT" | "DELETE", body?: object) {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const res = await fetch("/api/sms/number", {
        method,
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        setError(await errorFrom(res));
        return null;
      }
      const data = await readBody<Status & { devCode?: string }>(res);
      const next = { ...status, ...data } as Status & { devCode?: string };
      setStatus(next);
      return next;
    } finally {
      setBusy(false);
    }
  }

  async function sendCode() {
    const data = await call("POST", { number });
    if (!data) return;
    setDevCode(data.devCode ?? null);
    setCode("");
    setNote(data.devCode ? "No texting provider here, so the code is shown below." : `Code sent to ${data.number}.`);
  }

  async function verify() {
    const data = await call("PUT", { code });
    if (data?.verified) setNote(`${data.number} is verified.`);
  }

  async function remove() {
    const data = await call("DELETE");
    if (data) {
      setNumber("");
      setCode("");
      setDevCode(null);
      setNote("Number removed.");
    }
  }

  return (
    <div className="space-y-4">
      {!status.enabled && (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          Texting is not set up on this server yet. See DEPLOY.md for the Twilio steps.
        </p>
      )}

      <section className="card space-y-3">
        {status.verified ? (
          <>
            <p className="text-sm">
              <span className="font-medium">{status.number}</span> is verified. Texts from it reach {assistantName}, and it can
              text you back.
            </p>
            <p className="text-sm text-stone-600">
              {status.textTo
                ? `Text ${assistantName} at ${status.textTo}. Replies come back as texts, kept short; for photos, use the web chat.`
                : "The number to text appears here once the server has one configured."}
            </p>
            <button type="button" className="btn-secondary" onClick={remove} disabled={busy}>
              Remove number
            </button>
          </>
        ) : (
          <>
            <label className="label" htmlFor="sms-number">
              Your mobile
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <input
                id="sms-number"
                className="input w-64"
                type="tel"
                placeholder="(555) 123-4567"
                value={number}
                onChange={(e) => setNumber(e.target.value)}
                disabled={busy || !status.enabled}
              />
              <button type="button" className="btn-primary" onClick={sendCode} disabled={busy || !status.enabled || number.trim().length < 7}>
                {status.pending ? "Send a new code" : "Send code"}
              </button>
            </div>
            {status.pending && (
              <div className="space-y-2">
                <p className="text-sm text-stone-600">A six-digit code was texted to {status.number}. It lasts ten minutes.</p>
                {devCode && (
                  <p className="text-sm">
                    Development code: <code className="rounded bg-stone-100 px-1">{devCode}</code>
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    className="input w-40"
                    inputMode="numeric"
                    placeholder="123456"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && void verify()}
                    disabled={busy}
                  />
                  <button type="button" className="btn-primary" onClick={verify} disabled={busy || code.trim().length !== 6}>
                    Verify
                  </button>
                  <button type="button" className="btn-secondary" onClick={remove} disabled={busy}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        {note && !error && <p className="text-sm text-emerald-700">{note}</p>}
      </section>

      <section className="card space-y-2">
        <h2 className="font-semibold">Recent texts</h2>
        {recent.length === 0 ? (
          <p className="text-sm text-stone-600">Nothing yet. Texts you send and the replies show up here.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {recent.map((m) => (
              <li key={m.id} className={m.role === "user" ? "text-stone-900" : "text-stone-600"}>
                <span className="text-stone-400">{new Date(m.createdAt).toLocaleString()} · </span>
                {m.role === "user" ? "You: " : `${assistantName}: `}
                {m.text}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
