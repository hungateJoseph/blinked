import { INTEGRATIONS, INTEGRATION_IDS, SPECIALTIES, type IntegrationId } from "@/lib/assistant/catalog";

/**
 * A monogram tile per backend, in a colour that reads as the vendor without
 * borrowing its logo. Used in the hero strip and on the backend cards.
 */
const MARKS: Record<IntegrationId, { text: string; bg: string; fg: string }> = {
  amazon: { text: "a", bg: "#232f3e", fg: "#ff9900" },
  instacart: { text: "ic", bg: "#0aad0a", fg: "#ffffff" },
  aws: { text: "aws", bg: "#ff9900", fg: "#232f3e" },
  fiverr: { text: "fi", bg: "#1dbf73", fg: "#ffffff" },
  taskrabbit: { text: "tr", bg: "#2e8b57", fg: "#ffffff" },
  payments: { text: "$", bg: "#635bff", fg: "#ffffff" },
  comms: { text: "sms", bg: "#0ea5e9", fg: "#ffffff" },
  automation: { text: "cron", bg: "#334155", fg: "#ffffff" },
  varsitytutors: { text: "vt", bg: "#1a2b6d", fg: "#ffffff" },
  preply: { text: "pr", bg: "#ff7a59", fg: "#ffffff" },
  brighterly: { text: "br", bg: "#ffbf00", fg: "#1f2937" },
  outschool: { text: "os", bg: "#7c3aed", fg: "#ffffff" },
};

export function BackendMark({ id, size = 40 }: { id: IntegrationId; size?: number }) {
  const m = MARKS[id];
  const fontSize = m.text.length > 2 ? size * 0.28 : size * 0.42;
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-xl font-display font-extrabold lowercase tracking-tight"
      style={{ width: size, height: size, background: m.bg, color: m.fg, fontSize }}
    >
      {m.text}
    </span>
  );
}

/** The strip of backend tiles under the hero: every backend the planner can route to. */
export function BackendStrip() {
  return (
    <ul className="flex flex-wrap items-center gap-x-6 gap-y-3">
      {INTEGRATION_IDS.map((id) => (
        <li key={id} className="flex items-center gap-2.5 text-sm font-semibold text-stone-700">
          <BackendMark id={id} size={30} />
          {INTEGRATIONS[id].name}
        </li>
      ))}
    </ul>
  );
}

/** One card per backend: what it covers and up to three of its named sub-services. */
export function BackendGrid() {
  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {INTEGRATION_IDS.map((id) => {
        const info = INTEGRATIONS[id];
        const featured = SPECIALTIES.filter((s) => s.integration === id && "featured" in s && s.featured).slice(0, 3);
        const all = SPECIALTIES.filter((s) => s.integration === id).length;
        return (
          <li key={id} className="card flex flex-col gap-4 p-5">
            <div className="flex items-center gap-3">
              <BackendMark id={id} />
              <div>
                <p className="font-display text-base font-bold">{info.name}</p>
                <p className="text-xs text-stone-500">
                  {info.tier === 1 ? "A service does it" : "A person does it"}
                </p>
              </div>
            </div>
            <p className="text-sm leading-relaxed text-stone-600">{info.covers}</p>
            {featured.length > 0 ? (
              <ul className="mt-auto space-y-1.5 border-t border-stone-100 pt-3 text-sm">
                {featured.map((s) => (
                  <li key={s.id} className="flex items-start gap-2">
                    <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-rose-500" />
                    <span className="text-stone-800">{s.name}</span>
                  </li>
                ))}
                {all > featured.length && (
                  <li className="pl-3.5 text-xs text-stone-500">and {all - featured.length} more</li>
                )}
              </ul>
            ) : (
              <p className="mt-auto border-t border-stone-100 pt-3 text-sm text-stone-500">{info.example}</p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
