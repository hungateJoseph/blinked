/**
 * Database access for the assistant: its configuration, the conversation,
 * and the actions waiting for the photographer's confirmation.
 */
import { getDb, type AssistantActionRow, type AssistantMessageRow, type AssistantRow } from "../db";
import { getPhoto, photoToView } from "../photoStore";
import { newId, nowIso } from "../util";
import {
  parseAssistantConfig,
  type AssistantConfig,
  type Attachment,
  type ChatMessage,
} from "./catalog";

/** How long a proposed action stays confirmable. */
const ACTION_TTL_MINUTES = 15;

/** How much of the conversation is sent back to the model each turn. */
export const HISTORY_LIMIT = 30;

// --- Configuration ----------------------------------------------------------

export function getAssistant(userId: string): AssistantConfig | null {
  const row = getDb().prepare("SELECT * FROM assistants WHERE user_id = ?").get(userId) as
    | AssistantRow
    | undefined;
  if (!row) return null;
  try {
    return parseAssistantConfig(JSON.parse(row.config_json));
  } catch {
    return null;
  }
}

export function saveAssistant(userId: string, config: AssistantConfig): void {
  const now = nowIso();
  getDb()
    .prepare(
      `INSERT INTO assistants (user_id, config_json, created_at, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET config_json = excluded.config_json, updated_at = excluded.updated_at`,
    )
    .run(userId, JSON.stringify(config), now, now);
}

/** Remove the assistant, its conversation and anything it had proposed. */
export function deleteAssistant(userId: string): void {
  const db = getDb();
  db.transaction(() => {
    db.prepare("DELETE FROM assistant_actions WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM assistant_messages WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM assistants WHERE user_id = ?").run(userId);
  })();
}

// --- Conversation -----------------------------------------------------------

/** What is stored per attachment; the URL and name are looked up on read. */
type StoredAttachment = { photoId: string; variant: Attachment["variant"] };

/**
 * Resolve stored attachments against the photos as they are now. A photo
 * deleted since the message was sent simply disappears from it.
 */
function resolveAttachments(userId: string, json: string): Attachment[] {
  let stored: StoredAttachment[];
  try {
    stored = JSON.parse(json) as StoredAttachment[];
  } catch {
    return [];
  }
  const result: Attachment[] = [];
  for (const item of stored) {
    const row = getPhoto(userId, item.photoId);
    if (!row) continue;
    const view = photoToView(row);
    // An edited copy that has since been reverted falls back to the original,
    // so the message still shows the photo it was about.
    const url = item.variant === "edited" && view.edited ? view.edited.url : view.fileUrl;
    result.push({
      photoId: item.photoId,
      variant: item.variant === "edited" && view.edited ? "edited" : "original",
      url,
      name: view.originalName,
    });
  }
  return result;
}

function messageToView(userId: string, row: AssistantMessageRow): ChatMessage {
  return {
    id: row.id,
    role: row.role,
    text: row.text,
    attachments: resolveAttachments(userId, row.attachments_json),
    createdAt: row.created_at,
  };
}

/** The most recent messages, oldest first. */
export function listMessages(userId: string, channel: string, limit = 60): ChatMessage[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM assistant_messages WHERE user_id = ? AND channel = ?
       ORDER BY created_at DESC, rowid DESC LIMIT ?`,
    )
    .all(userId, channel, limit) as AssistantMessageRow[];
  return rows.reverse().map((row) => messageToView(userId, row));
}

export function addMessage(
  userId: string,
  channel: string,
  role: ChatMessage["role"],
  text: string,
  attachments: StoredAttachment[],
): ChatMessage {
  const row: AssistantMessageRow = {
    id: newId(),
    user_id: userId,
    channel,
    role,
    text,
    attachments_json: JSON.stringify(attachments),
    created_at: nowIso(),
  };
  getDb()
    .prepare(
      `INSERT INTO assistant_messages (id, user_id, channel, role, text, attachments_json, created_at)
       VALUES (@id, @user_id, @channel, @role, @text, @attachments_json, @created_at)`,
    )
    .run(row);
  return messageToView(userId, row);
}

/** Start over. Anything proposed but unconfirmed goes too. */
export function clearConversation(userId: string, channel: string): void {
  const db = getDb();
  db.transaction(() => {
    db.prepare("DELETE FROM assistant_messages WHERE user_id = ? AND channel = ?").run(userId, channel);
    db.prepare(
      `UPDATE assistant_actions SET resolved_at = ?, outcome = 'cancelled'
       WHERE user_id = ? AND channel = ? AND resolved_at IS NULL`,
    ).run(nowIso(), userId, channel);
  })();
}

/** Messages the photographer has sent since midnight UTC — for the daily cap. */
export function countMessagesToday(userId: string): number {
  const startOfDay = `${nowIso().slice(0, 10)}T00:00:00.000Z`;
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS c FROM assistant_messages
       WHERE user_id = ? AND role = 'user' AND created_at >= ?`,
    )
    .get(userId, startOfDay) as { c: number };
  return row.c;
}

// --- Proposed actions -------------------------------------------------------

export interface PendingAction {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  summary: string;
  /** The user message during which it was proposed. */
  proposedIn: string;
  expiresAt: string;
}

function actionToView(row: AssistantActionRow): PendingAction {
  return {
    id: row.id,
    kind: row.kind,
    payload: JSON.parse(row.payload_json) as Record<string, unknown>,
    summary: row.summary,
    proposedIn: row.proposed_in,
    expiresAt: row.expires_at,
  };
}

/**
 * Record something the assistant wants to do. Proposing a new action
 * supersedes any earlier unconfirmed one — there is only ever one question
 * on the table.
 */
export function proposeAction(input: {
  userId: string;
  channel: string;
  kind: string;
  payload: Record<string, unknown>;
  summary: string;
  proposedIn: string;
}): PendingAction {
  const db = getDb();
  const now = new Date();
  const row: AssistantActionRow = {
    id: newId(),
    user_id: input.userId,
    channel: input.channel,
    kind: input.kind,
    payload_json: JSON.stringify(input.payload),
    summary: input.summary,
    proposed_in: input.proposedIn,
    created_at: now.toISOString(),
    expires_at: new Date(now.getTime() + ACTION_TTL_MINUTES * 60_000).toISOString(),
    resolved_at: null,
    outcome: null,
  };
  db.transaction(() => {
    db.prepare(
      `UPDATE assistant_actions SET resolved_at = ?, outcome = 'cancelled'
       WHERE user_id = ? AND channel = ? AND resolved_at IS NULL`,
    ).run(row.created_at, input.userId, input.channel);
    db.prepare(
      `INSERT INTO assistant_actions (id, user_id, channel, kind, payload_json, summary, proposed_in,
                                      created_at, expires_at, resolved_at, outcome)
       VALUES (@id, @user_id, @channel, @kind, @payload_json, @summary, @proposed_in,
               @created_at, @expires_at, @resolved_at, @outcome)`,
    ).run(row);
  })();
  return actionToView(row);
}

/** The action awaiting confirmation, if there is one that has not expired. */
export function getPendingAction(userId: string, channel: string): PendingAction | null {
  const db = getDb();
  const now = nowIso();
  // Tidy up first so an expired proposal can never be confirmed late.
  db.prepare(
    `UPDATE assistant_actions SET resolved_at = ?, outcome = 'expired'
     WHERE user_id = ? AND channel = ? AND resolved_at IS NULL AND expires_at < ?`,
  ).run(now, userId, channel, now);

  const row = db
    .prepare(
      `SELECT * FROM assistant_actions WHERE user_id = ? AND channel = ? AND resolved_at IS NULL
       ORDER BY created_at DESC LIMIT 1`,
    )
    .get(userId, channel) as AssistantActionRow | undefined;
  return row ? actionToView(row) : null;
}

/** Close an action. Returns false if it was already closed (or is not this user's). */
export function resolveAction(
  userId: string,
  actionId: string,
  outcome: "confirmed" | "cancelled",
): boolean {
  const result = getDb()
    .prepare(
      `UPDATE assistant_actions SET resolved_at = ?, outcome = ?
       WHERE id = ? AND user_id = ? AND resolved_at IS NULL`,
    )
    .run(nowIso(), outcome, actionId, userId);
  return result.changes > 0;
}
