/**
 * POST /api/assistant/workflow/dev  { code }
 *
 * Is this the dev code? The browser asks once when the code is entered (and
 * again on later visits) so it knows whether to show the tier picker. Every
 * analysis request is checked again on its own; this is only for the UI.
 * Attempts are rate limited per address so the code cannot be guessed.
 */
import { NextResponse } from "next/server";
import { jsonError, readJson, unauthorized } from "@/lib/api";
import { ANALYSIS_TIERS, TIER_INFO } from "@/lib/assistant/catalog";
import { devCodeConfigured, isValidDevCode } from "@/lib/assistant/devAccess";
import { getCurrentUser } from "@/lib/auth";
import { clientAddress, rateLimit } from "@/lib/rateLimit";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const attempt = rateLimit(`dev-code:${clientAddress(request)}`, 10, 60 * 60 * 1000);
  if (!attempt.allowed) return jsonError("Too many attempts. Try again later.", 429);

  const body = await readJson(request);
  if (!devCodeConfigured()) {
    return NextResponse.json({ ok: false, reason: "No dev code is configured on this server." });
  }
  const ok = isValidDevCode(body.code);
  return NextResponse.json({
    ok,
    tiers: ok ? ANALYSIS_TIERS.map((id) => ({ id, ...TIER_INFO[id] })) : [],
  });
}
