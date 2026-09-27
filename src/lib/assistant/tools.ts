/**
 * The tools behind each skill — what the assistant can actually do.
 *
 * Every tool is a thin wrapper over a function the rest of the app already
 * uses (scheduleStore, enquiries, the touch-up pipeline), scoped to the
 * signed-in photographer. The model never touches the database or the file
 * system; it only ever calls these.
 *
 * Two rules are enforced here rather than in the prompt:
 *
 *   1. Anything that changes data is proposed, not done. `add_booking`
 *      records what it would do and returns "awaiting confirmation";
 *      `confirm_action` carries it out — and refuses if the proposal was made
 *      during the *same* message, so the photographer always gets a turn in
 *      between. A model that "forgets" to ask simply cannot succeed.
 *
 *   2. Only the tools for skills that are switched on exist at all. A skill
 *      that is off is not "disallowed" — it is absent.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { analyzePhotoWithAi, isAiConfigured } from "../ai";
import { WEEKDAY_NAMES, addDays, formatLong, isIsoDate, weekdayOf } from "../dates";
import { ruleCovers } from "../discounts";
import { listEnquiries } from "../enquiries";
import { DAY_PARTS, describeParts, isDayPart, type DayPart } from "../parts";
import { describeSharpness, measureSharpness, prepareForAi, readPhotoFile } from "../photos";
import { buildLocalAnalysis, getPhoto, insertAnalysis, listPhotos } from "../photoStore";
import {
  addBooking,
  bookingToView,
  deleteBooking,
  getLatestSchedule,
  listBookings,
  listDiscounts,
} from "../scheduleStore";
import { maskPhone, sendSms, trimForSms } from "../sms";
import { LIMITS, STYLE_PRESETS, type AssistantConfig } from "./catalog";
import { countTextsToday, getSmsNumber } from "./smsStore";
import { addMessage, getPendingAction, proposeAction, resolveAction } from "./store";
import { touchUpPhoto } from "./touchUp";

/** Everything a tool needs to know about the turn it is running in. */
export interface ToolContext {
  userId: string;
  channel: string;
  /** YYYY-MM-DD, worked out on the server. */
  today: string;
  config: AssistantConfig;
  /** The message being answered. Actions proposed during it cannot be confirmed during it. */
  messageId: string;
  /** Photos attached to that message. */
  attachedPhotoIds: string[];
  /** Photos the tools want shown with the reply — filled in as they run. */
  attachments: { photoId: string; variant: "original" | "edited" }[];
  publicSlug: string;
}

/** A tool as the loop sees it: its definition for the API, and how to run it. */
export interface AssistantTool {
  definition: Anthropic.Tool;
  run: (input: unknown, ctx: ToolContext) => Promise<unknown>;
}

/**
 * Build a tool from a Zod schema. The same schema validates what the model
 * sends and produces the JSON schema the API is given, so they cannot drift.
 */
function tool<T extends z.ZodObject>(spec: {
  name: string;
  description: string;
  input: T;
  run: (input: z.infer<T>, ctx: ToolContext) => Promise<unknown> | unknown;
}): AssistantTool {
  // Zod's converter adds a "$schema" key the Messages API does not want.
  const { $schema: _ignored, ...schema } = z.toJSONSchema(spec.input);
  return {
    definition: {
      name: spec.name,
      description: spec.description,
      input_schema: schema as Anthropic.Tool.InputSchema,
    },
    run: async (input, ctx) => {
      const parsed = spec.input.safeParse(input);
      if (!parsed.success) {
        return { error: `Invalid input: ${parsed.error.issues.map((i) => i.message).join("; ")}` };
      }
      return spec.run(parsed.data, ctx);
    },
  };
}

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Dates must be YYYY-MM-DD")
  .refine(isIsoDate, "Not a real date");

/** "Mon, Nov 2, 2026" — formatLong already carries the weekday, which is what stops calendar slips. */
const withWeekday = (date: string) => formatLong(date);

// ---------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------

const listBookingsTool = tool({
  name: "list_bookings",
  description:
    "The photographer's booked weddings in a date range (default: the next 12 months). " +
    "Each has a date, which parts of the day are booked, and a label such as the couple's name.",
  input: z.object({
    from: isoDate.optional().describe("Start date, inclusive. Defaults to today."),
    to: isoDate.optional().describe("End date, inclusive. Defaults to a year from the start."),
  }),
  run: ({ from, to }, ctx) => {
    const start = from ?? ctx.today;
    const end = to ?? addDays(start, 365);
    const bookings = listBookings(ctx.userId)
      .map(bookingToView)
      .filter((b) => b.date >= start && b.date <= end)
      .slice(0, 100)
      .map((b) => ({
        id: b.id,
        date: b.date,
        weekday: WEEKDAY_NAMES[weekdayOf(b.date)],
        parts: b.parts,
        label: b.label || "(no label)",
      }));
    return { from: start, to: end, bookings };
  },
});

const checkDateTool = tool({
  name: "check_date",
  description:
    "Everything known about one date: bookings on it, what the published availability page " +
    "shows for each part of the day (morning, afternoon, evening), and any offer that applies.",
  input: z.object({ date: isoDate }),
  run: ({ date }, ctx) => {
    const bookings = listBookings(ctx.userId)
      .map(bookingToView)
      .filter((b) => b.date === date)
      .map((b) => ({ id: b.id, parts: b.parts, label: b.label || "(no label)" }));

    const published = getLatestSchedule(ctx.userId, "final");
    const inRange = published && date >= published.rangeStart && date <= published.rangeEnd;
    const slots = inRange
      ? published.slots
          .filter((s) => s.date === date)
          .map((s) => ({
            part: s.part,
            status: s.status,
            reason: s.reason,
            offer: s.discount?.label ?? null,
          }))
      : null;

    const offers = listDiscounts(ctx.userId)
      .filter((rule) => DAY_PARTS.some((part) => ruleCovers(rule, date, part)))
      .map((rule) => ({
        label: rule.label,
        parts: DAY_PARTS.filter((part) => ruleCovers(rule, date, part)),
      }));

    return {
      date,
      weekday: WEEKDAY_NAMES[weekdayOf(date)],
      isPast: date < ctx.today,
      bookings,
      publishedAvailability: slots,
      publishedNote: published
        ? inRange
          ? null
          : `The published schedule covers ${published.rangeStart} to ${published.rangeEnd}; this date is outside it.`
        : "No schedule is published yet.",
      offersThatApply: offers,
    };
  },
});

const listOpenSlotsTool = tool({
  name: "list_open_slots",
  description:
    "Times shown as available on the photographer's published availability page, in a date range. " +
    "Use this for questions like 'what do I have open in October?'.",
  input: z.object({
    from: isoDate.optional().describe("Defaults to today."),
    to: isoDate.optional().describe("Defaults to 90 days after the start."),
  }),
  run: ({ from, to }, ctx) => {
    const published = getLatestSchedule(ctx.userId, "final");
    if (!published) {
      return {
        published: false,
        note: "No schedule is published. They can generate and finalize one on the Calendar/Planning page.",
      };
    }
    const start = from ?? ctx.today;
    const end = to ?? addDays(start, 90);
    const open = published.slots.filter(
      (s) => s.status === "available" && s.date >= start && s.date <= end,
    );
    return {
      published: true,
      scheduleCovers: { from: published.rangeStart, to: published.rangeEnd },
      availabilityPage: `/p/${ctx.publicSlug}`,
      openSlots: open.slice(0, 60).map((s) => ({
        date: s.date,
        weekday: WEEKDAY_NAMES[weekdayOf(s.date)],
        part: s.part,
        offer: s.discount?.label ?? null,
      })),
      truncated: open.length > 60 ? `${open.length - 60} more not shown` : null,
    };
  },
});

const listEnquiriesTool = tool({
  name: "list_enquiries",
  description:
    "Messages couples have left on the availability page, newest first. Each has a name, a way to " +
    "reply (email or phone), the time they asked about, and their message.",
  input: z.object({
    unreadOnly: z.boolean().optional().describe("Only ones the photographer has not read yet."),
  }),
  run: ({ unreadOnly }, ctx) => {
    const enquiries = listEnquiries(ctx.userId)
      .filter((e) => !unreadOnly || !e.read)
      .slice(0, 20)
      .map((e) => ({
        id: e.id,
        from: e.name,
        email: e.email || null,
        phone: e.phone || null,
        asksAbout: e.date ? `${withWeekday(e.date)}${e.part ? `, ${e.part}` : ""}` : null,
        message: e.message,
        receivedAt: e.createdAt,
        read: e.read,
      }));
    return { enquiries };
  },
});

const listOffersTool = tool({
  name: "list_offers",
  description: "The photographer's standing offers, such as '20% off Mondays'.",
  input: z.object({}),
  run: (_input, ctx) => ({
    offers: listDiscounts(ctx.userId).map((r) => ({
      label: r.label,
      detail: r.detail || null,
      weekdays: r.weekdays.length === 0 ? "every day" : r.weekdays.map((d) => WEEKDAY_NAMES[d]),
      parts: describeParts(r.parts),
      from: r.dateStart,
      to: r.dateEnd,
    })),
  }),
});

const partsInput = z
  .array(z.enum(DAY_PARTS))
  .min(1)
  .describe("Which parts of the day: morning, afternoon, evening. A whole day is all three.");

const addBookingTool = tool({
  name: "add_booking",
  description:
    "Propose adding a booking. Nothing is saved yet: the result describes exactly what would be " +
    "added and asks for the photographer's confirmation. Tell them, ask, and STOP — " +
    "confirm_action can only be called after they reply.",
  input: z.object({
    date: isoDate,
    parts: partsInput,
    label: z.string().max(120).describe("Who it is for, e.g. 'Nguyen wedding'. May be empty."),
  }),
  run: ({ date, parts, label }, ctx) => {
    const unique = [...new Set(parts)].filter(isDayPart) as DayPart[];
    const taken = new Set<DayPart>();
    for (const b of listBookings(ctx.userId).map(bookingToView)) {
      if (b.date === date) b.parts.forEach((p) => taken.add(p));
    }
    const clash = unique.filter((p) => taken.has(p));
    if (clash.length > 0) {
      return {
        error: `${describeParts(clash)} on ${withWeekday(date)} is already booked.`,
      };
    }
    const summary = `Add booking: ${label.trim() || "(no label)"} — ${withWeekday(date)}, ${describeParts(unique).toLowerCase()}`;
    const action = proposeAction({
      userId: ctx.userId,
      channel: ctx.channel,
      kind: "add_booking",
      payload: { date, parts: unique, label: label.trim() },
      summary,
      proposedIn: ctx.messageId,
    });
    return {
      status: "awaiting_confirmation",
      actionId: action.id,
      summary,
      instruction:
        "Not saved yet. Tell the photographer exactly this and ask them to confirm. " +
        "Do not call confirm_action in this turn; it will be refused.",
    };
  },
});

const removeBookingTool = tool({
  name: "remove_booking",
  description:
    "Propose removing a booking (use list_bookings for the id). Like add_booking, nothing " +
    "happens until the photographer confirms in their next message.",
  input: z.object({ bookingId: z.string() }),
  run: ({ bookingId }, ctx) => {
    const booking = listBookings(ctx.userId)
      .map(bookingToView)
      .find((b) => b.id === bookingId);
    if (!booking) return { error: "No booking with that id." };
    const summary = `Remove booking: ${booking.label || "(no label)"} — ${withWeekday(booking.date)}, ${describeParts(booking.parts).toLowerCase()}`;
    const action = proposeAction({
      userId: ctx.userId,
      channel: ctx.channel,
      kind: "remove_booking",
      payload: { bookingId },
      summary,
      proposedIn: ctx.messageId,
    });
    return {
      status: "awaiting_confirmation",
      actionId: action.id,
      summary,
      instruction:
        "Not removed yet. Tell the photographer exactly this and ask them to confirm. " +
        "Do not call confirm_action in this turn; it will be refused.",
    };
  },
});

const confirmActionTool = tool({
  name: "confirm_action",
  description:
    "Carry out a proposed action, once the photographer has confirmed it in a message AFTER it " +
    "was proposed. Refused if they have not had that chance.",
  input: z.object({ actionId: z.string() }),
  run: ({ actionId }, ctx) => {
    const pending = getPendingAction(ctx.userId, ctx.channel);
    if (!pending || pending.id !== actionId) {
      return { error: "That proposal is no longer open (it was cancelled, replaced or expired)." };
    }
    // The gate. A proposal made while answering this very message has not
    // been seen by the photographer yet, whatever the model believes.
    if (pending.proposedIn === ctx.messageId) {
      return {
        error:
          "Refused: this was proposed during the current message, so the photographer has not " +
          "confirmed it. Tell them what you propose and wait for their reply.",
      };
    }

    if (pending.kind === "add_booking") {
      const { date, parts, label } = pending.payload as {
        date: string;
        parts: DayPart[];
        label: string;
      };
      const result = addBooking(ctx.userId, date, parts, label);
      resolveAction(ctx.userId, pending.id, "confirmed");
      if ("conflict" in result) {
        return { error: `${describeParts(result.conflict)} on that date was booked in the meantime.` };
      }
      // The published page is not recomputed when a booking is added; the
      // photographer needs to know if couples can still see that time as open.
      const published = getLatestSchedule(ctx.userId, "final");
      const stillShownOpen = published?.slots.some(
        (s) => s.date === date && parts.includes(s.part) && s.status === "available",
      );
      return {
        done: true,
        booking: result.booking,
        warning: stillShownOpen
          ? "Their published availability page still shows that time as open until they generate and publish a new schedule."
          : null,
      };
    }

    if (pending.kind === "remove_booking") {
      const { bookingId } = pending.payload as { bookingId: string };
      const removed = deleteBooking(ctx.userId, bookingId);
      resolveAction(ctx.userId, pending.id, "confirmed");
      return removed ? { done: true } : { error: "That booking no longer exists." };
    }

    resolveAction(ctx.userId, pending.id, "cancelled");
    return { error: "Unknown action kind." };
  },
});

const cancelActionTool = tool({
  name: "cancel_action",
  description: "Drop a proposed action the photographer declined or wants changed.",
  input: z.object({ actionId: z.string() }),
  run: ({ actionId }, ctx) => ({
    cancelled: resolveAction(ctx.userId, actionId, "cancelled"),
  }),
});

// ---------------------------------------------------------------------------
// Photo touch-up
// ---------------------------------------------------------------------------

const listRecentPhotosTool = tool({
  name: "list_recent_photos",
  description: "The photographer's most recently uploaded photos, newest first.",
  input: z.object({ limit: z.number().int().min(1).max(20).optional() }),
  run: ({ limit }, ctx) => ({
    photos: listPhotos(ctx.userId)
      .slice(0, limit ?? 10)
      .map((p) => ({
        id: p.id,
        name: p.original_name,
        uploadedAt: p.created_at,
        edited: p.edited_name !== null,
        attachedToThisMessage: ctx.attachedPhotoIds.includes(p.id),
      })),
  }),
});

const touchUpPhotoTool = tool({
  name: "touch_up_photo",
  description:
    "Scan a photo, plan corrections without asking questions, apply them in the chosen style and " +
    "send the result back with the reply. Use it on every photo attached to a message unless the " +
    "photographer said not to. Pass any instructions they gave with the photo.",
  input: z.object({
    photoId: z.string(),
    style: z
      .enum(STYLE_PRESETS)
      .optional()
      .describe("Only if the photographer asked for a particular look; otherwise their default is used."),
    allowCrop: z.boolean().optional().describe("Only if they said whether cropping is OK."),
    instructions: z
      .string()
      .max(1000)
      .optional()
      .describe("Anything they said about this photo, in their words."),
  }),
  run: async ({ photoId, style, allowCrop, instructions }, ctx) => {
    const photo = getPhoto(ctx.userId, photoId);
    if (!photo) return { error: "No photo with that id." };
    const settings = ctx.config.skills.photos;
    const result = await touchUpPhoto({
      userId: ctx.userId,
      photo,
      style: style ?? settings.style,
      allowCrop: allowCrop ?? settings.allowCrop,
      instructions: instructions ?? "",
      // The planner sees the photographer's brief, so "never sharpen" or
      // "keep skin warm" written there reaches the edit itself, not just the
      // conversation around it.
      notes: ctx.config.brief,
      assistantName: ctx.config.name,
    });
    ctx.attachments.push({ photoId, variant: result.edited ? "edited" : "original" });
    return {
      edited: result.edited,
      quality: result.quality,
      whatTheScanFound: result.summary,
      issues: result.issues,
      applied: result.applied,
      needsARealEditor: result.manualSteps,
      assumptions: result.notes,
      photoPage: `/photos/${photoId}`,
      sentBack: result.edited
        ? "The edited photo is shown with your reply automatically."
        : "Nothing could be applied automatically, so the original is shown with your reply.",
    };
  },
});

const inspectPhotoTool = tool({
  name: "inspect_photo",
  description:
    "Scan a photo and report what is wrong with it WITHOUT editing. For 'what do you think of this?'.",
  input: z.object({ photoId: z.string() }),
  run: async ({ photoId }, ctx) => {
    const photo = getPhoto(ctx.userId, photoId);
    if (!photo) return { error: "No photo with that id." };
    const original = await readPhotoFile(photo);
    const sharpness = await measureSharpness(original);
    let analysis;
    let source: "ai" | "local";
    if (isAiConfigured()) {
      const image = await prepareForAi(original);
      analysis = await analyzePhotoWithAi({
        imageBase64: image.base64,
        mediaType: image.mediaType,
        fileName: photo.original_name,
        width: photo.width,
        height: photo.height,
        sharpness,
        sharpnessLabel: describeSharpness(sharpness),
      });
      source = "ai";
    } else {
      analysis = buildLocalAnalysis(sharpness);
      source = "local";
    }
    insertAnalysis({ photoId, sharpness, analysis, source });
    ctx.attachments.push({ photoId, variant: "original" });
    return {
      quality: analysis.overallQuality,
      summary: analysis.summary,
      issues: analysis.issues,
      questionsAnEditorWouldAsk: analysis.questions.map((q) => q.question),
      photoPage: `/photos/${photoId}`,
    };
  },
});

// ---------------------------------------------------------------------------
// Texting
// ---------------------------------------------------------------------------

/**
 * A text to the photographer's own verified mobile. Not gated like a booking
 * — it changes nothing — but capped per day, and only ever to them. On the
 * text channel the reply itself is the text, so the tool is not offered.
 */
const sendTextTool = tool({
  name: "send_text",
  description:
    "Text the photographer at their own verified mobile: a reminder, a detail they asked to have by text, a heads-up. " +
    "Only to them — never to a couple, a vendor or anyone else. A text, not a letter: a sentence or two.",
  input: z.object({
    text: z.string().min(1).max(480).describe("The message, plain text, no markdown"),
  }),
  run: async ({ text }, ctx) => {
    const row = getSmsNumber(ctx.userId);
    if (!row?.verified_at) {
      return { error: "No verified mobile on file. They can add one under Smart Photographer → Texting." };
    }
    if (countTextsToday(ctx.userId) >= LIMITS.textsPerDay) {
      return { error: `Today's limit of ${LIMITS.textsPerDay} texts is used up.` };
    }
    const result = await sendSms(row.number, text);
    // Kept on the text channel, so the texting page shows what went out.
    addMessage(ctx.userId, "sms", "assistant", trimForSms(text), []);
    return { sent: true, to: maskPhone(row.number), delivery: result.delivery };
  },
});

// ---------------------------------------------------------------------------

/** The tools an assistant gets, given which skills are on and how they are set. */
export function toolsFor(config: AssistantConfig, options: { canText?: boolean } = {}): AssistantTool[] {
  const tools = new Map<string, AssistantTool>();
  const add = (...list: AssistantTool[]) => list.forEach((t) => tools.set(t.definition.name, t));

  if (options.canText) add(sendTextTool);

  if (config.skills.scheduling.enabled) {
    add(listBookingsTool, checkDateTool, listOpenSlotsTool, listEnquiriesTool, listOffersTool);
    if (config.skills.scheduling.canBook) {
      add(addBookingTool, removeBookingTool, confirmActionTool, cancelActionTool);
    }
  }
  if (config.skills.photos.enabled) {
    add(listRecentPhotosTool, touchUpPhotoTool, inspectPhotoTool);
  }
  // Whatever the photographer described in the brief may read everything
  // they own — it is their data — but changes nothing: the write tools stay
  // behind the Scheduling skill's own switch.
  if (config.brief.trim().length > 0) {
    add(listBookingsTool, checkDateTool, listOpenSlotsTool, listEnquiriesTool, listOffersTool, listRecentPhotosTool);
  }
  return [...tools.values()];
}
