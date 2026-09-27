"use client";

import { useState } from "react";
import { errorFrom, readBody } from "@/lib/clientApi";
import { formatLong } from "@/lib/dates";
import { PART_LABELS } from "@/lib/parts";
import type { EnquiryView } from "@/lib/enquiries";

/** Enquiries, newest first, with read/archive/delete. */
export default function MessagesList({ initialEnquiries }: { initialEnquiries: EnquiryView[] }) {
  const [enquiries, setEnquiries] = useState(initialEnquiries);
  const [showArchived, setShowArchived] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const visible = enquiries.filter((e) => e.archived === showArchived);
  const unread = enquiries.filter((e) => !e.read && !e.archived).length;
  const archivedCount = enquiries.filter((e) => e.archived).length;

  async function update(id: string, changes: { read?: boolean; archived?: boolean }) {
    setBusyId(id);
    setError(null);
    const res = await fetch(`/api/enquiries/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(changes),
    });
    setBusyId(null);
    if (!res.ok) {
      setError(await errorFrom(res));
      return;
    }
    const { enquiry } = await readBody<{ enquiry: EnquiryView }>(res);
    if (enquiry) setEnquiries((list) => list.map((e) => (e.id === id ? enquiry : e)));
  }

  async function remove(id: string) {
    setBusyId(id);
    setError(null);
    const res = await fetch(`/api/enquiries/${id}`, { method: "DELETE" });
    setBusyId(null);
    setConfirmingDelete(null);
    if (!res.ok) {
      setError(await errorFrom(res));
      return;
    }
    setEnquiries((list) => list.filter((e) => e.id !== id));
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <button
          type="button"
          className={showArchived ? "btn-secondary" : "btn-primary"}
          onClick={() => setShowArchived(false)}
        >
          Inbox{unread > 0 ? ` (${unread} new)` : ""}
        </button>
        <button
          type="button"
          className={showArchived ? "btn-primary" : "btn-secondary"}
          onClick={() => setShowArchived(true)}
        >
          Archived ({archivedCount})
        </button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {visible.length === 0 ? (
        <p className="card text-sm text-stone-500">
          {showArchived
            ? "Nothing archived."
            : "No messages yet. They will appear here when a couple asks about a date on your availability page."}
        </p>
      ) : (
        <ul className="space-y-3">
          {visible.map((e) => (
            <li
              key={e.id}
              className={`card space-y-3 ${!e.read && !e.archived ? "border-rose-200 bg-rose-50/40" : ""}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-semibold">
                    {e.name}
                    {!e.read && !e.archived && (
                      <span className="badge ml-2 bg-rose-100 text-rose-700">new</span>
                    )}
                  </p>
                  <p className="text-sm text-stone-600">
                    {e.date
                      ? `About ${formatLong(e.date)}${e.part ? ` — ${PART_LABELS[e.part]}` : ""}`
                      : "No particular date"}
                  </p>
                </div>
                <p className="text-xs text-stone-500">{formatLong(e.createdAt.slice(0, 10))}</p>
              </div>

              {/* Whitespace preserved so a message typed in paragraphs reads as one. */}
              <p className="whitespace-pre-wrap text-sm text-stone-800">{e.message}</p>

              <div className="flex flex-wrap gap-3 text-sm">
                {e.email && (
                  <a className="font-medium text-rose-700 underline" href={`mailto:${e.email}`}>
                    {e.email}
                  </a>
                )}
                {e.phone && (
                  <a className="font-medium text-rose-700 underline" href={`tel:${e.phone}`}>
                    {e.phone}
                  </a>
                )}
              </div>

              <div className="flex flex-wrap gap-2 border-t border-stone-200 pt-3">
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={busyId === e.id}
                  onClick={() => update(e.id, { read: !e.read })}
                >
                  Mark {e.read ? "unread" : "read"}
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={busyId === e.id}
                  onClick={() => update(e.id, { archived: !e.archived })}
                >
                  {e.archived ? "Move to inbox" : "Archive"}
                </button>

                {confirmingDelete === e.id ? (
                  <>
                    <button
                      type="button"
                      className="btn-primary"
                      disabled={busyId === e.id}
                      onClick={() => remove(e.id)}
                    >
                      Delete for good
                    </button>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => setConfirmingDelete(null)}
                    >
                      Cancel
                    </button>
                    <span className="self-center text-xs text-stone-600">
                      This erases their name and contact details.
                    </span>
                  </>
                ) : (
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => setConfirmingDelete(e.id)}
                  >
                    Delete
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
