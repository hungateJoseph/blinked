import Link from "next/link";
import AgentDex from "@/components/AgentDex";
import { INTEGRATIONS, INTEGRATION_IDS, featuredSpecialties, specialtiesOf, type IntegrationId } from "@/lib/assistant/catalog";

/** A backend's sub-services: three or four up front, the rest behind "more". */
function Specialties({ integration }: { integration: IntegrationId }) {
  const all = specialtiesOf(integration);
  if (all.length === 0) return null;
  const shown = featuredSpecialties(integration);
  const rest = all.filter((s) => !shown.includes(s));
  return (
    <div className="space-y-1 pt-1">
      <ul className="flex flex-wrap gap-1.5">
        {shown.map((s) => (
          <li key={s.id} className="badge bg-stone-100 text-stone-700" title={s.covers}>
            {s.name}
          </li>
        ))}
      </ul>
      {rest.length > 0 && (
        <details className="text-sm text-stone-600">
          <summary className="cursor-pointer text-xs text-stone-500 hover:text-stone-800">
            and {rest.length} more
          </summary>
          <ul className="mt-1 space-y-0.5">
            {rest.map((s) => (
              <li key={s.id}>
                <span className="font-medium text-stone-800">{s.name}</span> — {s.covers}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
import { getAssistant } from "@/lib/assistant/store";
import { requireUser } from "@/lib/auth";
import { billingStatus } from "@/lib/billing";

/** AgentDex (beta): describe what your agent should do, get the steps, cost and time. */
export default async function AgentDexPage() {
  const user = await requireUser();
  const config = getAssistant(user.id);
  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="eyebrow">Build · beta</p>
          <h1 className="mt-1 text-3xl">AgentDex</h1>
          <p className="mt-1 max-w-2xl text-sm text-stone-600">
            Describe what your agent should do. You get the steps, who does each one, a rough cost
            and a time — then you create the agent.
          </p>
        </div>
        {config?.agent && (
          <Link href="/agentdex/agent" className="btn-secondary">
            Open your agent
          </Link>
        )}
      </div>

      <AgentDex initial={config} billing={billingStatus(user.id)} />

      {/* The backends the analysis assumes are wired up. None is live yet — hence beta on each. */}
      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">What your agent can already call on</h2>
          <p className="text-sm text-stone-600">
            These backends are assumed set up when a request is analysed, so a step that needs one
            goes straight to it — priced, timed and never marked unsupported. Where a backend has
            specialities, a step names the one it uses. Each is in beta.
          </p>
        </div>
        <ul className="grid gap-3 md:grid-cols-2">
          {INTEGRATION_IDS.map((id) => {
            const i = INTEGRATIONS[id];
            return (
              <li key={id} className="card space-y-1">
                <h3 className="font-semibold">
                  <span aria-hidden className="mr-2">
                    {i.icon}
                  </span>
                  {i.name}
                  <span className="badge ml-2 bg-rose-100 text-rose-700">beta</span>
                </h3>
                <p className="text-sm text-stone-600">{i.covers}</p>
                <p className="text-sm text-stone-800">{i.example}</p>
                <Specialties integration={id} />
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
