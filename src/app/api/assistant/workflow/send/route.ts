/**
 * POST /api/assistant/workflow/send  { description, report }
 *
 * Send the steps a person or the developers have to handle to the team.
 * Stored first (the photographer's copy under Requests), then emailed.
 */
import { NextResponse } from "next/server";
import { jsonError, readJson, unauthorized } from "@/lib/api";
import { LIMITS, WorkflowReportSchema } from "@/lib/assistant/catalog";
import { addTeamRequest } from "@/lib/assistant/requests";
import { getCurrentUser } from "@/lib/auth";
import { sendTeamRequest } from "@/lib/mailer";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body = await readJson(request);
  const description =
    typeof body.description === "string" ? body.description.trim().slice(0, LIMITS.workflow) : "";
  const report = WorkflowReportSchema.safeParse(body.report);
  if (!description || !report.success) return jsonError("Analyse the request first.");

  const steps = report.data.steps
    .filter((s) => s.route === "human" || s.route === "engineering")
    .map((s) => ({
      title: s.title,
      route: s.route,
      tier: s.tier,
      roadblocks: s.cost.roadblock ? [s.cost.roadblock] : [],
    }));
  if (steps.length === 0) return jsonError("Nothing in this workflow needs the team.");

  try {
    const sent = await sendTeamRequest({
      photographer: { name: user.name, email: user.email },
      description,
      steps,
      totals: report.data.totals,
    });
    const stored = addTeamRequest(user.id, description, steps, sent.to);
    return NextResponse.json({ sentAt: stored.createdAt, sentTo: sent.to, delivery: sent.delivery });
  } catch (error) {
    console.error("[assistant] workflow send:", error);
    return jsonError("Could not send that to the team right now. Please try again.", 502);
  }
}
