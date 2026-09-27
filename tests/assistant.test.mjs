// Unit tests for the assistant and the workflow analysis that need no model:
// configuration, the system prompt, the tools and their confirmation gate,
// the store, the report, tiers, billing, backends and specialities,
// recommendations, the agent, and texting. Run with `npm test`.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

// A throwaway database per run, set before anything imports db.ts.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "blinked-tests-"));
process.env.DATA_DIR = tmp;
process.env.UPLOAD_DIR = path.join(tmp, "uploads");
delete process.env.ANTHROPIC_API_KEY;
delete process.env.STRIPE_SECRET_KEY;
delete process.env.STRIPE_WEBHOOK_SECRET;
delete process.env.ANALYSIS_DEV_CODE;

const catalog = await import("@/lib/assistant/catalog");
const {
  applyPreset,
  parseAssistantConfig,
  DEFAULT_CONFIG,
  LIMITS,
  suggestionsFor,
  enabledSkillNames,
  understandingIsCurrent,
  SUGGESTED_SKILLS,
} = catalog;
const { buildSystemPrompt, linksInSettings } = await import("@/lib/assistant/run");
const { toolsFor } = await import("@/lib/assistant/tools");
const store = await import("@/lib/assistant/store");
const { getDb } = await import("@/lib/db");
const { listBookings, addBooking } = await import("@/lib/scheduleStore");
const { NO_ADJUSTMENTS } = await import("@/lib/ai");

const db = getDb();
const userId = "user-1";
db.prepare(
  `INSERT INTO users (id, email, name, picture, provider, public_slug, created_at)
   VALUES (?, ?, ?, NULL, 'email', ?, ?)`,
).run(userId, "jo@example.com", "Jo Test", "jo-test", new Date().toISOString());

const BRIEF =
  "Don't offer any date within two days of a lunar eclipse.\n" +
  "Negotiate: when an enquiry mentions price, check local rates and tell me how I compare.\n" +
  "Text Sam the date whenever I take a booking.";

const understanding = {
  brief: BRIEF,
  checkedAt: "2026-09-14T00:00:00.000Z",
  items: [
    {
      title: "Avoid eclipse dates",
      kind: "change",
      skill: "scheduling",
      verdict: "feasible",
      summary: "Dates near a lunar eclipse will not be offered.",
      cannotDo: [],
      instructions: "When a date is discussed, search for lunar eclipses near it and warn.",
    },
    {
      title: "Negotiate",
      kind: "new",
      skill: "none",
      verdict: "partly",
      summary: "It can read enquiries and search local rates.",
      cannotDo: ["Reply to the couple"],
      instructions: "When an enquiry mentions price, search for local rates and compare.",
    },
    {
      title: "Text Sam",
      kind: "new",
      skill: "none",
      verdict: "not_feasible",
      summary: "It cannot send texts to anyone.",
      cannotDo: ["Send a text"],
      instructions: "",
    },
  ],
};

/** A tool context for one message. */
const ctxFor = (config, messageId, channel = "web") => ({
  userId,
  channel,
  today: "2026-09-14",
  config,
  messageId,
  attachedPhotoIds: [],
  attachments: [],
  publicSlug: "jo-test",
});

const toolNamed = (config, name, options) => toolsFor(config, options).find((t) => t.definition.name === name);

// --- catalog ---------------------------------------------------------------

test("config: empty input gets every default", () => {
  const config = parseAssistantConfig({});
  assert.ok(config);
  assert.equal(config.name, "Smart Photographer");
  assert.equal(config.tone, "advisory");
  assert.equal(config.skills.scheduling.enabled, true);
  assert.equal(config.skills.photos.style, "natural");
  assert.equal(config.skills.lookup.enabled, true);
  assert.equal(config.brief, "");
  assert.equal(config.understanding, null);
  assert.equal(config.workflow, null);
  assert.equal(config.agent, null);
});

test("config: the first version's shape is upgraded, not rejected", () => {
  const config = parseAssistantConfig({
    name: "Pip",
    tone: "brief",
    houseRules: "Clients call me Jo.",
    lookup: false,
    skills: { scheduling: { enabled: false, notes: "" }, photos: { enabled: true, notes: "" } },
  });
  assert.ok(config);
  assert.equal(config.tone, "concise");
  assert.equal(config.instructions, "Clients call me Jo.");
  assert.equal(config.skills.lookup.enabled, false);
  assert.equal(config.skills.scheduling.enabled, false);
  assert.equal(config.brief, "");
  assert.equal(parseAssistantConfig({ tone: "friendly" }).tone, "advisory");
});

test("config: the second version's notes and custom skills fold into the brief", () => {
  const config = parseAssistantConfig({
    skills: {
      scheduling: { enabled: true, notes: "Avoid eclipse dates.", canBook: true },
      photos: { enabled: true, notes: "", style: "moody", allowCrop: true },
      lookup: { enabled: true, notes: "My site is https://example.com" },
    },
    custom: [{ id: "x", name: "Negotiate", description: "Compare prices.", enabled: true, assessment: null }],
  });
  assert.ok(config);
  assert.equal(
    config.brief,
    "Scheduling: Avoid eclipse dates.\nLook things up: My site is https://example.com\nNegotiate: Compare prices.",
  );
  assert.equal(config.skills.photos.style, "moody");
  assert.equal(config.understanding, null, "re-checked by the photographer next time");
  assert.equal("notes" in config.skills.photos, false);
  assert.equal("custom" in config, false);
});

test("config: limits are enforced; a brief with its check round-trips", () => {
  assert.equal(parseAssistantConfig({ brief: "x".repeat(LIMITS.brief + 1) }), null);
  assert.equal(parseAssistantConfig({ name: "" }), null);
  const config = parseAssistantConfig({ brief: BRIEF, understanding });
  assert.ok(config);
  assert.equal(understandingIsCurrent(config), true);
  assert.equal(understandingIsCurrent({ ...config, brief: `${BRIEF}\nSomething new.` }), false);
  assert.equal(understandingIsCurrent({ ...config, brief: `${BRIEF}\n` }), true, "trailing whitespace is not a change");
  assert.deepEqual(enabledSkillNames(config), ["Scheduling", "Photo touch-up", "Look things up", "Negotiate"]);
  assert.deepEqual(enabledSkillNames({ ...config, brief: "changed" }), ["Scheduling", "Photo touch-up", "Look things up"]);
});

test("presets: natural changes nothing, mono ends grey, values stay in range", () => {
  assert.deepEqual(applyPreset(NO_ADJUSTMENTS, "natural"), NO_ADJUSTMENTS);
  const mono = applyPreset({ ...NO_ADJUSTMENTS, saturation: 40 }, "mono");
  assert.equal(mono.saturation, -100);
  const bright = applyPreset({ ...NO_ADJUSTMENTS, exposure: 95 }, "bright");
  assert.ok(bright.exposure <= 100 && bright.exposure >= 95);
  assert.equal(bright.crop, null);
});

test("suggestions follow the skills that are on; suggested skills have distinct templates", () => {
  const off = parseAssistantConfig({ skills: { photos: { enabled: false } } });
  assert.ok(suggestionsFor(DEFAULT_CONFIG).length > suggestionsFor(off).length);
  assert.equal(new Set(SUGGESTED_SKILLS.map((s) => s.template)).size, SUGGESTED_SKILLS.length);
});

// --- system prompt ---------------------------------------------------------

test("prompt: instructions, tone, skills, the brief and its check all land in it", () => {
  const config = parseAssistantConfig({
    name: "Pip",
    tone: "concise",
    instructions: "Clients call me Jo.",
    skills: {
      scheduling: { enabled: true, canBook: false },
      photos: { enabled: false, style: "moody", allowCrop: false },
      lookup: { enabled: true },
    },
    brief: BRIEF,
    understanding,
  });
  const prompt = buildSystemPrompt({
    config,
    photographerName: "Jo Test",
    today: "2026-09-14",
    pending: { id: "act-1", kind: "add_booking", payload: {}, summary: "Add booking: X", proposedIn: "m1", expiresAt: "" },
    attached: [{ id: "p1", name: "ring.jpg" }],
  });
  assert.match(prompt, /You are Pip, the assistant of Jo Test/);
  assert.match(prompt, /Today is Mon, Sep 14, 2026/);
  assert.match(prompt, /Concise: a sentence or two/);
  assert.doesNotMatch(prompt, /ONE brief suggestion/);
  assert.match(prompt, /## Standing instructions from the photographer\nClients call me Jo\./);
  assert.match(prompt, /Read-only: bookings may not be added/);
  assert.match(prompt, /Photo touch-up \(off\)/);
  assert.match(prompt, /lunar eclipse/);
  assert.match(prompt, /"Avoid eclipse dates"/);
  assert.match(prompt, /"Text Sam".*not possible here/);
  assert.match(prompt, /"Negotiate" \(a new skill, partly\)/);
  assert.match(prompt, /Attached to the latest message: photo id p1 \("ring.jpg"\)/);
  assert.match(prompt, /awaiting the photographer's answer: "Add booking: X" \(action id act-1\)/);
  assert.doesNotMatch(prompt, /## Channel: text message/);
});

test("prompt: a stale check is left out; the advisory tone points at the brief; lookup off says so", () => {
  const config = parseAssistantConfig({
    tone: "advisory",
    skills: { lookup: { enabled: false } },
    brief: `${BRIEF}\nSomething new.`,
    understanding,
  });
  const prompt = buildSystemPrompt({ config, photographerName: "Jo", today: "2026-09-14", pending: null, attached: [] });
  assert.doesNotMatch(prompt, /How that brief was understood/, "the check was for an older brief");
  assert.match(prompt, /ONE brief suggestion/);
  assert.match(prompt, /you cannot look anything up online/);
  assert.match(prompt, /Nothing pending\./);
});

test("links: URLs in the instructions, the brief and the check are collected once each", () => {
  const config = parseAssistantConfig({
    instructions: "My site is https://oopsiblinked.com/about.",
    brief: "Read https://oopsiblinked.com/about and https://example.com/prices?x=1, please.",
    understanding: {
      brief: "Read https://oopsiblinked.com/about and https://example.com/prices?x=1, please.",
      checkedAt: "2026-09-14T00:00:00.000Z",
      items: [
        { title: "Prices", kind: "new", skill: "none", verdict: "feasible", summary: "s", cannotDo: [], instructions: "Check https://example.com/prices?x=1 first." },
      ],
    },
  });
  assert.deepEqual(linksInSettings(config), ["https://oopsiblinked.com/about", "https://example.com/prices?x=1"]);
});

// --- tools -------------------------------------------------------------------

test("tools: only the skills that are on exist", () => {
  const names = (c) => toolsFor(c).map((t) => t.definition.name);
  const all = names(parseAssistantConfig({}));
  assert.ok(all.includes("add_booking") && all.includes("confirm_action") && all.includes("touch_up_photo"));
  const readOnly = names(parseAssistantConfig({ skills: { scheduling: { enabled: true, canBook: false } } }));
  assert.ok(readOnly.includes("list_bookings") && !readOnly.includes("add_booking"));
  const noPhotos = names(parseAssistantConfig({ skills: { photos: { enabled: false } } }));
  assert.ok(!noPhotos.includes("touch_up_photo") && !noPhotos.includes("inspect_photo"));
  const nothing = names(parseAssistantConfig({ skills: { scheduling: { enabled: false }, photos: { enabled: false } } }));
  assert.deepEqual(nothing, []);
});

test("tools: a brief can read everything but change nothing", () => {
  const names = toolsFor(
    parseAssistantConfig({ skills: { scheduling: { enabled: false }, photos: { enabled: false } }, brief: "Tell me about my week." }),
  ).map((t) => t.definition.name);
  assert.ok(names.includes("list_bookings") && names.includes("list_enquiries") && names.includes("list_recent_photos"));
  assert.ok(!names.includes("add_booking") && !names.includes("touch_up_photo"));
});

test("tools: every definition carries a JSON schema without zod's $schema key", () => {
  for (const t of toolsFor(parseAssistantConfig({}), { canText: true })) {
    assert.equal(t.definition.input_schema.type, "object", t.definition.name);
    assert.equal("$schema" in t.definition.input_schema, false, t.definition.name);
    assert.ok(t.definition.description.length > 20, t.definition.name);
  }
});

test("gate: add_booking proposes; confirming in the same message is refused; a later message works", async () => {
  const config = parseAssistantConfig({});
  const propose = toolNamed(config, "add_booking");
  const confirm = toolNamed(config, "confirm_action");
  const first = await propose.run({ date: "2026-11-07", parts: ["morning", "afternoon"], label: "Nguyen wedding" }, ctxFor(config, "m1"));
  assert.equal(first.status, "awaiting_confirmation");
  assert.match(first.summary, /Nguyen wedding — Sat, Nov 7, 2026/);
  assert.equal(listBookings(userId).length, 0, "nothing saved yet");

  const refused = await confirm.run({ actionId: first.actionId }, ctxFor(config, "m1"));
  assert.match(refused.error, /Refused: this was proposed during the current message/);
  assert.equal(listBookings(userId).length, 0);

  const done = await confirm.run({ actionId: first.actionId }, ctxFor(config, "m2"));
  assert.equal(done.done, true);
  assert.equal(done.booking.date, "2026-11-07");
  assert.equal(listBookings(userId).length, 1);
  assert.equal(store.getPendingAction(userId, "web"), null);
});

test("gate: a clashing proposal is refused up front; cancel closes a proposal", async () => {
  const config = parseAssistantConfig({});
  const propose = toolNamed(config, "add_booking");
  const clash = await propose.run({ date: "2026-11-07", parts: ["morning"], label: "Another" }, ctxFor(config, "m3"));
  assert.match(clash.error, /already booked/);

  const open = await propose.run({ date: "2026-11-21", parts: ["evening"], label: "Reception" }, ctxFor(config, "m4"));
  assert.equal(open.status, "awaiting_confirmation");
  const cancelled = await toolNamed(config, "cancel_action").run({ actionId: open.actionId }, ctxFor(config, "m4"));
  assert.equal(cancelled.cancelled, true);
  assert.equal(store.getPendingAction(userId, "web"), null);
  assert.equal(await toolNamed(config, "cancel_action").run({ actionId: open.actionId }, ctxFor(config, "m5")).then((r) => r.cancelled), false, "already closed");
});

test("gate: a newer proposal replaces the older one; expired proposals close themselves", async () => {
  const config = parseAssistantConfig({});
  const propose = toolNamed(config, "add_booking");
  const a = await propose.run({ date: "2026-12-05", parts: ["morning"], label: "A" }, ctxFor(config, "m6"));
  const b = await propose.run({ date: "2026-12-12", parts: ["morning"], label: "B" }, ctxFor(config, "m6"));
  assert.equal(store.getPendingAction(userId, "web").id, b.id ?? b.actionId);
  const stale = await toolNamed(config, "confirm_action").run({ actionId: a.actionId }, ctxFor(config, "m7"));
  assert.match(stale.error, /no longer open/);

  db.prepare("UPDATE assistant_actions SET expires_at = ? WHERE id = ?").run("2000-01-01T00:00:00.000Z", b.actionId);
  assert.equal(store.getPendingAction(userId, "web"), null, "expired on read");
  const late = await toolNamed(config, "confirm_action").run({ actionId: b.actionId }, ctxFor(config, "m8"));
  assert.match(late.error, /no longer open/);
});

test("tools: remove_booking is gated the same way", async () => {
  const config = parseAssistantConfig({});
  const booking = listBookings(userId)[0];
  const remove = toolNamed(config, "remove_booking");
  const proposed = await remove.run({ bookingId: booking.id }, ctxFor(config, "m9"));
  assert.equal(proposed.status, "awaiting_confirmation");
  assert.match(proposed.summary, /Remove booking: Nguyen wedding/);
  const confirm = toolNamed(config, "confirm_action");
  assert.match((await confirm.run({ actionId: proposed.actionId }, ctxFor(config, "m9"))).error, /Refused/);
  assert.equal((await confirm.run({ actionId: proposed.actionId }, ctxFor(config, "m10"))).done, true);
  assert.equal(listBookings(userId).length, 0);
  assert.match((await remove.run({ bookingId: "nope" }, ctxFor(config, "m11"))).error, /No booking with that id/);
});

test("tools: check_date and list_open_slots read what the site knows", async () => {
  const config = parseAssistantConfig({});
  addBooking(userId, "2026-10-24", ["afternoon"], "Okafor wedding");
  const day = await toolNamed(config, "check_date").run({ date: "2026-10-24" }, ctxFor(config, "m12"));
  assert.equal(day.weekday, "Saturday");
  assert.equal(day.isPast, false);
  assert.deepEqual(day.bookings.map((b) => [b.label, b.parts]), [["Okafor wedding", ["afternoon"]]]);
  assert.equal(day.publishedNote, "No schedule is published yet.");
  const open = await toolNamed(config, "list_open_slots").run({}, ctxFor(config, "m12"));
  assert.equal(open.published, false);
  const bad = await toolNamed(config, "check_date").run({ date: "2026-02-30" }, ctxFor(config, "m12"));
  assert.match(bad.error, /Invalid input/);
});

test("tools: a photo that is not yours does not exist", async () => {
  const config = parseAssistantConfig({});
  assert.match((await toolNamed(config, "inspect_photo").run({ photoId: "someone-elses" }, ctxFor(config, "m13"))).error, /No photo with that id/);
  assert.match((await toolNamed(config, "touch_up_photo").run({ photoId: "someone-elses" }, ctxFor(config, "m13"))).error, /No photo with that id/);
  const recent = await toolNamed(config, "list_recent_photos").run({}, ctxFor(config, "m13"));
  assert.deepEqual(recent.photos, []);
});

// --- store -------------------------------------------------------------------

test("store: config round-trips (brief and check included) and can be removed with its conversation", () => {
  const config = parseAssistantConfig({ name: "Pip", brief: BRIEF, understanding });
  store.saveAssistant(userId, config);
  assert.deepEqual(store.getAssistant(userId), config);
  store.addMessage(userId, "web", "user", "hello", []);
  store.addMessage(userId, "web", "assistant", "hi", []);
  assert.equal(store.listMessages(userId, "web").length, 2);
  assert.equal(store.countMessagesToday(userId), 1, "only the photographer's messages count");
  store.deleteAssistant(userId);
  assert.equal(store.getAssistant(userId), null);
  assert.equal(store.listMessages(userId, "web").length, 0);
});

test("store: an attachment whose photo is gone vanishes from the message; bad JSON is empty", () => {
  const m = store.addMessage(userId, "web", "user", "look", [{ photoId: "deleted-photo", variant: "original" }]);
  assert.deepEqual(m.attachments, []);
  db.prepare("UPDATE assistant_messages SET attachments_json = 'not json' WHERE id = ?").run(m.id);
  assert.deepEqual(store.listMessages(userId, "web").find((x) => x.id === m.id).attachments, []);
  store.clearConversation(userId, "web");
});

test("store: clearing a conversation cancels whatever was pending", async () => {
  const config = parseAssistantConfig({});
  await toolNamed(config, "add_booking").run({ date: "2027-01-09", parts: ["morning"], label: "Pending" }, ctxFor(config, "m14"));
  assert.ok(store.getPendingAction(userId, "web"));
  store.clearConversation(userId, "web");
  assert.equal(store.getPendingAction(userId, "web"), null);
  assert.equal(store.listMessages(userId, "web").length, 0);
});

// --- workflow ---------------------------------------------------------------

test("workflow: tiers follow the route, human time is billed in blocks", () => {
  const { tierFor, humanCost } = catalog;
  assert.deepEqual([tierFor("site"), tierFor("ai_service"), tierFor("human"), tierFor("engineering")], [0, 1, 2, 3]);
  assert.equal(humanCost(0), 0);
  assert.equal(humanCost(5), 10, "a 15-minute minimum at $40/h");
  assert.equal(humanCost(15), 10);
  assert.equal(humanCost(16), 20, "rounded up to the next block");
  assert.equal(humanCost(60), 40);
});

const flat = (low, high, extra = {}) => ({ unit: "flat", unitLow: low, unitHigh: high, quantity: 1, basis: "", options: [], unknown: false, roadblock: "", ...extra });
const estimateStep = (index, humanMinutes, cost, time, alternative = null) => ({ index, humanMinutes, cost, time, alternative });
const screenOf = (steps, extra = {}) => ({ reasonable: true, reason: "r", steps, verifyExpense: false, expenseReason: "", briefLines: [], skillsToEnable: [], ...extra });
const screenStep = (title, route, extra = {}) => ({ title, detail: "", route, integration: "none", specialty: "none", uses: [], alternative: null, ...extra });

test("workflow: the report is built from the screen and the estimate, with totals and the budget flag", () => {
  const { buildReport, estimatedSeconds } = catalog;
  const screen = screenOf(
    [
      screenStep("Read the shoot date", "site", { uses: ["scheduling"] }),
      screenStep("Order five cameras", "human"),
      screenStep("Text you when they arrive", "engineering"),
    ],
    { reason: "Cameras delivered to the venue on the day." },
  );
  assert.ok(estimatedSeconds(screen) >= 3 && estimatedSeconds(screen) <= 60);
  const estimate = {
    steps: [
      estimateStep(0, 0, flat(0, 0), { kind: "estimate", estimate: "seconds" }),
      estimateStep(1, 20, { unit: "per_item", unitLow: 12, unitHigh: 18, quantity: 5, basis: "5-packs online", options: [{ label: "Fujifilm QuickSnap 5-pack", priceUsd: 90 }], unknown: false, roadblock: "" }, { kind: "estimate", estimate: "2–4 days" }),
      estimateStep(2, 0, flat(0, 0, { unknown: true, roadblock: "Depends on the texting provider." }), { kind: "estimate", estimate: "a week" }),
    ],
    briefLines: ["When I ask about a shoot, tell me its date and venue."],
    skillsToEnable: ["scheduling"],
  };
  const report = buildReport(screen, estimate);
  assert.equal(report.reasonable, true);
  assert.deepEqual(report.steps.map((s) => s.tier), [0, 2, 3]);
  assert.equal(report.steps[1].humanCost, 20, "20 minutes → two blocks");
  assert.equal(report.steps[1].cost.low, 60, "5 × $12, multiplied in code");
  assert.equal(report.steps[1].cost.high, 90);
  assert.equal(report.steps[2].humanMinutes, 0, "engineering is not priced — no team time either");
  assert.equal(report.steps[2].cost.unknown, false, "and not a roadblock: it simply needs the developers");
  assert.equal(report.steps[2].time.kind, "engineering");
  assert.deepEqual([report.totals.low, report.totals.high, report.totals.unknownSteps, report.totals.overBudget], [80, 110, 0, true]);

  const echo = buildReport({ reasonable: false, reason: "That would defraud your customers.", steps: [] }, null);
  assert.equal(echo.reasonable, false);
  assert.deepEqual(echo.steps, []);
});

test("workflow: the doable part folds into skills and brief; a stale old-shaped plan is dropped", () => {
  const { applyWorkflowReport, buildReport } = catalog;
  const config = parseAssistantConfig({ skills: { lookup: { enabled: false }, photos: { enabled: false } }, brief: "Never book Sundays." });
  const report = buildReport(
    screenOf([screenStep("Look up the venue", "site", { uses: ["lookup"] })], { briefLines: ["Never book Sundays.", "Look up the venue when I ask."], skillsToEnable: ["lookup"] }),
    { steps: [estimateStep(0, 0, flat(0, 0), { kind: "estimate", estimate: "moments" })], briefLines: ["Never book Sundays.", "Look up the venue when I ask."], skillsToEnable: ["lookup"] },
  );
  const next = applyWorkflowReport(config, report);
  assert.equal(next.skills.lookup.enabled, true);
  assert.equal(next.skills.photos.enabled, false, "only what the plan needs is switched on");
  assert.equal(next.brief, "Never book Sundays.\nLook up the venue when I ask.", "a line already there is not repeated");
  assert.equal(parseAssistantConfig({ workflow: { plan: { steps: [] } } }).workflow, null, "the first planner's shape is forgotten");
});

test("workflow: a step the photographer does is tier 0 and free; an old report without unit fields still parses", () => {
  const { buildReport, WorkflowReportSchema } = catalog;
  const report = buildReport(
    screenOf([screenStep("Pick the brand", "self")]),
    { steps: [estimateStep(0, 30, flat(5, 9), { kind: "human", estimate: "" })], briefLines: [], skillsToEnable: [] },
  );
  assert.deepEqual([report.steps[0].tier, report.steps[0].humanCost, report.steps[0].cost.high], [0, 0, 0]);
  const old = WorkflowReportSchema.safeParse({
    reasonable: true, reason: "r",
    steps: [{ title: "t", detail: "", route: "human", uses: [], tier: 2, humanMinutes: 15, humanCost: 10, cost: { low: 1, high: 2, basis: "", options: [], unknown: false, roadblock: "" }, time: { kind: "human", estimate: "" } }],
    totals: { low: 11, high: 12, unknownSteps: 0, overBudget: false }, briefLines: [], skillsToEnable: [],
  });
  assert.ok(old.success);
  assert.equal(old.data.steps[0].cost.unit, "flat");
  assert.equal(old.data.steps[0].specialty, "none");
});

test("workflow: the decision comes from the four flags alone; a flagged request keeps no steps", () => {
  const { screenFromOutput } = catalog;
  const base = { concernReason: "", summary: "s", steps: [screenStep("x", "engineering")], briefLines: [], skillsToEnable: [], alternatives: [] };
  const fine = screenFromOutput({ ...base, concerns: { illegal: false, unethical: false, absurd: false, obviouslyExpensive: false } });
  assert.equal(fine.reasonable, true, "needing the developers is never a concern");
  assert.equal(fine.steps.length, 1);
  const bad = screenFromOutput({ ...base, concerns: { illegal: true, unethical: false, absurd: false, obviouslyExpensive: false }, concernReason: "Fraud." });
  assert.equal(bad.reasonable, false);
  assert.equal(bad.reason, "Fraud.");
  assert.deepEqual(bad.steps, [], "no breakdown for a refused request");
  const dear = screenFromOutput({ ...base, concerns: { illegal: false, unethical: false, absurd: false, obviouslyExpensive: true }, concernReason: "Thousands." });
  assert.equal(dear.reasonable, true, "expense alone is verified by the estimate");
  assert.equal(dear.verifyExpense, true);
});

test("workflow: 'obviously expensive' is verified by the estimate's total, not taken on trust", () => {
  const { buildReport, PROHIBITIVE_USD } = catalog;
  const screen = screenOf([screenStep("Hire staff", "human")], { verifyExpense: true, expenseReason: "Staff for weeks." });
  const cheap = buildReport(screen, { steps: [estimateStep(0, 60, flat(100, 200), { kind: "human", estimate: "" })], briefLines: [], skillsToEnable: [] });
  assert.equal(cheap.reasonable, true, "the model's guess was wrong; the figure decides");
  const dear = buildReport(screen, { steps: [estimateStep(0, 60, flat(PROHIBITIVE_USD, PROHIBITIVE_USD * 2), { kind: "human", estimate: "" })], briefLines: [], skillsToEnable: [] });
  assert.equal(dear.reasonable, false);
  assert.match(dear.reason, /Staff for weeks\. Roughly \$/);
});

test("workflow: the model's output is read tolerantly — names become ids, oddities get defaults", () => {
  const { WorkflowScreenOutputLenient, StepEstimateLenient } = catalog;
  const screen = WorkflowScreenOutputLenient.parse({
    concerns: { illegal: "no" },
    summary: 42,
    steps: [{ title: "Book it", route: "Assistant", uses: ["Scheduling", "nonsense"] }, "garbage", { route: "Support ticket" }],
    skillsToEnable: ["Photo touch-up", "look"],
  });
  assert.deepEqual(screen.concerns, { illegal: false, unethical: false, absurd: false, obviouslyExpensive: false });
  assert.equal(screen.summary, "");
  assert.deepEqual(screen.steps.map((s) => [s.title, s.route, s.uses]), [["Book it", "site", ["scheduling"]], ["Step", "human", []], ["Step", "engineering", []]]);
  assert.deepEqual(screen.skillsToEnable, ["photos", "lookup"]);
  const estimate = StepEstimateLenient.parse({ humanMinutes: "20", cost: { unit: "cameras", unitLow: "19", unitHigh: 22, quantity: 5, options: [{ label: "", priceUsd: 1 }, { label: "Kodak", priceUsd: "95" }] }, time: { kind: "Human" } });
  assert.equal(estimate.humanMinutes, 20);
  assert.deepEqual([estimate.cost.unit, estimate.cost.unitLow, estimate.cost.options.length, estimate.time.kind], ["per_item", 19, 1, "human"]);
});

test("dev tiers: the cost readout, the countdown factor, and the code gate", async () => {
  const { usageCost, addUsage, estimatedSeconds, TIER_INFO, ANALYSIS_TIERS, MODEL_PRICES } = catalog;
  const { isValidDevCode, resolveTier, devCodeConfigured } = await import("@/lib/assistant/devAccess");
  const [cheapest] = Object.entries(MODEL_PRICES).sort((a, b) => a[1].input - b[1].input)[0];
  assert.equal(usageCost(cheapest, 1_000_000, 0, 0), MODEL_PRICES[cheapest].input, "a million input tokens at list price");
  assert.equal(usageCost(cheapest, 0, 0, 3), 0.03, "a cent a search");
  const sum = addUsage(
    { tier: "standard", model: "m", inputTokens: 1, outputTokens: 2, searches: 1, costUsd: 0.01, chargedCents: 1 },
    { tier: "standard", model: "m", inputTokens: 3, outputTokens: 4, searches: 0, costUsd: 0.02, chargedCents: 2 },
  );
  assert.deepEqual([sum.inputTokens, sum.outputTokens, sum.searches, sum.costUsd, sum.chargedCents], [4, 6, 1, 0.03, 3]);
  const screen = screenOf([screenStep("Buy", "service", { integration: "amazon" }), screenStep("Ask", "human")]);
  assert.ok(estimatedSeconds(screen, "thorough") > estimatedSeconds(screen, "standard"), "bigger models take longer");
  assert.deepEqual(Object.keys(TIER_INFO), [...ANALYSIS_TIERS]);

  assert.equal(devCodeConfigured(), false);
  assert.equal(isValidDevCode("anything"), false, "no code configured: nothing is valid");
  assert.deepEqual(resolveTier({ tier: "standard" }), { tier: "standard" });
  process.env.ANALYSIS_DEV_CODE = "s3cret";
  assert.equal(isValidDevCode("s3cret"), true);
  assert.equal(isValidDevCode("s3cre"), false);
  assert.equal(resolveTier({ tier: "balanced" }).status, 403);
  assert.deepEqual(resolveTier({ tier: "balanced", devCode: "s3cret" }), { tier: "balanced" });
  assert.deepEqual(resolveTier({ tier: "nonsense", devCode: "wrong" }), { tier: "standard" }, "an unknown tier is Standard, which needs no code");
  delete process.env.ANALYSIS_DEV_CODE;
});

test("billing: cents round up, the ledger is idempotent on reference, charges follow billing being on", async () => {
  const { costToCents, addLedgerEntry, balanceCents, chargeAnalysis, billingEnabled, canAffordRun, billingStatus } = await import("@/lib/billing");
  assert.deepEqual([costToCents(0), costToCents(0.001), costToCents(0.05), costToCents(0.0512)], [0, 1, 5, 6]);
  assert.equal(billingEnabled(), false);
  const usage = { tier: "standard", model: "m", inputTokens: 0, outputTokens: 0, searches: 0, costUsd: 0.0312, chargedCents: 0 };
  assert.equal(chargeAnalysis(userId, usage, "Test"), 0, "billing off: nothing charged");
  assert.equal(canAffordRun(userId), true);

  process.env.STRIPE_SECRET_KEY = "sk_test_fake";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_fake";
  assert.equal(billingEnabled(), true);
  assert.equal(canAffordRun(userId), false, "no credit yet");
  assert.ok(addLedgerEntry({ userId, kind: "topup", amountCents: 500, description: "Top-up", reference: "stripe:cs_1" }));
  assert.equal(addLedgerEntry({ userId, kind: "topup", amountCents: 500, description: "Top-up", reference: "stripe:cs_1" }), null, "a retried webhook credits nothing");
  assert.equal(balanceCents(userId), 500);
  assert.equal(chargeAnalysis(userId, usage, "Test"), 4);
  assert.equal(balanceCents(userId), 496);
  assert.deepEqual(billingStatus(userId), { enabled: true, balanceCents: 496, minimumCents: 5 });
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_WEBHOOK_SECRET;
});

test("backends: service steps tier by backend, are priced without team time, and are read tolerantly", () => {
  const { tierFor, buildReport, WorkflowScreenOutputLenient, normaliseIntegration, INTEGRATIONS } = catalog;
  assert.equal(tierFor("service", "amazon"), 1);
  assert.equal(tierFor("service", "comms"), 1);
  assert.equal(tierFor("service", "fiverr"), 2);
  assert.equal(tierFor("service", "taskrabbit"), 2);
  assert.equal(tierFor("service"), 1, "a backend step with no named backend is still a service");
  assert.deepEqual(
    ["Amazon Same-Day", "text me", "Fiverr artist", "TaskRabbit errand", "Stripe invoice", "every 15 minutes", "S3 bucket", "Instacart", "???"].map(normaliseIntegration),
    ["amazon", "comms", "fiverr", "taskrabbit", "payments", "automation", "aws", "instacart", "none"],
  );
  assert.ok(Object.values(INTEGRATIONS).every((i) => i.example && i.covers));

  const screen = WorkflowScreenOutputLenient.parse({
    concerns: {},
    summary: "s",
    steps: [
      { title: "Order water", detail: "Two cases to the venue (beta)", route: "Amazon", uses: [] },
      { title: "Text updates", detail: "", route: "engineering", integration: "comms", uses: [] },
      { title: "Watch the forecast", detail: "checks every 15 minutes", route: "service", uses: [] },
    ],
  });
  assert.deepEqual(screen.steps.map((s) => [s.route, s.integration]), [["service", "amazon"], ["service", "comms"], ["service", "automation"]], "a backend named anywhere makes it a service step");

  const report = buildReport(screenOf(screen.steps.map((s) => ({ ...s, alternative: null }))), {
    steps: [
      estimateStep(0, 30, { unit: "per_item", unitLow: 8, unitHigh: 12, quantity: 2, basis: "", options: [], unknown: false, roadblock: "" }, { kind: "human", estimate: "" }),
      estimateStep(1, 0, { unit: "per_item", unitLow: 0.01, unitHigh: 0.01, quantity: 30, basis: "", options: [], unknown: false, roadblock: "" }, { kind: "estimate", estimate: "seconds each" }),
      estimateStep(2, 0, flat(0, 0), { kind: "estimate", estimate: "as it happens" }),
    ],
    briefLines: [],
    skillsToEnable: [],
  });
  assert.deepEqual(report.steps.map((s) => s.tier), [1, 1, 1]);
  assert.equal(report.steps[0].humanCost, 0, "a backend step bills no team time, whatever the model said");
  assert.deepEqual([report.steps[0].cost.low, report.steps[0].cost.high], [16, 24]);
  assert.equal(report.steps[0].time.kind, "estimate", "a backend step always has its own timeframe");
  assert.equal(report.steps[0].time.estimate, "depends on the vendor");
  assert.equal(report.steps[1].cost.high, 0.3);
  assert.equal(report.totals.high, 24.3);
});

test("pricing: only steps without a tariff need the model; table steps and free steps need no call", () => {
  const { needsPricing, tablePrice, estimatedSeconds } = catalog;
  const s = (route, integration = "none") => ({ route, integration });
  assert.equal(needsPricing(s("service", "amazon")), true);
  assert.equal(needsPricing(s("service", "fiverr")), true);
  assert.equal(needsPricing(s("service", "comms")), false, "texts have a tariff");
  assert.equal(needsPricing(s("service", "automation")), false);
  assert.equal(needsPricing(s("service", "payments")), false);
  assert.equal(needsPricing(s("human")), true);
  assert.equal(needsPricing(s("ai_service")), true);
  assert.equal(needsPricing(s("site")), false);
  assert.equal(needsPricing(s("self")), false);
  assert.equal(needsPricing(s("engineering")), false);

  const texts = tablePrice("comms");
  assert.equal(texts.cost.unitLow, 0.01);
  assert.equal(texts.cost.quantity, 30);
  assert.equal(texts.time.kind, "estimate");
  assert.equal(tablePrice("amazon"), null);
  assert.equal(tablePrice("instacart"), null, "Instacart is priced by the model — store prices vary");
  assert.equal(tablePrice("none"), null);

  assert.equal(estimatedSeconds(screenOf([s("service", "comms"), s("site")])), 3, "nothing to price: near-instant");
  const one = estimatedSeconds(screenOf([s("service", "amazon")]));
  const three = estimatedSeconds(screenOf([s("service", "amazon"), s("human"), s("ai_service")]));
  assert.ok(one >= 8 && three > one && three <= 45, `parallel pricing grows slowly: ${one}s, ${three}s`);
});

test("recommendations: a faster or cheaper backend is attached to its step, priced on its own, and can be taken", () => {
  const { INTEGRATIONS, normaliseIntegration, WorkflowScreenOutputLenient, screenFromOutput, buildReport, applyRecommendation, estimatedSeconds, tablePrice, WorkflowReportSchema } = catalog;
  assert.equal(INTEGRATIONS.instacart.tier, 1);
  assert.equal(normaliseIntegration("Instacart from a local store"), "instacart");

  const output = WorkflowScreenOutputLenient.parse({
    concerns: {},
    summary: "Water to the venue.",
    steps: [
      { title: "Order two cases of water", detail: "Through Amazon (beta).", route: "service", integration: "amazon", uses: [] },
      { title: "Text updates", detail: "", route: "service", integration: "comms", uses: [] },
      { title: "Pick the brand", detail: "", route: "self", integration: "none", uses: [] },
    ],
    alternatives: [
      { stepIndex: 0, integration: "Instacart", gain: "Faster", detail: "Two cases from a nearby store through Instacart (beta).", tradeoff: "usually a few dollars more" },
      { stepIndex: 1, integration: "comms", gain: "cheaper", detail: "same", tradeoff: "" },
      { stepIndex: 2, integration: "taskrabbit", gain: "faster", detail: "x", tradeoff: "" },
      { stepIndex: 9, integration: "amazon", gain: "faster", detail: "x", tradeoff: "" },
      "garbage",
    ],
  });
  const screen = screenFromOutput(output);
  assert.deepEqual(screen.steps.map((s) => s.alternative?.integration ?? null), ["instacart", null, null], "the same backend, the photographer's own step and a step that does not exist get nothing");
  assert.equal(screen.steps[0].alternative.gain, "faster");
  const plain = { ...screen, steps: screen.steps.map((s) => ({ ...s, alternative: null })) };
  assert.ok(estimatedSeconds(screen) > estimatedSeconds(plain), "the alternative is priced too, so the countdown allows for it");

  const water = { humanMinutes: 0, cost: { unit: "per_item", unitLow: 8, unitHigh: 12, quantity: 2, basis: "", options: [], unknown: false, roadblock: "" }, time: { kind: "estimate", estimate: "2–4 hours" } };
  const instacart = { humanMinutes: 0, cost: { unit: "per_item", unitLow: 10, unitHigh: 14, quantity: 2, basis: "store price plus fees", options: [], unknown: false, roadblock: "" }, time: { kind: "human", estimate: "about an hour" } };
  const free = { humanMinutes: 0, cost: flat(0, 0), time: { kind: "estimate", estimate: "a minute" } };
  const estimate = (alternative) => ({ steps: [{ index: 0, ...water, alternative }, { index: 1, ...tablePrice("comms"), alternative: null }, { index: 2, ...free, alternative: null }], briefLines: [], skillsToEnable: [] });

  const report = buildReport(screen, estimate(instacart));
  const rec = report.steps[0].recommendation;
  assert.equal(rec.integration, "instacart");
  assert.deepEqual([rec.cost.low, rec.cost.high], [20, 28], "multiplied in code like any step");
  assert.equal(rec.time.kind, "estimate", "a backend option always has a timeframe, whatever the model said");
  assert.equal(rec.tier, 1);
  assert.equal(report.steps[1].recommendation, null);
  assert.deepEqual([report.totals.low, report.totals.high], [16.3, 24.3], "the option is not in the totals until taken");
  assert.ok(WorkflowReportSchema.safeParse(report).success);

  const taken = applyRecommendation(report, 0);
  assert.deepEqual([taken.steps[0].integration, taken.steps[0].route, taken.steps[0].recommendation, taken.steps[0].time.estimate], ["instacart", "service", null, "about an hour"]);
  assert.equal(taken.steps[0].detail, "Two cases from a nearby store through Instacart (beta).");
  assert.deepEqual([taken.totals.low, taken.totals.high], [20.3, 28.3], "the totals follow");
  assert.equal(applyRecommendation(report, 1), report, "nothing to take: the same report");
  assert.equal(report.steps[0].integration, "amazon", "the original report is untouched");
  assert.equal(buildReport(screen, estimate(null)).steps[0].recommendation.cost.unknown, true, "an option whose pricing failed is still shown, as unknown");
  const old = WorkflowReportSchema.parse({ ...report, steps: report.steps.map(({ recommendation: _r, ...s }) => s) });
  assert.equal(old.steps[0].recommendation, null, "a report from before recommendations existed still loads");
});

test("specialities: the lists are sound, a step names one, names are read tolerantly, the page shows at most four", () => {
  const { SPECIALTIES, specialtiesOf, featuredSpecialties, normaliseSpecialty, serviceLabel, WorkflowScreenOutputLenient, screenFromOutput, buildReport, applyRecommendation, WorkflowReportSchema, WorkflowScreenSchema } = catalog;
  assert.equal(new Set(SPECIALTIES.map((s) => s.id)).size, SPECIALTIES.length, "ids are unique");
  for (const s of SPECIALTIES) {
    assert.ok(s.id.startsWith(`${s.integration}.`), `${s.id} is filed under its backend`);
    assert.ok(s.name && s.covers && s.typical, `${s.id} is complete`);
  }
  for (const id of ["amazon", "aws", "fiverr", "taskrabbit"]) {
    assert.ok(specialtiesOf(id).length >= 7, `${id} has a real list`);
    const shown = featuredSpecialties(id);
    assert.ok(shown.length >= 3 && shown.length <= 4, `${id} shows three or four: ${shown.length}`);
  }
  assert.equal(specialtiesOf("comms").length, 0, "texts need no sub-list");
  assert.equal(featuredSpecialties("instacart").length, 0);

  assert.equal(normaliseSpecialty("fiverr.wedding_video_editing"), "fiverr.wedding_video_editing");
  assert.equal(normaliseSpecialty("fiverr/wedding-video-editing"), "fiverr.wedding_video_editing");
  assert.equal(normaliseSpecialty("Wedding video editing"), "fiverr.wedding_video_editing");
  assert.equal(normaliseSpecialty("wait for delivery"), "taskrabbit.wait");
  assert.equal(normaliseSpecialty("Rekognition"), "aws.rekognition");
  assert.equal(normaliseSpecialty("Amazon Prints"), "amazon.prints");
  assert.deepEqual(["none", undefined, "", "xyzzy", "s"].map(normaliseSpecialty), ["none", "none", "none", "none", "none"]);

  const output = WorkflowScreenOutputLenient.parse({
    concerns: {},
    summary: "s",
    steps: [
      { title: "Edit the film", detail: "", route: "service", integration: "fiverr", specialty: "Wedding video editing", uses: [] },
      { title: "Receive the parcel", detail: "", route: "human", integration: "none", specialty: "taskrabbit.wait", uses: [] },
      { title: "Text me", detail: "", route: "service", integration: "comms", specialty: "fiverr.retouching", uses: [] },
      { title: "Pick the brand", detail: "", route: "self", uses: [] },
    ],
    alternatives: [{ stepIndex: 0, integration: "none", specialty: "MediaConvert", gain: "cheaper", detail: "Transcode it on AWS (beta).", tradeoff: "no human editing" }],
  });
  assert.deepEqual(
    output.steps.map((s) => [s.route, s.integration, s.specialty]),
    [["service", "fiverr", "fiverr.wedding_video_editing"], ["service", "taskrabbit", "taskrabbit.wait"], ["service", "fiverr", "fiverr.retouching"], ["self", "none", "none"]],
    "a speciality settles the route and the backend",
  );
  const screen = screenFromOutput(output);
  assert.deepEqual([screen.steps[0].alternative.integration, screen.steps[0].alternative.specialty], ["aws", "aws.mediaconvert"], "an alternative's speciality names its backend");
  assert.ok(WorkflowScreenSchema.safeParse(screen).success, "the stored screen parses");
  assert.equal(serviceLabel(screen.steps[0]), "Fiverr › Wedding video editing");
  assert.equal(serviceLabel({ route: "service", integration: "comms", specialty: "none" }), "SMS, email & calls");
  assert.equal(serviceLabel({ route: "service", integration: "amazon" }), "Amazon");
  assert.equal(serviceLabel({ route: "service", integration: "amazon", specialty: "amazon.prints" }), "Amazon Prints", "no doubled name");
  assert.equal(serviceLabel({ route: "human", integration: "none" }), "a person on the team");
  assert.equal(serviceLabel({ route: "service", integration: "amazon", specialty: "fiverr.retouching" }), "Amazon", "a speciality from another backend is ignored");

  const price = (low, high, time) => ({ humanMinutes: 0, cost: flat(low, high), time: { kind: "estimate", estimate: time } });
  const report = buildReport(screen, {
    steps: [
      { index: 0, ...price(100, 500, "a week"), alternative: price(1, 3, "an hour") },
      { index: 1, ...price(25, 50, "as booked"), alternative: null },
      { index: 2, ...price(5, 50, "a day"), alternative: null },
      { index: 3, ...price(0, 0, "a minute"), alternative: null },
    ],
    briefLines: [],
    skillsToEnable: [],
  });
  assert.equal(report.steps[0].specialty, "fiverr.wedding_video_editing");
  assert.equal(report.steps[3].specialty, "none");
  assert.equal(report.steps[0].recommendation.specialty, "aws.mediaconvert");
  const taken = applyRecommendation(report, 0);
  assert.deepEqual([taken.steps[0].integration, taken.steps[0].specialty], ["aws", "aws.mediaconvert"], "the speciality comes across with the swap");
  const strip = ({ specialty: _s, recommendation, ...s }) => ({ ...s, recommendation: recommendation ? (({ specialty: _r, ...rest }) => rest)(recommendation) : null });
  const old = WorkflowReportSchema.parse({ ...report, steps: report.steps.map(strip) });
  assert.equal(old.steps[0].specialty, "none", "a report from before specialities existed still loads");
  assert.equal(old.steps[0].recommendation.specialty, "none");
});

test("agent: the workflow snapshot is stored, its asks skip the photographer's steps, and the prompt carries the beta rules", () => {
  const { agentAsks, stepAvailability } = catalog;
  const cost = (low, high) => ({ low, high, unit: "flat", unitLow: low, unitHigh: high, quantity: 1, basis: "", options: [], unknown: false, roadblock: "" });
  const step = (title, route, extra = {}) => ({
    title, detail: `${title}.`, route, integration: "none", specialty: "none", uses: [], tier: 0, humanMinutes: 0, humanCost: 0,
    cost: cost(0, 0), time: { kind: "estimate", estimate: "moments" }, recommendation: null, ...extra,
  });
  const report = {
    reasonable: true,
    reason: "Water to the venue.",
    steps: [
      step("Read the shoot date", "site", { uses: ["scheduling"] }),
      step("Pick the brand", "self"),
      step("Order two cases of water", "service", { integration: "amazon", specialty: "amazon.delivery", tier: 1, cost: cost(16, 24), time: { kind: "estimate", estimate: "about an hour" } }),
      step("Text me updates", "service", { integration: "comms", tier: 1, cost: cost(0.3, 0.3), time: { kind: "estimate", estimate: "seconds per message" } }),
    ],
    totals: { low: 16.3, high: 24.3, unknownSteps: 0, overBudget: false },
    briefLines: ["When I ask about a shoot, tell me its date."],
    skillsToEnable: ["scheduling"],
  };
  const config = parseAssistantConfig({ agent: { description: "Water to the venue on a hot day", report, createdAt: "2026-09-16T00:00:00.000Z" } });
  assert.ok(config?.agent, "an agent snapshot parses");
  assert.deepEqual(agentAsks(config.agent), ["Read the shoot date", "Order two cases of water", "Text me updates"], "the photographer's own step is not an ask");
  assert.deepEqual(report.steps.map(stepAvailability), ["now", "yours", "later", "later"]);

  const base = { config, photographerName: "Jo", today: "2026-09-16", pending: null, attached: [] };
  const prompt = buildSystemPrompt({ ...base, agent: config.agent });
  assert.match(prompt, /AgentDex beta/);
  assert.match(prompt, /Water to the venue on a hot day/);
  assert.match(prompt, /1\. \[NOW\] Read the shoot date — the assistant; no direct cost; moments\./);
  assert.match(prompt, /2\. \[THEIRS\] Pick the brand/);
  assert.match(prompt, /3\. \[LATER\] Order two cases of water — Amazon › Same-Day & Prime delivery; about \$16–\$24; about an hour\./);
  assert.match(prompt, /You do NOT carry these out in this beta/);
  assert.match(prompt, /Never say it is done, ordered, booked, hired or sent/);
  assert.doesNotMatch(buildSystemPrompt(base), /AgentDex beta/, "the ordinary chat does not carry the workflow");
});

test("texting: numbers normalise, signatures verify, a code verifies a number once, and the prompt and tools follow", async () => {
  const { normalisePhone, maskPhone, trimForSms, twilioSignature, verifyTwilioSignature, SMS_MAX_CHARS } = await import("@/lib/sms");
  const sms = await import("@/lib/assistant/smsStore");
  assert.deepEqual(
    ["(555) 123-4567", "555.123.4567", "1 555 123 4567", "+44 7700 900123", "12345", "+0 123"].map((n) => normalisePhone(n)),
    ["+15551234567", "+15551234567", "+15551234567", "+447700900123", null, null],
  );
  assert.equal(maskPhone("+15551234567"), "+1 ••• 4567");
  assert.equal(maskPhone("+447700900123"), "+44 ••• 0123");
  assert.ok(trimForSms("word ".repeat(200)).length <= SMS_MAX_CHARS);
  assert.equal(trimForSms("short"), "short");

  const url = "https://oopsiblinked.com/api/sms/twilio";
  const params = { From: "+15551234567", Body: "hi", MessageSid: "SM1" };
  const sig = twilioSignature(url, params, "tok");
  assert.equal(verifyTwilioSignature(url, params, sig, "tok"), true);
  assert.equal(verifyTwilioSignature(url, params, sig, "other"), false, "a different token");
  assert.equal(verifyTwilioSignature(url, { ...params, Body: "hi!" }, sig, "tok"), false, "a changed field");
  assert.equal(verifyTwilioSignature(`${url}?x=1`, params, sig, "tok"), false, "a changed URL");
  assert.equal(verifyTwilioSignature(url, params, null, "tok"), false);

  assert.deepEqual(sms.smsStatus(userId), { number: null, verified: false, pending: false });
  const started = sms.startVerification(userId, "+15551234567");
  assert.equal(started.ok, true);
  assert.match(started.code, /^\d{6}$/);
  assert.equal(sms.smsStatus(userId).pending, true);
  assert.equal(sms.canText(userId), false, "not until the code comes back");
  assert.equal(sms.confirmVerification(userId, "000000").ok, false, "a wrong code");
  assert.equal(sms.confirmVerification(userId, started.code).ok, true);
  assert.equal(sms.canText(userId), true);
  assert.equal(sms.userIdForNumber("+15551234567"), userId);
  assert.equal(sms.userIdForNumber("+15550000000"), null);

  db.prepare(
    `INSERT INTO users (id, email, name, picture, provider, public_slug, created_at) VALUES ('user-2', 'two@example.com', 'Two', NULL, 'email', 'two', ?)`,
  ).run(new Date().toISOString());
  const taken = sms.startVerification("user-2", "+15551234567");
  assert.equal(taken.ok, false);
  assert.equal(taken.status, 409, "a verified number belongs to one account");
  for (let i = 0; i < 3; i++) assert.equal(sms.startVerification("user-2", "+15559876543").ok, true);
  const capped = sms.startVerification("user-2", "+15559876543");
  assert.equal(capped.ok, false);
  assert.equal(capped.status, 429, "three codes an hour");

  const again = sms.startVerification(userId, "+15551234567");
  assert.equal(again.ok, true, "re-verifying your own number is allowed");
  assert.equal(sms.canText(userId), false, "and it is unverified until the new code comes back");
  for (let i = 0; i < 5; i++) sms.confirmVerification(userId, "111111");
  assert.match(sms.confirmVerification(userId, again.code).error, /Too many/, "five wrong tries kill the code");

  assert.equal(sms.recordInbound("SM1", userId), true);
  assert.equal(sms.recordInbound("SM1", userId), false, "a redelivered webhook is not answered twice");
  sms.removeNumber(userId);
  assert.equal(sms.smsStatus(userId).number, null);

  const config = parseAssistantConfig({});
  const base = { config, photographerName: "Jo", today: "2026-09-17", pending: null, attached: [] };
  assert.match(buildSystemPrompt({ ...base, channel: "sms" }), /## Channel: text message/);
  assert.match(buildSystemPrompt({ ...base, channel: "sms" }), /already replying by text/);
  assert.match(buildSystemPrompt({ ...base, canText: true }), /send_text texts the photographer/);
  assert.match(buildSystemPrompt(base), /Texting is not set up/);
  assert.doesNotMatch(buildSystemPrompt(base), /## Channel: text message/);
  const withAgent = parseAssistantConfig({
    agent: { description: "d", report: { reasonable: true, reason: "r", steps: [], totals: { low: 0, high: 0, unknownSteps: 0, overBudget: false }, briefLines: [], skillsToEnable: [] }, createdAt: "2026-09-17T00:00:00.000Z" },
  });
  assert.match(buildSystemPrompt({ ...base, config: withAgent, agent: withAgent.agent, canText: true }), /a text to the photographer themselves is live through send_text/);
  assert.match(buildSystemPrompt({ ...base, config: withAgent, agent: withAgent.agent }), /even a text to the photographer stays LATER/);
  const names = (opts) => toolsFor(config, opts).map((t) => t.definition.name);
  assert.ok(names({ canText: true }).includes("send_text"));
  assert.ok(!names({}).includes("send_text"));
  assert.ok(!names().includes("send_text"));
});
