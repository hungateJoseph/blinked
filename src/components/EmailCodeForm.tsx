"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { errorFrom, readBody } from "@/lib/clientApi";

/**
 * Two-step email sign-in: enter an address, receive a 6-digit code, enter it.
 *
 * In this beta there is no mail server, so the server returns the code in
 * development mode and we show it right here on the page.
 */
export default function EmailCodeForm() {
  const router = useRouter();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function requestCode(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/auth/email/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    // Clear `busy` before anything that could fail, so the button can never be
    // left stuck on "Sending…".
    setBusy(false);
    if (!res.ok) {
      setError(await errorFrom(res));
      return;
    }
    const data = await readBody<{ devCode?: string }>(res);
    setDevCode(data.devCode ?? null);
    setStep("code");
  }

  async function verifyCode(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/auth/email/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, code }),
    });
    setBusy(false);
    if (!res.ok) {
      setError(await errorFrom(res));
      return;
    }
    router.push("/");
    router.refresh();
  }

  if (step === "email") {
    return (
      <form onSubmit={requestCode} className="space-y-3">
        <div>
          <label htmlFor="email" className="label">
            Email address
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            className="input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? "Sending…" : "Send me a code"}
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={verifyCode} className="space-y-3">
      <p className="text-sm text-stone-600">
        We sent a 6-digit code to <strong>{email}</strong>.
      </p>
      {devCode && (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          Beta: no email is actually sent yet. Your code is <strong className="font-mono">{devCode}</strong>.
        </p>
      )}
      <div>
        <label htmlFor="code" className="label">
          Code
        </label>
        <input
          id="code"
          inputMode="numeric"
          pattern="\d{6}"
          maxLength={6}
          required
          autoComplete="one-time-code"
          className="input font-mono tracking-widest"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          placeholder="123456"
        />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? "Checking…" : "Sign in"}
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => {
            setStep("email");
            setCode("");
            setError(null);
          }}
        >
          Use a different email
        </button>
      </div>
    </form>
  );
}
