import Link from "next/link";
import TextingSetup from "@/components/TextingSetup";
import { smsStatus } from "@/lib/assistant/smsStore";
import { getAssistant, listMessages } from "@/lib/assistant/store";
import { requireUser } from "@/lib/auth";
import { maskPhone, smsEnabled, smsFromNumber } from "@/lib/sms";

/** Texting: link a mobile, then text the assistant and get texts back. */
export default async function TextingPage() {
  const user = await requireUser();
  const config = getAssistant(user.id);
  const status = smsStatus(user.id);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">
            Texting <span className="badge bg-rose-100 text-rose-700">beta</span>
          </h1>
          <p className="mt-1 text-sm text-stone-600">
            Text your Smart Photographer from your phone and get short replies back. Only your own verified
            number is ever texted — never couples or vendors.
          </p>
        </div>
        <Link href="/assistant" className="btn-secondary">
          Back to the chat
        </Link>
      </div>

      {!config ? (
        <p className="card text-sm text-stone-600">
          Set up your{" "}
          <Link href="/assistant" className="underline hover:text-stone-900">
            Smart Photographer
          </Link>{" "}
          first — texting talks to it.
        </p>
      ) : (
        <TextingSetup
          initial={{
            enabled: smsEnabled() || process.env.NODE_ENV !== "production",
            configured: smsEnabled(),
            number: status.number ? maskPhone(status.number) : null,
            verified: status.verified,
            pending: status.pending,
            textTo: smsFromNumber(),
          }}
          assistantName={config.name}
          recent={listMessages(user.id, "sms", 20)}
        />
      )}
    </div>
  );
}
