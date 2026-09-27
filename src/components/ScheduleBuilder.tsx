"use client";

import { useEffect, useState, type FormEvent } from "react";
import MonthCalendar, { slotKey } from "./MonthCalendar";
import ProgressBar from "./ProgressBar";
import { errorFrom, readBody } from "@/lib/clientApi";
import { WEEKDAY_NAMES, formatLong } from "@/lib/dates";
import { DAY_PARTS, PART_HINTS, PART_LABELS, describeParts, type DayPart } from "@/lib/parts";
import { DEFAULT_PREFERENCES, type SchedulePreferences, type ScheduleSlot } from "@/lib/schedule";
import type { ScheduleView } from "@/lib/scheduleStore";

interface Booking {
  id: string;
  date: string;
  parts: DayPart[];
  label: string;
}

interface ScheduleBuilderProps {
  initialBookings: Booking[];
  initialDraft: ScheduleView | null;
  initialFinal: ScheduleView | null;
  publicSlug: string;
  aiConfigured: boolean;
  /** Default planning window, worked out on the server (see the note in dates.ts). */
  defaultRangeStart: string;
  defaultRangeEnd: string;
}

/**
 * The whole Calendar/Planning workflow in one component:
 *   1. manage booked dates,
 *   2. set preferences and generate a proposal,
 *   3. review the proposal (toggle days) and finalize it,
 *   4. see the published schedule and its public link.
 */
export default function ScheduleBuilder({
  initialBookings,
  initialDraft,
  initialFinal,
  publicSlug,
  aiConfigured,
  defaultRangeStart,
  defaultRangeEnd,
}: ScheduleBuilderProps) {
  // --- 1. Booked dates ------------------------------------------------------
  const [bookings, setBookings] = useState(initialBookings);
  const [newDate, setNewDate] = useState("");
  const [newLabel, setNewLabel] = useState("");
  // A wedding usually takes the whole day, so that is the starting point.
  const [newParts, setNewParts] = useState<DayPart[]>([...DAY_PARTS]);
  const [bookingError, setBookingError] = useState<string | null>(null);

  async function addBooking(event: FormEvent) {
    event.preventDefault();
    setBookingError(null);
    const res = await fetch("/api/bookings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: newDate, parts: newParts, label: newLabel }),
    });
    if (!res.ok) {
      setBookingError(await errorFrom(res));
      return;
    }
    const { booking } = await readBody<{ booking: Booking }>(res);
    if (!booking) return;
    setBookings((list) => [...list, booking].sort((a, b) => a.date.localeCompare(b.date)));
    setNewDate("");
    setNewLabel("");
    setNewParts([...DAY_PARTS]);
  }

  async function removeBooking(id: string) {
    const res = await fetch(`/api/bookings/${id}`, { method: "DELETE" });
    if (res.ok) setBookings((list) => list.filter((b) => b.id !== id));
  }

  // The draft awaiting review and the published schedule. Declared up here
  // because generating a proposal (step 2) replaces the draft.
  const [draft, setDraft] = useState(initialDraft);
  const [final, setFinal] = useState(initialFinal);

  // --- 2. Preferences + generation -------------------------------------------
  const [rangeStart, setRangeStart] = useState(initialDraft?.rangeStart ?? defaultRangeStart);
  const [rangeEnd, setRangeEnd] = useState(initialDraft?.rangeEnd ?? defaultRangeEnd);
  const [prefs, setPrefs] = useState<SchedulePreferences>(
    initialDraft?.preferences ?? DEFAULT_PREFERENCES,
  );
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  function toggleWorkingDay(day: number) {
    setPrefs((p) => ({
      ...p,
      workingDays: p.workingDays.includes(day)
        ? p.workingDays.filter((d) => d !== day)
        : [...p.workingDays, day].sort(),
    }));
  }

  async function generate(event: FormEvent) {
    event.preventDefault();
    setGenerating(true);
    setGenerateError(null);
    const res = await fetch("/api/schedule/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rangeStart, rangeEnd, preferences: prefs }),
    });
    setGenerating(false);
    if (!res.ok) {
      setGenerateError(await errorFrom(res));
      return;
    }
    const { schedule } = await readBody<{ schedule: ScheduleView }>(res);
    if (schedule) setDraft(schedule);
  }

  // --- 3. Review + finalize ---------------------------------------------------
  const [finalizing, setFinalizing] = useState(false);
  const [finalizeError, setFinalizeError] = useState<string | null>(null);

  /** Flip a day between available and blocked while reviewing. */
  function toggleSlot(date: string, part: DayPart) {
    setDraft((current) => {
      if (!current) return current;
      const slots: ScheduleSlot[] = current.slots.map((slot) =>
        slot.date === date && slot.part === part
          ? {
              ...slot,
              status: slot.status === "available" ? "blocked" : "available",
              reason: "Set by you during review",
            }
          : slot,
      );
      return { ...current, slots };
    });
  }

  async function finalize() {
    if (!draft) return;
    setFinalizing(true);
    setFinalizeError(null);
    const res = await fetch("/api/schedule/finalize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scheduleId: draft.id, slots: draft.slots }),
    });
    setFinalizing(false);
    if (!res.ok) {
      setFinalizeError(await errorFrom(res));
      return;
    }
    const { schedule } = await readBody<{ schedule: ScheduleView }>(res);
    if (!schedule) return;
    setFinal(schedule);
    setDraft(null);
  }

  // --- 4. Published schedule ---------------------------------------------------
  const [publicUrl, setPublicUrl] = useState(`/p/${publicSlug}`);
  useEffect(() => {
    // The full URL is only known in the browser.
    setPublicUrl(`${window.location.origin}/p/${publicSlug}`);
  }, [publicSlug]);

  // Taking the page down is asked about first, inline rather than with a
  // browser dialog, so the consequence can be spelled out.
  const [confirmingUnpublish, setConfirmingUnpublish] = useState(false);
  const [unpublishing, setUnpublishing] = useState(false);
  const [unpublishError, setUnpublishError] = useState<string | null>(null);

  async function unpublish() {
    setUnpublishing(true);
    setUnpublishError(null);
    const res = await fetch("/api/schedule/unpublish", { method: "POST" });
    setUnpublishing(false);
    if (!res.ok) {
      setUnpublishError(await errorFrom(res));
      return;
    }
    setConfirmingUnpublish(false);
    setFinal(null);
  }

  const bookedKeys = new Set(
    bookings.flatMap((b) => b.parts.map((part) => slotKey(b.date, part))),
  );
  const openCount = (schedule: ScheduleView) =>
    schedule.slots.filter((s) => s.status === "available").length;
  const openDayCount = (schedule: ScheduleView) =>
    new Set(schedule.slots.filter((s) => s.status === "available").map((s) => s.date)).size;

  return (
    <div className="space-y-8">
      {/* 1. Booked dates */}
      <section className="card space-y-4">
        <h2 className="text-lg font-semibold">1. Dates you already have a wedding</h2>
        <form onSubmit={addBooking} className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="booking-date" className="label">
              Date
            </label>
            <input
              id="booking-date"
              type="date"
              required
              className="input"
              value={newDate}
              onChange={(e) => setNewDate(e.target.value)}
            />
          </div>
          <div>
            <span className="label">Which part of the day</span>
            <div className="flex gap-2">
              {DAY_PARTS.map((part) => (
                <label
                  key={part}
                  title={PART_HINTS[part]}
                  className="flex cursor-pointer items-center gap-1 rounded-lg border border-stone-300 px-3 py-2 text-sm has-[:checked]:border-rose-500 has-[:checked]:bg-rose-50"
                >
                  <input
                    type="checkbox"
                    checked={newParts.includes(part)}
                    onChange={() =>
                      setNewParts((current) =>
                        current.includes(part)
                          ? current.filter((p) => p !== part)
                          : DAY_PARTS.filter((p) => p === part || current.includes(p)),
                      )
                    }
                  />
                  {PART_LABELS[part]}
                </label>
              ))}
            </div>
          </div>
          <div className="min-w-48 flex-1">
            <label htmlFor="booking-label" className="label">
              Label (optional)
            </label>
            <input
              id="booking-label"
              type="text"
              className="input"
              placeholder="e.g. Smith wedding, Lakeside"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
            />
          </div>
          <button type="submit" className="btn-primary" disabled={newParts.length === 0}>
            Add booking
          </button>
        </form>
        {newParts.length === 0 && (
          <p className="text-sm text-stone-500">Choose at least one part of the day.</p>
        )}
        {bookingError && <p className="text-sm text-red-600">{bookingError}</p>}

        {bookings.length === 0 ? (
          <p className="text-sm text-stone-500">No bookings yet.</p>
        ) : (
          <ul className="divide-y divide-stone-200 text-sm">
            {bookings.map((b) => (
              <li key={b.id} className="flex items-center justify-between py-2">
                <span>
                  <strong>{formatLong(b.date)}</strong>
                  <span className="text-stone-500"> · {describeParts(b.parts)}</span>
                  {b.label && <span className="text-stone-500"> — {b.label}</span>}
                </span>
                <button type="button" className="text-stone-500 hover:text-red-600" onClick={() => removeBooking(b.id)}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 2. Preferences */}
      <section className="card space-y-4">
        <h2 className="text-lg font-semibold">2. How you like to work</h2>
        <form onSubmit={generate} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="range-start" className="label">
                Plan from
              </label>
              <input id="range-start" type="date" required className="input" value={rangeStart} onChange={(e) => setRangeStart(e.target.value)} />
            </div>
            <div>
              <label htmlFor="range-end" className="label">
                Plan until
              </label>
              <input id="range-end" type="date" required className="input" value={rangeEnd} onChange={(e) => setRangeEnd(e.target.value)} />
            </div>
          </div>

          <div>
            <span className="label">Days you take bookings</span>
            <div className="flex flex-wrap gap-2">
              {WEEKDAY_NAMES.map((name, day) => (
                <label key={name} className="flex cursor-pointer items-center gap-1 rounded-lg border border-stone-300 px-3 py-1 text-sm has-[:checked]:border-rose-500 has-[:checked]:bg-rose-50">
                  <input type="checkbox" checked={prefs.workingDays.includes(day)} onChange={() => toggleWorkingDay(day)} />
                  {name.slice(0, 3)}
                </label>
              ))}
            </div>
          </div>

          <div>
            <span className="label">Times of day you shoot</span>
            <div className="flex flex-wrap gap-2">
              {DAY_PARTS.map((part) => (
                <label
                  key={part}
                  title={PART_HINTS[part]}
                  className="flex cursor-pointer items-center gap-1 rounded-lg border border-stone-300 px-3 py-1 text-sm has-[:checked]:border-rose-500 has-[:checked]:bg-rose-50"
                >
                  <input
                    type="checkbox"
                    checked={prefs.workingParts.includes(part)}
                    onChange={() =>
                      setPrefs((p) => ({
                        ...p,
                        workingParts: p.workingParts.includes(part)
                          ? p.workingParts.filter((x) => x !== part)
                          : DAY_PARTS.filter((x) => x === part || p.workingParts.includes(x)),
                      }))
                    }
                  />
                  {PART_LABELS[part]}
                </label>
              ))}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="max-week" className="label">
                Max weddings per week
              </label>
              <input id="max-week" type="number" min={1} max={7} className="input" value={prefs.maxShootsPerWeek} onChange={(e) => setPrefs({ ...prefs, maxShootsPerWeek: Number(e.target.value) })} />
            </div>
            <div>
              <label htmlFor="rest-days" className="label">
                Rest days after each wedding
              </label>
              <input id="rest-days" type="number" min={0} max={7} className="input" value={prefs.restDaysAfterShoot} onChange={(e) => setPrefs({ ...prefs, restDaysAfterShoot: Number(e.target.value) })} />
            </div>
          </div>

          <div>
            <label htmlFor="notes" className="label">
              Notes for the AI (holidays, travel, anything else)
            </label>
            <textarea id="notes" rows={3} className="input" placeholder="e.g. On vacation 10–20 August. No bookings the week of Thanksgiving." value={prefs.notes} onChange={(e) => setPrefs({ ...prefs, notes: e.target.value })} />
            {!aiConfigured && (
              <p className="mt-1 text-xs text-amber-700">
                No ANTHROPIC_API_KEY is set, so a rule-based scheduler will run and notes are ignored.
              </p>
            )}
          </div>

          {generateError && <p className="text-sm text-red-600">{generateError}</p>}

          {generating ? (
            <ProgressBar indeterminate label={aiConfigured ? "Asking the AI to draft your schedule… this can take a minute" : "Building your schedule…"} />
          ) : (
            <button type="submit" className="btn-primary">
              {aiConfigured ? "Generate schedule with AI" : "Generate schedule"}
            </button>
          )}
        </form>
      </section>

      {/* 3. Review */}
      {draft && (
        <section className="card space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">3. Review the proposal</h2>
            <span className={`badge ${draft.source === "ai" ? "bg-violet-100 text-violet-700" : "bg-stone-200 text-stone-700"}`}>
              {draft.source === "ai" ? "drafted by AI" : "rule-based draft"}
            </span>
          </div>
          <p className="text-sm text-stone-700">{draft.summary}</p>
          {draft.warnings.length > 0 && (
            <ul className="space-y-1 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
              {draft.warnings.map((w, i) => (
                <li key={i}>⚠️ {w}</li>
              ))}
            </ul>
          )}
          <p className="text-sm text-stone-600">
            <strong>{openCount(draft)}</strong> open slots across{" "}
            <strong>{openDayCount(draft)}</strong> days. Click any strip to switch that part of the
            day between available and blocked, then finalize.
          </p>
          <Legend />
          <MonthCalendar slots={draft.slots} bookedKeys={bookedKeys} onToggle={toggleSlot} />
          {finalizeError && <p className="text-sm text-red-600">{finalizeError}</p>}
          {finalizing ? (
            <ProgressBar indeterminate label="Publishing…" />
          ) : (
            <button type="button" className="btn-primary" onClick={finalize}>
              Finalize and publish
            </button>
          )}
        </section>
      )}

      {/* 4. Published */}
      {final && (
        <section className="card space-y-4">
          <h2 className="text-lg font-semibold">Your published availability</h2>
          <p className="text-sm text-stone-600">
            {openCount(final)} open slots across {openDayCount(final)} days between{" "}
            {formatLong(final.rangeStart)} and {formatLong(final.rangeEnd)}.
            Potential clients can see it at{" "}
            <a href={publicUrl} target="_blank" rel="noreferrer" className="font-medium text-rose-700 underline">
              {publicUrl}
            </a>
          </p>
          <Legend />
          <MonthCalendar slots={final.slots} bookedKeys={bookedKeys} />

          <div className="border-t border-stone-200 pt-4">
            {unpublishError && <p className="mb-2 text-sm text-red-600">{unpublishError}</p>}
            {unpublishing ? (
              <ProgressBar indeterminate label="Taking your page down…" />
            ) : confirmingUnpublish ? (
              <div className="space-y-3 rounded-lg bg-amber-50 p-3">
                <p className="text-sm text-amber-900">
                  Take your availability page down? Anyone who already has the link will see
                  &ldquo;no availability published&rdquo; instead of your open dates. Your bookings
                  are kept, and you can publish again whenever you like.
                </p>
                <div className="flex gap-2">
                  <button type="button" className="btn-primary" onClick={unpublish}>
                    Yes, take it down
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => setConfirmingUnpublish(false)}
                  >
                    Keep it published
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setConfirmingUnpublish(true)}
              >
                Unpublish
              </button>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

/** Colour key for the calendars. */
function Legend() {
  return (
    <div className="flex flex-wrap gap-4 text-xs text-stone-600">
      <span className="flex items-center gap-1">
        <span className="inline-block h-3 w-3 rounded-[2px] bg-emerald-200" /> available
      </span>
      <span className="flex items-center gap-1">
        <span className="inline-block h-3 w-3 rounded-[2px] bg-stone-200" /> blocked
      </span>
      <span className="flex items-center gap-1">
        <span className="inline-block h-3 w-3 rounded-[2px] bg-rose-200" /> booked wedding
      </span>
      <span className="text-stone-500">
        each day is three strips: {DAY_PARTS.map((p) => PART_LABELS[p].toLowerCase()).join(", ")}
      </span>
    </div>
  );
}
