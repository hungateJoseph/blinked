/**
 * Standing discount rules.
 *
 * A rule says "this label applies to these weekdays, in these parts of the
 * day, optionally between these dates" — for example "20% off Mondays". Rules
 * are matched against open slots when a schedule is saved, so setting one once
 * tags every matching slot in that schedule and in every later one.
 *
 * Only open slots are tagged: advertising a discount on a date you cannot
 * shoot would be worse than saying nothing.
 */
import { weekdayOf } from "./dates";
import { DAY_PARTS, type DayPart } from "./parts";
import type { ScheduleSlot } from "./schedule";

export interface DiscountRule {
  id: string;
  /** Short, shown to couples. e.g. "20% off". */
  label: string;
  /** Optional longer explanation, shown to couples under the label. */
  detail: string;
  /** 0 = Sunday … 6 = Saturday. Empty means every day. */
  weekdays: number[];
  /** Which parts of the day it applies to. */
  parts: DayPart[];
  /** Optional window. Null means the rule always applies. */
  dateStart: string | null;
  dateEnd: string | null;
}

export const MAX_LABEL_LENGTH = 40;
export const MAX_DETAIL_LENGTH = 200;

/** Does this rule cover this date and part? */
export function ruleCovers(rule: DiscountRule, date: string, part: DayPart): boolean {
  if (rule.dateStart && date < rule.dateStart) return false;
  if (rule.dateEnd && date > rule.dateEnd) return false;
  if (rule.weekdays.length > 0 && !rule.weekdays.includes(weekdayOf(date))) return false;
  return rule.parts.includes(part);
}

/**
 * Tag open slots with the first rule that covers them.
 *
 * First rather than all: two labels on one slot reads as confusion rather than
 * generosity, and the photographer can see the order in their list.
 */
export function applyDiscounts(slots: ScheduleSlot[], rules: DiscountRule[]): ScheduleSlot[] {
  if (rules.length === 0) return slots.map((slot) => ({ ...slot, discount: null }));

  return slots.map((slot) => {
    if (slot.status !== "available") return { ...slot, discount: null };
    const rule = rules.find((r) => ruleCovers(r, slot.date, slot.part));
    return {
      ...slot,
      discount: rule ? { label: rule.label, detail: rule.detail } : null,
    };
  });
}

/** Clean up a rule submitted from the browser. Returns null if unusable. */
export function parseRule(input: unknown): Omit<DiscountRule, "id"> | null {
  const raw = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;

  const label = typeof raw.label === "string" ? raw.label.trim().slice(0, MAX_LABEL_LENGTH) : "";
  if (!label) return null; // a discount with no label tells a couple nothing

  const weekdays = Array.isArray(raw.weekdays)
    ? [...new Set(raw.weekdays.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6))].sort()
    : [];

  const parts = Array.isArray(raw.parts)
    ? DAY_PARTS.filter((p) => (raw.parts as unknown[]).includes(p))
    : [];

  const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

  return {
    label,
    detail: typeof raw.detail === "string" ? raw.detail.trim().slice(0, MAX_DETAIL_LENGTH) : "",
    weekdays,
    // No parts chosen means the whole day, which is what someone offering a
    // "Monday discount" almost always means.
    parts: parts.length > 0 ? parts : [...DAY_PARTS],
    dateStart: isDate(raw.dateStart) ? raw.dateStart : null,
    dateEnd: isDate(raw.dateEnd) ? raw.dateEnd : null,
  };
}
