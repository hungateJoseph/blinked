import { eachDay, endOfMonth, formatLong, formatMonth, monthKey, weekdayOf } from "@/lib/dates";
import { DAY_PARTS, PART_INITIALS, PART_LABELS, type DayPart } from "@/lib/parts";
import type { ScheduleSlot } from "@/lib/schedule";

interface MonthCalendarProps {
  slots: ScheduleSlot[];
  /** "date|part" keys that have an existing booking, drawn in a third colour. */
  bookedKeys?: Set<string>;
  /** When given, each part becomes a button and this is called with what was clicked. */
  onToggle?: (date: string, part: DayPart) => void;
  /** Show each slot's reason as a tooltip (off for the public page). */
  showReasons?: boolean;
}

const WEEKDAY_HEADERS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

/** The key used to look a slot up by date and part. */
export function slotKey(date: string, part: DayPart): string {
  return `${date}|${part}`;
}

/**
 * One grid per month. Each day is a small stack of three strips — morning,
 * afternoon, evening — because availability is decided per part of the day.
 *
 * Colours: green = available, grey = blocked, rose = an existing booking.
 * Days outside the schedule's range are drawn faintly so the grid still lines
 * up with the weekday headers. Plain component: works on server and client.
 */
export default function MonthCalendar({
  slots,
  bookedKeys = new Set(),
  onToggle,
  showReasons = true,
}: MonthCalendarProps) {
  if (slots.length === 0) return null;

  const byKey = new Map(slots.map((slot) => [slotKey(slot.date, slot.part), slot]));
  const months = [...new Set(slots.map((slot) => monthKey(slot.date)))];

  return (
    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {months.map((month) => {
        const firstOfMonth = `${month}-01`;
        const leadingBlanks = weekdayOf(firstOfMonth); // empty cells before the 1st
        const days = eachDay(firstOfMonth, endOfMonth(month));

        return (
          <div key={month} className="card p-3">
            <h3 className="mb-2 text-sm font-semibold">{formatMonth(month)}</h3>
            <div className="grid grid-cols-7 gap-1 text-center text-[10px]">
              {WEEKDAY_HEADERS.map((day) => (
                <div key={day} className="pb-1 font-medium text-stone-500">
                  {day}
                </div>
              ))}
              {Array.from({ length: leadingBlanks }, (_, i) => (
                <div key={`blank-${i}`} />
              ))}
              {days.map((date) => {
                const inSchedule = byKey.has(slotKey(date, "morning"));
                const dayNumber = Number(date.slice(8, 10));

                return (
                  <div key={date} className="flex flex-col items-stretch gap-px">
                    <div
                      className={`leading-tight ${inSchedule ? "text-stone-700" : "text-stone-300"}`}
                    >
                      {dayNumber}
                    </div>

                    {DAY_PARTS.map((part) => {
                      const slot = byKey.get(slotKey(date, part));
                      const booked = bookedKeys.has(slotKey(date, part));
                      const colour = !slot
                        ? "bg-stone-50"
                        : booked
                          ? "bg-rose-200 text-rose-900"
                          : slot.status === "available"
                            ? // An offer gets its own colour, so a couple can pick
                              // out the discounted times without hovering.
                              slot.discount
                              ? "bg-amber-300 text-amber-900"
                              : "bg-emerald-200 text-emerald-900"
                            : "bg-stone-200 text-stone-400";

                      const label = `${formatLong(date)} — ${PART_LABELS[part]}`;
                      const title =
                        slot && showReasons && slot.reason ? `${label}: ${slot.reason}` : label;

                      // Booked parts cannot be toggled: they are always blocked.
                      if (onToggle && slot && !booked) {
                        return (
                          <button
                            key={part}
                            type="button"
                            title={`${title} (click to toggle)`}
                            aria-label={title}
                            onClick={() => onToggle(date, part)}
                            className={`h-3 rounded-[2px] ${colour} hover:ring-1 hover:ring-rose-400`}
                          >
                            <span className="sr-only">{PART_INITIALS[part]}</span>
                          </button>
                        );
                      }
                      return (
                        <div
                          key={part}
                          title={title}
                          aria-label={title}
                          className={`h-3 rounded-[2px] ${colour}`}
                        />
                      );
                    })}
                  </div>
                );
              })}
            </div>

            <p className="mt-2 text-[10px] text-stone-500">
              Each day shows morning, afternoon and evening, top to bottom.
            </p>
          </div>
        );
      })}
    </div>
  );
}
