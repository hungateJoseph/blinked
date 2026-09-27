"use client";

import { useState } from "react";
import EnquiryForm from "./EnquiryForm";
import MonthCalendar from "./MonthCalendar";
import { formatLong } from "@/lib/dates";
import { DAY_PARTS, PART_HINTS, PART_LABELS, type DayPart } from "@/lib/parts";
import type { PublicAvailability as Availability } from "@/lib/scheduleStore";

/**
 * The public availability page's interactive part: clicking an open slot opens
 * an enquiry form already addressed to that date and time.
 */
export default function PublicAvailability({ availability }: { availability: Availability }) {
  const [asking, setAsking] = useState<
    { date: string; part: DayPart; discount: { label: string; detail: string } | null } | null
  >(null);
  const [showGeneral, setShowGeneral] = useState(false);

  const open = availability.slots.filter((s) => s.available);
  const openDays = new Set(open.map((s) => s.date)).size;

  // Discounts actually in force, so they can be listed once above the calendar
  // rather than being something you have to hunt for by hovering.
  const offers = new Map<string, string>();
  for (const slot of open) {
    if (slot.discount) offers.set(slot.discount.label, slot.discount.detail);
  }

  const byKey = new Map(availability.slots.map((s) => [`${s.date}|${s.part}`, s]));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{availability.photographerName}&apos;s availability</h1>
        <p className="mt-1 text-sm text-stone-600">
          {open.length} open slot{open.length === 1 ? "" : "s"} across {openDays} day
          {openDays === 1 ? "" : "s"} between {formatLong(availability.rangeStart)} and{" "}
          {formatLong(availability.rangeEnd)}. Updated{" "}
          {formatLong(availability.finalizedAt.slice(0, 10))}.
        </p>
      </div>

      {offers.size > 0 && (
        <div className="card border-amber-200 bg-amber-50">
          <h2 className="text-sm font-semibold text-amber-900">Current offers</h2>
          <ul className="mt-2 space-y-1 text-sm text-amber-900">
            {[...offers].map(([label, detail]) => (
              <li key={label}>
                <span className="badge bg-amber-200 text-amber-900">{label}</span>
                {detail && <span className="ml-2">{detail}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap gap-4 text-xs text-stone-600">
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded-[2px] bg-emerald-200" /> open
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded-[2px] bg-stone-200" /> not available
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded-[2px] bg-amber-300" /> open, with an offer
        </span>
        <span className="text-stone-500">
          each day is three strips:{" "}
          {DAY_PARTS.map((p) => `${PART_LABELS[p].toLowerCase()} (${PART_HINTS[p]})`).join(", ")}
        </span>
      </div>

      <p className="text-sm text-stone-700">
        Click any open time to ask about it — no account needed.
      </p>

      <MonthCalendar
        slots={availability.slots.map((s) => ({
          date: s.date,
          part: s.part,
          status: s.available ? "available" : "blocked",
          reason: s.discount ? s.discount.label : "",
          discount: s.discount,
        }))}
        showReasons
        onToggle={(date, part) => {
          const slot = byKey.get(`${date}|${part}`);
          if (!slot?.available) return; // only open times can be asked about
          setShowGeneral(false);
          setAsking({ date, part, discount: slot.discount });
        }}
      />

      {asking ? (
        <EnquiryForm slug={availability.slug} slot={asking} onClose={() => setAsking(null)} />
      ) : showGeneral ? (
        <EnquiryForm slug={availability.slug} slot={null} onClose={() => setShowGeneral(false)} />
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="btn-secondary" onClick={() => setShowGeneral(true)}>
            Ask about something else
          </button>
          <span className="text-sm text-stone-600">
            Or click an open time above to ask about that date.
          </span>
        </div>
      )}
    </div>
  );
}
