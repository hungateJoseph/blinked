import AssistantSetup from "@/components/AssistantSetup";
import { DEFAULT_CONFIG } from "@/lib/assistant/catalog";
import { getAssistant } from "@/lib/assistant/store";
import { requireUser } from "@/lib/auth";

/** Edit an existing Smart Photographer, or create one from here. */
export default async function AssistantSetupPage() {
  const user = await requireUser();
  const config = getAssistant(user.id);
  return <AssistantSetup initial={config ?? DEFAULT_CONFIG} mode={config ? "edit" : "create"} />;
}
