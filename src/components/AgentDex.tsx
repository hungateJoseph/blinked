"use client";

import { useEffect, useRef, useState } from "react";
import { DEFAULT_CONFIG, type AssistantConfig } from "@/lib/assistant/catalog";
import WorkflowPlanner from "./WorkflowPlanner";

/**
 * AgentDex: one box — describe what your agent should do — and the analysis.
 *
 * The analysis reads and writes the photographer's assistant configuration:
 * the last report is kept there, and "use what the assistant can do" folds
 * steps into its brief. Every change made here is saved straight away; a
 * photographer who has no assistant yet gets one with the defaults the first
 * time there is something to keep, so AgentDex can be the way in as well.
 */
export default function AgentDex({
  initial,
  billing,
}: {
  initial: AssistantConfig | null;
  billing: { enabled: boolean; balanceCents: number; minimumCents: number };
}) {
  const [config, setConfig] = useState<AssistantConfig>(initial ?? DEFAULT_CONFIG);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Persist what the planner changes.
  const lastSaved = useRef<AssistantConfig | null>(initial);
  useEffect(() => {
    if (config === lastSaved.current) return;

    let cancelled = false;
    (async () => {
      const res = await fetch("/api/assistant", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      if (cancelled) return;
      if (res.ok) {
        lastSaved.current = config;
        setSaveError(null);
      } else {
        setSaveError("Could not save this to your assistant. It is still shown here.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [config]);

  return (
    <div className="space-y-3">
      <WorkflowPlanner config={config} setConfig={setConfig} billing={billing} />
      {saveError && <p className="text-sm text-amber-800">{saveError}</p>}
    </div>
  );
}
