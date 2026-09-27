/**
 * Sending the one-time sign-in code.
 *
 * Uses Resend (https://resend.com) when RESEND_API_KEY is set, and otherwise
 * falls back to printing the code on the server console for local development.
 *
 * The returned `delivery` matters: the login page only shows the code on
 * screen when the code was *not* actually sent anywhere, so how the code is
 * delivered and whether it is exposed can never disagree with each other.
 */

export type Delivery = "email" | "console";

export interface DeliveryResult {
  delivery: Delivery;
}

/** Address the code is sent from. Must be on a domain verified in Resend. */
const FROM = process.env.EMAIL_FROM || "onboarding@resend.dev";

/** True once a real email provider is configured. */
export function isMailerConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

/** Plain-text and HTML bodies for the sign-in email. */
function buildEmail(code: string) {
  const text = `Your sign-in code for Blinked is ${code}.

It expires in 10 minutes. If you did not ask to sign in, you can ignore this email.`;

  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:480px">
  <h2 style="margin:0 0 16px">Your sign-in code</h2>
  <p style="font-size:32px;letter-spacing:6px;font-weight:700;margin:0 0 16px">${code}</p>
  <p style="color:#57534e;margin:0">It expires in 10 minutes. If you did not ask to sign in, you can ignore this email.</p>
</div>`;

  return { text, html };
}

/** Escape text taken from an anonymous visitor before putting it in HTML. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Tell the photographer that a couple has been in touch.
 *
 * The enquiry is already saved by the time this runs, so a failure here is
 * logged and swallowed by the caller rather than losing the message.
 */
export async function sendEnquiryNotification(
  photographerEmail: string,
  slug: string,
  enquiry: {
    name: string;
    email: string;
    phone: string;
    message: string;
    date: string | null;
    part: string | null;
  },
): Promise<DeliveryResult> {
  const about =
    enquiry.date && enquiry.part
      ? `${enquiry.date} (${enquiry.part})`
      : enquiry.date
        ? enquiry.date
        : "no particular date";
  const contact = [enquiry.email, enquiry.phone].filter(Boolean).join(" · ");

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.log(`[enquiry] New enquiry for ${photographerEmail} from ${enquiry.name} (${contact})`);
    return { delivery: "console" };
  }

  const text = `${enquiry.name} asked about ${about}.

${enquiry.message}

Reply to: ${contact}

See it in Blinked: /messages`;

  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:520px">
  <h2 style="margin:0 0 4px">New enquiry from ${escapeHtml(enquiry.name)}</h2>
  <p style="color:#57534e;margin:0 0 16px">About ${escapeHtml(about)}</p>
  <blockquote style="margin:0 0 16px;padding:12px 16px;background:#f5f5f4;border-radius:8px;white-space:pre-wrap">${escapeHtml(enquiry.message)}</blockquote>
  <p style="margin:0">Reply to: <strong>${escapeHtml(contact)}</strong></p>
</div>`;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: FROM,
      to: [photographerEmail],
      // Replying in a mail client should reach the couple, not Blinked.
      ...(enquiry.email ? { reply_to: enquiry.email } : {}),
      subject: `New enquiry from ${enquiry.name} — ${about}`,
      text,
      html,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Resend rejected the request (${response.status}): ${detail.slice(0, 300)}`);
  }
  return { delivery: "email" };
}

/**
 * Where workflow requests that need a person or the developers are sent.
 * During the beta that is one inbox.
 */
export const TEAM_EMAIL = process.env.TEAM_EMAIL || "jbabyjbaby1@gmail.com";

/**
 * Send the steps of a workflow that a person or the developers have to
 * handle. The request is already stored by the time this runs, so a failure
 * is reported to the photographer without losing the request.
 */
export async function sendTeamRequest(input: {
  photographer: { name: string | null; email: string };
  description: string;
  steps: { title: string; route: string; tier: number; roadblocks: string[] }[];
  totals: { low: number; high: number };
}): Promise<DeliveryResult & { to: string }> {
  const who = input.photographer.name
    ? `${input.photographer.name} (${input.photographer.email})`
    : input.photographer.email;
  const lines = input.steps.map(
    (s, i) =>
      `${i + 1}. ${s.title} — ${s.route}, tier ${s.tier}` +
      (s.roadblocks.length > 0 ? `\n   Roadblocks: ${s.roadblocks.join("; ")}` : ""),
  );

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.log(`[team] Request from ${who} (would go to ${TEAM_EMAIL}):\n${input.description}\n${lines.join("\n")}`);
    return { delivery: "console", to: TEAM_EMAIL };
  }

  const text = `${who} asked for:

${input.description}

Steps that need a person or the developers:
${lines.join("\n")}

Rough total so far: $${input.totals.low}–$${input.totals.high}.`;

  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:560px">
  <h2 style="margin:0 0 4px">Workflow request from ${escapeHtml(who)}</h2>
  <blockquote style="margin:12px 0 16px;padding:12px 16px;background:#f5f5f4;border-radius:8px;white-space:pre-wrap">${escapeHtml(input.description)}</blockquote>
  <p style="margin:0 0 8px"><strong>Steps that need a person or the developers</strong></p>
  <ol style="margin:0 0 16px;padding-left:20px">${input.steps
    .map(
      (s) =>
        `<li>${escapeHtml(s.title)} — ${escapeHtml(s.route)}, tier ${s.tier}` +
        (s.roadblocks.length > 0 ? `<br><em>Roadblocks: ${escapeHtml(s.roadblocks.join("; "))}</em>` : "") +
        `</li>`,
    )
    .join("")}</ol>
  <p style="margin:0;color:#57534e">Rough total so far: $${input.totals.low}–$${input.totals.high}.</p>
</div>`;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: FROM,
      to: [TEAM_EMAIL],
      reply_to: input.photographer.email,
      subject: `Blinked request from ${input.photographer.name || input.photographer.email}: ${input.description.slice(0, 60)}`,
      text,
      html,
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Resend rejected the request (${response.status}): ${detail.slice(0, 300)}`);
  }
  return { delivery: "email", to: TEAM_EMAIL };
}

/** Deliver a sign-in code, returning how it was delivered. */
export async function sendLoginCode(email: string, code: string): Promise<DeliveryResult> {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    console.log(`[login] One-time code for ${email}: ${code}`);
    return { delivery: "console" };
  }

  const { text, html } = buildEmail(code);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM,
      to: [email],
      subject: `${code} is your sign-in code`,
      text,
      html,
    }),
  });

  if (!response.ok) {
    // Surface the reason in the server log — the caller turns this into a
    // generic message for the user, who cannot act on Resend's error text.
    const detail = await response.text().catch(() => "");
    throw new Error(`Resend rejected the request (${response.status}): ${detail.slice(0, 300)}`);
  }

  return { delivery: "email" };
}
