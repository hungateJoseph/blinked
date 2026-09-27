/**
 * Sessions and user lookup.
 *
 * A logged-in user carries a signed JWT in an httpOnly cookie. The token only
 * contains the user id; everything else is loaded from the database on each
 * request. Signing uses `jose` with a secret from SESSION_SECRET.
 */
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb, type UserRow } from "./db";
import { newId, newPublicSlug, nowIso } from "./util";

const SESSION_COOKIE = "jwph_session";
const SESSION_DAYS = 30;

/** The secret used to sign cookies, as bytes. */
function getSecret(): Uint8Array {
  const fromEnv = process.env.SESSION_SECRET;
  if (fromEnv && fromEnv.length >= 16) return new TextEncoder().encode(fromEnv);

  if (process.env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET must be set (at least 16 characters) in production.");
  }
  // Development convenience only — see .env.example.
  return new TextEncoder().encode("dev-only-insecure-session-secret");
}

/** Log a user in: issue a token and store it in the session cookie. */
export async function createSession(userId: string): Promise<void> {
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(getSecret());

  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

/** Log the user out by removing the cookie. */
export async function clearSession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

/** The currently signed-in user, or null. Safe to call anywhere on the server. */
export async function getCurrentUser(): Promise<UserRow | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  // Read the secret outside the try: a misconfigured server must fail loudly
  // rather than be mistaken for "nobody is signed in", which would make every
  // page render as logged-out with nothing in the logs to explain why.
  const secret = getSecret();

  let userId: string;
  try {
    const { payload } = await jwtVerify(token, secret);
    if (!payload.sub) return null;
    userId = payload.sub;
  } catch {
    // Expired or tampered token — that one really does mean logged out.
    return null;
  }

  const row = getDb().prepare("SELECT * FROM users WHERE id = ?").get(userId) as
    | UserRow
    | undefined;
  return row ?? null;
}

/** For pages: get the user or send the visitor to the login page. */
export async function requireUser(): Promise<UserRow> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/**
 * Find the user with this email, or create one. Used by both sign-in methods
 * so a person who first used Google and later uses email gets the same account.
 */
export function findOrCreateUser(input: {
  email: string;
  name?: string | null;
  picture?: string | null;
  provider: "google" | "email";
}): UserRow {
  const db = getDb();
  const email = input.email.trim().toLowerCase();

  const existing = db.prepare("SELECT * FROM users WHERE email = ?").get(email) as
    | UserRow
    | undefined;
  if (existing) {
    // Fill in a name/picture we didn't have before (e.g. first Google login).
    if ((!existing.name && input.name) || (!existing.picture && input.picture)) {
      db.prepare("UPDATE users SET name = COALESCE(name, ?), picture = COALESCE(picture, ?) WHERE id = ?").run(
        input.name ?? null,
        input.picture ?? null,
        existing.id,
      );
      return { ...existing, name: existing.name ?? input.name ?? null, picture: existing.picture ?? input.picture ?? null };
    }
    return existing;
  }

  const user: UserRow = {
    id: newId(),
    email,
    name: input.name ?? null,
    picture: input.picture ?? null,
    provider: input.provider,
    public_slug: newPublicSlug(input.name),
    created_at: nowIso(),
  };
  db.prepare(
    `INSERT INTO users (id, email, name, picture, provider, public_slug, created_at)
     VALUES (@id, @email, @name, @picture, @provider, @public_slug, @created_at)`,
  ).run(user);
  return user;
}
