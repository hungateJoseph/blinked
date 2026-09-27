import Link from "next/link";
import AssistantChat from "@/components/AssistantChat";
import AssistantSetup from "@/components/AssistantSetup";
import { isAiConfigured } from "@/lib/ai";
import { DEFAULT_CONFIG, enabledSkillNames, suggestionsFor } from "@/lib/assistant/catalog";
import { getAssistant, listMessages } from "@/lib/assistant/store";
import { requireUser } from "@/lib/auth";

/**
 * Smart Photographer: the setup wizard until one exists, then the chat.
 */
export default async function AssistantPage() {
  const user = await requireUser();
  const config = getAssistant(user.id);

  if (!config) return <AssistantSetup initial={DEFAULT_CONFIG} mode="create" />;

  const skillsOn = enabledSkillNames(config);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="eyebrow">Assistant</p>
          <h1 className="mt-1 text-3xl">{config.name}</h1>
          <p className="mt-1 max-w-2xl text-sm text-stone-600">
            {skillsOn.length > 0 ? `Skills on: ${skillsOn.join(", ")}.` : "No skills switched on yet."}{" "}
            Anything it wants to change — a booking, say — it proposes first and does only when you
            say yes.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/assistant/texting" className="btn-secondary">
            Texting
          </Link>
          <Link href="/assistant/credit" className="btn-secondary">
            Credit
          </Link>
          <Link href="/assistant/requests" className="btn-secondary">
            Requests
          </Link>
          <Link href="/assistant/setup" className="btn-secondary">
            Settings
          </Link>
        </div>
      </div>

      <AssistantChat
        assistantName={config.name}
        initialMessages={listMessages(user.id, "web")}
        suggestions={suggestionsFor(config)}
        aiConfigured={isAiConfigured()}
      />
    </div>
  );
}
