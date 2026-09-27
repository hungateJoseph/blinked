/**
 * Workflow requests sent to the team — the photographer's copy.
 */
import { getDb, type TeamRequestRow } from "../db";
import { newId, nowIso } from "../util";

export interface RequestStepSummary {
  title: string;
  route: string;
  tier: number;
  roadblocks: string[];
}

export interface TeamRequestView {
  id: string;
  description: string;
  steps: RequestStepSummary[];
  sentTo: string;
  createdAt: string;
}

function toView(row: TeamRequestRow): TeamRequestView {
  return {
    id: row.id,
    description: row.description,
    steps: JSON.parse(row.summary_json) as RequestStepSummary[],
    sentTo: row.sent_to,
    createdAt: row.created_at,
  };
}

export function addTeamRequest(
  userId: string,
  description: string,
  steps: RequestStepSummary[],
  sentTo: string,
): TeamRequestView {
  const row: TeamRequestRow = {
    id: newId(),
    user_id: userId,
    description,
    summary_json: JSON.stringify(steps),
    sent_to: sentTo,
    created_at: nowIso(),
  };
  getDb()
    .prepare(
      `INSERT INTO team_requests (id, user_id, description, summary_json, sent_to, created_at)
       VALUES (@id, @user_id, @description, @summary_json, @sent_to, @created_at)`,
    )
    .run(row);
  return toView(row);
}

/** Newest first. */
export function listTeamRequests(userId: string): TeamRequestView[] {
  const rows = getDb()
    .prepare("SELECT * FROM team_requests WHERE user_id = ? ORDER BY created_at DESC")
    .all(userId) as TeamRequestRow[];
  return rows.map(toView);
}
