"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  LIMITS,
  SKILLS,
  STYLE_LABELS,
  STYLE_PRESETS,
  SUGGESTED_SKILLS,
  TONES,
  TONE_LABELS,
  currentUnderstanding,
  enabledSkillNames,
  understandingIsCurrent,
  type AssistantConfig,
  type SkillId,
  type Understanding,
  type UnderstandingItem,
} from "@/lib/assistant/catalog";
import { errorFrom, readBody } from "@/lib/clientApi";

const STEPS = ["Name & tone", "Skills", "Channels", "Try it"] as const;

const VERDICT: Record<UnderstandingItem["verdict"], { label: string; className: string }> = {
  feasible: { label: "yes", className: "bg-emerald-100 text-emerald-800" },
  partly: { label: "partly", className: "bg-amber-100 text-amber-800" },
  not_feasible: { label: "no", className: "bg-red-100 text-red-800" },
};

/** A small labelled skill chip: tap the label to select, the arrow to expand. */
function Chip({
  icon,
  label,
  selected,
  expanded,
  addable = false,
  onToggle,
  onExpand,
}: {
  icon: string;
  label: string;
  selected: boolean;
  expanded: boolean;
  /** Suggested skills show a "+" rather than a tick-style selection. */
  addable?: boolean;
  onToggle: () => void;
  onExpand: () => void;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full border text-sm ${
        selected ? "border-rose-600 bg-rose-50 text-rose-800" : "border-stone-300 bg-white text-stone-700"
      }`}
    >
      <button
        type="button"
        className="flex items-center gap-1.5 py-1 pl-3 pr-2"
        onClick={onToggle}
        aria-pressed={selected}
      >
        <span aria-hidden>{icon}</span>
        {label}
        <span aria-hidden className="text-xs">
          {selected ? "✓" : addable ? "+" : ""}
        </span>
      </button>
      <button
        type="button"
        className="border-l border-inherit px-2 py-1 text-xs text-stone-500 hover:text-stone-800"
        aria-label={`About ${label}`}
        aria-expanded={expanded}
        onClick={onExpand}
      >
        {expanded ? "▲" : "▼"}
      </button>
    </span>
  );
}

/**
 * Create or edit a Smart Photographer.
 *
 * The Skills step is deliberately bare: a row of chips for the built-in
 * skills, a row of suggested ones, and one box for anything the photographer
 * wants added or changed — "the brief". The brief is checked against what
 * the assistant can actually do, item by item, so they know what they'll get.
 */
export default function AssistantSetup({
  initial,
  mode,
}: {
  initial: AssistantConfig;
  mode: "create" | "edit";
}) {
  const router = useRouter();
  const [config, setConfig] = useState<AssistantConfig>(initial);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState<null | "saving" | "checking">(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  /** Which chip's detail panel is open — a skill id or a suggested skill id. */
  const [expanded, setExpanded] = useState<string | null>(null);

  const update = (patch: Partial<AssistantConfig>) => setConfig((c) => ({ ...c, ...patch }));
  const updateSkill = <K extends SkillId>(id: K, patch: Partial<AssistantConfig["skills"][K]>) =>
    setConfig((c) => ({ ...c, skills: { ...c.skills, [id]: { ...c.skills[id], ...patch } } }));

  const briefHas = (text: string) => config.brief.includes(text);
  const addToBrief = (text: string) => {
    if (briefHas(text)) return;
    const current = config.brief.trim();
    update({ brief: current ? `${current}\n${text}` : text });
  };
  const removeFromBrief = (text: string) =>
    update({ brief: config.brief.split("\n").filter((line) => line.trim() !== text).join("\n") });

  /**
   * Ask the server to read the brief and check it. Returns the result, "skip"
   * when the server has no AI key (saving goes ahead without a check), or
   * null on an error that has been shown.
   */
  async function check(): Promise<Understanding | "skip" | null> {
    setBusy("checking");
    setError(null);
    const res = await fetch("/api/assistant/skills/assess", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        brief: config.brief,
        skillsOn: SKILLS.filter((s) => config.skills[s.id].enabled).map((s) => s.name),
      }),
    });
    setBusy(null);
    if (res.status === 503) return "skip";
    if (!res.ok) {
      setError(await errorFrom(res));
      return null;
    }
    const body = await readBody<{ understanding: Understanding }>(res);
    if (!body.understanding) return null;
    setConfig((c) => ({ ...c, understanding: body.understanding! }));
    return body.understanding;
  }

  async function save() {
    setError(null);
    let next = config;
    // A brief that changed since it was last checked is checked on the way out,
    // so the photographer always sees what they will get.
    if (config.brief.trim().length >= 5 && !understandingIsCurrent(config)) {
      const result = await check();
      if (result === null) return;
      if (result !== "skip") next = { ...config, understanding: result };
    }
    setBusy("saving");
    const res = await fetch("/api/assistant", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(next),
    });
    setBusy(null);
    if (!res.ok) {
      setError(await errorFrom(res));
      return;
    }
    router.push("/assistant");
    router.refresh();
  }

  async function remove() {
    setBusy("saving");
    const res = await fetch("/api/assistant", { method: "DELETE" });
    setBusy(null);
    if (!res.ok) {
      setError(await errorFrom(res));
      return;
    }
    router.push("/");
    router.refresh();
  }

  const expandedSkill = SKILLS.find((s) => s.id === expanded);
  const expandedSuggested = SUGGESTED_SKILLS.find((s) => s.id === expanded);
  const items = currentUnderstanding(config);
  const briefChecked = understandingIsCurrent(config);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">
          {mode === "create" ? "Create your Smart Photographer" : "Smart Photographer settings"}
        </h1>
        <p className="mt-1 text-sm text-stone-600">
          An assistant that knows your calendar and your photos, and works the way you tell it to.
        </p>
      </div>

      {/* Step bar — clickable, so nothing is locked behind "Next". */}
      <ol className="flex flex-wrap gap-2 text-sm">
        {STEPS.map((label, i) => (
          <li key={label}>
            <button
              type="button"
              onClick={() => setStep(i)}
              className={`rounded-full px-3 py-1 ${
                i === step ? "bg-rose-600 text-white" : "bg-stone-200 text-stone-700 hover:bg-stone-300"
              }`}
            >
              {i + 1}. {label}
            </button>
          </li>
        ))}
      </ol>

      {step === 0 && (
        <section className="card space-y-4">
          <div>
            <label className="label" htmlFor="assistant-name">
              Name
            </label>
            <input
              id="assistant-name"
              className="input max-w-sm"
              value={config.name}
              maxLength={LIMITS.name}
              onChange={(e) => update({ name: e.target.value })}
            />
          </div>

          <fieldset>
            <legend className="label">How it talks</legend>
            <div className="space-y-2 text-sm">
              {TONES.map((tone) => (
                <label key={tone} className="flex items-start gap-2">
                  <input
                    type="radio"
                    name="tone"
                    className="mt-1"
                    checked={config.tone === tone}
                    onChange={() => update({ tone })}
                  />
                  <span>
                    <span className="font-medium">{TONE_LABELS[tone].label}</span>{" "}
                    <span className="text-stone-600">— {TONE_LABELS[tone].hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <div>
            <label className="label" htmlFor="instructions">
              Standing instructions
            </label>
            <textarea
              id="instructions"
              className="input min-h-24"
              placeholder="e.g. Clients call me Jo. Never book me on a Sunday. My second shooter is Sam — mention her when relevant."
              value={config.instructions}
              maxLength={LIMITS.instructions}
              onChange={(e) => update({ instructions: e.target.value })}
            />
            <p className="mt-1 text-xs text-stone-500">Followed in everything it does, across every skill.</p>
          </div>
        </section>
      )}

      {step === 1 && (
        <section className="space-y-4">
          <div className="space-y-2">
            <p className="text-sm text-stone-600">Pick what it can do. The arrow shows what each one covers.</p>
            <div className="flex flex-wrap gap-2">
              {SKILLS.map((skill) => (
                <Chip
                  key={skill.id}
                  icon={skill.icon}
                  label={skill.name}
                  selected={config.skills[skill.id].enabled}
                  expanded={expanded === skill.id}
                  onToggle={() => updateSkill(skill.id, { enabled: !config.skills[skill.id].enabled })}
                  onExpand={() => setExpanded(expanded === skill.id ? null : skill.id)}
                />
              ))}
            </div>

            {expandedSkill && (
              <div className="card space-y-3 text-sm">
                <p className="text-stone-700">{expandedSkill.does}</p>
                <ul className="list-disc pl-5 text-stone-600">
                  {expandedSkill.supports.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>

                {expandedSkill.id === "scheduling" && (
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={config.skills.scheduling.canBook}
                      onChange={(e) => updateSkill("scheduling", { canBook: e.target.checked })}
                    />
                    May add and remove bookings (always asks first)
                  </label>
                )}
                {expandedSkill.id === "photos" && (
                  <div className="flex flex-wrap items-center gap-4">
                    <label className="flex items-center gap-2">
                      Default style
                      <select
                        className="input w-auto"
                        value={config.skills.photos.style}
                        onChange={(e) =>
                          updateSkill("photos", {
                            style: e.target.value as AssistantConfig["skills"]["photos"]["style"],
                          })
                        }
                      >
                        {STYLE_PRESETS.map((preset) => (
                          <option key={preset} value={preset}>
                            {STYLE_LABELS[preset].label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={config.skills.photos.allowCrop}
                        onChange={(e) => updateSkill("photos", { allowCrop: e.target.checked })}
                      />
                      May crop
                    </label>
                  </div>
                )}

                <p className="text-xs text-stone-500">
                  To change it, write in the box below — for example “{expandedSkill.example}”{" "}
                  <button
                    type="button"
                    className="underline hover:text-stone-800"
                    onClick={() => addToBrief(expandedSkill.example)}
                  >
                    add this
                  </button>
                </p>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <p className="text-sm text-stone-600">Suggested — tap one to add it to your brief:</p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTED_SKILLS.map((skill) => (
                <Chip
                  key={skill.id}
                  icon={skill.icon}
                  label={skill.name}
                  selected={briefHas(skill.template)}
                  expanded={expanded === skill.id}
                  addable
                  onToggle={() =>
                    briefHas(skill.template) ? removeFromBrief(skill.template) : addToBrief(skill.template)
                  }
                  onExpand={() => setExpanded(expanded === skill.id ? null : skill.id)}
                />
              ))}
            </div>
            {expandedSuggested && (
              <div className="card space-y-2 text-sm">
                <p className="text-stone-700">{expandedSuggested.hint}</p>
                <p className="text-stone-600">Adds to your brief: “{expandedSuggested.template}”</p>
              </div>
            )}
          </div>

          <div className="card space-y-3">
            <label className="label" htmlFor="brief">
              Anything else? Change how a skill works, or describe a new one.
            </label>
            <textarea
              id="brief"
              className="input min-h-32"
              placeholder={
                "e.g. Don't offer any date within two days of a lunar eclipse.\n" +
                "Negotiate: when an enquiry mentions price, check what others in my area charge and tell me how I compare."
              }
              value={config.brief}
              maxLength={LIMITS.brief}
              onChange={(e) => update({ brief: e.target.value })}
            />
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                className="btn-secondary"
                onClick={check}
                disabled={busy !== null || config.brief.trim().length < 5 || briefChecked}
              >
                {busy === "checking" ? "Checking…" : briefChecked ? "Checked" : "Check what's possible"}
              </button>
              <span className="text-xs text-stone-500">
                {config.brief.trim().length < 5
                  ? "Checked against what the assistant can actually do."
                  : briefChecked
                    ? "Checked against what the assistant can actually do."
                    : "Changed since it was last checked — it's checked again when you save."}
              </span>
            </div>

            {items.length > 0 && (
              <ul className="space-y-2 text-sm">
                {items.map((item, i) => (
                  <li key={`${item.title}-${i}`} className="flex flex-wrap items-baseline gap-2">
                    <span className={`badge ${VERDICT[item.verdict].className}`}>{VERDICT[item.verdict].label}</span>
                    <span className="font-medium">{item.title}</span>
                    <span className="text-stone-500">
                      {item.kind === "change"
                        ? `changes ${SKILLS.find((s) => s.id === item.skill)?.name ?? "a skill"}`
                        : "new skill"}
                    </span>
                    <span className="basis-full text-stone-600">
                      {item.summary}
                      {item.cannotDo.length > 0 && ` Can't: ${item.cannotDo.join("; ")}.`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {briefChecked && items.length === 0 && (
              <p className="text-sm text-stone-500">Nothing to act on in the brief.</p>
            )}
          </div>

          <p className="text-sm text-stone-600">
            Not sure what you need?{" "}
            <a href="/agentdex" className="font-medium text-rose-700 underline">
              Describe it in AgentDex
            </a>{" "}
            and get the steps, who does each one, a rough cost and a time.
          </p>
        </section>
      )}

      {step === 2 && (
        <section className="space-y-3">
          <div className="card">
            <h2 className="font-semibold">
              💬 In-app chat <span className="badge ml-2 bg-emerald-100 text-emerald-800">on</span>
            </h2>
            <p className="mt-1 text-sm text-stone-600">
              Talk to it on the Smart Photographer page and attach photos from your phone or computer.
              Everything you set up here is what it uses, on every channel.
            </p>
          </div>
          <div className="card opacity-70">
            <h2 className="font-semibold">
              📱 Text messages <span className="badge ml-2 bg-stone-200 text-stone-600">coming next</span>
            </h2>
            <p className="mt-1 text-sm text-stone-600">
              Text it a photo from a wedding and get the touched-up version back. Needs a verified
              business texting number (US carriers block unverified business texting), and it only
              answers a phone number you have verified here.
            </p>
          </div>
          <div className="card opacity-70">
            <h2 className="font-semibold">
              ✉️ Email <span className="badge ml-2 bg-stone-200 text-stone-600">later</span>
            </h2>
            <p className="mt-1 text-sm text-stone-600">Full-size photos, no carrier compression.</p>
          </div>
        </section>
      )}

      {step === 3 && (
        <section className="card space-y-3">
          <h2 className="text-lg font-semibold">{config.name || "Your assistant"} is ready to try</h2>
          <ul className="space-y-1 text-sm text-stone-700">
            <li>
              <span className="font-medium">Skills on:</span>{" "}
              {enabledSkillNames(config).join(", ") || "none yet — pick one in step 2"}
            </li>
            <li>
              <span className="font-medium">Tone:</span> {TONE_LABELS[config.tone].label}
            </li>
            {config.skills.photos.enabled && (
              <li>
                <span className="font-medium">Photo style:</span>{" "}
                {STYLE_LABELS[config.skills.photos.style].label}
              </li>
            )}
            {config.brief.trim() && (
              <li>
                <span className="font-medium">Your brief:</span>{" "}
                {briefChecked
                  ? items.length > 0
                    ? items.map((i) => `${i.title} (${VERDICT[i.verdict].label})`).join(", ")
                    : "checked"
                  : "checked when you finish"}
              </li>
            )}
          </ul>
          <p className="text-sm text-stone-600">
            Next you get a chat where you can ask it about your calendar or send it a photo — the
            same assistant, with the same settings, that would answer your texts later.
          </p>
          <button type="button" className="btn-primary" onClick={save} disabled={busy !== null}>
            {busy === "checking"
              ? "Checking your brief…"
              : busy === "saving"
                ? "Saving…"
                : mode === "create"
                  ? "Finish and start chatting"
                  : "Save and go to chat"}
          </button>
        </section>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex flex-wrap items-center gap-3">
        {step > 0 && (
          <button type="button" className="btn-secondary" onClick={() => setStep(step - 1)}>
            Back
          </button>
        )}
        {step < STEPS.length - 1 && (
          <button type="button" className="btn-primary" onClick={() => setStep(step + 1)}>
            Next
          </button>
        )}
        {mode === "edit" && step < STEPS.length - 1 && (
          <button type="button" className="btn-secondary" onClick={save} disabled={busy !== null}>
            {busy === "checking" ? "Checking…" : busy === "saving" ? "Saving…" : "Save changes"}
          </button>
        )}
        {mode === "edit" && (
          <span className="ml-auto">
            {confirmRemove ? (
              <span className="flex items-center gap-2 text-sm">
                <span className="text-stone-600">Remove it and its conversation?</span>
                <button type="button" className="btn-secondary" onClick={remove} disabled={busy !== null}>
                  Yes, remove
                </button>
                <button type="button" className="btn-secondary" onClick={() => setConfirmRemove(false)}>
                  Keep
                </button>
              </span>
            ) : (
              <button
                type="button"
                className="text-sm text-stone-500 underline hover:text-red-700"
                onClick={() => setConfirmRemove(true)}
              >
                Remove assistant
              </button>
            )}
          </span>
        )}
      </div>
    </div>
  );
}
