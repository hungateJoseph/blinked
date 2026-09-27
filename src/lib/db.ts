/**
 * SQLite database access.
 *
 * The whole beta runs on a single SQLite file at ./data/app.db, created on
 * first use. `better-sqlite3` is synchronous, which keeps the data layer very
 * easy to read: no awaits, no connection pools.
 */
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

// In production the database belongs on a mounted disk that survives
// redeploys, so the location is configurable. Locally it defaults to ./data.
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "app.db");

/**
 * Table definitions. `IF NOT EXISTS` makes this safe to run on every start-up.
 * Dates are "YYYY-MM-DD" strings, timestamps are ISO-8601 strings, and JSON
 * columns hold serialized objects (see the *_json names).
 */
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id          TEXT PRIMARY KEY,
    email       TEXT NOT NULL UNIQUE,
    name        TEXT,
    picture     TEXT,
    provider    TEXT NOT NULL,            -- 'google' or 'email'
    public_slug TEXT NOT NULL UNIQUE,     -- used in the public /p/<slug> page
    created_at  TEXT NOT NULL
  );

  -- One-time codes for email sign-in.
  CREATE TABLE IF NOT EXISTS login_codes (
    id         TEXT PRIMARY KEY,
    email      TEXT NOT NULL,
    code       TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used       INTEGER NOT NULL DEFAULT 0
  );

  -- Dates the photographer already has a wedding booked. A day may hold more
  -- than one booking (a morning ceremony and an evening reception), so there
  -- is deliberately no uniqueness constraint on (user_id, date); overlapping
  -- parts are checked in code, where a useful message can be returned.
  CREATE TABLE IF NOT EXISTS bookings (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date       TEXT NOT NULL,
    parts      TEXT NOT NULL,          -- JSON DayPart[], e.g. ["morning","evening"]
    label      TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS bookings_user_date ON bookings (user_id, date);

  -- Availability schedules. A user has at most one 'draft' (awaiting review)
  -- and one 'final' (published) schedule; older finals become 'archived'.
  CREATE TABLE IF NOT EXISTS schedules (
    id               TEXT PRIMARY KEY,
    user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status           TEXT NOT NULL,       -- 'draft' | 'final' | 'archived'
    range_start      TEXT NOT NULL,
    range_end        TEXT NOT NULL,
    preferences_json TEXT NOT NULL,
    slots_json       TEXT NOT NULL,       -- ScheduleSlot[] (see lib/schedule.ts)
    summary          TEXT NOT NULL,
    warnings_json    TEXT NOT NULL,
    source           TEXT NOT NULL,       -- 'ai' | 'rules'
    created_at       TEXT NOT NULL,
    finalized_at     TEXT
  );

  -- Uploaded wedding photos. The file itself lives in ./uploads/<user_id>/.
  -- The original is never modified: applying a cleanup plan writes a second
  -- file and records it in the edited_* columns, so reverting is just a matter
  -- of forgetting it.
  CREATE TABLE IF NOT EXISTS photos (
    id            TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    original_name TEXT NOT NULL,
    stored_name   TEXT NOT NULL,
    mime          TEXT NOT NULL,
    size          INTEGER NOT NULL,
    width         INTEGER NOT NULL,
    height        INTEGER NOT NULL,
    created_at    TEXT NOT NULL,
    edited_name   TEXT,                -- filename of the edited copy, or NULL
    edited_width  INTEGER,
    edited_height INTEGER,
    edited_size   INTEGER,
    edits_json    TEXT,                -- the Adjustments that produced it
    edited_at     TEXT
  );

  -- Faces found in uploaded photos, one row per face.
  --
  -- The descriptor is 128 numbers produced by a face-recognition model in the
  -- photographer's own browser; no face image is ever stored here and nothing
  -- is sent anywhere. Two faces are judged to be the same person by the
  -- distance between their descriptors.
  --
  -- This is biometric data about third parties (wedding guests), so it is kept
  -- separate from everything else, deleted with its photo, and clearable in
  -- one go from the People page.
  CREATE TABLE IF NOT EXISTS photo_faces (
    id            TEXT PRIMARY KEY,
    photo_id      TEXT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
    user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    descriptor    TEXT NOT NULL,   -- JSON number[128]
    box_json      TEXT NOT NULL,   -- where in the photo, as fractions 0-1
    confidence    REAL NOT NULL,   -- the detector's confidence this is a face
    created_at    TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS photo_faces_user ON photo_faces (user_id);
  CREATE INDEX IF NOT EXISTS photo_faces_photo ON photo_faces (photo_id);

  -- Standing discount rules, e.g. "20% off Mondays". Matching open slots are
  -- tagged when a schedule is saved, so a rule set once applies to every
  -- schedule from then on.
  CREATE TABLE IF NOT EXISTS discounts (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    label      TEXT NOT NULL,            -- short, shown to couples: "20% off"
    detail     TEXT NOT NULL DEFAULT '', -- optional longer explanation
    weekdays   TEXT NOT NULL,            -- JSON number[], 0 = Sunday
    parts      TEXT NOT NULL,            -- JSON DayPart[]
    date_start TEXT,                     -- optional window, NULL = always
    date_end   TEXT,
    created_at TEXT NOT NULL
  );

  -- Enquiries left by potential clients on the public availability page.
  -- Deliberately has no account: a couple should be able to ask about a date
  -- without signing up for anything. That makes this the only table written
  -- to by anonymous visitors, so everything reaching it is validated, capped
  -- and rate limited.
  CREATE TABLE IF NOT EXISTS enquiries (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date        TEXT,                     -- the slot asked about, if any
    part        TEXT,
    name        TEXT NOT NULL,
    email       TEXT NOT NULL DEFAULT '', -- at least one of email/phone is required
    phone       TEXT NOT NULL DEFAULT '',
    message     TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    read_at     TEXT,
    archived_at TEXT
  );
  CREATE INDEX IF NOT EXISTS enquiries_user ON enquiries (user_id, created_at DESC);

  -- The photographer's assistant ("Smart Photographer"): one per user. Its
  -- whole configuration — name, tone, which skills are on, the notes that
  -- extend each one — is a single JSON document, validated on the way in and
  -- out by lib/assistant/catalog.ts, so adding a setting never needs a
  -- migration.
  CREATE TABLE IF NOT EXISTS assistants (
    user_id     TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    config_json TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  );

  -- The conversation with the assistant, per channel ('web' now; 'sms' is
  -- planned). Only what each side said is kept — not the tool calls in
  -- between — so the history stays small enough to send back with every turn.
  CREATE TABLE IF NOT EXISTS assistant_messages (
    id               TEXT PRIMARY KEY,
    user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel          TEXT NOT NULL,
    role             TEXT NOT NULL,      -- 'user' | 'assistant'
    text             TEXT NOT NULL,
    attachments_json TEXT NOT NULL,      -- [{ photoId, variant }]
    created_at       TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS assistant_messages_user
    ON assistant_messages (user_id, channel, created_at);

  -- Actions the assistant has proposed but not carried out. Anything that
  -- changes data — a booking, say — is written here first, and only executed
  -- once the photographer confirms it in a *later* message. That rule is
  -- enforced here (see lib/assistant/tools.ts), not by asking the model nicely.
  CREATE TABLE IF NOT EXISTS assistant_actions (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel      TEXT NOT NULL,
    kind         TEXT NOT NULL,          -- 'add_booking' | 'remove_booking'
    payload_json TEXT NOT NULL,
    summary      TEXT NOT NULL,          -- the sentence the photographer confirms
    proposed_in  TEXT NOT NULL,          -- id of the message it was proposed during
    created_at   TEXT NOT NULL,
    expires_at   TEXT NOT NULL,
    resolved_at  TEXT,
    outcome      TEXT                    -- 'confirmed' | 'cancelled' | 'expired'
  );
  CREATE INDEX IF NOT EXISTS assistant_actions_user
    ON assistant_actions (user_id, channel, resolved_at);

  -- Workflow requests a photographer sent to the team: the steps a person or
  -- the developers have to handle. The email goes out at the same time; this
  -- is the copy the photographer can look back at.
  CREATE TABLE IF NOT EXISTS team_requests (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    description  TEXT NOT NULL,       -- what the photographer asked for
    summary_json TEXT NOT NULL,       -- the steps sent: title, route, tier, roadblocks
    sent_to      TEXT NOT NULL,
    created_at   TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS team_requests_user ON team_requests (user_id, created_at DESC);

  -- Prepaid credit for the workflow analysis, as a ledger: top-ups add,
  -- charges subtract, the balance is the sum. Money in comes only through
  -- Stripe (the site never sees a card); money out is the actual API cost of
  -- each analysis pass, rounded up to the cent.
  CREATE TABLE IF NOT EXISTS credit_ledger (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind         TEXT NOT NULL,          -- 'topup' | 'charge' | 'adjustment'
    amount_cents INTEGER NOT NULL,       -- positive adds credit, negative spends it
    description  TEXT NOT NULL,
    reference    TEXT UNIQUE,            -- e.g. a Stripe session id: a repeated webhook cannot credit twice
    created_at   TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS credit_ledger_user ON credit_ledger (user_id, created_at DESC);

  -- The photographer's mobile for texting the assistant, proven by a code
  -- sent to it. A verified number belongs to one account, which is how an
  -- incoming text is matched to its photographer.
  CREATE TABLE IF NOT EXISTS sms_numbers (
    user_id         TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    number          TEXT NOT NULL,          -- E.164, e.g. +15551234567
    verified_at     TEXT,                   -- NULL until the code comes back
    code_hash       TEXT,                   -- sha256 of the code that was sent
    code_expires_at TEXT,
    attempts        INTEGER NOT NULL DEFAULT 0,
    sends_json      TEXT NOT NULL DEFAULT '[]',  -- when codes went out, for the hourly cap
    updated_at      TEXT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS sms_numbers_verified
    ON sms_numbers (number) WHERE verified_at IS NOT NULL;

  -- Texts received, by the provider's message id, so a redelivered webhook
  -- is answered once.
  CREATE TABLE IF NOT EXISTS sms_inbound (
    sid        TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL
  );

  -- Results of the AI Image Cleanup tool, one row per analysis run.
  CREATE TABLE IF NOT EXISTS photo_analyses (
    id            TEXT PRIMARY KEY,
    photo_id      TEXT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
    sharpness     REAL NOT NULL,          -- local blur metric (higher = sharper)
    analysis_json TEXT NOT NULL,          -- PhotoAnalysis (see lib/ai.ts)
    answers_json  TEXT,                   -- the photographer's answers
    plan_json     TEXT,                   -- CleanupPlan once answers are in
    source        TEXT NOT NULL,          -- 'ai' | 'local'
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
  );
`;

// Next.js reloads server modules while you develop. Keeping the open
// connection on `globalThis` means we reuse it instead of opening a new file
// handle on every reload.
declare global {
  // eslint-disable-next-line no-var
  var __weddingDb: Database.Database | undefined;
}

/**
 * Bring an older database up to date.
 *
 * Run before foreign keys are switched on, because rebuilding a table means
 * dropping and recreating it, which foreign key enforcement would block.
 *
 * The only migration so far moves bookings from whole-day to parts-of-day. A
 * database created fresh already has the new shape, so the check is for the
 * `parts` column rather than a stored version number — that way it is correct
 * whether the file is new, already migrated, or still old.
 */
function migrate(db: Database.Database): void {
  const needsParts = () => {
    const columns = db.prepare("PRAGMA table_info(bookings)").all() as { name: string }[];
    return columns.length > 0 && !columns.some((c) => c.name === "parts");
  };
  if (!needsParts()) return;

  console.log("[db] Migrating bookings and schedules to parts-of-day…");

  db.transaction(() => {
    // Checked again inside the transaction: if another process migrated while
    // this one was starting up, its write is already committed by the time we
    // hold the write lock, and repeating the work would be wasted at best.
    if (!needsParts()) return;

    // SQLite cannot drop the old UNIQUE (user_id, date) constraint in place,
    // so the table is rebuilt. Existing bookings become all-day, which is what
    // a whole-day booking always meant.
    db.exec(`
      CREATE TABLE bookings_migrated (
        id         TEXT PRIMARY KEY,
        user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        date       TEXT NOT NULL,
        parts      TEXT NOT NULL,
        label      TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );
      INSERT INTO bookings_migrated (id, user_id, date, parts, label, created_at)
        SELECT id, user_id, date, '["morning","afternoon","evening"]', label, created_at
        FROM bookings;
      DROP TABLE bookings;
      ALTER TABLE bookings_migrated RENAME TO bookings;
      CREATE INDEX IF NOT EXISTS bookings_user_date ON bookings (user_id, date);
    `);

    // Stored schedules hold one slot per date. Each becomes three slots — one
    // per part — carrying the same status, so a schedule already published
    // keeps showing exactly the same availability to couples.
    const schedules = db.prepare("SELECT id, slots_json FROM schedules").all() as {
      id: string;
      slots_json: string;
    }[];
    const update = db.prepare("UPDATE schedules SET slots_json = ? WHERE id = ?");

    for (const row of schedules) {
      let slots: { date: string; part?: string; status: string; reason: string }[];
      try {
        slots = JSON.parse(row.slots_json);
      } catch {
        continue; // unreadable; leave it rather than lose it
      }
      if (!Array.isArray(slots) || slots.some((s) => s.part)) continue; // already migrated

      const expanded = slots.flatMap((slot) =>
        ["morning", "afternoon", "evening"].map((part) => ({ ...slot, part })),
      );
      update.run(JSON.stringify(expanded), row.id);
    }
  })();

  console.log("[db] Migration complete.");
}

/**
 * Add the columns that track an edited copy of a photo.
 *
 * Adding nullable columns needs no table rebuild, so unlike the parts-of-day
 * migration this is just a few ALTERs. Existing photos simply have no edited
 * copy, which is exactly right.
 */
function migratePhotoEdits(db: Database.Database): void {
  const columns = db.prepare("PRAGMA table_info(photos)").all() as { name: string }[];
  if (columns.length === 0 || columns.some((c) => c.name === "edited_name")) return;

  console.log("[db] Adding edited-photo columns…");
  db.transaction(() => {
    for (const sql of [
      "ALTER TABLE photos ADD COLUMN edited_name TEXT",
      "ALTER TABLE photos ADD COLUMN edited_width INTEGER",
      "ALTER TABLE photos ADD COLUMN edited_height INTEGER",
      "ALTER TABLE photos ADD COLUMN edited_size INTEGER",
      "ALTER TABLE photos ADD COLUMN edits_json TEXT",
      "ALTER TABLE photos ADD COLUMN edited_at TEXT",
    ]) {
      db.exec(sql);
    }
  })();
  console.log("[db] Done.");
}

/** Get the shared database connection, creating the file and tables if needed. */
export function getDb(): Database.Database {
  if (globalThis.__weddingDb) return globalThis.__weddingDb;

  fs.mkdirSync(DATA_DIR, { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL"); // better concurrency for a web server

  migrate(db); // before foreign_keys, so tables can be rebuilt
  migratePhotoEdits(db);
  db.exec(SCHEMA); // creates anything missing, including on a fresh database
  db.pragma("foreign_keys = ON"); // make the REFERENCES clauses above enforceable

  globalThis.__weddingDb = db;
  return db;
}

// ---------------------------------------------------------------------------
// Row types — these mirror the tables above one-to-one.
// ---------------------------------------------------------------------------

export interface UserRow {
  id: string;
  email: string;
  name: string | null;
  picture: string | null;
  provider: "google" | "email";
  public_slug: string;
  created_at: string;
}

export interface LoginCodeRow {
  id: string;
  email: string;
  code: string;
  expires_at: string;
  used: 0 | 1;
}

export interface BookingRow {
  id: string;
  user_id: string;
  date: string;
  /** JSON-encoded DayPart[]. Use `parseParts(JSON.parse(...))` when reading. */
  parts: string;
  label: string;
  created_at: string;
}

export interface PhotoFaceRow {
  id: string;
  photo_id: string;
  user_id: string;
  /** JSON number[128] from the face-recognition model. */
  descriptor: string;
  /** JSON { x, y, width, height } as fractions of the image. */
  box_json: string;
  confidence: number;
  created_at: string;
}

export interface DiscountRow {
  id: string;
  user_id: string;
  label: string;
  detail: string;
  /** JSON number[] — days of the week the rule applies to. */
  weekdays: string;
  /** JSON DayPart[]. */
  parts: string;
  date_start: string | null;
  date_end: string | null;
  created_at: string;
}

export interface EnquiryRow {
  id: string;
  user_id: string;
  date: string | null;
  part: string | null;
  name: string;
  email: string;
  phone: string;
  message: string;
  created_at: string;
  read_at: string | null;
  archived_at: string | null;
}

export interface ScheduleRow {
  id: string;
  user_id: string;
  status: "draft" | "final" | "archived";
  range_start: string;
  range_end: string;
  preferences_json: string;
  slots_json: string;
  summary: string;
  warnings_json: string;
  source: "ai" | "rules";
  created_at: string;
  finalized_at: string | null;
}

export interface PhotoRow {
  id: string;
  user_id: string;
  original_name: string;
  stored_name: string;
  mime: string;
  size: number;
  width: number;
  height: number;
  created_at: string;
  edited_name: string | null;
  edited_width: number | null;
  edited_height: number | null;
  edited_size: number | null;
  edits_json: string | null;
  edited_at: string | null;
}

export interface AssistantRow {
  user_id: string;
  /** JSON AssistantConfig — see lib/assistant/catalog.ts. */
  config_json: string;
  created_at: string;
  updated_at: string;
}

export interface AssistantMessageRow {
  id: string;
  user_id: string;
  channel: string;
  role: "user" | "assistant";
  text: string;
  /** JSON { photoId, variant }[]. */
  attachments_json: string;
  created_at: string;
}

export interface AssistantActionRow {
  id: string;
  user_id: string;
  channel: string;
  kind: string;
  payload_json: string;
  summary: string;
  proposed_in: string;
  created_at: string;
  expires_at: string;
  resolved_at: string | null;
  outcome: "confirmed" | "cancelled" | "expired" | null;
}

export interface TeamRequestRow {
  id: string;
  user_id: string;
  description: string;
  /** JSON { title, route, tier, roadblocks }[]. */
  summary_json: string;
  sent_to: string;
  created_at: string;
}

export interface SmsNumberRow {
  user_id: string;
  number: string;
  verified_at: string | null;
  code_hash: string | null;
  code_expires_at: string | null;
  attempts: number;
  /** JSON string[] of ISO times a code was sent. */
  sends_json: string;
  updated_at: string;
}

export interface CreditLedgerRow {
  id: string;
  user_id: string;
  kind: "topup" | "charge" | "adjustment";
  amount_cents: number;
  description: string;
  reference: string | null;
  created_at: string;
}

export interface PhotoAnalysisRow {
  id: string;
  photo_id: string;
  sharpness: number;
  analysis_json: string;
  answers_json: string | null;
  plan_json: string | null;
  source: "ai" | "local";
  created_at: string;
  updated_at: string;
}
