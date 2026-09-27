import Link from "next/link";
import AssistantChat from "@/components/AssistantChat";
import { isAiConfigured } from "@/lib/ai";
import {
  AVAILABILITY_LABELS,
  agentAsks,
  serviceLabel,
  stepAvailability,
  type StepAvailability,
} from "@/lib/assistant/catalog";
import { getAssistant, listMessages } from "@/lib/assistant/store";
import { requireUser } from "@/lib/auth";

const AVAILABILITY_BADGE: Record<StepAvailability, string> = {
  now: "bg-emerald-100 text-emerald-800",
  later: "bg-amber-100 text-amber-800",
  yours: "bg-stone-200 text-stone-700",
};

/**
 * The agent made from a workflow: the Smart Photographer on its own channel,
 * with the workflow's steps as the things to ask for. In this beta it does
 * the steps it can do itself — lookups, the calendar, a photo — and only
 * describes the rest.
 */
export default async function AgentPage() {
  const user = await requireUser();
  const config = getAssistant(user.id);
  const agent = config?.agent ?? null;

  if (!config || !agent) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">
          Your agent <span className="badge bg-rose-100 text-rose-700">beta</span>
        </h1>
        <p className="card text-sm text-stone-600">
          No agent yet. Describe a workflow on{" "}
          <Link href="/agentdex" className="underline hover:text-stone-900">
            AgentDex
          </Link>
          , check the analysis, then press Create Agent.
        </p>
      </div>
    );
  }

  const steps = agent.report.steps;
  const count = (kind: StepAvailability) => steps.filter((s) => stepAvailability(s) === kind).length;
  const asks = agentAsks(agent);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">
            {config.name} <span className="badge bg-rose-100 text-rose-700">agent · beta</span>
          </h1>
          <p className="mt-1 text-sm text-stone-600">Set up for: {agent.description}</p>
        </div>
        <Link href="/agentdex" className="btn-secondary">
          Back to AgentDex
        </Link>
      </div>

      <section className="card space-y-2 text-sm">
        <h2 className="font-semibold">What it can do in this beta</h2>
        <p className="text-stone-600">
          {count("now") === 0
            ? "None of these steps is one it does itself yet, so it will walk you through each: "
            : `It does ${count("now")} step${count("now") === 1 ? "" : "s"} itself now. `}
          {count("later") > 0 &&
            `${count("later")} ${count("later") === 1 ? "runs" : "run"} on a backend or with a person — it describes exactly what it would do, with the cost and time, but does not order, hire, edit, pay or text yet.`}
        </p>
        <ol className="space-y-1">
          {steps.map((s, i) => {
            const kind = stepAvailability(s);
            return (
              <li key={`${s.title}-${i}`} className="flex flex-wrap items-baseline gap-2">
                <span className="text-stone-400">{i + 1}.</span>
                <span className="font-medium">{s.title}</span>
                <span className="badge bg-stone-200 text-stone-700">{serviceLabel(s)}</span>
                <span className={`badge ${AVAILABILITY_BADGE[kind]}`}>{AVAILABILITY_LABELS[kind]}</span>
              </li>
            );
          })}
        </ol>
      </section>

      <AssistantChat
        assistantName={config.name}
        channel="agent"
        initialMessages={listMessages(user.id, "agent")}
        suggestions={[]}
        quickAsks={asks}
        intro={`I'm ${config.name}, set up for this workflow. Ask me for any step below — I'll do the ones I can now, and walk you through the rest.`}
        aiConfigured={isAiConfigured()}
      />
    </div>
  );
}
