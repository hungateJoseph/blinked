"use client";

import { useState } from "react";
import type { LedgerEntry } from "@/lib/billing";
import { errorFrom, readBody } from "@/lib/clientApi";

const dollars = (cents: number) => `$${(Math.abs(cents) / 100).toFixed(2)}`;

/**
 * Balance, top-up buttons and the ledger. A top-up goes to Stripe's hosted
 * checkout page; the credit appears once Stripe's webhook has confirmed it,
 * which is usually by the time the photographer is back on this page.
 */
export default function CreditPanel({
  enabled,
  balanceCents,
  ledger,
  amounts,
}: {
  enabled: boolean;
  balanceCents: number;
  ledger: LedgerEntry[];
  amounts: readonly number[];
}) {
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function topUp(amountCents: number) {
    setBusy(amountCents);
    setError(null);
    const res = await fetch("/api/billing/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amountCents }),
    });
    if (!res.ok) {
      setError(await errorFrom(res));
      setBusy(null);
      return;
    }
    const { url } = await readBody<{ url: string }>(res);
    if (url) window.location.href = url;
    else {
      setError("Stripe did not return a checkout page.");
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <section className="card space-y-3">
        <p className="text-sm text-stone-600">Balance</p>
        <p className="text-3xl font-bold">{dollars(balanceCents)}</p>
        {enabled ? (
          <>
            <p className="text-sm text-stone-600">
              Each workflow analysis is charged what it actually costs to run — a Standard run is a
              few cents. Top up on Stripe&apos;s secure page; your card never touches this site.
            </p>
            <div className="flex flex-wrap gap-2">
              {amounts.map((amount) => (
                <button
                  key={amount}
                  type="button"
                  className="btn-primary"
                  onClick={() => topUp(amount)}
                  disabled={busy !== null}
                >
                  {busy === amount ? "Opening Stripe…" : `Add ${dollars(amount)}`}
                </button>
              ))}
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
          </>
        ) : (
          <p className="text-sm text-stone-600">
            Top-ups are not set up on this server yet, so analyses are free for now.
          </p>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">History</h2>
        {ledger.length === 0 ? (
          <p className="text-sm text-stone-500">Nothing yet.</p>
        ) : (
          <ul className="divide-y divide-stone-200 rounded-xl border border-stone-200 bg-white">
            {ledger.map((entry) => (
              <li key={entry.id} className="flex items-baseline justify-between gap-4 px-4 py-2 text-sm">
                <span>
                  <span className="text-stone-800">{entry.description}</span>
                  <span className="ml-2 text-xs text-stone-500">{new Date(entry.createdAt).toLocaleString()}</span>
                </span>
                <span className={entry.amountCents >= 0 ? "font-medium text-emerald-700" : "text-stone-700"}>
                  {entry.amountCents >= 0 ? "+" : "−"}
                  {dollars(entry.amountCents)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
