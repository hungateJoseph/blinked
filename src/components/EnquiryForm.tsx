"use client";

import { useState, type FormEvent } from "react";
import { errorFrom } from "@/lib/clientApi";
import { formatLong } from "@/lib/dates";
import { PART_HINTS, PART_LABELS, type DayPart } from "@/lib/parts";

interface EnquiryFormProps {
  slug: string;
  /** The slot the visitor clicked, if any. */
  slot: { date: string; part: DayPart; discount: { label: string; detail: string } | null } | null;
  onClose: () => void;
}

/**
 * The form a couple fills in to ask about a date. No account, no password —
 * a name, one way to reply, and a message.
 */
export default function EnquiryForm({ slug, slot, onClose }: EnquiryFormProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState(
    slot ? `Hi, are you free on ${formatLong(slot.date)} in the ${PART_LABELS[slot.part].toLowerCase()}?` : "",
  );
  // Hidden from people, irresistible to form-filling bots.
  const [website, setWebsite] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function send(event: FormEvent) {
    event.preventDefault();
    setSending(true);
    setError(null);
    const res = await fetch(`/api/p/${encodeURIComponent(slug)}/enquiries`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: slot?.date ?? null,
        part: slot?.part ?? null,
        name,
        email,
        phone,
        message,
        website,
      }),
    });
    setSending(false);
    if (!res.ok) {
      setError(await errorFrom(res));
      return;
    }
    setSent(true);
  }

  if (sent) {
    return (
      <div className="card space-y-3 border-emerald-200 bg-emerald-50">
        <h2 className="font-semibold text-emerald-900">Message sent</h2>
        <p className="text-sm text-emerald-900">
          The photographer has your details and will get back to you. Nothing else to do.
        </p>
        <button type="button" className="btn-secondary" onClick={onClose}>
          Close
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={send} className="card space-y-4">
      <div>
        <h2 className="font-semibold">
          {slot ? `Ask about ${formatLong(slot.date)}` : "Get in touch"}
        </h2>
        {slot && (
          <p className="mt-1 text-sm text-stone-600">
            {PART_LABELS[slot.part]} — {PART_HINTS[slot.part]}
            {slot.discount && (
              <span className="badge ml-2 bg-amber-100 text-amber-900">{slot.discount.label}</span>
            )}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="enq-name" className="label">
          Your name
        </label>
        <input
          id="enq-name"
          className="input"
          required
          maxLength={80}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="enq-email" className="label">
            Email
          </label>
          <input
            id="enq-email"
            type="email"
            className="input"
            maxLength={120}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="enq-phone" className="label">
            Phone
          </label>
          <input
            id="enq-phone"
            type="tel"
            className="input"
            maxLength={120}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </div>
      </div>
      <p className="-mt-2 text-xs text-stone-500">
        Leave at least one of the two so they can reply.
      </p>

      <div>
        <label htmlFor="enq-message" className="label">
          Message
        </label>
        <textarea
          id="enq-message"
          rows={4}
          className="input"
          required
          maxLength={2000}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
      </div>

      {/* Not shown to anyone; a filled-in value means an automated sender. */}
      <div className="hidden" aria-hidden>
        <label htmlFor="enq-website">Website</label>
        <input
          id="enq-website"
          tabIndex={-1}
          autoComplete="off"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
        />
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-2">
        <button type="submit" className="btn-primary" disabled={sending}>
          {sending ? "Sending…" : "Send message"}
        </button>
        <button type="button" className="btn-secondary" onClick={onClose}>
          Cancel
        </button>
      </div>
    </form>
  );
}
