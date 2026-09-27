/**
 * GET    /api/assistant/messages?channel=web|agent — the conversation so far
 * POST   /api/assistant/messages — send a message: { text, photoIds, channel? } → the reply
 * DELETE /api/assistant/messages?channel=web|agent — clear the conversation
 *
 * Two channels share the assistant: "web" is the Smart Photographer chat, and
 * "agent" is the agent created from a workflow on AgentDex — the same tools,
 * a separate conversation, and the workflow with its beta rules in the prompt.
 *
 * The reply is produced synchronously: a photo touch-up takes a few seconds
 * and a scheduling question less, so the browser simply waits with a spinner.
 * (Text messages, when they come, will need to acknowledge first and reply
 * when ready — that is a channel concern, not this route's.)
 */
import { NextResponse } from "next/server";
import { AiError, isAiConfigured } from "@/lib/ai";
import { jsonError, readJson, unauthorized } from "@/lib/api";
import { LIMITS } from "@/lib/assistant/catalog";
import { runAssistant } from "@/lib/assistant/run";
import { canText } from "@/lib/assistant/smsStore";
import {
  HISTORY_LIMIT,
  addMessage,
  clearConversation,
  countMessagesToday,
  getAssistant,
  listMessages,
} from "@/lib/assistant/store";
import { getCurrentUser } from "@/lib/auth";
import { todayIso } from "@/lib/dates";
import { getPhoto } from "@/lib/photoStore";

type Channel = "web" | "agent" | "sms";

/** "agent" and "sms" are their own conversations; anything else is the ordinary chat. */
const channelOf = (value: unknown): Channel => (value === "agent" || value === "sms" ? value : "web");

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const channel = channelOf(new URL(request.url).searchParams.get("channel"));
  return NextResponse.json({ messages: listMessages(user.id, channel) });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const config = getAssistant(user.id);
  if (!config) return jsonError("Set up your Smart Photographer first.", 409);
  if (!isAiConfigured()) {
    return jsonError("The assistant needs ANTHROPIC_API_KEY to be configured on the server.", 503);
  }

  const body = await readJson(request);
  const channel = channelOf(body.channel);
  if (channel === "agent" && !config.agent) {
    return jsonError("Create your agent on AgentDex first.", 409);
  }
  if (channel === "sms") return jsonError("Texts are sent from your phone, not from here.");
  const text = typeof body.text === "string" ? body.text.trim().slice(0, LIMITS.message) : "";
  const photoIds = Array.isArray(body.photoIds)
    ? body.photoIds.filter((id): id is string => typeof id === "string").slice(0, LIMITS.attachments)
    : [];

  // Only the photographer's own photos, and only ones that still exist.
  for (const id of photoIds) {
    if (!getPhoto(user.id, id)) return jsonError("One of the attached photos was not found.", 404);
  }
  if (!text && photoIds.length === 0) return jsonError("Say something or attach a photo.");

  if (countMessagesToday(user.id) >= LIMITS.messagesPerDay) {
    return jsonError(
      `You have reached today's limit of ${LIMITS.messagesPerDay} messages. It resets at midnight UTC.`,
      429,
    );
  }

  // The history is read before the new message is stored, so it is not in there twice.
  const history = listMessages(user.id, channel, HISTORY_LIMIT);
  const message = addMessage(
    user.id,
    channel,
    "user",
    text,
    photoIds.map((photoId) => ({ photoId, variant: "original" as const })),
  );

  try {
    const reply = await runAssistant({
      user,
      config,
      channel,
      today: todayIso(),
      history,
      message,
      agent: channel === "agent" ? config.agent : null,
      canText: canText(user.id),
    });
    const stored = addMessage(user.id, channel, "assistant", reply.text, reply.attachments);
    return NextResponse.json({ messages: [message, stored] });
  } catch (error) {
    // The photographer's message stays in the conversation either way, so
    // they can see what they asked when they try again.
    if (error instanceof AiError) {
      return NextResponse.json({ error: error.message, messages: [message] }, { status: 502 });
    }
    console.error("[assistant] run:", error);
    return NextResponse.json(
      { error: "Something went wrong while answering. Please try again.", messages: [message] },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const channel = channelOf(new URL(request.url).searchParams.get("channel"));
  clearConversation(user.id, channel);
  return NextResponse.json({ ok: true });
}
