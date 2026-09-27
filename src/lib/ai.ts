/**
 * Everything that talks to Claude lives in this file, so the rest of the app
 * never touches the Anthropic SDK directly. Each function:
 *
 *   1. takes plain data in,
 *   2. asks Claude for a *structured* answer (validated against a schema), and
 *   3. returns typed data — or throws an `AiError` with a friendly message.
 *
 * When ANTHROPIC_API_KEY is not set, `isAiConfigured()` is false and callers
 * use the rule-based fallbacks instead of calling anything here.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import {
  BUDGET_USD,
  CAPABILITIES,
  HUMAN_MINIMUM_MINUTES,
  HUMAN_RATE_PER_HOUR,
  INTEGRATIONS,
  INTEGRATION_IDS,
  SKILLS,
  SPECIALTY_BY_ID,
  StepEstimateLenient,
  StepEstimateSchema,
  UnderstandingOutputLenient,
  UnderstandingOutputSchema,
  WORKFLOW_CANNOT,
  WORKFLOW_FACTS,
  WORKFLOW_ROUTES,
  WorkflowScreenOutputLenient,
  WorkflowScreenOutputSchema,
  needsPricing,
  screenFromOutput,
  specialtiesOf,
  tablePrice,
  usageCost,
  type AnalysisTier,
  type AnalysisUsage,
  type StepEstimate,
  type UnderstandingItem,
  type WorkflowEstimate,
  type WorkflowScreen,
} from "./assistant/catalog";
import { WEEKDAY_NAMES, eachDay, weekdayOf } from "./dates";
import { DAY_PARTS, PART_HINTS, PART_LABELS } from "./parts";
import type { BookingInput, ScheduleDraft, SchedulePreferences } from "./schedule";
import { normalizeSlots } from "./schedule";

/** The model used for every request — change it in one place if needed. */
export const MODEL = "claude-opus-5";

/** A problem talking to Claude, with a message safe to show to the user. */
export class AiError extends Error {}

export function isAiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/** The SDK picks up ANTHROPIC_API_KEY from the environment by itself. */
function getClient(): Anthropic {
  return new Anthropic();
}

/**
 * The assistant runs its own tool-use loop (lib/assistant/run.ts) and needs the
 * client and the error translation, so those two are shared rather than
 * duplicated. Everything else in this file stays the only place that builds
 * prompts for one-shot, structured requests.
 */
export { getClient as getAiClient, toAiError };

/** Translate SDK exceptions into an AiError, most specific first. */
function toAiError(error: unknown): AiError {
  if (error instanceof AiError) return error;
  if (error instanceof Anthropic.AuthenticationError) {
    return new AiError("The ANTHROPIC_API_KEY is missing or invalid.");
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new AiError("The model is rate-limiting requests right now — please try again in a moment.");
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new AiError("Could not reach the model API. Check your network connection.");
  }
  if (error instanceof Anthropic.APIError) {
    return new AiError(`Model API error (${error.status}): ${error.message}`);
  }
  return new AiError(error instanceof Error ? error.message : "Unexpected AI error.");
}

// ---------------------------------------------------------------------------
// 1. Schedule generation
// ---------------------------------------------------------------------------

const ScheduleOutput = z.object({
  slots: z.array(
    z.object({
      date: z.string().describe("YYYY-MM-DD"),
      part: z.enum(DAY_PARTS),
      status: z.enum(["available", "blocked"]),
      reason: z.string().describe("Short reason, under 12 words"),
    }),
  ),
  summary: z.string().describe("1-3 sentences for the photographer to read before reviewing"),
  warnings: z.array(z.string()).describe("Anything ambiguous or that could not be honoured"),
});

const SCHEDULE_SYSTEM_PROMPT = `You are a scheduling assistant for a wedding photographer.
You receive the photographer's already-booked weddings, their working preferences, and a date range.
Produce a proposed availability schedule for potential customers.

Each day is divided into three parts: "morning", "afternoon" and "evening". Availability is decided
separately for each part, so a photographer can shoot a morning ceremony and still offer that evening.

Rules:
- Output exactly one slot for EVERY part of EVERY date in the range, in order: three slots per date,
  morning then afternoon then evening. None may be missing or repeated.
- A part that is already booked is always "blocked" (mention the booking label in the reason).
- Block the requested number of rest days after each booked wedding — those block the whole day.
- Only mark a part "available" if the date is one of the photographer's working days AND the part is
  one of the parts they work.
- Respect the weekly maximum: it counts shoots (whole days), not parts, within a Monday–Sunday week.
  A day offering two parts still counts as one shoot.
- Apply the free-text notes sensibly (holidays, vacations, blackout periods, travel). Notes may refer
  to times of day ("no early starts", "evenings only in December") — honour those at the part level.
  If a note is ambiguous, make a cautious choice and add a warning explaining it rather than guessing
  silently.
- Keep every reason short (under 12 words). The summary is 1–3 plain sentences.`;

/** Ask Claude for a schedule proposal. Returns the same shape as the rule-based generator. */
export async function generateScheduleWithAi(input: {
  bookings: BookingInput[];
  preferences: SchedulePreferences;
  rangeStart: string;
  rangeEnd: string;
}): Promise<ScheduleDraft> {
  const { bookings, preferences, rangeStart, rangeEnd } = input;

  // Listing every date (with its weekday) keeps the model grounded and avoids
  // calendar mistakes such as thinking a date is a Saturday when it is not.
  const request = {
    rangeStart,
    rangeEnd,
    datesInRange: eachDay(rangeStart, rangeEnd).map((date) => ({
      date,
      weekday: WEEKDAY_NAMES[weekdayOf(date)],
    })),
    dayParts: DAY_PARTS.map((part) => `${part} (${PART_HINTS[part]})`),
    bookings: bookings.map((b) => ({
      date: b.date,
      partsBooked: b.parts,
      label: b.label || "(no label)",
    })),
    preferences: {
      workingDays: preferences.workingDays.map((d) => WEEKDAY_NAMES[d]),
      workingParts: preferences.workingParts.map((p) => PART_LABELS[p]),
      maxShootsPerWeek: preferences.maxShootsPerWeek,
      restDaysAfterShoot: preferences.restDaysAfterShoot,
      notes: preferences.notes || "(none)",
    },
  };

  try {
    const response = await getClient().messages.parse({
      model: MODEL,
      max_tokens: 16000,
      system: SCHEDULE_SYSTEM_PROMPT,
      messages: [{ role: "user", content: JSON.stringify(request, null, 2) }],
      output_config: { format: zodOutputFormat(ScheduleOutput) },
    });

    if (response.stop_reason === "refusal") {
      throw new AiError("The model declined to generate this schedule.");
    }
    const parsed = response.parsed_output;
    if (!parsed) {
      throw new AiError("The model returned a schedule in an unexpected format. Please try again.");
    }

    return {
      rangeStart,
      rangeEnd,
      // Belt and braces: guarantee one slot per date even if the model slipped.
      slots: normalizeSlots(parsed.slots, rangeStart, rangeEnd),
      summary: parsed.summary,
      warnings: parsed.warnings,
      source: "ai",
    };
  } catch (error) {
    throw toAiError(error);
  }
}

// ---------------------------------------------------------------------------
// 2. AI Image Cleanup — step one: find irregularities and ask questions
// ---------------------------------------------------------------------------

export const ISSUE_CATEGORIES = [
  "blur",
  "face_cutoff",
  "closed_eyes",
  "exposure",
  "color",
  "composition",
  "noise",
  "distraction",
  "other",
] as const;

const PhotoAnalysisOutput = z.object({
  overallQuality: z.enum(["good", "fair", "poor"]),
  summary: z.string().describe("Two or three sentences a photographer would find useful"),
  issues: z.array(
    z.object({
      id: z.string().describe("Short stable id such as issue-1"),
      category: z.enum(ISSUE_CATEGORIES),
      severity: z.enum(["low", "medium", "high"]),
      description: z.string().describe("What exactly is wrong, in one or two sentences"),
      location: z.string().describe("Where in the frame, e.g. 'left edge' or 'the bride's face'"),
    }),
  ),
  questions: z.array(
    z.object({
      id: z.string().describe("Short stable id such as q-1"),
      issueId: z.string().describe("The related issue id, or an empty string if general"),
      question: z.string(),
      options: z
        .array(z.string())
        .describe("2-4 short answer options, or an empty list for a free-text answer"),
    }),
  ),
});

export type PhotoAnalysis = z.infer<typeof PhotoAnalysisOutput>;
export type PhotoIssue = PhotoAnalysis["issues"][number];
export type PhotoQuestion = PhotoAnalysis["questions"][number];

const ANALYSIS_SYSTEM_PROMPT = `You are an assistant to a professional wedding photo retoucher.
Examine the photo for obvious technical irregularities that a client would notice:
blur or missed focus, motion blur, faces or heads cut off by the frame edge, closed eyes,
over- or under-exposure, blown highlights, strong colour casts, a tilted horizon, distracting
objects, and heavy noise.

Guidelines:
- Report only problems you can actually see. Do not invent issues; a clean photo has zero issues.
- Give each issue a precise location in the frame.
- Then write the follow-up questions the photographer must answer before edits can be planned —
  for example whether a tighter crop is acceptable, whether blur was an intentional artistic choice,
  or which subject matters most. Offer 2–4 short answer options when it makes sense; leave the
  options empty for free-text answers.
- If the photo looks clean, return no issues and at most one general question.
- You will also receive a local sharpness measurement. Use it only as a hint; trust your eyes.`;

/** Ask Claude to look at one photo and list what it would fix, plus questions for the photographer. */
export async function analyzePhotoWithAi(input: {
  imageBase64: string;
  mediaType: "image/jpeg";
  fileName: string;
  width: number;
  height: number;
  sharpness: number;
  sharpnessLabel: string;
}): Promise<PhotoAnalysis> {
  const hint = `File: ${input.fileName}. Dimensions: ${input.width}×${input.height}px.
Local sharpness metric (variance of the Laplacian): ${input.sharpness} — ${input.sharpnessLabel}.
(Below ~50 usually means blur, above ~150 usually means sharp.)`;

  try {
    const response = await getClient().messages.parse({
      model: MODEL,
      max_tokens: 16000,
      system: ANALYSIS_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: input.mediaType, data: input.imageBase64 },
            },
            { type: "text", text: hint },
          ],
        },
      ],
      output_config: { format: zodOutputFormat(PhotoAnalysisOutput) },
    });

    if (response.stop_reason === "refusal") {
      throw new AiError("The model declined to analyze this photo.");
    }
    if (!response.parsed_output) {
      throw new AiError("The model returned an analysis in an unexpected format. Please try again.");
    }
    return response.parsed_output;
  } catch (error) {
    throw toAiError(error);
  }
}

// ---------------------------------------------------------------------------
// 3. AI Image Cleanup — step two: turn the answers into a cleanup plan
// ---------------------------------------------------------------------------

/**
 * The adjustments Blinked can carry out itself.
 *
 * A fixed set of named numbers rather than a list of operations: it is far
 * more reliable to get back from a model, and it mirrors the panel of sliders
 * a photographer already knows. Zero means "leave this alone", so a plan that
 * only needs sharpening simply leaves the rest at zero.
 */
const AdjustmentsOutput = z.object({
  exposure: z.number().describe("-100 (much darker) to 100 (much brighter), 0 = no change"),
  highlights: z.number().describe("-100 recovers blown highlights, 100 brightens them, 0 = no change"),
  shadows: z.number().describe("-100 deepens shadows, 100 lifts them, 0 = no change"),
  contrast: z.number().describe("-100 to 100, 0 = no change"),
  saturation: z.number().describe("-100 (grey) to 100 (vivid), 0 = no change"),
  temperature: z.number().describe("-100 (cooler/bluer) to 100 (warmer/oranger), 0 = no change"),
  sharpen: z.number().describe("0 (none) to 100 (heavy). Use sparingly; it cannot rescue real blur"),
  denoise: z.number().describe("0 (none) to 100 (heavy). Softens detail, so keep low"),
  straighten: z.number().describe("Degrees to rotate, -15 to 15, to level a tilted horizon. 0 = no change"),
  crop: z
    .object({
      left: z.number().describe("0-1, fraction from the left edge"),
      top: z.number().describe("0-1, fraction from the top edge"),
      width: z.number().describe("0-1, fraction of the width to keep"),
      height: z.number().describe("0-1, fraction of the height to keep"),
    })
    .nullable()
    .describe("Null for no crop. Use for recomposing or trimming distractions at the edges"),
});

export type Adjustments = z.infer<typeof AdjustmentsOutput>;

const CleanupPlanOutput = z.object({
  steps: z.array(
    z.object({
      title: z.string(),
      detail: z.string().describe("Concrete instructions, including settings where useful"),
      toolHint: z.string().describe("Where to do it, e.g. 'Lightroom: Detail > Sharpening'"),
      /** Whether this step is covered by the adjustments below, or needs a real editor. */
      automatic: z
        .boolean()
        .describe("True if this step is fully covered by the adjustments field below"),
    }),
  ),
  adjustments: AdjustmentsOutput,
  notes: z.string().describe("Anything the photographer should double-check, or an empty string"),
});

export type CleanupPlan = z.infer<typeof CleanupPlanOutput>;

/** Every adjustment at zero — nothing to do. */
export const NO_ADJUSTMENTS: Adjustments = {
  exposure: 0,
  highlights: 0,
  shadows: 0,
  contrast: 0,
  saturation: 0,
  temperature: 0,
  sharpen: 0,
  denoise: 0,
  straighten: 0,
  crop: null,
};

/** True when at least one adjustment would actually change the image. */
export function hasAdjustments(a: Adjustments): boolean {
  return (
    a.crop !== null ||
    [
      a.exposure,
      a.highlights,
      a.shadows,
      a.contrast,
      a.saturation,
      a.temperature,
      a.sharpen,
      a.denoise,
      a.straighten,
    ].some((v) => Math.abs(v) >= 1)
  );
}

const PLAN_SYSTEM_PROMPT = `You are an assistant to a professional wedding photo retoucher.
You are given a photo, the list of irregularities found in it, and the photographer's answers to
follow-up questions.

Return two things.

1. "steps": an ordered, concrete cleanup plan. Each step needs a title, specific instructions and a
   tool hint. Do not include steps the photographer's answers ruled out. Mark a step automatic:true
   ONLY if the "adjustments" values below fully achieve it.

2. "adjustments": the subset of the work this application can perform itself. It can only do global
   tonal and colour changes, sharpening, noise reduction, straightening and cropping — the values in
   that object and nothing else. It CANNOT do anything generative or content-aware: it cannot extend
   a frame, rebuild a cut-off head, remove an object, clone, heal, or swap eyes from another frame.
   Steps like those must be automatic:false and left out of the adjustments.

Guidelines for the numbers:
- Be conservative. These are applied to an already-processed JPEG, which has far less latitude than
  a RAW file; large moves will band, clip or look artificial.
- Typical useful magnitudes are 5-40. Reserve anything above 60 for a genuinely severe problem.
- Sharpening cannot rescue real blur or missed focus. If the photo is properly out of focus, say so
  in the steps and keep sharpen low.
- Only crop when it genuinely improves the frame or removes a distraction, and never crop so tightly
  that the subject is clipped. Leave crop null if unsure.
- If nothing needs doing, return one step saying so and leave every adjustment at 0.`;

const TOUCH_UP_SYSTEM_PROMPT = `You are an assistant to a professional wedding photo retoucher.
The photographer is on location and has sent one photo for a quick touch-up — a sneak peek for the
couple, not the final delivery. Nobody can be asked questions, so make sensible assumptions and
state each one in "notes".

You are given the photo, the irregularities already found in it, and possibly instructions from the
photographer. Return the same two things as a normal cleanup plan:

1. "steps": an ordered, concrete plan. Mark a step automatic:true ONLY if the "adjustments" values
   fully achieve it. Anything generative or content-aware — extending a frame, rebuilding a cut-off
   head, removing an object, cloning, healing, swapping eyes — cannot be done here: automatic:false.

2. "adjustments": global tonal and colour corrections, sharpening, noise reduction, straightening
   and cropping, and nothing else.

Assumptions to make, unless the photographer's instructions say otherwise:
- Softness is a fault, not a style, unless it is unmistakably a deliberate effect.
- Correct towards neutral: even exposure, natural colour, a level horizon. Do NOT apply a "look" —
  the photographer's chosen style is layered on afterwards.
- Crop only if the input says cropping is allowed AND it clearly helps; never clip a person.
- Be conservative: this is a JPEG. Typical useful magnitudes are 5-40; above 60 only for something
  severe. Sharpening cannot rescue real blur.
- If the photo needs nothing, return one step saying so and leave every adjustment at 0.`;

/**
 * Plan a touch-up with no questions asked — the on-location version of
 * `planCleanupWithAi`, for the assistant. Same output shape, so the result is
 * stored and applied exactly like a plan the photographer answered questions for.
 */
export async function planTouchUpWithAi(input: {
  imageBase64: string;
  mediaType: "image/jpeg";
  analysis: PhotoAnalysis;
  allowCrop: boolean;
  instructions: string;
  photographerNotes: string;
}): Promise<CleanupPlan> {
  const context = {
    issues: input.analysis.issues,
    croppingAllowed: input.allowCrop,
    instructionsFromPhotographer: input.instructions || "(none)",
    standingNotesFromPhotographer: input.photographerNotes || "(none)",
  };

  try {
    const response = await getClient().messages.parse({
      model: MODEL,
      max_tokens: 16000,
      system: TOUCH_UP_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: input.mediaType, data: input.imageBase64 },
            },
            { type: "text", text: JSON.stringify(context, null, 2) },
          ],
        },
      ],
      output_config: { format: zodOutputFormat(CleanupPlanOutput) },
    });

    if (response.stop_reason === "refusal") {
      throw new AiError("The model declined to plan edits for this photo.");
    }
    if (!response.parsed_output) {
      throw new AiError("The model returned a plan in an unexpected format. Please try again.");
    }
    return response.parsed_output;
  } catch (error) {
    throw toAiError(error);
  }
}

// ---------------------------------------------------------------------------
// 4. Smart Photographer — what did the photographer ask for, and how much is achievable?
// ---------------------------------------------------------------------------

const UNDERSTAND_SYSTEM_PROMPT = `A wedding photographer has written, in their own words, what they want added to or changed
about their assistant inside Blinked, the app they use for scheduling, enquiries from couples and
photo cleanup. This text is their "brief".

You are given the brief, which built-in skills are switched on, and the exact list of what the
assistant CAN and CANNOT do. Split the brief into its distinct requests and judge each honestly.

- Each item is either a change to a built-in skill (scheduling, photos, lookup) or a new skill.
  A restriction or preference about dates is a change to scheduling; about editing, to photos.
- "feasible": all of the useful part. "partly": a useful part. "not_feasible": none of it.
- Translate requests into capabilities: checking other photographers' prices means searching the
  web; "messages about pricing" means reading the enquiries; sunset times can be searched for.
- Never promise anything not on the CAN list, and never soften a CANNOT. Sending a message to
  anyone, another app, acting on a timer, or anything with a device is out — say so plainly.
- If a request needs a skill that is switched off (web research with lookup off), it is "partly"
  at best; say which skill to switch on.
- The instructions are for the assistant itself: when the item applies, which capabilities to
  use, what to tell the photographer. Second person, concrete, short. Only what is feasible.
- A plain instruction like "clients call me Jo" is one feasible item. An empty or meaningless
  brief gives an empty list. Keep everything short.`;

/** Ask Claude to split the photographer's brief into items and check each against CAPABILITIES. */
export async function understandBriefWithAi(input: {
  brief: string;
  skillsOn: string[];
}): Promise<UnderstandingItem[]> {
  const request = {
    brief: input.brief,
    builtInSkillsSwitchedOn: input.skillsOn,
    theAssistantCan: CAPABILITIES.can,
    theAssistantCannot: CAPABILITIES.cannot,
  };
  try {
    const { output } = await createStructured(
      {
        model: MODEL,
        max_tokens: 6000,
        system: UNDERSTAND_SYSTEM_PROMPT,
        messages: [{ role: "user", content: JSON.stringify(request, null, 2) }],
      },
      tolerantFormat(UnderstandingOutputSchema, UnderstandingOutputLenient),
      "The model declined to read that brief.",
    );
    return output.items;
  } catch (error) {
    throw toAiError(error);
  }
}

// ---------------------------------------------------------------------------
// 5. Smart Photographer — turn a rough wish into a workflow, honestly judged
// ---------------------------------------------------------------------------

/**
 * The workflow analysis runs on the cheapest model. It is a judgement and an
 * estimate, not the assistant's conversation, and at Haiku prices a whole
 * analysis costs about a cent plus a cent per web search.
 */
export const CHEAP_MODEL = "claude-haiku-4-5-20251001";

/** What each analysis tier actually runs. The picker's copy is in the catalogue. */
const TIER_SETTINGS: Record<
  AnalysisTier,
  { model: string; searches: number; thinking: boolean; searchTool: "web_search_20250305" | "web_search_20260209" }
> = {
  // Haiku only has the basic search variant; the newer one is for the larger models.
  standard: { model: CHEAP_MODEL, searches: 3, thinking: false, searchTool: "web_search_20250305" },
  balanced: { model: "claude-sonnet-5", searches: 5, thinking: false, searchTool: "web_search_20260209" },
  thorough: { model: MODEL, searches: 8, thinking: true, searchTool: "web_search_20260209" },
};

/** What one or more responses cost, from the usage the API reports. */
function usageOf(tier: AnalysisTier, model: string, responses: Anthropic.Message[]): AnalysisUsage {
  const inputTokens = responses.reduce((n, r) => n + r.usage.input_tokens, 0);
  const outputTokens = responses.reduce((n, r) => n + r.usage.output_tokens, 0);
  const searches = responses.reduce((n, r) => n + (r.usage.server_tool_use?.web_search_requests ?? 0), 0);
  return {
    tier,
    model,
    inputTokens,
    outputTokens,
    searches,
    costUsd: usageCost(model, inputTokens, outputTokens, searches),
    chargedCents: 0,
  };
}

/**
 * A structured request that survives the two things `messages.parse` does
 * not: a turn paused mid-search (`pause_turn`, which needs resuming with the
 * partial turn appended) and a preamble text block before the JSON. The
 * answer is read from the LAST text block. Returns every response made, so
 * the usage can be summed.
 */
async function createStructured<T>(
  params: Omit<Anthropic.MessageCreateParamsNonStreaming, "output_config">,
  format: { type: "json_schema"; schema: Anthropic.JSONOutputFormat["schema"]; parse: (content: string) => T },
  refusalMessage: string,
): Promise<{ output: T; responses: Anthropic.Message[] }> {
  const client = getClient();
  const responses: Anthropic.Message[] = [];
  let messages = params.messages;
  // A few resumes cover a long search; more than that and something is wrong.
  for (let round = 0; round < 5; round++) {
    const response = await client.messages.create({
      ...params,
      messages,
      output_config: { format: { type: "json_schema", schema: format.schema } },
    });
    responses.push(response);
    if (response.stop_reason === "refusal") throw new AiError(refusalMessage);
    if (response.stop_reason === "pause_turn") {
      messages = [...messages, { role: "assistant", content: response.content }];
      continue;
    }
    if (response.stop_reason === "max_tokens") {
      throw new AiError("The model ran out of room before finishing. Please try again.");
    }
    const texts = response.content.filter((b): b is Anthropic.TextBlock => b.type === "text");
    if (texts.length === 0) throw new AiError("The model returned no answer. Please try again.");
    // The JSON is normally the last text block, but a model sometimes adds a
    // remark after it or before it; try each block from the last, and within
    // a block the outermost {...} in case of surrounding prose.
    let lastError: unknown = null;
    for (const block of [...texts].reverse()) {
      for (const candidate of jsonCandidates(block.text)) {
        try {
          return { output: format.parse(candidate), responses };
        } catch (error) {
          lastError = error;
        }
      }
    }
    throw new AiError(`The model's answer could not be read: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
  }
  throw new AiError("That took too many rounds of searching. Please try again.");
}

/** The text as-is, then the outermost {...} inside it if there is prose around it. */
function jsonCandidates(text: string): string[] {
  const trimmed = text.trim();
  const candidates = [trimmed];
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start > 0 || (start === 0 && end < trimmed.length - 1)) {
    if (start >= 0 && end > start) candidates.push(trimmed.slice(start, end + 1));
  }
  return candidates;
}

/**
 * An output format that hands the API the strict schema (which steers the
 * model) but reads the reply through a lenient one (which forgives it).
 * With plain zodOutputFormat, one wrong enum value — "Photo touch-up" for
 * "photos" — throws the whole analysis away; here names are mapped and
 * unknown values defaulted, and only unparseable JSON is an error.
 */
function tolerantFormat<T>(strict: z.ZodType, lenient: z.ZodType<T>) {
  const base = zodOutputFormat(strict);
  return {
    type: "json_schema" as const,
    schema: base.schema,
    parse: (content: string): T => {
      const parsed: unknown = JSON.parse(content);
      const result = lenient.safeParse(parsed);
      if (!result.success) {
        throw new Error(result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
      }
      return result.data;
    },
  };
}

const SCREEN_SYSTEM_PROMPT = `A wedding photographer describes something they want done. It might be done by their
assistant inside Blinked, by the photographer themselves, by a third-party AI or online service,
by a person on the team, or it might need new functionality built into the site.

Answer four yes/no questions about the request, then ALWAYS break it into steps.

The four concerns — true only when clearly so:
- illegal: it breaks the law (defrauding customers of deposits, harassment, privacy violations).
- unethical: it mocks, humiliates or discriminates against people ("pick out the ugly people to
  laugh at"), or deceives the photographer's clients. Retouching is this photographer's trade:
  cosmetic edits to their own clients' photos — smoothing wrinkles, adding a fun prop like a pink
  tiara, picking out guests by apparent age or by who they are in order to edit them — are ordinary
  work and NOT unethical.
- absurd: pointless make-work (removing one pixel at a time until someone notices), or so many
  moving parts — dozens of parties — that nobody could deliver it. A handful of steps is not this.
- obviouslyExpensive: plainly in the thousands of dollars before looking at any prices — hiring
  staff for weeks, renting a venue, buying equipment. Bulk AI processing of photos costs cents per
  photo and is NOT this. If unsure, false: the estimate will price it and the total decides.

Whether the software can do it is NOT one of the questions. Needing a backend, a person or the
developers is never a concern — it is a route for a step.

Steps: in the order things would happen, one per distinct action, each on the backend that
handles it. The supported backends (listed in the input, every one tagged beta) are ASSUMED set
up and working with no roadblocks: route their steps to "service" and name the backend in
"integration" — never call them unsupported, never send them to "human" or "engineering". Say
"(beta)" in the detail of a service step. For "if the temperature rises above 100°F on the
wedding day, have two cases of water delivered to the venue and text me an update every 15
minutes": watch the forecast and trigger ("service", automation); order the water to the venue
("service", amazon); text the updates ("service", comms). Routes:
- "site": the assistant does it now, when asked, with the skills listed (say which in "uses").
- "self": the photographer does it themselves — choosing, approving, handing something over.
- "service": a supported backend — amazon (any purchase and delivery; the usual choice for
  goods), instacart (groceries and everyday goods from local stores, in about an hour), aws
  (cloud storage, photo and video editing software), fiverr (any freelance service), taskrabbit
  (any local hands-on task by a person), payments (PayPal/Stripe requests and refunds), comms
  (texts, emails, calls to anyone), automation (scheduled checks and triggers, repeating on a
  timer). Route a purchase to the backend the photographer named, or amazon if they named none.
  Delivery is part of a purchase step, never a step of its own; making and delivering a print
  or album is ONE step.
- "ai_service": some other third-party AI or online service — say what kind in the detail.
- "human": a person on the team, for what no backend covers — a bespoke judgement call.
- "engineering": outside every backend — other vendors' accounts, devices — not supported yet.
Never route to "site" anything the skills and facts say the assistant cannot do. Keep every title
and detail short. Give a one-sentence summary of the workflow either way.

briefLines: for "site" steps only, one sentence each in the photographer's own voice for the
assistant's brief ("When I ask about a shoot, tell me its date and venue."); empty if there are
no site steps. skillsToEnable: the built-in skills those steps rely on.

alternatives: where a DIFFERENT supported backend would do a step clearly faster or clearly
cheaper, offer it here instead of overriding the step: the step's index, the backend, "faster"
or "cheaper", the step done that way in one short sentence (say "(beta)"), and the trade-off in
a few words. The usual cases: everyday goods needed today — water, ice, snacks, flowers — put on
amazon: instacart is faster (about an hour from a local store; usually a few dollars more). A
purchase not needed today put on instacart: amazon is cheaper (a day slower). A local hands-on
job given to a fiverr freelancer or a person on the team: taskrabbit is faster. A retouch,
design or write-up given to a person on the team: fiverr is cheaper. Only when the difference is
real and the backend genuinely covers the step — a person running errands cannot make a print,
an album or a film faster than the service that makes it; never the backend the step is already
on; at most one per step; empty when nothing is clearly better.

specialty: amazon, aws, fiverr and taskrabbit each list their specialities in the input, with
ids. Every "service" step on one of those names the speciality that fits, by id — "Fiverr ›
Wedding video editing", "TaskRabbit › Wait for Delivery & Wait in Line", "AWS › Rekognition" —
not just the backend; if none fits exactly, the closest. "none" only for backends without a
list. An alternative names its speciality the same way.`;

/**
 * Pass one: the four concerns and the steps. Fast, no searching. The
 * decision itself is made in code — see screenFromOutput.
 */
export async function screenWorkflowWithAi(input: {
  description: string;
  skillsOn: string[];
  tier?: AnalysisTier;
}): Promise<{ screen: WorkflowScreen; usage: AnalysisUsage }> {
  const tier = input.tier ?? "standard";
  const settings = TIER_SETTINGS[tier];
  const request = {
    whatThePhotographerWants: input.description,
    builtInSkills: SKILLS.map((s) => ({
      id: s.id,
      name: s.name,
      covers: s.supports,
      switchedOn: input.skillsOn.includes(s.name),
    })),
    supportedBackends: INTEGRATION_IDS.map((id) => ({
      integration: id,
      name: INTEGRATIONS[id].name,
      covers: INTEGRATIONS[id].covers,
      status: "beta — assumed set up and working",
      specialties: specialtiesOf(id).map((s) => ({ specialty: s.id, name: s.name, covers: s.covers })),
    })),
    theAssistantCan: CAPABILITIES.can,
    stillOutOfReach: WORKFLOW_CANNOT,
    facts: WORKFLOW_FACTS,
  };
  try {
    const { output, responses } = await createStructured(
      {
        model: settings.model,
        max_tokens: settings.thinking ? 8000 : 3000,
        ...(settings.thinking ? { thinking: { type: "adaptive" as const } } : {}),
        system: SCREEN_SYSTEM_PROMPT,
        messages: [{ role: "user", content: JSON.stringify(request, null, 2) }],
      },
      tolerantFormat(WorkflowScreenOutputSchema, WorkflowScreenOutputLenient),
      "The model declined to look at that request.",
    );
    return { screen: screenFromOutput(output), usage: usageOf(tier, settings.model, responses) };
  } catch (error) {
    throw toAiError(error);
  }
}

const ESTIMATE_SYSTEM_PROMPT = `Price and time ONE step of a workflow for a wedding photographer, in US dollars. You are given
the whole request for context and the one step to price, with its route (${WORKFLOW_ROUTES.join(", ")})
and, for a supported backend, which one. Answer for that step only, briefly: basis in at most
fifteen words, at most two options.

Cost: goods, delivery, service and AI fees only. Give a unit (flat, per_photo, per_item, per_hour,
per_month), the unit price as a low and a high, and the quantity — the site multiplies, so never
multiply yourself. Five cameras: per_item, $19–$22, quantity 5. AI processing of about a thousand
photos: per_photo, quantity 1000. For a purchase give up to two concrete options with the total
price for the quantity needed, the fastest way to get it first (Amazon Same-Day, Instacart,
DoorDash, with its fee). Search the web at most once, and only if the item is not in the typical
prices below — prefer what you know.

A supported backend ("service" route) costs what the vendor charges — nothing more, and no team
time: an Amazon item plus any same-day fee; a Fiverr gig; TaskRabbit's hourly rate plus its
service fee; AWS per GB-month or per month. When the step names a speciality with a typical
price, price WITHIN that range — it is the site's checked rate for that speciality — scaled to
the request's quantity; do not search for a different figure. A purchase step includes its
delivery: price the goods and the delivery together, once.

Typical prices, so estimates stay plausible (search if the case is unusual): a case of bottled
water on Amazon $6–$12, same-day delivery fee $0–$10; on Instacart the store price plus about
10–15% markup, a $4–$8 delivery fee and a service fee of about 5% — a case of water $9–$16
delivered, in 1–2 hours (about an hour with priority delivery); a fleece blanket $15–$40; disposable
cameras $15–$25 each; Fiverr custom artwork $30–$300, a retoucher $5–$50 per photo; TaskRabbit
$30–$60 per hour plus about 15% service fee, one-hour minimum; texts $0.01 each, emails free, a
phone call a few cents a minute; AWS storage about $0.023 per GB-month, cloud editing software
$10–$50 per month; face or age detection by API $0.001–$0.01 per image; generative edits by API
$0.02–$0.20 per image; a human retoucher $1–$10 per photo; same-day courier in a US city $10–$40.

A person on the team is billed at $${HUMAN_RATE_PER_HOUR} an hour in ${HUMAN_MINIMUM_MINUTES}-minute blocks: give their minutes in
humanMinutes, not dollars — the site converts and shows it, so NEVER mention the person's time or
its cost in basis; basis is about goods, delivery and fees only. Only "human" steps have
humanMinutes; every other route gets 0. "site" and "self" steps cost nothing. "engineering" steps
are not priced at all — flat $0, quantity 1, empty basis, no options, no searching: the site says
they need the developers. An "ai_service" step ALWAYS has a fee — estimate it from the typical prices above,
and search if you do not know; it is never $0. If a step's cost genuinely cannot be pinned down,
set unknown=true and say why in roadblock, and keep going with the rest — never put 0 where you
mean "don't know".

Time: assume everything starts immediately and takes the fastest realistic route. Give the
fastest option first, then the ordinary one: for something stocked locally, "about an hour by
Amazon Same-Day or Instacart; 1–2 days shipped" — never just "1–2 days". A Fiverr gig is its
delivery time; a TaskRabbit tasker can usually start within hours. A "service" or "ai_service"
step is kind "estimate". A "human" step with no tangible timeframe at all is kind "human" (only
the team can say).`;

/** What the pricing call is given: a step, or a recommended alternative dressed as one. */
type PricedStep = Pick<WorkflowScreen["steps"][number], "title" | "detail" | "route" | "integration" | "specialty">;

/** Price and time one step. Searches at most once (twice on the bigger tiers). */
async function estimateStepWithAi(input: {
  description: string;
  step: PricedStep;
  tier: AnalysisTier;
}): Promise<{ estimate: StepEstimate; responses: Anthropic.Message[] }> {
  const settings = TIER_SETTINGS[input.tier];
  const specialty = input.step.specialty && input.step.specialty !== "none" ? SPECIALTY_BY_ID[input.step.specialty] : undefined;
  const request = {
    wholeRequest: input.description,
    stepToPrice: {
      title: input.step.title,
      detail: input.step.detail,
      route: input.step.route,
      integration: input.step.integration,
      backend: input.step.integration === "none" ? undefined : INTEGRATIONS[input.step.integration].name,
      specialty: specialty ? { name: specialty.name, covers: specialty.covers, typicalPrice: specialty.typical } : undefined,
    },
  };
  // A speciality's typical price is the sheet: no search unless the price
  // turns on what is bought (goods on Amazon). Fewer searches, steadier numbers.
  const canSearch = !specialty || specialty.lookup === true;
  const { output, responses } = await createStructured(
    {
      model: settings.model,
      max_tokens: settings.thinking ? 3000 : 1200,
      ...(settings.thinking ? { thinking: { type: "adaptive" as const } } : {}),
      system: ESTIMATE_SYSTEM_PROMPT,
      tools: canSearch ? [{ type: settings.searchTool, name: "web_search", max_uses: input.tier === "standard" ? 1 : 2 }] : [],
      messages: [{ role: "user", content: JSON.stringify(request, null, 2) }],
    },
    tolerantFormat(StepEstimateSchema, StepEstimateLenient),
    "The model declined to price that step.",
  );
  return { estimate: output, responses };
}

/** What a step that needs no pricing call looks like in the estimate. */
function defaultEstimate(step: PricedStep): StepEstimate {
  const table = tablePrice(step.integration);
  if (table) return table;
  const time =
    step.route === "site"
      ? { kind: "estimate" as const, estimate: "moments, when you ask" }
      : step.route === "self"
        ? { kind: "estimate" as const, estimate: "a few minutes of your own time" }
        : { kind: "engineering" as const, estimate: "" };
  return {
    humanMinutes: 0,
    cost: { unit: "flat", unitLow: 0, unitHigh: 0, quantity: 1, basis: "", options: [], unknown: false, roadblock: "" },
    time,
  };
}

/**
 * Pass two: money and time per step. Each step that needs a price is a small
 * call of its own, and they all run at once, so the wait is the slowest step
 * rather than the sum; steps with a table tariff or no cost need no call at
 * all. A recommended alternative (water from Instacart rather than Amazon) is
 * priced the same way, beside its step. One step failing to price does not
 * sink the rest — it comes back as a roadblock. The brief lines come from the
 * screen, which already knows the site steps.
 */
export async function estimateWorkflowWithAi(input: {
  description: string;
  screen: WorkflowScreen;
  tier?: AnalysisTier;
}): Promise<{ estimate: WorkflowEstimate; usage: AnalysisUsage }> {
  const tier = input.tier ?? "standard";
  const settings = TIER_SETTINGS[tier];

  const priceOne = async (step: PricedStep): Promise<{ estimate: StepEstimate; responses: Anthropic.Message[] }> => {
    if (!needsPricing(step)) return { estimate: defaultEstimate(step), responses: [] };
    try {
      return await estimateStepWithAi({ description: input.description, step, tier });
    } catch (error) {
      const message = toAiError(error).message;
      return {
        estimate: {
          humanMinutes: 0,
          cost: { unit: "flat", unitLow: 0, unitHigh: 0, quantity: 1, basis: "", options: [], unknown: true, roadblock: `Could not price this step: ${message}` },
          time: { kind: step.route === "human" ? "human" : "estimate", estimate: "" },
        },
        responses: [],
      };
    }
  };

  const results = await Promise.all(
    input.screen.steps.map(async (step, index): Promise<{ step: WorkflowEstimate["steps"][number]; responses: Anthropic.Message[] }> => {
      const alt = step.alternative;
      const [main, other] = await Promise.all([
        priceOne(step),
        alt
          ? priceOne({ title: step.title, detail: alt.detail, route: "service", integration: alt.integration, specialty: alt.specialty ?? "none" })
          : Promise.resolve(null),
      ]);
      return {
        step: { index, ...main.estimate, alternative: other?.estimate ?? null },
        responses: [...main.responses, ...(other?.responses ?? [])],
      };
    }),
  );

  return {
    estimate: {
      steps: results.map((r) => r.step),
      briefLines: input.screen.briefLines,
      skillsToEnable: input.screen.skillsToEnable,
    },
    usage: usageOf(tier, settings.model, results.flatMap((r) => r.responses)),
  };
}

/** Ask Claude for an edit plan, given the earlier analysis and the photographer's answers. */
export async function planCleanupWithAi(input: {
  imageBase64: string;
  mediaType: "image/jpeg";
  analysis: PhotoAnalysis;
  answers: Record<string, string>;
}): Promise<CleanupPlan> {
  const context = {
    issues: input.analysis.issues,
    questionsAndAnswers: input.analysis.questions.map((q) => ({
      question: q.question,
      relatedIssue: q.issueId || null,
      answer: input.answers[q.id] ?? "(no answer)",
    })),
  };

  try {
    const response = await getClient().messages.parse({
      model: MODEL,
      max_tokens: 16000,
      system: PLAN_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: input.mediaType, data: input.imageBase64 },
            },
            { type: "text", text: JSON.stringify(context, null, 2) },
          ],
        },
      ],
      output_config: { format: zodOutputFormat(CleanupPlanOutput) },
    });

    if (response.stop_reason === "refusal") {
      throw new AiError("The model declined to plan edits for this photo.");
    }
    if (!response.parsed_output) {
      throw new AiError("The model returned a plan in an unexpected format. Please try again.");
    }
    return response.parsed_output;
  } catch (error) {
    throw toAiError(error);
  }
}
