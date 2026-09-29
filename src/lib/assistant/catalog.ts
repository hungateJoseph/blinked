/**
 * What a Smart Photographer can be made of.
 *
 * This is the catalogue the setup screen is built from and the shape of the
 * configuration stored per user. It is browser-safe on purpose — no database,
 * no Anthropic SDK — so the setup wizard can import it directly. The server
 * side (running the assistant, the tools behind each skill) lives next door
 * in run.ts and tools.ts.
 *
 * The design: each photographer gets ONE assistant. They pick which built-in
 * skills it has, and then write, in one open box, anything they want added or
 * changed — "avoid dates near a lunar eclipse", or a whole new skill such as
 * "Negotiate: compare an enquiry's budget with local rates". That text is the
 * "brief". The model reads it, splits it into items, and checks each against the
 * fixed list of what the assistant can and cannot do (CAPABILITIES), so the
 * photographer is told up front which part they will get.
 */
import { z } from "zod";
import type { Adjustments } from "../ai";

export const SKILL_IDS = ["scheduling", "photos", "lookup"] as const;
export type SkillId = (typeof SKILL_IDS)[number];

export const TONES = ["concise", "advisory"] as const;
export type Tone = (typeof TONES)[number];

export const TONE_LABELS: Record<Tone, { label: string; hint: string }> = {
  concise: { label: "Concise", hint: "Short answers. No suggestions unless you ask." },
  advisory: {
    label: "Advisory",
    hint: "Still short, but suggests a follow-up, or how to tune a skill to get what you want.",
  },
};

/** How a touched-up photo should look, on top of the corrections. */
export const STYLE_PRESETS = ["natural", "bright", "moody", "mono"] as const;
export type StylePreset = (typeof STYLE_PRESETS)[number];

export const STYLE_LABELS: Record<StylePreset, { label: string; hint: string }> = {
  natural: { label: "Natural", hint: "Corrections only — true to the scene" },
  bright: { label: "Bright & airy", hint: "Lifted, soft, a touch warm" },
  moody: { label: "Moody", hint: "Deeper, contrasty, slightly cool" },
  mono: { label: "Black & white", hint: "Monochrome with a little punch" },
};

/**
 * The look each preset adds, layered on top of whatever corrections the plan
 * made. Kept deliberately gentle: these are applied to JPEGs, which have far
 * less latitude than RAW files.
 */
const PRESET_ADJUSTMENTS: Record<StylePreset, Partial<Adjustments>> = {
  natural: {},
  bright: { exposure: 12, shadows: 18, contrast: -8, temperature: 4, saturation: -6 },
  moody: { exposure: -8, shadows: -10, contrast: 12, temperature: -6, saturation: -14 },
  mono: { saturation: -100, contrast: 8 },
};

/** Add a preset's look to a set of corrections, keeping every value in range. */
export function applyPreset(base: Adjustments, style: StylePreset): Adjustments {
  const clamp = (n: number) => Math.max(-100, Math.min(100, n));
  const look = PRESET_ADJUSTMENTS[style];
  const result: Adjustments = { ...base };
  for (const key of [
    "exposure",
    "highlights",
    "shadows",
    "contrast",
    "saturation",
    "temperature",
  ] as const) {
    result[key] = clamp(base[key] + (look[key] ?? 0));
  }
  // Grey means grey: whatever the corrections did, mono ends at no colour.
  if (style === "mono") result.saturation = -100;
  return result;
}

/** A built-in skill, as the setup screen and the prompt describe it. */
export interface SkillInfo {
  id: SkillId;
  name: string;
  icon: string;
  /** One line: what it does out of the box. */
  does: string;
  /** What it supports, for the expanded chip. Short. */
  supports: string[];
  /** One thing a photographer might write to change it. */
  example: string;
  /** Things you could type to it; offered on an empty conversation. */
  examples: string[];
}

export const SKILLS: SkillInfo[] = [
  {
    id: "scheduling",
    name: "Scheduling",
    icon: "🗓️",
    does: "Your calendar, enquiries and offers, by message.",
    supports: [
      "Is a date, or a part of a day, free?",
      "Your bookings and the open times on your published page",
      "Enquiries from couples, and your standing offers",
      "Adding or removing a booking — after you say yes",
    ],
    example: "Don't offer any date within two days of a lunar eclipse — I shoot those.",
    examples: ["Am I free the afternoon of 14 October?", "What came in this week?"],
  },
  {
    id: "photos",
    name: "Photo touch-up",
    icon: "🖼️",
    does: "Send it a photo, get it back corrected — for sneak peeks on the day.",
    supports: [
      "Scans for blur, cut-off faces, exposure and colour problems",
      "Applies the corrections itself, in your chosen style",
      "Takes instructions with the photo — “warmer”, “straighten it”",
      "Says what it assumed, and what needs a real editor",
    ],
    example: "Never crop, and skip the sharpening — I do that myself in Lightroom.",
    examples: ["(attach a photo) — nothing else needed", "Make this one a bit warmer"],
  },
  {
    id: "lookup",
    name: "Look things up",
    icon: "🔎",
    does: "Searches the web and reads pages you point it at.",
    supports: [
      "Facts the app doesn't hold — an eclipse date, what's on locally",
      "Pages you give it a link to, such as your own website",
      "Used only when a question or your brief needs it",
    ],
    example: "My website is https://example.com — read it, and match its tone whenever you write anything for me.",
    examples: ["Is anything happening in town on 3 October?"],
  },
];

/**
 * Skills the photographer might want that are not built in. Picking one drops
 * its description into the brief, where it is checked like anything else they
 * write — so each is phrased as the doable version.
 */
export interface SuggestedSkill {
  id: string;
  name: string;
  icon: string;
  hint: string;
  template: string;
}

export const SUGGESTED_SKILLS: SuggestedSkill[] = [
  {
    id: "negotiate",
    name: "Negotiate",
    icon: "🤝",
    hint: "Compares an enquiry's budget with local rates and suggests a counter.",
    template:
      "Negotiate: when an enquiry mentions price, check what other wedding photographers in my area charge and tell me how their budget compares to the going rate, with a counter I could make.",
  },
  {
    id: "venue",
    name: "Venue scout",
    icon: "🌅",
    hint: "Sunset and golden hour for a wedding date and place.",
    template:
      "Venue scout: when I ask about a venue or a wedding day, look up sunset and golden hour for that date and place and tell me when the light is best.",
  },
  {
    id: "replies",
    name: "Enquiry replies",
    icon: "✉️",
    hint: "Drafts a reply for you to copy and send.",
    template:
      "Enquiry replies: when I ask, draft a reply to an enquiry in my voice, saying whether the date is open, for me to copy and send.",
  },
  {
    id: "briefing",
    name: "Day briefing",
    icon: "☀️",
    hint: "The booking, the light and the weather for a wedding day.",
    template:
      "Day briefing: when I ask for a briefing for a wedding day, give me the booking details, sunset and golden hour, and the weather forecast for the venue.",
  },
];

/**
 * What the assistant can and cannot do, in plain words. This is what the
 * photographer's brief is checked against — the check (lib/ai.ts) may only
 * promise things on the first list.
 */
export const CAPABILITIES = {
  can: [
    "Read the photographer's bookings, their published availability and its open times, their standing offers, and the enquiries couples have sent (name, contact details, the date asked about, the message)",
    "Propose adding or removing a booking, which the photographer then confirms",
    "Scan a photo for problems and apply global corrections (exposure, colour, sharpening, straightening, cropping) in a chosen style",
    "Search the web, and read web pages the photographer gives a link to (only while 'Look things up' is on)",
    "Follow standing instructions and the brief, reason over all of the above, and write replies — including drafts for the photographer to send themselves",
    "Text the photographer at their own verified mobile, and answer texts they send it (once Texting is set up under Smart Photographer)",
  ],
  cannot: [
    "Send messages, emails or texts to anyone but the photographer — it only ever talks to them",
    "Log in to other sites or apps, or read the photographer's email, calendar apps or files outside Blinked",
    "Do anything on a schedule or without being messaged, or remember anything between conversations except these settings",
    "Change bookings, offers or the published schedule without confirmation, or change enquiries at all",
    "Generative photo edits: removing objects, rebuilding a cut-off head, swapping faces",
    "Control cameras, drones or any other device",
  ],
} as const;

/**
 * Facts the workflow planner needs beyond CAPABILITIES: what exists around
 * the assistant — channels, delivery, integrations — and what does not.
 */
export const WORKFLOW_FACTS = [
  "The assistant ('site' route) can do what its skills cover, in in-app chat, when messaged: read the calendar and enquiries, look things up online, touch up a photo.",
  "The supported backends ('service' route, each tagged beta) are assumed set up and working with no roadblocks: Amazon purchases and delivery; AWS cloud storage and photo/video editing software; any freelance service on Fiverr; any local hands-on task through TaskRabbit; payment requests through PayPal and Stripe; texts, emails and phone calls to anyone; scheduled checks and triggers (watching the weather, a date or a reply, acting when a condition is met, repeating every N minutes). Never call any of these unsupported. They still cost what the vendor charges, so prices must be estimated.",
  "A person on the team ('human' route) handles what no backend covers — a bespoke judgement call, or coordinating something unusual — billed hourly.",
  "Other third-party AI and online services ('ai_service' route) cover generative photo work — retouching, removing objects, adding things to a picture, detection at scale — for a fee per photo or per month.",
  "Still not supported ('engineering' route): vendors and accounts outside the list above, controlling cameras, drones or other devices, and anything needing the photographer's logins elsewhere.",
] as const;

/** For the workflow analysis only: what is out of reach even with the backends. The assistant's own CAPABILITIES are a different, current list. */
export const WORKFLOW_CANNOT = [
  "Log in to accounts or vendors outside the supported backends",
  "Control cameras, drones or any other device",
  "Do anything illegal, or anything that mocks or deceives people",
] as const;

export const LIMITS = {
  name: 40,
  instructions: 2000,
  /** The open box on the Skills step. */
  brief: 4000,
  /** The rough description a workflow is planned from. */
  workflow: 3000,
  /** Characters in one chat message. */
  message: 4000,
  /** Photos attached to one chat message. */
  attachments: 4,
  /** Messages a photographer may send per day — protects the API bill. */
  messagesPerDay: 150,
  /** Texts the assistant may send a photographer per day — replies and send_text alike; protects the Twilio bill. */
  textsPerDay: 30,
} as const;

/** One thing the photographer asked for in the brief, as the check understood it. */
export const UnderstandingItemSchema = z.object({
  title: z
    .string()
    .describe(
      "Two to five words naming this item. If the photographer named it ('Negotiate: …'), use their name",
    ),
  kind: z.enum(["change", "new"]).describe("A change to a built-in skill, or a new skill"),
  skill: z
    .enum(["scheduling", "photos", "lookup", "none"])
    .describe("The built-in skill a change applies to; 'none' for a new skill"),
  verdict: z
    .enum(["feasible", "partly", "not_feasible"])
    .describe("feasible: all of it; partly: a useful part; not_feasible: none of the useful part"),
  summary: z.string().describe("One plain sentence to the photographer: what will happen, or why it can't"),
  cannotDo: z.array(z.string()).describe("What was asked for but is out of reach, with why in a few words"),
  instructions: z
    .string()
    .describe(
      "Operating instructions for the assistant, second person: when this applies, which " +
        "capabilities to use, what to say. Only what is feasible. Empty if not_feasible",
    ),
});
export type UnderstandingItem = z.infer<typeof UnderstandingItemSchema>;

/** What the check returns for a whole brief. */
export const UnderstandingOutputSchema = z.object({
  items: z.array(UnderstandingItemSchema).describe("One per distinct request in the brief; empty if the brief asks for nothing"),
});

/** The check's result, stored with the brief it was made for so staleness is detectable. */
const UnderstandingSchema = z.object({
  brief: z.string(),
  items: z.array(UnderstandingItemSchema),
  checkedAt: z.string(),
});
export type Understanding = z.infer<typeof UnderstandingSchema>;

// ---------------------------------------------------------------------------
// Workflow analysis
//
// A photographer describes anything they want done. It is judged on three
// things — feasibility, rough cost, time — and every step gets a route (who
// does it) and a tier. "Feasible" does not mean the software can do it: a
// person on the team can order goods, edit by hand or make calls, so the only
// unreasonable requests are the illegal, the unethical, the absurd and the
// obviously expensive. Two passes: a quick screen that splits the request
// into steps (and gives the countdown its length), then the estimate.
// ---------------------------------------------------------------------------

// --- Supported backends -------------------------------------------------------
//
// The vertical infrastructure the analysis may assume is wired up and working.
// None of it is built yet — every one is tagged beta — but assuming it lets the
// analysis route a step straight to "Amazon" or "SMS" instead of working out
// from scratch how ordering or texting could possibly happen, and spend its
// effort on the price instead. Steps on these backends are never "not
// supported"; what remains unsupported is anything outside the list.

export const INTEGRATION_IDS = [
  "amazon",
  "instacart",
  "aws",
  "fiverr",
  "taskrabbit",
  "payments",
  "comms",
  "automation",
  "varsitytutors",
  "preply",
  "brighterly",
  "outschool",
] as const;
export type IntegrationId = (typeof INTEGRATION_IDS)[number];

export interface IntegrationInfo {
  name: string;
  icon: string;
  /** What it covers, one line. */
  covers: string;
  /** How a photographer might call on it — the pitch shown on AgentDex. */
  example: string;
  /** Tier I: a service does it. Tier II: a person does it, through a service. */
  tier: 1 | 2;
}

export const INTEGRATIONS: Record<IntegrationId, IntegrationInfo> = {
  amazon: {
    name: "Amazon",
    icon: "📦",
    covers: "Any Amazon purchase, delivered wherever you say — same-day where it exists.",
    example: "Want your agent to order two cases of water to the venue on a hot wedding day? Easy.",
    tier: 1,
  },
  instacart: {
    name: "Instacart",
    icon: "🛒",
    covers: "Groceries and everyday goods from local stores, delivered in about an hour.",
    example: "Want the water at the venue within the hour, not tomorrow? Instacart is the fast way — the analysis will suggest it.",
    tier: 1,
  },
  aws: {
    name: "AWS",
    icon: "☁️",
    covers: "Cloud storage, and photo and video editing software running in the cloud.",
    example: "Want every gallery backed up as it's delivered, or a video cut from the day's clips? Covered.",
    tier: 1,
  },
  fiverr: {
    name: "Fiverr",
    icon: "🎨",
    covers: "Any freelance service on Fiverr — artists, retouchers, writers, designers.",
    example: "Want original artwork of the wedding made by an artist on Fiverr? The app can take that on.",
    tier: 2,
  },
  taskrabbit: {
    name: "TaskRabbit",
    icon: "🛠️",
    covers: "Any local, hands-on task a person can do — pickups, setup, running errands, waiting for a delivery.",
    example: "Want someone to collect the prints and hand them to the couple at the venue? That's a TaskRabbit job.",
    tier: 2,
  },
  payments: {
    name: "PayPal & Stripe",
    icon: "💳",
    covers: "Payment requests and invoices to couples, and refunds.",
    example: "Want the deposit invoiced the moment a date is booked? Done.",
    tier: 1,
  },
  comms: {
    name: "SMS, email & calls",
    icon: "📱",
    covers: "Texts, emails and phone calls — to you, to couples, to vendors.",
    example: "Want a text every 15 minutes with a delivery update? Supported.",
    tier: 1,
  },
  varsitytutors: {
    name: "Varsity Tutors",
    icon: "🎓",
    covers: "The largest US tutor pool: K-12 subjects and SAT, ACT and PSAT prep, one-to-one or in small groups.",
    example: "Want five vetted PSAT tutors with their bios, ratings and reviews texted to you? That's a Varsity Tutors search.",
    tier: 2,
  },
  preply: {
    name: "Preply",
    icon: "🗣️",
    covers: "One-to-one tutors you pick from profiles, strongest for languages, with the highest parent rating of the marketplaces.",
    example: "Want a Spanish tutor for Tuesday evenings, shortlisted by rating and price? Preply.",
    tier: 2,
  },
  brighterly: {
    name: "Brighterly",
    icon: "➗",
    covers: "K-8 math with a matched tutor and a set curriculum; parents rate the tutors themselves 4.5 of 5.",
    example: "Want a patient math tutor for a fourth grader, matched rather than searched for? Brighterly.",
    tier: 2,
  },
  outschool: {
    name: "Outschool",
    icon: "🧑‍🏫",
    covers: "Small-group live classes for kids on almost any subject, from coding to creative writing.",
    example: "Want a weekly small-group class that keeps a curious ten-year-old busy? Outschool.",
    tier: 2,
  },
  automation: {
    name: "Scheduled checks",
    icon: "⏱️",
    covers: "Watching something on a timer and acting when a condition is met — weather, a date, a reply.",
    example: "\"If it rises above 100°F on the wedding day…\" — the watching part is covered.",
    tier: 1,
  },
};

// --- Specialities ------------------------------------------------------------
//
// What each backend actually offers, by sub-service, so a step can say
// "Fiverr › Wedding video editing" rather than just "Fiverr", and be priced
// from that speciality's typical rate. Names follow the vendors' own category
// names where they have them. `featured` picks the three or four shown on the
// AgentDex page; the rest sit behind "more". Backends without a list (texts,
// payments, scheduled checks, Instacart) are specific enough on their own.

export interface Specialty {
  id: string;
  integration: IntegrationId;
  name: string;
  /** What it covers, one line. */
  covers: string;
  /** A typical price for the pricing pass — indicative, US dollars. */
  typical: string;
  featured?: boolean;
  /** The price depends on what is bought (goods), so the pricing pass may look it up; otherwise the typical price is the sheet. */
  lookup?: boolean;
}

export const SPECIALTIES = [
  // Amazon
  { id: "amazon.delivery", integration: "amazon", name: "Same-Day & Prime delivery", covers: "Any product, delivered same day where it exists, otherwise in one to two days.", typical: "item price plus a $0–$10 same-day fee", featured: true, lookup: true },
  { id: "amazon.fresh", integration: "amazon", name: "Amazon Fresh & Whole Foods", covers: "Groceries and drinks delivered in a two-hour window.", typical: "store prices plus $0–$10 delivery", lookup: true },
  { id: "amazon.prints", integration: "amazon", name: "Amazon Prints", covers: "Photo prints from 3.5×5 to 13×19, photo books, wall art and canvas, cards, calendars. About three business days; US only.", typical: "4×6 prints about $0.15 each; photo books $20–$60; canvas $30–$150", featured: true },
  { id: "amazon.photos", integration: "amazon", name: "Amazon Photos", covers: "Consumer photo storage bundled with Prime, full resolution.", typical: "included with Prime; otherwise $2–$7 a month" },
  { id: "amazon.business", integration: "amazon", name: "Amazon Business", covers: "Bulk orders, quantity discounts, invoicing and tax exemption for studio supplies.", typical: "item price, often 5–15% below retail in quantity", featured: true, lookup: true },
  { id: "amazon.locker", integration: "amazon", name: "Locker & hold at location", covers: "Delivery to an Amazon Locker or pickup counter when the venue cannot take a parcel.", typical: "no extra charge", featured: true },
  { id: "amazon.handmade", integration: "amazon", name: "Handmade & Custom", covers: "Personalised gifts and custom-made items from independent makers.", typical: "$20–$150 per gift; one to two weeks", lookup: true },
  // AWS
  { id: "aws.s3", integration: "aws", name: "S3 storage", covers: "Working storage for RAW files and delivered galleries, with shareable links.", typical: "$0.023 per GB-month; a 200 GB wedding about $5 a month", featured: true },
  { id: "aws.glacier", integration: "aws", name: "Glacier archive", covers: "Long-term archive of past weddings: Intelligent-Tiering, Glacier Instant, Flexible and Deep Archive.", typical: "Deep Archive about $1 per TB-month; retrieval takes hours to a day" },
  { id: "aws.cloudfront", integration: "aws", name: "CloudFront gallery hosting", covers: "A fast client gallery or proofing site served from S3.", typical: "$0.085 per GB transferred; a gallery a few cents to a dollar" },
  { id: "aws.transfer", integration: "aws", name: "Bulk upload (DataSync, Transfer Family, Snowball)", covers: "Moving a large back catalogue into the cloud.", typical: "DataSync $0.0125 per GB; Snowball from $300 a job" },
  { id: "aws.rekognition", integration: "aws", name: "Rekognition", covers: "Face detection and matching to find every photo of a guest, label and text detection, content moderation.", typical: "$0.001 per image; 2,000 photos about $2", featured: true },
  { id: "aws.nova_canvas", integration: "aws", name: "Nova Canvas image editing", covers: "Background removal, inpainting to remove or add elements, outpainting, variations, virtual try-on.", typical: "$0.04–$0.08 per image", featured: true },
  { id: "aws.bedrock_text", integration: "aws", name: "Bedrock language models", covers: "Captions, alt text, album text and culling suggestions from the images.", typical: "$0.003–$0.02 per photo" },
  { id: "aws.mediaconvert", integration: "aws", name: "MediaConvert", covers: "Transcoding and compressing films, proxies, watermarks, multiple output formats.", typical: "$0.0075–$0.03 per minute of output", featured: true },
  { id: "aws.medialive", integration: "aws", name: "MediaLive streaming", covers: "Live streaming a ceremony.", typical: "$1–$3 per hour of stream plus delivery" },
  { id: "aws.transcribe", integration: "aws", name: "Transcribe, Translate & Polly", covers: "Captions for vows and speeches, translated subtitles, synthetic voice-over.", typical: "Transcribe $0.024 a minute; Translate $15 per million characters; Polly $4–$16 per million characters" },
  { id: "aws.messaging", integration: "aws", name: "SES, SNS, Pinpoint & Connect", covers: "Email, SMS and calls from AWS — the same as the comms backend.", typical: "email $0.0001; a text $0.01; calls a few cents a minute" },
  { id: "aws.automation", integration: "aws", name: "Lambda, Step Functions & EventBridge", covers: "Scheduled checks and triggers — the same as the scheduled checks backend.", typical: "fractions of a cent per run" },
  { id: "aws.location", integration: "aws", name: "Location Service", covers: "Venue geocoding and travel times.", typical: "$0.50 per 1,000 requests" },
  // Fiverr
  { id: "fiverr.retouching", integration: "fiverr", name: "Photo retouching", covers: "Skin retouching, blemishes, wrinkles, stray hairs.", typical: "$5–$50 per photo", featured: true },
  { id: "fiverr.editing", integration: "fiverr", name: "Photo editing & colour grading", covers: "Colour correction and grading, Lightroom editing to a preset.", typical: "$0.50–$5 per photo in bulk; $10–$40 for a single photo" },
  { id: "fiverr.manipulation", integration: "fiverr", name: "Background removal & photo manipulation", covers: "Background removal, object removal and addition, composites, head swaps.", typical: "$5–$40 per photo" },
  { id: "fiverr.restoration", integration: "fiverr", name: "Photo restoration", covers: "Old family photos repaired and recoloured for the couple's display.", typical: "$15–$60 per photo" },
  { id: "fiverr.presets", integration: "fiverr", name: "Custom Lightroom presets", covers: "Presets built to a photographer's look.", typical: "$20–$100" },
  { id: "fiverr.culling", integration: "fiverr", name: "Culling", covers: "Picking the keepers from a full shoot. Gigs exist; not a Fiverr category.", typical: "$0.02–$0.10 per photo" },
  { id: "fiverr.album_design", integration: "fiverr", name: "Album & photo book design", covers: "Layout and design of albums and photo books.", typical: "$50–$300 per album", featured: true },
  { id: "fiverr.invitations", integration: "fiverr", name: "Invitation & stationery design", covers: "Wedding invitations, save-the-dates, signage.", typical: "$25–$150" },
  { id: "fiverr.artwork", integration: "fiverr", name: "Illustration, portraits & caricatures", covers: "Custom artwork from a photo.", typical: "$30–$300", featured: true },
  { id: "fiverr.branding", integration: "fiverr", name: "Logo, brand & web design", covers: "Design for the photographer's own business: logo, brand guide, social media, website.", typical: "$50–$500 per piece" },
  { id: "fiverr.wedding_video_editing", integration: "fiverr", name: "Wedding video editing", covers: "Highlight films and full-length edits from the day's clips.", typical: "$100–$500 per film; three to ten days", featured: true },
  { id: "fiverr.videographers", integration: "fiverr", name: "Videographers & drone", covers: "A local videographer or drone operator for a shoot.", typical: "$200–$1,500 a day" },
  { id: "fiverr.video_extras", integration: "fiverr", name: "Slideshows, intros & captions", covers: "Photo slideshows, intros and outros, logo animation, subtitles.", typical: "$20–$150" },
  { id: "fiverr.copywriting", integration: "fiverr", name: "Copywriting & translation", covers: "Website content, blog posts, SEO, social and ad copy, proofreading, translation.", typical: "$30–$200 per piece" },
  { id: "fiverr.audio", integration: "fiverr", name: "Voice-over & audio", covers: "Voice-over, audio editing and mixing, jingles.", typical: "$25–$150" },
  { id: "fiverr.assistant", integration: "fiverr", name: "Virtual assistant & customer care", covers: "Admin, data entry, answering enquiries, CRM, email marketing.", typical: "$5–$25 an hour" },
  { id: "fiverr.photographers", integration: "fiverr", name: "Photographers for hire", covers: "Event, portrait, product, aerial, real estate, lifestyle, food and scenic photographers — a second shooter or an engagement session.", typical: "$100–$800 per session" },
  { id: "fiverr.ai", integration: "fiverr", name: "AI artists & AI image editing", covers: "AI-generated art and AI-assisted edits.", typical: "$10–$100" },
  // TaskRabbit
  { id: "taskrabbit.errands", integration: "taskrabbit", name: "Delivery & errands", covers: "Delivery Service, Running Your Errands, Return Items, Shipping.", typical: "$30–$60 an hour, one-hour minimum, plus about 15% fee", featured: true },
  { id: "taskrabbit.wait", integration: "taskrabbit", name: "Wait for Delivery & Wait in Line", covers: "Someone to receive a parcel or hold a place.", typical: "$25–$50 an hour for the whole waiting window, plus about 15% fee", featured: true },
  { id: "taskrabbit.grocery", integration: "taskrabbit", name: "Grocery Shopping & Delivery", covers: "Shopping and delivery by a Tasker.", typical: "$30–$55 an hour plus the goods" },
  { id: "taskrabbit.assistant", integration: "taskrabbit", name: "Personal & Executive Assistant", covers: "Personal Assistant, Executive Assistant, Virtual Assistant.", typical: "$30–$70 an hour" },
  { id: "taskrabbit.event_staffing", integration: "taskrabbit", name: "Event Staffing", covers: "Greeters, coat check, setup and teardown crew.", typical: "$30–$60 an hour per person", featured: true },
  { id: "taskrabbit.setup", integration: "taskrabbit", name: "Party setup & decoration", covers: "Outdoor Party Setup, Decoration, Hang Art Mirror & Decor, General Mounting — backdrops and signage.", typical: "$40–$80 an hour", featured: true },
  { id: "taskrabbit.cleaning", integration: "taskrabbit", name: "Party & one-time cleaning", covers: "Party Cleaning, One Time Cleaning Services.", typical: "$35–$70 an hour" },
  { id: "taskrabbit.moving", integration: "taskrabbit", name: "Help Moving & Heavy Lifting", covers: "Help Moving, Heavy Lifting & Loading, Truck Assisted Help Moving, One Item Movers, Furniture Movers — gear, props and arches.", typical: "$45–$100 an hour; more with a truck" },
  { id: "taskrabbit.assembly", integration: "taskrabbit", name: "Furniture Assembly", covers: "Furniture Assembly and Disassemble Furniture — arches, photo booths, displays.", typical: "$40–$80 an hour" },
  { id: "taskrabbit.removal", integration: "taskrabbit", name: "Junk & Furniture Removal", covers: "Junk Pickup, Trash & Furniture Removal.", typical: "$50–$120 an hour" },
  { id: "taskrabbit.handyman", integration: "taskrabbit", name: "Handyman & mounting", covers: "TV Mounting, Electrical Help, Light Installation, Smart Home Installation, Painting, Carpentry.", typical: "$50–$120 an hour" },
  { id: "taskrabbit.yard", integration: "taskrabbit", name: "Yard Work & Landscaping", covers: "Yard Work, Landscaping, Lawn Mowing, Leaf Raking, Pressure Washing.", typical: "$40–$80 an hour" },
  { id: "taskrabbit.organization", integration: "taskrabbit", name: "Organization & Interior Design", covers: "Organization, Closet Organization, Interior Design Service — studio staging.", typical: "$40–$90 an hour" },
  { id: "taskrabbit.snow", integration: "taskrabbit", name: "Snow Removal & Sidewalk Salting", covers: "Clearing paths for a winter wedding.", typical: "$50–$100 an hour" },
  { id: "taskrabbit.photography", integration: "taskrabbit", name: "Photography assistant", covers: "TaskRabbit's Photography category: an on-the-day assistant.", typical: "$30–$75 an hour" },
  { id: "taskrabbit.crafts", integration: "taskrabbit", name: "Arts / Crafts, Sewing, Cooking / Baking", covers: "Dress repairs on the day, craft and food help.", typical: "$30–$70 an hour" },
  { id: "taskrabbit.admin", integration: "taskrabbit", name: "Data Entry, Office Administration, Computer Help", covers: "Desk work and project coordination by a Tasker.", typical: "$25–$60 an hour" },
  { id: "taskrabbit.car", integration: "taskrabbit", name: "Car Washing & Laundry Help", covers: "The getaway car and the linens.", typical: "$35–$60 an hour" },

  // Varsity Tutors
  { id: "varsitytutors.testprep", integration: "varsitytutors", name: "SAT, ACT & PSAT prep", covers: "One-to-one test prep with a vetted tutor; the parents of exam-prepping high schoolers are the platform's happiest customers.", typical: "$70–$120 an hour; packages from about $500", featured: true },
  { id: "varsitytutors.k12", integration: "varsitytutors", name: "K-12 subject tutoring", covers: "Math, science, English and languages, matched to the student's grade and school.", typical: "$60–$100 an hour", featured: true },
  { id: "varsitytutors.shortlist", integration: "varsitytutors", name: "Tutor shortlist", covers: "Five tutors for a subject with bios, ratings, reviews and availability, ready to compare.", typical: "no charge to search; the first session is the cost", featured: true },
  { id: "varsitytutors.group", integration: "varsitytutors", name: "Small-group classes", covers: "Live classes of a handful of students for a subject or exam.", typical: "$20–$40 a class" },

  // Preply
  { id: "preply.language", integration: "preply", name: "Language tutors", covers: "Spanish, French, Mandarin and forty more, chosen from tutor profiles with trial lessons.", typical: "$15–$40 an hour; a trial lesson from about $10", featured: true },
  { id: "preply.academic", integration: "preply", name: "School subjects", covers: "Math, science and writing tutors, filtered by price, rating and time zone.", typical: "$20–$50 an hour", featured: true },
  { id: "preply.shortlist", integration: "preply", name: "Tutor shortlist", covers: "Five tutors matching a subject, budget and schedule, with ratings and reviews.", typical: "no charge to search", featured: true },

  // Brighterly
  { id: "brighterly.math", integration: "brighterly", name: "K-8 math, matched tutor", covers: "A tutor matched to the child after a free assessment, following a set curriculum.", typical: "$25–$45 a lesson on a plan", featured: true },
  { id: "brighterly.assessment", integration: "brighterly", name: "Free assessment lesson", covers: "A first lesson that places the child and proposes a plan.", typical: "free", featured: true },

  // Outschool
  { id: "outschool.classes", integration: "outschool", name: "Small-group live classes", covers: "Ongoing or one-off classes on academic and enrichment topics, taught live to a small group.", typical: "$10–$30 a class", featured: true },
  { id: "outschool.oneonone", integration: "outschool", name: "One-to-one tutoring", covers: "Private sessions with an Outschool teacher.", typical: "$30–$60 an hour", featured: true },
] as const satisfies readonly Specialty[];

export type SpecialtyId = (typeof SPECIALTIES)[number]["id"];
export const SPECIALTY_IDS = SPECIALTIES.map((s) => s.id) as [SpecialtyId, ...SpecialtyId[]];
export const SPECIALTY_BY_ID = Object.fromEntries(SPECIALTIES.map((s) => [s.id, s])) as Record<SpecialtyId, Specialty>;

export function specialtiesOf(integration: IntegrationId): Specialty[] {
  return SPECIALTIES.filter((s) => s.integration === integration);
}

/** The few shown on the AgentDex page: at most four. */
export function featuredSpecialties(integration: IntegrationId): Specialty[] {
  return specialtiesOf(integration)
    .filter((s) => s.featured)
    .slice(0, 4);
}

export const WORKFLOW_ROUTES = ["site", "self", "service", "ai_service", "human", "engineering"] as const;
export type WorkflowRoute = (typeof WORKFLOW_ROUTES)[number];

export const ROUTE_LABELS: Record<WorkflowRoute, string> = {
  site: "the assistant",
  self: "you",
  service: "a supported service",
  ai_service: "a third-party AI service",
  human: "a person on the team",
  engineering: "not supported yet",
};

/** "Fiverr › Wedding video editing" for a step with a speciality, "Amazon" for one without, otherwise the route's label. */
export function serviceLabel(step: {
  route: WorkflowRoute;
  integration: IntegrationId | "none";
  specialty?: SpecialtyId | "none";
}): string {
  if (step.route !== "service" || step.integration === "none") return ROUTE_LABELS[step.route];
  const name = INTEGRATIONS[step.integration].name;
  const specialty = step.specialty && step.specialty !== "none" ? SPECIALTY_BY_ID[step.specialty] : undefined;
  if (!specialty || specialty.integration !== step.integration) return name;
  // "Amazon Prints", not "Amazon › Amazon Prints".
  return specialty.name.startsWith(name) ? specialty.name : `${name} › ${specialty.name}`;
}

/**
 * Tiers. Tier I is a service doing it, II is a person doing it (hourly, or
 * through Fiverr or TaskRabbit), III is engineering — which someone on the
 * team has to order and oversee, so it always involves a person too. What the
 * assistant already does, and what the photographer does themselves, is 0.
 */
export function tierFor(route: WorkflowRoute, integration: IntegrationId | "none" = "none"): 0 | 1 | 2 | 3 {
  if (route === "service" && integration !== "none") return INTEGRATIONS[integration].tier;
  return { site: 0, self: 0, service: 1, ai_service: 1, human: 2, engineering: 3 }[route] as 0 | 1 | 2 | 3;
}

/** How a step's price is expressed; the site multiplies unit price by quantity. */
export const COST_UNITS = ["flat", "per_photo", "per_item", "per_hour", "per_month"] as const;
export type CostUnit = (typeof COST_UNITS)[number];

export const COST_UNIT_LABELS: Record<CostUnit, string> = {
  flat: "",
  per_photo: "photos",
  per_item: "items",
  per_hour: "hours",
  per_month: "months",
};

export const TIER_LABELS = ["Tier 0", "Tier I", "Tier II", "Tier III"] as const;

/** What a person on the team costs, and the smallest block they are billed in. */
export const HUMAN_RATE_PER_HOUR = 40;
export const HUMAN_MINIMUM_MINUTES = 15;
/** Above this all-in, a request is flagged (and, if obvious up front, unreasonable). */
export const BUDGET_USD = 100;
/**
 * When the screen's only concern is expense, the estimate is run anyway and
 * this is the line: at or above it the request is refused with the real
 * figure; below it, it goes ahead with the usual over-budget warning. The
 * model's guess at "obviously expensive" is not trusted on its own.
 */
export const PROHIBITIVE_USD = 1000;

/** Human minutes → dollars, rounded up to whole blocks. */
export function humanCost(minutes: number): number {
  if (minutes <= 0) return 0;
  const blocks = Math.ceil(Math.max(minutes, HUMAN_MINIMUM_MINUTES) / HUMAN_MINIMUM_MINUTES);
  return Math.round(((blocks * HUMAN_MINIMUM_MINUTES * HUMAN_RATE_PER_HOUR) / 60) * 100) / 100;
}

const USES = z.enum(["scheduling", "photos", "lookup", "chat", "sms", "email"]);

const INTEGRATION_OR_NONE = z.enum([...INTEGRATION_IDS, "none"]);
const SPECIALTY_OR_NONE = z.enum([...SPECIALTY_IDS, "none"]);

/** What a recommended backend wins over the step as routed. */
export const GAINS = ["faster", "cheaper"] as const;
export type Gain = (typeof GAINS)[number];

/**
 * Another supported backend that would do a step clearly faster or clearly
 * cheaper — water from Instacart in about an hour instead of Amazon tomorrow.
 * The step stays on the backend the photographer asked for; this is offered
 * beside it, priced on its own, and one click takes it.
 */
const AlternativeSchema = z.object({
  integration: z.enum(INTEGRATION_IDS).describe("The other supported backend"),
  specialty: SPECIALTY_OR_NONE.describe("That backend's speciality that fits, by id, if it has a list; none otherwise"),
  gain: z.enum(GAINS).describe("What it wins over the step as routed"),
  detail: z.string().describe("The step done that way, one short sentence"),
  tradeoff: z.string().describe("What it gives up, in a few words: 'usually a few dollars more', 'a day slower'"),
});
export type Alternative = z.infer<typeof AlternativeSchema>;

const ScreenStepSchema = z.object({
  title: z.string().describe("Three to eight words"),
  detail: z.string().describe("What happens in this step, in plain words, one or two sentences"),
  route: z
    .enum(WORKFLOW_ROUTES)
    .describe(
      "site: the assistant does it now. self: the photographer does it themselves. service: one of " +
        "the supported backends (say which in integration). ai_service: some other third-party AI or " +
        "online service. human: a person on the team. engineering: outside every backend (not supported yet)",
    ),
  integration: INTEGRATION_OR_NONE.describe("For a 'service' step, which backend; otherwise none"),
  specialty: SPECIALTY_OR_NONE.describe(
    "For a 'service' step on a backend with specialities (Amazon, AWS, Fiverr, TaskRabbit): the one that fits, by id; none otherwise",
  ),
  uses: z.array(USES).describe("Skills and channels a 'site' step relies on; empty otherwise"),
});

/**
 * Pass one, straight from the model. It answers four yes/no questions and
 * always lists the steps; whether the request is reasonable is decided in
 * code from those four answers alone. That is deliberate: a small model
 * kept turning "this needs engineering" into "this is unreasonable", and
 * with no field to say so, it cannot.
 */
export const WorkflowScreenOutputSchema = z.object({
  concerns: z.object({
    illegal: z.boolean().describe("Breaks the law: fraud, theft, harassment, privacy violations"),
    unethical: z
      .boolean()
      .describe("Mocks, humiliates or discriminates against people, or deceives the photographer's clients"),
    absurd: z
      .boolean()
      .describe(
        "Pointless make-work (removing one pixel at a time), or so many moving parts — dozens of " +
          "parties — that nobody could deliver it. Needing a person or the developers is NOT this",
      ),
    obviouslyExpensive: z
      .boolean()
      .describe(
        "Plainly in the thousands of dollars before looking at any prices — hiring staff for weeks, " +
          "renting a venue, buying equipment. Bulk AI processing of photos costs cents per photo and is " +
          "NOT this. If unsure, false: the estimate will price it",
      ),
  }),
  concernReason: z.string().describe("If any concern is true: one plain sentence why. Otherwise empty"),
  summary: z.string().describe("One sentence on what the workflow does end to end"),
  steps: z.array(ScreenStepSchema).describe("In the order things would happen, always — even if a concern is raised"),
  briefLines: z
    .array(z.string())
    .describe("For 'site' steps only: sentences in the photographer's own voice for the assistant's brief. Empty if none"),
  skillsToEnable: z.array(z.enum(SKILL_IDS)).describe("Built-in skills the 'site' steps rely on; empty if none"),
  alternatives: z
    .array(AlternativeSchema.extend({ stepIndex: z.number().int().describe("The step it is an alternative to, counting from 0") }))
    .describe(
      "Steps another supported backend would do clearly faster or clearly cheaper — at most one per step; " +
        "empty when nothing is clearly better",
    ),
});
export type WorkflowScreenOutput = z.infer<typeof WorkflowScreenOutputSchema>;

// --- Tolerant reading of what the model returns ------------------------------
//
// The strict schemas above are what the API is given, and they steer the
// model well. But a small model still sometimes writes "Photo touch-up" where
// the schema says "photos", and one wrong enum value would throw the whole
// analysis away. So its output is read through these lenient twins instead:
// names are mapped to ids, unknown values get a sensible default, and only
// unparseable JSON is an error.

/** "Photo touch-up", "photos", "PHOTO" → "photos"; anything unrecognised is dropped. */
export function normaliseSkillIds(values: unknown): SkillId[] {
  if (!Array.isArray(values)) return [];
  const out = new Set<SkillId>();
  for (const v of values) {
    const s = String(v).toLowerCase();
    if (/schedul|calendar|booking/.test(s)) out.add("scheduling");
    else if (/photo|touch|edit|retouch/.test(s)) out.add("photos");
    else if (/look|search|web|online/.test(s)) out.add("lookup");
  }
  return [...out];
}

export function normaliseRoute(value: unknown): WorkflowRoute {
  const s = String(value).toLowerCase();
  if (/^site$|assistant|blinked/.test(s)) return "site";
  if (/^self$|^you|photographer|yourself/.test(s)) return "self";
  if (/^service$|backend|integration|amazon|instacart|aws|fiverr|taskrabbit|paypal|stripe|sms|comms|automation/.test(s)) return "service";
  if (/ai|third|api|vendor/.test(s)) return "ai_service";
  if (/engineer|support|build|develop|new site/.test(s)) return "engineering";
  return "human";
}

export function normaliseIntegration(value: unknown): IntegrationId | "none" {
  const s = String(value).toLowerCase();
  if (/instacart|grocer|local store/.test(s)) return "instacart";
  if (/amazon|purchase|deliver|order/.test(s)) return "amazon";
  if (/aws|cloud|storage|s3|video edit|editing software/.test(s)) return "aws";
  if (/fiverr|freelanc|artist|designer/.test(s)) return "fiverr";
  if (/taskrabbit|tasker|errand|hands-on|labou?r/.test(s)) return "taskrabbit";
  if (/pay|stripe|invoice|refund/.test(s)) return "payments";
  if (/sms|text|email|call|phone|comm|message/.test(s)) return "comms";
  if (/automat|schedul|timer|monitor|trigger|watch|every \d|minutes|hourly|daily|repeat|interval|threshold|forecast/.test(s)) {
    return "automation";
  }
  return "none";
}

/**
 * "fiverr.wedding_video_editing", "fiverr/wedding-video-editing", "Wedding
 * video editing", "wait for delivery" → the speciality; anything else is none.
 */
export function normaliseSpecialty(value: unknown): SpecialtyId | "none" {
  if (value == null) return "none";
  const raw = String(value).trim();
  const lower = raw.toLowerCase();
  if (!raw || lower === "none") return "none";
  const key = lower.replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  const byId = SPECIALTIES.find((s) => s.id === raw || s.id.replace(".", "_") === key || s.id.split(".")[1] === key);
  if (byId) return byId.id;
  const byName = SPECIALTIES.find((s) => s.name.toLowerCase() === lower);
  if (byName) return byName.id;
  if (lower.length < 3) return "none";
  const loose = SPECIALTIES.find((s) => s.name.toLowerCase().includes(lower) || lower.includes(s.name.toLowerCase()));
  return loose?.id ?? "none";
}

function normaliseUses(values: unknown): (typeof USES)["options"][number][] {
  if (!Array.isArray(values)) return [];
  const known = new Set<string>(USES.options);
  return [...new Set(values.map((v) => String(v).toLowerCase()).filter((v) => known.has(v)))] as (typeof USES)["options"][number][];
}

export function normaliseUnit(value: unknown): CostUnit {
  const s = String(value).toLowerCase();
  if (/photo|image|picture|face/.test(s)) return "per_photo";
  if (/item|each|unit|camera|piece/.test(s)) return "per_item";
  if (/hour/.test(s)) return "per_hour";
  if (/month/.test(s)) return "per_month";
  return "flat";
}

const num = (fallback: number) => z.coerce.number().catch(fallback);
const str = z.string().catch("");
const bool = z.boolean().catch(false);

const LenientScreenStep = z
  .object({
    title: z.string().catch("Step"),
    detail: str,
    // `.optional()` matters: in zod 4 an `unknown` key is still required, so a
    // step the model wrote without one would fail as a whole.
    route: z.unknown().optional().transform(normaliseRoute),
    integration: z.unknown().optional().transform(normaliseIntegration),
    specialty: z.unknown().optional().transform(normaliseSpecialty),
    uses: z.unknown().optional().transform(normaliseUses),
  })
  // A speciality names its backend, so it settles the route and the backend.
  // Otherwise a backend named without the route, or a route without the
  // backend, is read as what was meant.
  .transform((step) => {
    if (step.specialty !== "none") {
      const integration = SPECIALTY_BY_ID[step.specialty].integration;
      return step.route === "service" && step.integration === integration ? step : { ...step, route: "service" as const, integration };
    }
    if (step.route === "service" && step.integration === "none") return { ...step, integration: normaliseIntegration(`${step.title} ${step.detail}`) };
    if (step.route !== "service" && step.integration !== "none") return { ...step, route: "service" as const };
    return step;
  });

/** WorkflowScreenOutputSchema, read leniently. */
export const WorkflowScreenOutputLenient = z.object({
  concerns: z
    .object({ illegal: bool, unethical: bool, absurd: bool, obviouslyExpensive: bool })
    .catch({ illegal: false, unethical: false, absurd: false, obviouslyExpensive: false }),
  concernReason: str,
  summary: str,
  steps: z.array(LenientScreenStep.catch({ title: "Step", detail: "", route: "human", integration: "none", specialty: "none", uses: [] })).catch([]),
  briefLines: z.array(z.string()).catch([]),
  skillsToEnable: z.unknown().optional().transform(normaliseSkillIds),
  alternatives: z
    .array(
      z
        .object({
          stepIndex: num(-1),
          integration: z.unknown().optional().transform(normaliseIntegration),
          specialty: z.unknown().optional().transform(normaliseSpecialty),
          gain: z.unknown().optional().transform((g): Gain => (/cheap|less|sav/i.test(String(g)) ? "cheaper" : "faster")),
          detail: str,
          tradeoff: str,
        })
        .catch({ stepIndex: -1, integration: "none", specialty: "none", gain: "faster", detail: "", tradeoff: "" }),
    )
    .catch([])
    // A speciality names its backend; an alternative with no recognisable
    // backend is no alternative.
    .transform((list) =>
      list
        .map((a) => (a.specialty !== "none" ? { ...a, integration: SPECIALTY_BY_ID[a.specialty].integration } : a))
        .filter(
          (a): a is { stepIndex: number; integration: IntegrationId; specialty: SpecialtyId | "none"; gain: Gain; detail: string; tradeoff: string } =>
            a.integration !== "none",
        ),
    ),
});

/** StepEstimateSchema, read leniently: what the model returns for one step. */
export const StepEstimateLenient = z.object({
  humanMinutes: num(0),
  cost: z
    .object({
      unit: z.unknown().optional().transform(normaliseUnit),
      unitLow: num(0),
      unitHigh: num(0),
      quantity: num(1),
      basis: str,
      options: z
        .array(z.object({ label: z.string().catch(""), priceUsd: num(0) }).catch({ label: "", priceUsd: 0 }))
        .catch([])
        .transform((list) => list.filter((o) => o.label)),
      unknown: bool,
      roadblock: str,
    })
    .catch({ unit: "flat", unitLow: 0, unitHigh: 0, quantity: 1, basis: "", options: [], unknown: true, roadblock: "No estimate came back for this step." }),
  time: z
    .object({
      kind: z.unknown().optional().transform((k) => {
        const s = String(k).toLowerCase();
        return s === "human" || s === "engineering" ? s : "estimate";
      }),
      estimate: str,
    })
    .catch({ kind: "estimate", estimate: "" }),
});

/** One step as assembled in code: by index, with the alternative's price if one was offered. */
const LenientEstimateStep = StepEstimateLenient.extend({
  index: num(-1),
  alternative: StepEstimateLenient.nullable().catch(null),
});

/** WorkflowEstimateSchema, read leniently. */
export const WorkflowEstimateLenient = z.object({
  steps: z.array(LenientEstimateStep).catch([]),
  briefLines: z.array(z.string()).catch([]),
  skillsToEnable: z.unknown().optional().transform(normaliseSkillIds),
});

/** UnderstandingOutputSchema, read leniently. */
export const UnderstandingOutputLenient = z.object({
  items: z
    .array(
      z.object({
        title: z.string().catch("Item"),
        kind: z.unknown().optional().transform((k) => (String(k).toLowerCase() === "new" ? "new" : "change")),
        skill: z.unknown().optional().transform((s) => normaliseSkillIds([s])[0] ?? "none"),
        verdict: z.unknown().optional().transform((v) => {
          const s = String(v).toLowerCase();
          return s === "feasible" || s === "partly" ? s : s.includes("not") ? "not_feasible" : "partly";
        }),
        summary: str,
        cannotDo: z.array(z.string()).catch([]),
        instructions: str,
      }),
    )
    .catch([]),
});

/** A step as stored: the model's step, with the alternative it offered (if any) attached to it. */
const StoredScreenStepSchema = ScreenStepSchema.extend({
  specialty: SPECIALTY_OR_NONE.default("none"),
  alternative: AlternativeSchema.extend({ specialty: SPECIALTY_OR_NONE.default("none") }).nullable().default(null),
});

/** Pass one as stored and sent on: the decision, the reason, the steps. */
export const WorkflowScreenSchema = z.object({
  reasonable: z.boolean(),
  reason: z.string(),
  steps: z.array(StoredScreenStepSchema),
  /** Expense was the only concern: let the estimate's total decide (see PROHIBITIVE_USD). */
  verifyExpense: z.boolean().default(false),
  expenseReason: z.string().default(""),
  /** What the assistant can take on itself, worked out here rather than in the pricing pass. */
  briefLines: z.array(z.string()).default([]),
  skillsToEnable: z.array(z.enum(SKILL_IDS)).default([]),
});
export type WorkflowScreen = z.infer<typeof WorkflowScreenSchema>;

/**
 * The alternative offered for a step, if it makes sense: a different supported
 * backend, for a step that is a service's, another AI service's or a person's.
 * The assistant's own work and the photographer's have no vendor to swap. One
 * per step; the first wins.
 */
function alternativeFor(
  alternatives: Array<{
    stepIndex: number;
    integration: IntegrationId | "none";
    specialty?: SpecialtyId | "none";
    gain: Gain;
    detail: string;
    tradeoff: string;
  }>,
  step: WorkflowScreenOutput["steps"][number],
  index: number,
): Alternative | null {
  const a = alternatives.find((x) => x.stepIndex === index);
  if (!a) return null;
  const specialty = a.specialty ?? "none";
  // A speciality names its backend.
  const integration = specialty !== "none" ? SPECIALTY_BY_ID[specialty].integration : a.integration;
  if (integration === "none") return null;
  if (step.route !== "service" && step.route !== "ai_service" && step.route !== "human") return null;
  if (step.route === "service" && step.integration === integration) return null;
  return {
    integration,
    specialty,
    gain: a.gain,
    detail: a.detail || `${step.title}, through ${serviceLabel({ route: "service", integration, specialty })} (beta).`,
    tradeoff: a.tradeoff,
  };
}

/**
 * The decision. Only the four flags count, and illegal, unethical and absurd
 * requests keep no steps: they get a refusal, not a breakdown. Expense alone
 * is not trusted — the request goes on to be priced, and the total decides.
 */
export function screenFromOutput(output: WorkflowScreenOutput): WorkflowScreen {
  const c = output.concerns;
  if (c.illegal || c.unethical || c.absurd) {
    return {
      reasonable: false,
      reason: output.concernReason || "This request is not something the team will take on.",
      steps: [],
      verifyExpense: false,
      expenseReason: "",
      briefLines: [],
      skillsToEnable: [],
    };
  }
  return {
    reasonable: true,
    reason: output.summary,
    steps: output.steps.map((step, index) => ({ ...step, alternative: alternativeFor(output.alternatives ?? [], step, index) })),
    verifyExpense: c.obviouslyExpensive,
    expenseReason: c.obviouslyExpensive ? output.concernReason : "",
    briefLines: output.briefLines,
    skillsToEnable: output.skillsToEnable,
  };
}

/** What the model is asked for when pricing ONE step. */
export const StepEstimateSchema = z.object({
      humanMinutes: z
        .number()
        .min(0)
        .describe("Minutes of a team member's time this step needs; 0 for site and AI-service steps"),
      cost: z.object({
        unit: z
          .enum(COST_UNITS)
          .describe("flat: one price for the whole step. Otherwise a per-unit price the site multiplies by quantity"),
        unitLow: z.number().min(0).describe("USD per unit (or the flat price): goods, delivery, service and AI fees only"),
        unitHigh: z.number().min(0),
        quantity: z.number().min(0).describe("How many units — photos, items, hours, months. 1 for flat"),
        basis: z.string().describe("Where the numbers come from and what was assumed, briefly"),
        options: z
          .array(z.object({ label: z.string(), priceUsd: z.number().min(0) }))
          .describe("For purchases: two or three concrete choices with prices; otherwise empty"),
        unknown: z.boolean().describe("True if the cost genuinely cannot be pinned down"),
        roadblock: z.string().describe("If unknown: why. Otherwise empty"),
      }),
      time: z.object({
        kind: z
          .enum(["estimate", "human", "engineering"])
          .describe(
            "estimate: a tangible timeframe. human: only the team can say. engineering: needs the developers",
          ),
        estimate: z.string().describe("For estimate: e.g. '2–4 days', 'about an hour'. Otherwise empty"),
      }),
});

export type StepEstimate = z.infer<typeof StepEstimateSchema>;

/** One step of the estimate as assembled in code: by index, with the alternative's price if one was offered. */
const EstimateStepSchema = StepEstimateSchema.extend({
  index: z.number().int(),
  alternative: StepEstimateSchema.nullable().default(null),
});

/** Pass two, as buildReport consumes it: money and time per step, by index, plus the brief lines. */
export const WorkflowEstimateSchema = z.object({
  steps: z.array(EstimateStepSchema),
  briefLines: z
    .array(z.string())
    .describe("Sentences in the photographer's own voice to add to the assistant's brief for the 'site' steps only"),
  skillsToEnable: z.array(z.enum(SKILL_IDS)).describe("Built-in skills the 'site' steps rely on"),
});
export type WorkflowEstimate = z.infer<typeof WorkflowEstimateSchema>;

const ReportCostSchema = z.object({
  /** Computed: unit price × quantity. */
  low: z.number(),
  high: z.number(),
  unit: z.enum(COST_UNITS).default("flat"),
  unitLow: z.number().default(0),
  unitHigh: z.number().default(0),
  quantity: z.number().default(1),
  basis: z.string(),
  options: z.array(z.object({ label: z.string(), priceUsd: z.number() })),
  unknown: z.boolean(),
  roadblock: z.string(),
});
const ReportTimeSchema = z.object({ kind: z.enum(["estimate", "human", "engineering"]), estimate: z.string() });

/** The alternative as shown: the backend, what it wins and gives up, and its own price and time. */
const RecommendationSchema = AlternativeSchema.extend({
  specialty: SPECIALTY_OR_NONE.default("none"),
  tier: z.number().int().min(0).max(3),
  cost: ReportCostSchema,
  time: ReportTimeSchema,
});
export type Recommendation = z.infer<typeof RecommendationSchema>;

/** One analysed step, as stored and shown: the screen's step plus the estimate and the computed parts. */
const ReportStepSchema = z.object({
  title: z.string(),
  detail: z.string(),
  route: z.enum(WORKFLOW_ROUTES),
  integration: INTEGRATION_OR_NONE.default("none"),
  /** The backend's sub-service — "Fiverr › Wedding video editing" — when it has a list. */
  specialty: SPECIALTY_OR_NONE.default("none"),
  uses: z.array(USES),
  tier: z.number().int().min(0).max(3),
  humanMinutes: z.number(),
  humanCost: z.number(),
  cost: ReportCostSchema,
  time: ReportTimeSchema,
  /** A faster or cheaper way to do this step, if the analysis found one. */
  recommendation: RecommendationSchema.nullable().default(null),
});
export type ReportStep = z.infer<typeof ReportStepSchema>;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** A step's price from the model's unit price and quantity — the multiplication happens here, not in the model. */
function costFromEstimate(e: WorkflowEstimate["steps"][number]["cost"]): ReportStep["cost"] {
  const quantity = e.unit === "flat" ? 1 : Math.max(0, e.quantity);
  return {
    low: round2(e.unitLow * quantity),
    high: round2(e.unitHigh * quantity),
    unit: e.unit,
    unitLow: e.unitLow,
    unitHigh: e.unitHigh,
    quantity,
    basis: e.basis,
    options: e.options,
    unknown: e.unknown,
    roadblock: e.roadblock,
  };
}

const NO_COST: ReportStep["cost"] = {
  low: 0, high: 0, unit: "flat", unitLow: 0, unitHigh: 0, quantity: 1,
  basis: "", options: [], unknown: false, roadblock: "",
};

export const WorkflowReportSchema = z.object({
  reasonable: z.boolean(),
  reason: z.string(),
  steps: z.array(ReportStepSchema),
  totals: z.object({
    low: z.number(),
    high: z.number(),
    unknownSteps: z.number().int(),
    overBudget: z.boolean(),
  }),
  briefLines: z.array(z.string()),
  skillsToEnable: z.array(z.enum(SKILL_IDS)),
});
export type WorkflowReport = z.infer<typeof WorkflowReportSchema>;

// --- Analysis tiers ---------------------------------------------------------
//
// The analysis runs on the cheapest model by default. A dev code (an
// environment variable on the server) unlocks bigger models for the
// photographer testing the beta. What each tier actually uses lives on the
// server (lib/ai.ts); this is what the picker shows.

export const ANALYSIS_TIERS = ["standard", "balanced", "thorough"] as const;
export type AnalysisTier = (typeof ANALYSIS_TIERS)[number];

export const TIER_INFO: Record<AnalysisTier, { label: string; model: string; hint: string; approx: string }> = {
  standard: {
    label: "Standard",
    model: "the fast model",
    hint: "Cheapest. The step breakdown can vary from run to run.",
    approx: "1–4¢",
  },
  balanced: {
    label: "Balanced",
    model: "the mid-size model",
    hint: "Steadier breakdowns and pricing; a few cents.",
    approx: "5–10¢",
  },
  thorough: {
    label: "Thorough",
    model: "the largest model, with extended thinking",
    hint: "Best judgement on hard requests; slower.",
    approx: "20–40¢",
  },
};

/**
 * Approximate list prices per million tokens, for the dev readout only. They
 * are not used for anything the photographer is charged, and a stale figure
 * here only makes the readout a little off.
 */
export const MODEL_PRICES: Record<string, { input: number; output: number }> = {
  "claude-haiku-4-5-20251001": { input: 1, output: 5 },
  "claude-sonnet-5": { input: 3, output: 15 },
  "claude-opus-5": { input: 5, output: 25 },
};
/** Per web search, in dollars. */
export const WEB_SEARCH_PRICE = 0.01;

/** What one analysis actually used, and what that roughly cost. */
export const AnalysisUsageSchema = z.object({
  tier: z.enum(ANALYSIS_TIERS),
  model: z.string(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  searches: z.number(),
  costUsd: z.number(),
  /** What was taken from the photographer's credit, in cents; 0 when billing is off or the run was comped. */
  chargedCents: z.number().default(0),
});
export type AnalysisUsage = z.infer<typeof AnalysisUsageSchema>;

export function usageCost(model: string, inputTokens: number, outputTokens: number, searches: number): number {
  const price = MODEL_PRICES[model] ?? { input: 5, output: 25 };
  const dollars = (inputTokens * price.input + outputTokens * price.output) / 1_000_000 + searches * WEB_SEARCH_PRICE;
  return Math.round(dollars * 10_000) / 10_000;
}

/** Two usages (the screen and the estimate) as one. */
export function addUsage(a: AnalysisUsage, b: AnalysisUsage): AnalysisUsage {
  return {
    tier: a.tier,
    model: a.model === b.model ? a.model : `${a.model} + ${b.model}`,
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    searches: a.searches + b.searches,
    costUsd: Math.round((a.costUsd + b.costUsd) * 10_000) / 10_000,
    chargedCents: (a.chargedCents ?? 0) + (b.chargedCents ?? 0),
  };
}

/** The last analysis, kept with the configuration so it can be revisited. */
const StoredWorkflowSchema = z.object({
  description: z.string(),
  report: WorkflowReportSchema,
  analysedAt: z.string(),
  /** When it was sent to the team, if it was. */
  sentAt: z.string().nullable().default(null),
  /** What ran it and what it cost; absent on reports from before the readout existed. */
  analysedWith: AnalysisUsageSchema.nullable().default(null),
});
export type StoredWorkflow = z.infer<typeof StoredWorkflowSchema>;

/**
 * The agent built from a workflow: a snapshot of the analysis at the moment
 * "Create Agent" was pressed, so a later re-analysis does not change what the
 * agent was set up for. It talks on its own channel of the assistant.
 */
export const StoredAgentSchema = z.object({
  description: z.string(),
  report: WorkflowReportSchema,
  createdAt: z.string(),
});
export type StoredAgent = z.infer<typeof StoredAgentSchema>;

/**
 * What the agent may do with a step in this beta: do it now (the assistant's
 * own steps — lookups, the calendar, a photo), only describe it (anything on a
 * backend or with a person), or leave it to the photographer.
 */
export type StepAvailability = "now" | "later" | "yours";

export function stepAvailability(step: { route: WorkflowRoute }): StepAvailability {
  if (step.route === "site") return "now";
  if (step.route === "self") return "yours";
  return "later";
}

export const AVAILABILITY_LABELS: Record<StepAvailability, string> = {
  now: "does it now",
  later: "describes it — beta",
  yours: "yours to do",
};

/** The steps as asks to put to the agent — the hints shown in its chat. The photographer's own steps are not asks. */
export function agentAsks(agent: StoredAgent): string[] {
  return agent.report.steps.filter((s) => s.route !== "self").map((s) => s.title);
}

/**
 * How long the estimate pass will take, for the countdown. Thirty seconds to
 * a minute, per the brief; longer for more steps, for steps that need prices
 * looked up, and for the bigger models.
 */
/**
 * Which steps need a model to price them. Backends with a known tariff are
 * priced from a table (see tablePrice); the assistant's, the photographer's
 * and engineering steps cost nothing — no call for any of those.
 */
export function needsPricing(step: { route: WorkflowRoute; integration: IntegrationId | "none" }): boolean {
  if (step.route === "human" || step.route === "ai_service") return true;
  if (step.route === "service") return !(step.integration in TABLE_PRICES);
  return false;
}

/**
 * Backends with a tariff simple enough to price without asking anyone: a
 * text is a cent and takes seconds, a scheduled check costs nothing, a
 * payment request costs nothing up front (the fee comes out of the payment).
 */
export const TABLE_PRICES: Partial<Record<IntegrationId, { cost: StepEstimate["cost"]; time: string }>> = {
  comms: {
    cost: {
      unit: "per_item",
      unitLow: 0.01,
      unitHigh: 0.01,
      quantity: 30,
      basis: "Texts at about a cent each; emails are free. Assumes up to 30 messages.",
      options: [],
      unknown: false,
      roadblock: "",
    },
    time: "seconds per message",
  },
  automation: {
    cost: { unit: "flat", unitLow: 0, unitHigh: 0, quantity: 1, basis: "", options: [], unknown: false, roadblock: "" },
    time: "runs the moment the condition is met",
  },
  payments: {
    cost: {
      unit: "flat",
      unitLow: 0,
      unitHigh: 0,
      quantity: 1,
      basis: "No cost to send; the processor's fee (about 2.9% + 30¢) comes out of the payment.",
      options: [],
      unknown: false,
      roadblock: "",
    },
    time: "instant",
  },
};

/** The estimate for one table-priced step, in the shape the model would have returned. */
export function tablePrice(integration: IntegrationId | "none"): StepEstimate | null {
  const tariff = integration === "none" ? undefined : TABLE_PRICES[integration];
  if (!tariff) return null;
  return { humanMinutes: 0, cost: tariff.cost, time: { kind: "estimate", estimate: tariff.time } };
}

export function estimatedSeconds(screen: WorkflowScreen, tier: AnalysisTier = "standard"): number {
  // Steps are priced in parallel, so the wait is about one lookup, plus a
  // little per step for the ones that need a search — a recommended
  // alternative is a step of its own for this.
  const priced =
    screen.steps.filter(needsPricing).length +
    screen.steps.filter((s) => s.alternative && needsPricing({ route: "service", integration: s.alternative.integration })).length;
  const factor = { standard: 1, balanced: 1.4, thorough: 1.8 }[tier];
  if (priced === 0) return 3;
  return Math.round(Math.min(45 * factor, Math.max(8, (8 + 3 * priced) * factor)));
}

/** Combine the screen and the estimate into the report: tiers, human cost, totals. */
export function buildReport(screen: WorkflowScreen, estimate: WorkflowEstimate | null): WorkflowReport {
  if (!screen.reasonable || !estimate) {
    return {
      reasonable: screen.reasonable,
      reason: screen.reason,
      steps: [],
      totals: { low: 0, high: 0, unknownSteps: 0, overBudget: false },
      briefLines: [],
      skillsToEnable: [],
    };
  }

  const steps: ReportStep[] = screen.steps.map((step, index) => {
    const e = estimate.steps.find((s) => s.index === index) ?? estimate.steps[index];
    // A person is involved in every human step, whatever the model said, and
    // in no other kind. An engineering step is not priced at all: it needs the
    // developers, and what that costs is theirs to say, not a guess to add up.
    const minutes = step.route === "human" ? Math.max(e?.humanMinutes ?? 0, HUMAN_MINIMUM_MINUTES) : 0;
    const time = e?.time ?? { kind: "human" as const, estimate: "" };
    // The assistant's own work and the photographer's have no fee — whatever
    // the model priced them at. Backend steps cost what the vendor charges.
    const cost =
      step.route === "site" || step.route === "self" || step.route === "engineering"
        ? NO_COST
        : e
          ? costFromEstimate(e.cost)
          : { ...NO_COST, unknown: true, roadblock: "No estimate came back for this step." };
    return {
      title: step.title,
      detail: step.detail,
      route: step.route,
      integration: step.route === "service" ? step.integration : "none",
      specialty: step.route === "service" ? (step.specialty ?? "none") : "none",
      uses: step.uses,
      tier: tierFor(step.route, step.integration),
      humanMinutes: minutes,
      humanCost: humanCost(minutes),
      cost,
      recommendation: step.alternative ? recommendationFor(step.alternative, e?.alternative ?? null) : null,
      // A backend step always has a timeframe of its own; only engineering is the developers' to give.
      time:
        step.route === "engineering"
          ? { kind: "engineering", estimate: "" }
          : step.route === "service" && time.kind !== "estimate"
            ? { kind: "estimate", estimate: time.estimate || "depends on the vendor" }
            : time,
    };
  });

  const totals = totalsFor(steps);

  // The screen suspected this was prohibitively expensive; the real figure decides.
  if (screen.verifyExpense && totals.high >= PROHIBITIVE_USD) {
    return {
      reasonable: false,
      reason: `${screen.expenseReason || "This would be prohibitively expensive."} Roughly $${totals.low}–$${totals.high} all-in, against a usual limit of $${BUDGET_USD}.`,
      steps: [],
      totals: { low: 0, high: 0, unknownSteps: 0, overBudget: false },
      briefLines: [],
      skillsToEnable: [],
    };
  }

  return {
    reasonable: true,
    reason: screen.reason,
    steps,
    totals,
    briefLines: estimate.briefLines,
    skillsToEnable: estimate.skillsToEnable,
  };
}

/** The all-in figures: priced steps plus team time; unknown steps are counted, not added. */
function totalsFor(steps: ReportStep[]): WorkflowReport["totals"] {
  const low = round2(steps.reduce((sum, s) => sum + (s.cost.unknown ? 0 : s.cost.low) + s.humanCost, 0));
  const high = round2(steps.reduce((sum, s) => sum + (s.cost.unknown ? 0 : s.cost.high) + s.humanCost, 0));
  return { low, high, unknownSteps: steps.filter((s) => s.cost.unknown).length, overBudget: high > BUDGET_USD };
}

/** The recommended backend with its own price and time, in the report's shape. A backend always has a timeframe. */
function recommendationFor(alt: Alternative, e: StepEstimate | null): Recommendation {
  return {
    integration: alt.integration,
    specialty: alt.specialty ?? "none",
    gain: alt.gain,
    detail: alt.detail,
    tradeoff: alt.tradeoff,
    tier: tierFor("service", alt.integration),
    cost: e ? costFromEstimate(e.cost) : { ...NO_COST, unknown: true, roadblock: "No estimate came back for this option." },
    time: { kind: "estimate", estimate: e?.time.estimate || "depends on the vendor" },
  };
}

/**
 * Take the recommendation for one step: the step becomes that backend's, with
 * its price and time, and the totals follow. The original is not kept —
 * "Analyse again" brings it back. Nothing to take returns the report as is.
 */
export function applyRecommendation(report: WorkflowReport, index: number): WorkflowReport {
  const step = report.steps[index];
  const rec = step?.recommendation;
  if (!rec) return report;
  const swapped: ReportStep = {
    ...step,
    detail: rec.detail,
    route: "service",
    integration: rec.integration,
    specialty: rec.specialty,
    uses: [],
    tier: rec.tier,
    humanMinutes: 0,
    humanCost: 0,
    cost: rec.cost,
    time: rec.time,
    recommendation: null,
  };
  const steps = report.steps.map((s, i) => (i === index ? swapped : s));
  return { ...report, steps, totals: totalsFor(steps) };
}

/**
 * The stored configuration. Every field has a default so a config saved before
 * a setting existed still parses — that is what lets settings be added without
 * a database migration.
 */
const AssistantConfigSchema = z.object({
  name: z.string().trim().min(1).max(LIMITS.name).default("Smart Photographer"),
  tone: z.enum(TONES).default("advisory"),
  /** Free-text standing instructions: "clients call me Jo", "never book Sundays". */
  instructions: z.string().trim().max(LIMITS.instructions).default(""),
  skills: z
    .object({
      scheduling: z
        .object({
          enabled: z.boolean().default(true),
          /** Whether it may add or remove bookings (always with confirmation). */
          canBook: z.boolean().default(true),
        })
        .default({ enabled: true, canBook: true }),
      photos: z
        .object({
          enabled: z.boolean().default(true),
          style: z.enum(STYLE_PRESETS).default("natural"),
          allowCrop: z.boolean().default(false),
        })
        .default({ enabled: true, style: "natural", allowCrop: false }),
      lookup: z.object({ enabled: z.boolean().default(true) }).default({ enabled: true }),
    })
    .default({
      scheduling: { enabled: true, canBook: true },
      photos: { enabled: true, style: "natural", allowCrop: false },
      lookup: { enabled: true },
    }),
  /** Everything the photographer added or changed, in their own words. */
  brief: z.string().trim().max(LIMITS.brief).default(""),
  understanding: UnderstandingSchema.nullable().default(null),
  workflow: StoredWorkflowSchema.nullable().default(null),
  /** The agent created from a workflow, if one has been. */
  agent: StoredAgentSchema.nullable().default(null),
});

export type AssistantConfig = z.infer<typeof AssistantConfigSchema>;

export const DEFAULT_CONFIG: AssistantConfig = AssistantConfigSchema.parse({});

const SKILL_LABELS: Record<SkillId, string> = {
  scheduling: "Scheduling",
  photos: "Photo touch-up",
  lookup: "Look things up",
};

/**
 * Bring a configuration saved by an earlier version up to the current shape.
 * First version: "house rules", the old tone names, a lookup checkbox. Second
 * version: per-skill notes and separately described custom skills — those all
 * fold into the one brief, which the photographer can re-check.
 */
function upgrade(input: unknown): unknown {
  if (typeof input !== "object" || input === null) return input;
  const raw = { ...(input as Record<string, unknown>) };
  if (raw.instructions === undefined && typeof raw.houseRules === "string") {
    raw.instructions = raw.houseRules;
  }
  if (raw.tone === "brief") raw.tone = "concise";
  if (raw.tone === "friendly") raw.tone = "advisory";

  const skills =
    typeof raw.skills === "object" && raw.skills !== null
      ? { ...(raw.skills as Record<string, Record<string, unknown> | undefined>) }
      : {};
  if (skills.lookup === undefined && typeof raw.lookup === "boolean") {
    skills.lookup = { enabled: raw.lookup };
  }
  raw.skills = skills;

  if (raw.brief === undefined) {
    const lines: string[] = [];
    for (const id of SKILL_IDS) {
      const notes = skills[id]?.notes;
      if (typeof notes === "string" && notes.trim()) lines.push(`${SKILL_LABELS[id]}: ${notes.trim()}`);
    }
    if (Array.isArray(raw.custom)) {
      for (const c of raw.custom as { name?: unknown; description?: unknown }[]) {
        if (typeof c?.name === "string" && typeof c.description === "string") {
          lines.push(`${c.name}: ${c.description}`);
        }
      }
    }
    if (lines.length > 0) raw.brief = lines.join("\n");
  }
  // The first workflow planner stored a different shape ("plan"); a stale one
  // is simply forgotten rather than making the whole configuration unreadable.
  if (typeof raw.workflow === "object" && raw.workflow !== null && !("report" in raw.workflow)) {
    raw.workflow = null;
  }
  return raw;
}

/** Validate a configuration from the browser or the database; null if unusable. */
export function parseAssistantConfig(input: unknown): AssistantConfig | null {
  const result = AssistantConfigSchema.safeParse(upgrade(input));
  return result.success ? result.data : null;
}

/**
 * Take the part of a workflow the assistant can do into the configuration:
 * switch on the skills it relies on and add its lines to the brief (skipping
 * any already there). The brief is then checked like anything else written.
 */
export function applyWorkflowReport(config: AssistantConfig, plan: WorkflowReport): AssistantConfig {
  const on = new Set(plan.skillsToEnable);
  const skills: AssistantConfig["skills"] = {
    scheduling: { ...config.skills.scheduling, enabled: config.skills.scheduling.enabled || on.has("scheduling") },
    photos: { ...config.skills.photos, enabled: config.skills.photos.enabled || on.has("photos") },
    lookup: { ...config.skills.lookup, enabled: config.skills.lookup.enabled || on.has("lookup") },
  };

  const existing = new Set(config.brief.split("\n").map((line) => line.trim()));
  const fresh = plan.briefLines.map((line) => line.trim()).filter((line) => line && !existing.has(line));
  const brief = [config.brief.trim(), ...fresh].filter(Boolean).join("\n");

  return { ...config, skills, brief };
}

/** True when the stored check was made for the brief as it is now. */
export function understandingIsCurrent(config: AssistantConfig): boolean {
  // Trimmed on both sides: the server stores the brief trimmed, but in the
  // browser the box may still carry a trailing newline.
  return config.understanding !== null && config.understanding.brief === config.brief.trim();
}

/** The items from a current check; none if the brief changed since. */
export function currentUnderstanding(config: AssistantConfig): UnderstandingItem[] {
  return understandingIsCurrent(config) ? config.understanding!.items : [];
}

/** A photo shown in the conversation: what the photographer sent, or what came back. */
export interface Attachment {
  photoId: string;
  variant: "original" | "edited";
  /** Resolved when the message is read, so it reflects the photo as it is now. */
  url: string;
  name: string;
}

/** One turn of the conversation, as the browser sees it. */
export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  attachments: Attachment[];
  createdAt: string;
}

/** The names of everything switched on, for headings. */
export function enabledSkillNames(config: AssistantConfig): string[] {
  return [
    ...SKILLS.filter((s) => config.skills[s.id].enabled).map((s) => s.name),
    ...currentUnderstanding(config)
      .filter((item) => item.kind === "new" && item.verdict !== "not_feasible")
      .map((item) => item.title),
  ];
}

/** The example prompts offered on an empty conversation, per enabled skill. */
export function suggestionsFor(config: AssistantConfig): string[] {
  return SKILLS.filter((s) => config.skills[s.id].enabled).flatMap((s) => s.examples);
}
