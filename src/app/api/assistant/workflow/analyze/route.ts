/**
 * POST /api/assistant/workflow/analyze  { description, screen, screenUsage?, tier?, devCode? }
 *
 * Pass two: rough cost and time for each step the screen produced, combined
 * into the report (tiers, human cost and totals are computed here, not by
 * the model). An unreasonable screen needs no second pass: the report simply
 * echoes it. The screen's usage comes back from the browser so the stored
 * readout covers both passes. Charged to credit like the first pass, unless
 * the dev code came with it.
 */
import { NextResponse } from "next/server";
import { AiError, estimateWorkflowWithAi, isAiConfigured } from "@/lib/ai";
import { jsonError, readJson, unauthorized } from "@/lib/api";
import {
  AnalysisUsageSchema,
  LIMITS,
  WorkflowScreenSchema,
  addUsage,
  buildReport,
  type StoredWorkflow,
} from "@/lib/assistant/catalog";
import { isValidDevCode, resolveTier } from "@/lib/assistant/devAccess";
import { getCurrentUser } from "@/lib/auth";
import { billingStatus, canAffordRun, chargeAnalysis } from "@/lib/billing";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!isAiConfigured()) {
    return jsonError("Analysing a request needs ANTHROPIC_API_KEY to be configured on the server.", 503);
  }

  const body = await readJson(request);
  const description =
    typeof body.description === "string" ? body.description.trim().slice(0, LIMITS.workflow) : "";
  const screen = WorkflowScreenSchema.safeParse(body.screen);
  if (!description || !screen.success) return jsonError("Run the first pass before this one.");
  const screenUsage = AnalysisUsageSchema.safeParse(body.screenUsage);

  const access = resolveTier(body);
  if ("error" in access) return jsonError(access.error, access.status);
  const comped = isValidDevCode(body.devCode);
  if (screen.data.reasonable && !comped && !canAffordRun(user.id)) {
    return NextResponse.json(
      { error: "Not enough credit to finish the analysis. Top up to continue.", topUp: "/assistant/credit" },
      { status: 402 },
    );
  }

  try {
    let estimate = null;
    let usage = screenUsage.success ? screenUsage.data : null;
    let chargedCents = 0;
    if (screen.data.reasonable) {
      const result = await estimateWorkflowWithAi({ description, screen: screen.data, tier: access.tier });
      estimate = result.estimate;
      chargedCents = comped ? 0 : chargeAnalysis(user.id, result.usage, "Workflow analysis — estimate");
      const withCharge = { ...result.usage, chargedCents };
      usage = usage ? addUsage(usage, withCharge) : withCharge;
    }
    const workflow: StoredWorkflow = {
      description,
      report: buildReport(screen.data, estimate),
      analysedAt: new Date().toISOString(),
      sentAt: null,
      analysedWith: usage,
    };
    return NextResponse.json({ workflow, billing: { ...billingStatus(user.id), chargedCents, comped } });
  } catch (error) {
    if (error instanceof AiError) return jsonError(error.message, 502);
    console.error("[assistant] workflow analyze:", error);
    return jsonError("Could not estimate that right now. Please try again.", 500);
  }
}
