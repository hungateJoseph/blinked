/**
 * POST /api/assistant/workflow/screen  { description, skillsOn, tier?, devCode? }
 *
 * Pass one of the workflow analysis: is the request reasonable, and what are
 * its steps? Fast and cheap, so the browser can show the steps and start a
 * countdown for the slower cost-and-time pass. A tier above Standard needs
 * the dev code. When billing is on, the pass is charged its actual cost to
 * the photographer's credit — unless the dev code came with it, which is the
 * beta owner testing and is on the house.
 */
import { NextResponse } from "next/server";
import { AiError, isAiConfigured, screenWorkflowWithAi } from "@/lib/ai";
import { jsonError, readJson, unauthorized } from "@/lib/api";
import { LIMITS, SKILLS, estimatedSeconds } from "@/lib/assistant/catalog";
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
  if (description.length < 15) return jsonError("Describe what you're after in a sentence or two first.");

  const known = new Set<string>(SKILLS.map((s) => s.name));
  const skillsOn = Array.isArray(body.skillsOn)
    ? body.skillsOn.filter((s): s is string => typeof s === "string" && known.has(s))
    : [];

  const access = resolveTier(body);
  if ("error" in access) return jsonError(access.error, access.status);
  const comped = isValidDevCode(body.devCode);
  if (!comped && !canAffordRun(user.id)) {
    return NextResponse.json(
      { error: "Not enough credit for an analysis. Top up to continue.", topUp: "/assistant/credit" },
      { status: 402 },
    );
  }

  try {
    const { screen, usage } = await screenWorkflowWithAi({ description, skillsOn, tier: access.tier });
    const chargedCents = comped ? 0 : chargeAnalysis(user.id, usage, "Workflow analysis — screening");
    return NextResponse.json({
      screen,
      usage: { ...usage, chargedCents },
      estimatedSeconds: screen.reasonable ? estimatedSeconds(screen, access.tier) : 0,
      billing: { ...billingStatus(user.id), chargedCents, comped },
    });
  } catch (error) {
    if (error instanceof AiError) return jsonError(error.message, 502);
    console.error("[assistant] workflow screen:", error);
    return jsonError("Could not look at that right now. Please try again.", 500);
  }
}
