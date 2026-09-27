/**
 * POST /api/sms/twilio — Twilio posts here for every text the number receives.
 *
 * The text is matched to the photographer by their verified mobile, stored on
 * the "sms" channel, and answered by the assistant. Twilio wants a response
 * within seconds and the assistant can take longer than that, so the
 * webhook is acknowledged at once with an empty reply and the answer goes
 * out afterwards as a text of its own (`after` runs once the response is
 * sent). Every post is checked against Twilio's signature first.
 */
import { NextResponse, after } from "next/server";
import { AiError, isAiConfigured } from "@/lib/ai";
import { LIMITS } from "@/lib/assistant/catalog";
import { runAssistant } from "@/lib/assistant/run";
import { countTextsToday, recordInbound, userIdForNumber } from "@/lib/assistant/smsStore";
import { HISTORY_LIMIT, addMessage, countMessagesToday, getAssistant, listMessages } from "@/lib/assistant/store";
import { siteOrigin } from "@/lib/billing";
import { todayIso } from "@/lib/dates";
import { getDb, type UserRow } from "@/lib/db";
import { escapeXml, normalisePhone, sendSms, trimForSms, verifyTwilioSignature } from "@/lib/sms";

const CHANNEL = "sms";

/** A TwiML response: with a message, or empty when the answer follows separately. */
function twiml(text?: string): Response {
  const body = `<?xml version="1.0" encoding="UTF-8"?><Response>${text ? `<Message>${escapeXml(text)}</Message>` : ""}</Response>`;
  return new NextResponse(body, { headers: { "Content-Type": "text/xml" } });
}

export async function POST(request: Request) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) return new NextResponse("Texting is not configured.", { status: 503 });

  const params: Record<string, string> = {};
  (await request.formData()).forEach((value, key) => {
    params[key] = String(value);
  });
  // Twilio signed the public URL it was given, which behind the proxy is not
  // the one this process sees; rebuild it from the forwarded headers.
  const requested = new URL(request.url);
  const url = `${siteOrigin(request)}${requested.pathname}${requested.search}`;
  if (!verifyTwilioSignature(url, params, request.headers.get("x-twilio-signature"), authToken)) {
    return new NextResponse("Bad signature", { status: 403 });
  }

  const from = normalisePhone(params.From ?? "");
  const userId = from ? userIdForNumber(from) : null;
  if (!from || !userId) {
    return twiml("This number isn't linked to a Blinked account. Verify it under Smart Photographer → Texting.");
  }
  const sid = params.MessageSid ?? "";
  if (!sid || !recordInbound(sid, userId)) return twiml(); // a redelivery: already answered

  const user = getDb().prepare("SELECT * FROM users WHERE id = ?").get(userId) as UserRow | undefined;
  const config = getAssistant(userId);
  if (!user || !config) return twiml("Set up your Smart Photographer in the app first.");
  if (!isAiConfigured()) return twiml("The assistant isn't available right now.");
  if (countMessagesToday(userId) >= LIMITS.messagesPerDay) return twiml("You've reached today's message limit. It resets at midnight UTC.");
  if (countTextsToday(userId) >= LIMITS.textsPerDay) return twiml("Today's text limit is used up. The web chat still works.");

  let text = (params.Body ?? "").trim();
  const media = Number(params.NumMedia ?? "0") || 0;
  if (media > 0) text = `${text}\n[Sent ${media} photo${media === 1 ? "" : "s"} by MMS — photos cannot be received by text in this beta]`.trim();
  if (!text) return twiml();

  const history = listMessages(userId, CHANNEL, HISTORY_LIMIT);
  const message = addMessage(userId, CHANNEL, "user", text, []);

  after(async () => {
    let reply: string;
    try {
      const result = await runAssistant({
        user,
        config,
        channel: CHANNEL,
        today: todayIso(),
        history,
        message,
        agent: config.agent,
        canText: false,
      });
      reply = result.text;
    } catch (error) {
      console.error("[sms] answering failed:", error instanceof AiError ? error.message : error);
      reply = "Sorry — I couldn't answer that one. Try again, or use the web chat.";
    }
    try {
      await sendSms(from, reply);
      addMessage(userId, CHANNEL, "assistant", trimForSms(reply), []);
    } catch (error) {
      console.error("[sms] sending the reply failed:", error);
    }
  });

  return twiml(); // the answer follows as its own text
}
