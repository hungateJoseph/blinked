/**
 * The dev code that unlocks the bigger analysis models.
 *
 * One code, set as ANALYSIS_DEV_CODE on the server, never stored anywhere
 * else. The photographer testing the beta enters it once in the browser,
 * which sends it with each analysis; every request is checked here. A daily
 * cap on upgraded runs keeps a leaked code from running up the bill.
 */
import { timingSafeEqual } from "node:crypto";
import { rateLimit } from "../rateLimit";
import { ANALYSIS_TIERS, type AnalysisTier } from "./catalog";

/** Upgraded (non-standard) runs allowed per day, across everyone. */
export const DEV_RUNS_PER_DAY = 100;

export function devCodeConfigured(): boolean {
  return Boolean(process.env.ANALYSIS_DEV_CODE);
}

/** Constant-time comparison, so response timing cannot leak the code. */
export function isValidDevCode(code: unknown): boolean {
  const expected = process.env.ANALYSIS_DEV_CODE;
  if (!expected || typeof code !== "string" || code.length === 0) return false;
  const a = Buffer.from(code);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Which tier a request may run at. Standard needs nothing. Anything else needs
 * a valid code and a slot under the daily cap; the reason is a message for the
 * photographer when refused.
 */
export function resolveTier(body: {
  tier?: unknown;
  devCode?: unknown;
}): { tier: AnalysisTier } | { error: string; status: 403 | 429 } {
  const wanted = ANALYSIS_TIERS.includes(body.tier as AnalysisTier) ? (body.tier as AnalysisTier) : "standard";
  if (wanted === "standard") return { tier: "standard" };
  if (!isValidDevCode(body.devCode)) {
    return { error: "That tier needs a valid dev code.", status: 403 };
  }
  const slot = rateLimit("analysis-dev-runs", DEV_RUNS_PER_DAY, 24 * 60 * 60 * 1000);
  if (!slot.allowed) {
    return {
      error: `Today's limit of ${DEV_RUNS_PER_DAY} upgraded analyses is used up; Standard still works.`,
      status: 429,
    };
  }
  return { tier: wanted };
}
