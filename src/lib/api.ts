/**
 * Tiny helpers shared by the API route handlers under src/app/api.
 */
import { NextResponse } from "next/server";

/** A JSON error response: `{ error: "message" }` with the given status. */
export function jsonError(message: string, status = 400): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

/** The 401 every protected route returns when nobody is signed in. */
export function unauthorized(): NextResponse {
  return jsonError("Please sign in first.", 401);
}

/** Parse a JSON request body, returning `{}` for a missing or malformed body. */
export async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await request.json();
    return typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
