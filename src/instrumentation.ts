/**
 * Next.js runs `register()` once when the server starts, before it handles any
 * request. We use it to check the configuration up front, so a mistake shows
 * up as a clear message in the startup log instead of as strange behaviour
 * later on (for example everyone appearing to be signed out).
 */
export async function register(): Promise<void> {
  // Only the Node.js server runtime has our env vars and console.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const production = process.env.NODE_ENV === "production";
  const secret = process.env.SESSION_SECRET ?? "";

  if (production && secret.length < 16) {
    throw new Error(
      "SESSION_SECRET must be set to at least 16 characters in production. " +
        "Generate one with: openssl rand -hex 32",
    );
  }

  // Not errors — the app runs without these, with reduced features. Saying so
  // at startup saves a lot of confusion about why the AI 'is not working'.
  const notes: string[] = [];
  if (!secret) notes.push("SESSION_SECRET is empty — using the insecure development default.");
  if (!process.env.ANTHROPIC_API_KEY) {
    notes.push("ANTHROPIC_API_KEY is empty — using the rule-based scheduler and local blur check.");
  }
  if (!process.env.GOOGLE_CLIENT_ID) {
    notes.push("GOOGLE_CLIENT_ID is empty — Google sign-in is hidden.");
  }
  for (const note of notes) console.log(`[config] ${note}`);
}
