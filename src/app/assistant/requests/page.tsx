import Link from "next/link";
import { ROUTE_LABELS, TIER_LABELS, type WorkflowRoute } from "@/lib/assistant/catalog";
import { listTeamRequests } from "@/lib/assistant/requests";
import { requireUser } from "@/lib/auth";

/** The photographer's copy of every workflow request sent to the team. */
export default async function RequestsPage() {
  const user = await requireUser();
  const requests = listTeamRequests(user.id);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Requests to the team</h1>
          <p className="mt-1 text-sm text-stone-600">
            Steps from your workflows that a person or the developers have to handle. They come back
            to you by email with a time estimate.
          </p>
        </div>
        <Link href="/assistant/setup" className="btn-secondary">
          Back to settings
        </Link>
      </div>

      {requests.length === 0 ? (
        <p className="text-sm text-stone-500">Nothing sent yet.</p>
      ) : (
        <ul className="space-y-4">
          {requests.map((r) => (
            <li key={r.id} className="card space-y-2">
              <p className="text-xs text-stone-500">
                Sent {new Date(r.createdAt).toLocaleString()} to {r.sentTo}
              </p>
              <p className="whitespace-pre-wrap text-sm text-stone-800">{r.description}</p>
              <ol className="list-decimal space-y-1 pl-5 text-sm text-stone-600">
                {r.steps.map((s, i) => (
                  <li key={`${s.title}-${i}`}>
                    {s.title} — {ROUTE_LABELS[s.route as WorkflowRoute] ?? s.route},{" "}
                    {TIER_LABELS[s.tier] ?? `tier ${s.tier}`}
                    {s.roadblocks.length > 0 && (
                      <span className="text-amber-800"> · roadblock: {s.roadblocks.join("; ")}</span>
                    )}
                  </li>
                ))}
              </ol>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
