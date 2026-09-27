"use client";

import { useState, type FormEvent } from "react";
import { errorFrom, readBody } from "@/lib/clientApi";
import { WEEKDAY_NAMES, formatLong } from "@/lib/dates";
import { DAY_PARTS, PART_LABELS, describeParts, type DayPart } from "@/lib/parts";
import type { DiscountRule } from "@/lib/discounts";

/**
 * Standing discount rules, e.g. "20% off Mondays".
 *
 * Rules are matched when a schedule is saved, so adding one here affects the
 * next schedule you generate — not one already published. That is deliberate:
 * a couple who saw an offer should not find it withdrawn under them.
 */
export default function DiscountRules({ initial }: { initial: DiscountRule[] }) {
  const [rules, setRules] = useState(initial);
  const [label, setLabel] = useState("");
  const [detail, setDetail] = useState("");
  const [weekdays, setWeekdays] = useState<number[]>([1]); // Mondays, the common case
  const [parts, setParts] = useState<DayPart[]>([...DAY_PARTS]);
  const [dateStart, setDateStart] = useState("");
  const [dateEnd, setDateEnd] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/discounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        label,
        detail,
        weekdays,
        parts,
        dateStart: dateStart || null,
        dateEnd: dateEnd || null,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      setError(await errorFrom(res));
      return;
    }
    const { discount } = await readBody<{ discount: DiscountRule }>(res);
    if (!discount) return;
    setRules((list) => [...list, discount]);
    setLabel("");
    setDetail("");
  }

  async function remove(id: string) {
    const res = await fetch(`/api/discounts/${id}`, { method: "DELETE" });
    if (res.ok) setRules((list) => list.filter((r) => r.id !== id));
  }

  const describeRule = (r: DiscountRule) => {
    const days =
      r.weekdays.length === 0
        ? "every day"
        : r.weekdays.map((d) => `${WEEKDAY_NAMES[d]}s`).join(", ");
    const when =
      r.dateStart && r.dateEnd
        ? ` between ${formatLong(r.dateStart)} and ${formatLong(r.dateEnd)}`
        : r.dateStart
          ? ` from ${formatLong(r.dateStart)}`
          : r.dateEnd
            ? ` until ${formatLong(r.dateEnd)}`
            : "";
    return `${days}, ${describeParts(r.parts).toLowerCase()}${when}`;
  };

  return (
    <section className="card space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Discounts and offers</h2>
        <p className="mt-1 text-sm text-stone-600">
          Tag open times with an offer, such as a reduced rate for midweek weddings. It shows on your
          public page. Rules apply to the next schedule you generate, not one already published.
        </p>
      </div>

      <form onSubmit={add} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="disc-label" className="label">
              Label couples see
            </label>
            <input
              id="disc-label"
              className="input"
              required
              maxLength={40}
              placeholder="e.g. 20% off"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="disc-detail" className="label">
              Detail (optional)
            </label>
            <input
              id="disc-detail"
              className="input"
              maxLength={200}
              placeholder="e.g. Midweek weddings booked before June"
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
            />
          </div>
        </div>

        <div>
          <span className="label">Applies on</span>
          <div className="flex flex-wrap gap-2">
            {WEEKDAY_NAMES.map((name, day) => (
              <label
                key={name}
                className="flex cursor-pointer items-center gap-1 rounded-lg border border-stone-300 px-3 py-1 text-sm has-[:checked]:border-amber-500 has-[:checked]:bg-amber-50"
              >
                <input
                  type="checkbox"
                  checked={weekdays.includes(day)}
                  onChange={() =>
                    setWeekdays((cur) =>
                      cur.includes(day) ? cur.filter((d) => d !== day) : [...cur, day].sort(),
                    )
                  }
                />
                {name.slice(0, 3)}
              </label>
            ))}
          </div>
          {weekdays.length === 0 && (
            <p className="mt-1 text-xs text-stone-500">No days chosen means every day.</p>
          )}
        </div>

        <div>
          <span className="label">Times of day</span>
          <div className="flex flex-wrap gap-2">
            {DAY_PARTS.map((part) => (
              <label
                key={part}
                className="flex cursor-pointer items-center gap-1 rounded-lg border border-stone-300 px-3 py-1 text-sm has-[:checked]:border-amber-500 has-[:checked]:bg-amber-50"
              >
                <input
                  type="checkbox"
                  checked={parts.includes(part)}
                  onChange={() =>
                    setParts((cur) =>
                      cur.includes(part)
                        ? cur.filter((p) => p !== part)
                        : DAY_PARTS.filter((p) => p === part || cur.includes(p)),
                    )
                  }
                />
                {PART_LABELS[part]}
              </label>
            ))}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="disc-from" className="label">
              Only from (optional)
            </label>
            <input
              id="disc-from"
              type="date"
              className="input"
              value={dateStart}
              onChange={(e) => setDateStart(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="disc-to" className="label">
              Only until (optional)
            </label>
            <input
              id="disc-to"
              type="date"
              className="input"
              value={dateEnd}
              onChange={(e) => setDateEnd(e.target.value)}
            />
          </div>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? "Adding…" : "Add offer"}
        </button>
      </form>

      {rules.length === 0 ? (
        <p className="text-sm text-stone-500">No offers set up.</p>
      ) : (
        <ul className="divide-y divide-stone-200 text-sm">
          {rules.map((r) => (
            <li key={r.id} className="flex items-start justify-between gap-3 py-2">
              <span>
                <span className="badge bg-amber-100 text-amber-900">{r.label}</span>
                <span className="ml-2 text-stone-600">{describeRule(r)}</span>
                {r.detail && <p className="text-xs text-stone-500">{r.detail}</p>}
              </span>
              <button
                type="button"
                className="shrink-0 text-stone-500 hover:text-red-600"
                onClick={() => remove(r.id)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {rules.length > 1 && (
        <p className="text-xs text-stone-500">
          When two offers cover the same time, the one added first wins.
        </p>
      )}
    </section>
  );
}
