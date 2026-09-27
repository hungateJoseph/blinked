/**
 * "Sign in with Google" verification.
 *
 * The browser-side Google Identity Services widget hands us an ID token (a JWT
 * signed by Google). We verify its signature and audience here on the server
 * before trusting the email address inside it.
 */
import { OAuth2Client } from "google-auth-library";

export interface GoogleProfile {
  email: string;
  name: string | null;
  picture: string | null;
}

/** True when a Google OAuth client id has been configured. */
export function isGoogleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID);
}

/** Verify a Google ID token and return the profile it proves. Throws if invalid. */
export async function verifyGoogleIdToken(idToken: string): Promise<GoogleProfile> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    throw new Error("Google sign-in is not configured (GOOGLE_CLIENT_ID is empty).");
  }

  const client = new OAuth2Client(clientId);
  const ticket = await client.verifyIdToken({ idToken, audience: clientId });
  const payload = ticket.getPayload();

  if (!payload?.email || !payload.email_verified) {
    throw new Error("The Google account does not have a verified email address.");
  }

  return {
    email: payload.email,
    name: payload.name ?? null,
    picture: payload.picture ?? null,
  };
}
