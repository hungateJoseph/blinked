"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import {
  ANALYSIS_TIERS,
  BUDGET_USD,
  COST_UNIT_LABELS,
  HUMAN_RATE_PER_HOUR,
  INTEGRATIONS,
  LIMITS,
  SKILLS,
  TIER_INFO,
  TIER_LABELS,
  applyRecommendation,
  applyWorkflowReport,
  serviceLabel,
  type AnalysisTier,
  type AnalysisUsage,
  type AssistantConfig,
  type ReportStep,
  type StoredWorkflow,
  type WorkflowScreen,
} from "@/lib/assistant/catalog";

/** Where the dev code and chosen tier are remembered in this browser. */
const DEV_CODE_KEY = "blinked.devCode";
const TIER_KEY = "blinked.analysisTier";

const readStored = (key: string): string => {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
};
const writeStored = (key: string, value: string) => {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // Private windows and blocked storage: the code simply is not remembered.
  }
};

/** "≈6.2¢" under a dollar, "$1.20" above. */
const cents = (usd: number) => (usd < 1 ? `≈${(usd * 100).toFixed(1)}¢` : `≈$${usd.toFixed(2)}`);
import { errorFrom, readBody } from "@/lib/clientApi";
import ProgressBar from "./ProgressBar";

const ROUTE_BADGE: Record<ReportStep["route"], string> = {
  site: "bg-emerald-100 text-emerald-800",
  self: "bg-stone-200 text-stone-700",
  service: "bg-indigo-100 text-indigo-800",
  ai_service: "bg-sky-100 text-sky-800",
  human: "bg-amber-100 text-amber-800",
  engineering: "bg-violet-100 text-violet-800",
};

/** "$12", "$0.30", and "$0.001" for a sub-cent unit price rather than "$0.00". */
const money = (n: number) => `$${n % 1 === 0 ? n : n >= 0.01 ? n.toFixed(2) : n.toPrecision(1)}`;

/** "200 photos × $0.02–$0.20 = $4–$40", or just the total for a flat price. */
function describeCost(cost: ReportStep["cost"]): string {
  if (cost.unknown) return "cost unknown";
  if (cost.low === 0 && cost.high === 0) return "no direct cost";
  const total = cost.low === cost.high ? money(cost.low) : `${money(cost.low)}–${money(cost.high)}`;
  if (cost.unit === "flat" || cost.quantity <= 1) return total;
  const unit = cost.unitLow === cost.unitHigh ? money(cost.unitLow) : `${money(cost.unitLow)}–${money(cost.unitHigh)}`;
  return `${cost.quantity} ${COST_UNIT_LABELS[cost.unit]} × ${unit} = ${total}`;
}

/**
 * "Describe what you're after" → a judged workflow.
 *
 * Two requests: a quick screen that decides whether the request is
 * reasonable and lists its steps (and how long the rest will take, for the
 * countdown), then the cost-and-time estimate. The result is shown in the
 * three sections the brief asks for — feasibility, rough cost, time — with a
 * route and a tier on every step. The report lives in the configuration so
 * it can be revisited.
 */
export default function WorkflowPlanner({
  config,
  setConfig,
  billing,
}: {
  config: AssistantConfig;
  setConfig: Dispatch<SetStateAction<AssistantConfig>>;
  billing: { enabled: boolean; balanceCents: number; minimumCents: number };
}) {
  const [text, setText] = useState(config.workflow?.description ?? "");
  // The balance moves with every charged pass; the server sends it back each time.
  const [balanceCents, setBalanceCents] = useState(billing.balanceCents);
  const router = useRouter();
  const [phase, setPhase] = useState<null | "screening" | "estimating" | "sending" | "creating">(null);
  const [screen, setScreen] = useState<WorkflowScreen | null>(null);
  const [eta, setEta] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);

  // Dev mode: a code remembered in this browser unlocks the bigger models.
  const [devCode, setDevCode] = useState("");
  const [devUnlocked, setDevUnlocked] = useState(false);
  const [showDevField, setShowDevField] = useState(false);
  const [devMessage, setDevMessage] = useState<string | null>(null);
  const [tier, setTier] = useState<AnalysisTier>("standard");
  const [screenUsage, setScreenUsage] = useState<AnalysisUsage | null>(null);

  // The countdown: one tick a second while the estimate runs.
  useEffect(() => {
    if (phase !== "estimating") return;
    setElapsed(0);
    const timer = setInterval(() => setElapsed((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [phase]);

  // A code remembered from an earlier visit is checked again with the server.
  useEffect(() => {
    const stored = readStored(DEV_CODE_KEY);
    if (!stored) return;
    setDevCode(stored);
    void verifyDevCode(stored, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Ask the server whether this is the dev code; on yes, show the tiers. */
  async function verifyDevCode(code: string, quiet = false) {
    const res = await fetch("/api/assistant/workflow/dev", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const body = await readBody<{ ok: boolean; reason?: string }>(res);
    if (res.ok && body.ok) {
      setDevUnlocked(true);
      setShowDevField(false);
      writeStored(DEV_CODE_KEY, code);
      const remembered = readStored(TIER_KEY) as AnalysisTier;
      setTier(ANALYSIS_TIERS.includes(remembered) ? remembered : "balanced");
      if (!quiet) setDevMessage("Dev mode on.");
      return;
    }
    setDevUnlocked(false);
    setTier("standard");
    writeStored(DEV_CODE_KEY, "");
    if (!quiet) setDevMessage(body.reason ?? (res.ok ? "That code is not right." : await errorFrom(res)));
  }

  function forgetDevCode() {
    setDevCode("");
    setDevUnlocked(false);
    setTier("standard");
    setDevMessage(null);
    writeStored(DEV_CODE_KEY, "");
  }

  function chooseTier(next: AnalysisTier) {
    setTier(next);
    writeStored(TIER_KEY, next);
  }

  const workflow = config.workflow;
  const skillsOn = SKILLS.filter((s) => config.skills[s.id].enabled).map((s) => s.name);

  async function analyse() {
    setError(null);
    setApplied(false);
    setScreen(null);
    setScreenUsage(null);
    setPhase("screening");
    // Sent with both passes; the server checks the code on each one.
    const access = devUnlocked ? { tier, devCode } : { tier: "standard" as AnalysisTier };

    const first = await fetch("/api/assistant/workflow/screen", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: text, skillsOn, ...access }),
    });
    if (!first.ok) {
      setError(await errorFrom(first));
      setPhase(null);
      return;
    }
    const screened = await readBody<{
      screen: WorkflowScreen;
      estimatedSeconds: number;
      usage: AnalysisUsage;
      billing?: { balanceCents: number };
    }>(first);
    if (!screened.screen) {
      setError("Something went wrong on the first pass. Please try again.");
      setPhase(null);
      return;
    }
    if (screened.billing) setBalanceCents(screened.billing.balanceCents);
    setScreen(screened.screen);
    setScreenUsage(screened.usage ?? null);
    setEta(screened.estimatedSeconds ?? 0);
    setPhase("estimating");

    const second = await fetch("/api/assistant/workflow/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: text, screen: screened.screen, screenUsage: screened.usage, ...access }),
    });
    setPhase(null);
    if (!second.ok) {
      setError(await errorFrom(second));
      return;
    }
    const body = await readBody<{ workflow: StoredWorkflow; billing?: { balanceCents: number } }>(second);
    if (body.billing) setBalanceCents(body.billing.balanceCents);
    if (body.workflow) setConfig((c) => ({ ...c, workflow: body.workflow! }));
    setScreen(null);
  }

  // Without the dev code, a run needs credit when billing is on.
  const shortOfCredit = billing.enabled && !devUnlocked && balanceCents < billing.minimumCents;

  function useIt() {
    setConfig((c) => (c.workflow ? applyWorkflowReport(c, c.workflow.report) : c));
    setApplied(true);
  }

  /** Swap a step for the faster or cheaper backend the analysis suggested; the report is re-totalled and kept. */
  function takeRecommendation(index: number) {
    setConfig((c) => (c.workflow ? { ...c, workflow: { ...c.workflow, report: applyRecommendation(c.workflow.report, index) } } : c));
    setApplied(false);
  }

  /** Back to the empty page: no text, no report — the stored report goes too. */
  function reset() {
    setText("");
    setScreen(null);
    setScreenUsage(null);
    setError(null);
    setApplied(false);
    setConfig((c) => (c.workflow ? { ...c, workflow: null } : c));
  }

  async function sendToTeam() {
    if (!workflow) return;
    setError(null);
    setPhase("sending");
    const res = await fetch("/api/assistant/workflow/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: workflow.description, report: workflow.report }),
    });
    setPhase(null);
    if (!res.ok) {
      setError(await errorFrom(res));
      return;
    }
    const body = await readBody<{ sentAt: string }>(res);
    if (body.sentAt) {
      setConfig((c) => (c.workflow ? { ...c, workflow: { ...c.workflow, sentAt: body.sentAt! } } : c));
    }
  }

  /**
   * "Create Agent": keep a snapshot of this workflow as the agent, saved before
   * the page changes so nothing is lost, then open its chat. The same workflow
   * already made into an agent just opens it.
   */
  const agentIsCurrent = !!workflow && config.agent?.description === workflow.description;
  async function createAgent() {
    if (!workflow) return;
    if (agentIsCurrent) {
      router.push("/agentdex/agent");
      return;
    }
    setError(null);
    setPhase("creating");
    const next: AssistantConfig = {
      ...config,
      agent: { description: workflow.description, report: workflow.report, createdAt: new Date().toISOString() },
    };
    const res = await fetch("/api/assistant", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(next),
    });
    setPhase(null);
    if (!res.ok) {
      setError(await errorFrom(res));
      return;
    }
    setConfig(next);
    router.push("/agentdex/agent");
  }

  const report = workflow?.report ?? null;
  const teamSteps = report?.steps.filter((s) => s.route === "human" || s.route === "engineering") ?? [];
  const siteSteps = report?.steps.filter((s) => s.route === "site") ?? [];
  const busy = phase !== null;

  return (
    <div className="card space-y-3">
      <label className="label" htmlFor="workflow">
        Describe what your agent should do.
      </label>
      <textarea
        id="workflow"
        className="input min-h-32"
        placeholder="Anything. You get the steps, who does each one, a rough cost and a time."
        value={text}
        maxLength={LIMITS.workflow}
        onChange={(e) => setText(e.target.value)}
        disabled={busy}
      />
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="btn-secondary"
          onClick={analyse}
          disabled={busy || text.trim().length < 15 || shortOfCredit}
        >
          {phase === "screening" ? "Looking…" : phase === "estimating" ? "Estimating…" : workflow ? "Analyse again" : "Analyse"}
        </button>
        {(text.length > 0 || workflow) && (
          <button type="button" className="btn-secondary" onClick={reset} disabled={busy}>
            Clear
          </button>
        )}
        {devUnlocked && (
          <label className="flex items-center gap-2 text-sm">
            Model
            <select className="input w-auto" value={tier} onChange={(e) => chooseTier(e.target.value as AnalysisTier)} disabled={busy}>
              {ANALYSIS_TIERS.map((id) => (
                <option key={id} value={id}>
                  {TIER_INFO[id].label} — {TIER_INFO[id].model} · {TIER_INFO[id].approx}
                </option>
              ))}
            </select>
          </label>
        )}
        {error && <span className="text-sm text-red-600">{error}</span>}
      </div>

      {billing.enabled && (
        <p className={`text-xs ${shortOfCredit ? "text-amber-800" : "text-stone-500"}`}>
          {devUnlocked
            ? "Dev runs are not charged."
            : `Credit ${money(balanceCents / 100)} — a Standard run costs a few cents, charged at what it actually uses. `}
          {!devUnlocked && (
            <a href="/assistant/credit" className="underline hover:text-stone-800">
              {shortOfCredit ? "Top up to run an analysis" : "Top up"}
            </a>
          )}
        </p>
      )}

      {/* Dev mode: a small line, not a feature the photographer is meant to notice. */}
      <div className="text-xs text-stone-500">
        {devUnlocked ? (
          <span>
            Dev mode on — {TIER_INFO[tier].hint}{" "}
            <button type="button" className="underline hover:text-stone-800" onClick={forgetDevCode}>
              forget code
            </button>
          </span>
        ) : showDevField ? (
          <span className="flex flex-wrap items-center gap-2">
            <input
              className="input w-48 py-1 text-xs"
              type="password"
              placeholder="Dev code"
              value={devCode}
              onChange={(e) => setDevCode(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void verifyDevCode(devCode)}
            />
            <button type="button" className="btn-secondary py-1 text-xs" onClick={() => void verifyDevCode(devCode)} disabled={!devCode}>
              Unlock
            </button>
            <button type="button" className="underline hover:text-stone-800" onClick={() => setShowDevField(false)}>
              cancel
            </button>
            {devMessage && <span className="text-red-600">{devMessage}</span>}
          </span>
        ) : (
          <button type="button" className="underline hover:text-stone-800" onClick={() => setShowDevField(true)}>
            Dev code
          </button>
        )}
      </div>

      {phase === "screening" && (
        <ProgressBar indeterminate label={`Checking the request and splitting it into steps with ${TIER_INFO[tier].model}…`} />
      )}

      {phase === "estimating" && screen && (
        <div className="space-y-2 text-sm">
          <ProgressBar
            value={eta > 0 ? Math.min(100, (elapsed / eta) * 100) : 100}
            label={
              elapsed < eta
                ? `Working out cost and time for ${screen.steps.length} step${screen.steps.length === 1 ? "" : "s"} — about ${eta - elapsed}s left`
                : "Almost there…"
            }
          />
          <ol className="list-decimal pl-5 text-stone-600">
            {screen.steps.map((s, i) => (
              <li key={`${s.title}-${i}`}>
                {s.title} <span className="text-stone-400">— {serviceLabel(s)}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {report && phase !== "estimating" && (
        <div className="space-y-4 rounded-lg bg-stone-50 p-3 text-sm">
          {workflow?.analysedWith && (
            <p className="text-xs text-stone-500">
              Analysed with {TIER_INFO[workflow.analysedWith.tier]?.model ?? workflow.analysedWith.model} · {cents(workflow.analysedWith.costUsd)}
              {workflow.analysedWith.chargedCents > 0 && ` · charged ${workflow.analysedWith.chargedCents}¢ to your credit`}
              {devUnlocked &&
                ` · ${workflow.analysedWith.inputTokens.toLocaleString()} in / ${workflow.analysedWith.outputTokens.toLocaleString()} out tokens · ${workflow.analysedWith.searches} search${workflow.analysedWith.searches === 1 ? "" : "es"}`}
            </p>
          )}

          {/* 1. Feasibility */}
          <section className="space-y-2">
            <h3 className="font-semibold text-stone-800">
              Feasibility{" "}
              <span className={`badge ${report.reasonable ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"}`}>
                {report.reasonable ? "reasonable" : "not reasonable"}
              </span>
            </h3>
            <p className="text-stone-700">{report.reason}</p>
            {report.reasonable && (
              <ol className="space-y-2">
                {report.steps.map((s, i) => (
                  <li key={`${s.title}-${i}`} className="space-y-0.5">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="text-stone-400">{i + 1}.</span>
                      <span className="font-medium">{s.title}</span>
                      <span className={`badge ${ROUTE_BADGE[s.route]}`}>{serviceLabel(s)}</span>
                      {s.route === "service" && <span className="badge bg-rose-100 text-rose-700">beta</span>}
                      <span className="badge bg-stone-200 text-stone-700">{TIER_LABELS[s.tier]}</span>
                    </div>
                    <p className="pl-5 text-stone-600">{s.detail}</p>
                    {s.recommendation && (
                      <div className="ml-5 rounded-lg bg-sky-50 px-2.5 py-1.5 text-sky-950">
                        <span className="font-medium">
                          {s.recommendation.gain === "faster" ? "Faster" : "Cheaper"} with{" "}
                          {serviceLabel({ route: "service", integration: s.recommendation.integration, specialty: s.recommendation.specialty })}
                        </span>
                        <span className="badge ml-1.5 bg-rose-100 text-rose-700">beta</span> {s.recommendation.detail}{" "}
                        <span className="text-sky-800">
                          {describeCost(s.recommendation.cost)} · {s.recommendation.time.estimate}
                          {s.recommendation.tradeoff && ` · ${s.recommendation.tradeoff}`}
                        </span>
                        {!workflow?.sentAt && (
                          <>
                            {" "}
                            <button
                              type="button"
                              className="font-medium underline hover:text-sky-700"
                              onClick={() => takeRecommendation(i)}
                            >
                              Use {INTEGRATIONS[s.recommendation.integration].name} instead
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </section>

          {/* 2. Rough cost */}
          <section className="space-y-2">
            <h3 className="font-semibold text-stone-800">Rough cost</h3>
            {!report.reasonable ? (
              <p className="text-stone-600">Not estimated — {report.reason}</p>
            ) : (
              <>
                <ul className="space-y-1.5">
                  {report.steps.map((s, i) => (
                    <li key={`${s.title}-${i}`} className="space-y-0.5">
                      <div className="flex flex-wrap items-baseline gap-2">
                        <span className="text-stone-400">{i + 1}.</span>
                        <span className="font-medium">{s.title}</span>
                        <span className="text-stone-700">
                          {s.route === "engineering" ? "needs the developers — not priced" : describeCost(s.cost)}
                          {s.humanCost > 0 &&
                            ` + ${money(s.humanCost)} for ${s.humanMinutes} min of a team member's time`}
                        </span>
                      </div>
                      {s.cost.basis && !s.cost.unknown && <p className="pl-5 text-stone-500">{s.cost.basis}</p>}
                      {s.cost.options.length > 0 && (
                        <ul className="list-disc pl-10 text-stone-600">
                          {s.cost.options.map((o) => (
                            <li key={o.label}>
                              {o.label} — {money(o.priceUsd)}
                            </li>
                          ))}
                        </ul>
                      )}
                      {s.cost.unknown && (
                        <p className="pl-5 text-amber-800">Roadblock: {s.cost.roadblock}</p>
                      )}
                    </li>
                  ))}
                </ul>
                <p className="font-medium text-stone-800">
                  {report.totals.high === 0
                    ? "Nothing to pay for the steps priced here."
                    : `Roughly ${money(report.totals.low)}–${money(report.totals.high)} all-in` +
                      (report.totals.unknownSteps > 0
                        ? `, not counting ${report.totals.unknownSteps} step${report.totals.unknownSteps === 1 ? "" : "s"} with no estimate`
                        : "") +
                      `. Team time is ${money(HUMAN_RATE_PER_HOUR)} an hour.`}
                  {report.steps.some((s) => s.route === "engineering") &&
                    ` ${report.steps.filter((s) => s.route === "engineering").length} step${report.steps.filter((s) => s.route === "engineering").length === 1 ? "" : "s"} need${report.steps.filter((s) => s.route === "engineering").length === 1 ? "s" : ""} the developers and ${report.steps.filter((s) => s.route === "engineering").length === 1 ? "is" : "are"} not priced.`}
                </p>
                {report.totals.overBudget && (
                  <p className="rounded-lg bg-amber-50 p-2 text-amber-900">
                    This could come to more than {money(BUDGET_USD)} — over the usual limit for a request. Worth trimming, or expect it to be discussed.
                  </p>
                )}
              </>
            )}
          </section>

          {/* 3. Time */}
          <section className="space-y-2">
            <h3 className="font-semibold text-stone-800">Time</h3>
            {!report.reasonable ? (
              <p className="text-stone-600">Not estimated — {report.reason}</p>
            ) : (
              <ul className="space-y-1">
                {report.steps.map((s, i) => (
                  <li key={`${s.title}-${i}`} className="flex flex-wrap items-baseline gap-2">
                    <span className="text-stone-400">{i + 1}.</span>
                    <span className="font-medium">{s.title}</span>
                    <span className="text-stone-700">
                      {s.time.kind === "estimate"
                        ? s.time.estimate
                        : s.time.kind === "engineering"
                          ? workflow?.sentAt
                            ? "Not built yet — sent to the developer team for consideration."
                            : "Not built yet — sending this to the team puts it in front of the developers."
                          : workflow?.sentAt
                            ? "Needs a person on the team — sent; they will come back with a time estimate."
                            : "Needs a person on the team — send it to them below for a time estimate."}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {report.reasonable && (
            <div className="flex flex-wrap items-center gap-3 border-t border-stone-200 pt-3">
              <button type="button" className="btn-primary" onClick={createAgent} disabled={busy}>
                {phase === "creating" ? "Creating…" : agentIsCurrent ? "Open agent" : "Create Agent"}
              </button>
              {siteSteps.length > 0 && (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={useIt}
                  disabled={report.briefLines.length === 0 && report.skillsToEnable.length === 0}
                >
                  Use what the assistant can do
                </button>
              )}
              {teamSteps.length > 0 &&
                (workflow?.sentAt ? (
                  <span className="text-sm text-emerald-700">
                    Sent to the team {new Date(workflow.sentAt).toLocaleString()}.
                  </span>
                ) : (
                  <button type="button" className="btn-secondary" onClick={sendToTeam} disabled={busy}>
                    {phase === "sending" ? "Sending…" : `Send ${teamSteps.length === 1 ? "this step" : `these ${teamSteps.length} steps`} to the team`}
                  </button>
                ))}
              <span className="text-xs text-stone-500">
                {applied
                  ? "Added to your brief and skills — check it above, then save."
                  : agentIsCurrent
                    ? "Your agent is set up for this workflow."
                    : "Happy with the analysis? Create Agent opens a chat set up for these steps — in this beta it does the lookups itself and walks you through the rest."}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
