# Blinked (beta)

An agent builder. Describe a job in plain words and Blinked turns it into a plan — the steps,
who does each one (the assistant, a backend service, a person, or not yet possible), a rough
cost and a time — and then into an agent set up to carry it out. It is built for photographers
first: the schedule, the photo library, the people in the photos and the enquiries from couples
are what the agent draws on.

## What it does

- **Sign in** with the Google account you're already logged into in your browser, or with just an
  email address (a 6-digit one-time code).
- **Schedule** — enter the weddings you already have and how you like to work (working
  days and times, weddings per week, rest days, free-text notes). Availability is tracked per
  **part of day** — morning, afternoon, evening — so a morning ceremony and an evening reception
  are separate bookings, and the afternoon in between can still be offered. The AI drafts a
  schedule for the period you choose. You review it — click any strip to flip that part of that
  day — then finalize. The result is published at a shareable link (`/p/<your-slug>`) showing
  couples which times are open, without revealing why the others are taken. Unpublish takes it
  back down whenever you want.
- **Offers** — standing rules such as "20% off Mondays", optionally limited to certain times of
  day or a date range. Matching open times are tagged automatically when you publish, and appear in
  their own colour on your public page with the offers listed above the calendar.
- **Enquiries** — couples click an open time on your public page and send an enquiry with a message
  and an email or phone number. **No account needed** — asking someone to sign up to ask a question
  would lose you the booking. They land under Enquiries and you get an email you can reply to
  directly. Because that endpoint is open to the internet it is defended by a honeypot field, a
  per-address rate limit and strict validation.
- **Google Drive import** — pick photos from Drive instead of your computer, through Google's own
  file picker. Blinked is granted access only to the files you choose, never your whole Drive, and
  the files pass through your browser rather than the server holding a Google token.
- **Photo library** — upload wedding photos (as many at a time as you like) and run the
  **AI Image Cleanup** tool. It scans for obvious irregularities — blur, faces cut off by the frame,
  closed eyes, exposure and colour problems, distractions — lists what it found and where, asks you
  follow-up questions (was the blur intentional? is a tighter crop OK?), and turns your answers
  into a step-by-step cleanup plan.
- **People** — for when a couple asks for "all the ones with Grandma". Once your photos are
  scanned, everyone found in them is grouped into distinct people and shown as a row of faces:
  **pick a guest out of your own photographs** rather than going to find a headshot of each one.
  You can also click someone directly on a photo you are viewing ("People in this photo"), or
  upload a picture of somebody not in the library yet. **All the recognition runs in your browser**:
  each photo is scanned on your own machine and only 128 numbers per face are stored — never a face
  image, and never sent to any third party. Results are ranked and you confirm each one, because
  the gap between "same person" and "different person" is real but narrow.
- **Assistant (Smart Photographer)** — your own assistant. Pick its skills from a row of chips (Scheduling,
  Photo touch-up, Look things up — each expands to show what it covers), tap a suggested one
  (Negotiate, Venue scout, Enquiry replies, Day briefing) to add it, and write anything else in
  one box — the **brief**: "don't offer any date within two days of a lunar eclipse", or a whole
  new skill in a sentence. The brief is checked against the fixed list of what the assistant can
  and cannot do, item by item, so you are told which part you'll get ("Negotiate: yes — it reads
  enquiries and searches local rates; it can't send the reply"). Two tones: *concise* (no
  suggestions) or *advisory* (still short, but suggests a follow-up or exactly what to add to
  your brief).
- **AgentDex (beta)** — one box: describe what your agent should do, anything, and get a
  **workflow analysis** in three parts. The analysis assumes a catalogue of **supported backends**
  is wired up — Amazon purchases, AWS storage and editing software, Fiverr, TaskRabbit, PayPal
  and Stripe, SMS/email/calls, and scheduled checks — each shown on the page with an example and
  tagged *beta*, because none is live yet. A step that needs one goes straight to it (priced from
  what the vendor charges, timed, never "unsupported") instead of the model working out from
  scratch how ordering or texting could happen, which is what makes the analysis fast. Its parts:
  *feasibility* (legal, ethical, sane, under ~$100 → feasible; each step routed to the assistant,
  a third-party AI service, a person on the team, or new site functionality, with a tier 0–III),
  *rough cost* (goods with priced options, service fees, team time at $40/hour, roadblocks where a
  figure can't be found, a warning over $100) and *time* (an estimate where there is one; "send
  it to the team" where only a person can say). A countdown shows how long the estimate will
  take. One click takes what the assistant can do into your assistant's brief (creating the
  assistant if you have none yet); another sends the rest to the team, with your copy under
  Requests. Analyses are paid from prepaid credit (see below).
- **Talking to the assistant** — ask about your calendar and enquiries, or attach a photo and get
  it back corrected in your chosen style. Anything that changes data — adding a booking — it
  proposes first and does only after you say yes in a later message; that rule is enforced by
  the server, not by asking the model nicely. Text-message and email channels are the planned
  next step; the same assistant, with the same settings, will answer those.
- **Applying the plan** — the steps Blinked can carry out itself are applied to the photo in the
  browser, with a before/after and a download. That covers exposure, highlights, shadows, contrast,
  colour temperature, saturation, sharpening, noise, straightening and cropping. Anything
  generative — rebuilding a cut-off head, removing an object, swapping in open eyes — is labelled
  "needs an editor" and left as instructions. Your original is never modified, so Revert always works.

## Quick start

```bash
npm install
cp .env.example .env.local   # then fill in whatever you have (see below)
npm run dev
```

Open <http://localhost:3000>. The first run creates `data/app.db` (SQLite) and, on your first
upload, an `uploads/` folder. Both are git-ignored.

`npm test` runs the unit tests in `tests/` — the configuration, the system prompt, the tools and
their confirmation gate, the store, the workflow report, tiers, billing, backends, recommendations,
the agent and texting — against a throwaway database, with no model calls. Node runs the app's
TypeScript directly; nothing is compiled first.

## Configuration (`.env.local`)

| Variable                       | Needed for                   | Without it                                                                                  |
| ------------------------------ | ---------------------------- | ------------------------------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY`            | AI scheduling, AI cleanup, Smart Photographer | A rule-based scheduler runs (notes are ignored), the cleanup tool only does a local blur check, and the assistant cannot answer. |
| `GOOGLE_CLIENT_ID` | "Continue with Google", Drive import | The Google button is hidden; email sign-in still works.                      |
| `GOOGLE_API_KEY`   | Importing photos from Google Drive | The Drive section is hidden; uploading from disk is unaffected.               |
| `SESSION_SECRET`               | Signing the login cookie     | A built-in placeholder is used in development. **Required** in production.                  |
| `ANALYSIS_DEV_CODE`            | Bigger models for the workflow analysis | Only the Standard (Haiku) tier exists.                                           |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Prepaid credit for analyses (see DEPLOY.md) | Billing is off: analyses are free and the credit page says so.      |

- Anthropic key: <https://console.anthropic.com/>
- Google client id: create an *OAuth 2.0 Client ID → Web application* at
  <https://console.cloud.google.com/apis/credentials> and add `http://localhost:3000` under
  *Authorized JavaScript origins*.
- Google API key (Drive import only): in the same project, enable **Google Drive API** and
  **Google Picker API** under *APIs & Services → Library*, then create an API key. Blinked asks
  only for the `drive.file` scope — access to the files you pick in Google's own picker and
  nothing else — so no Google verification review is needed. The broader `drive.readonly` scope
  is "restricted" and would require one.
- Session secret: `openssl rand -hex 32`

## How the code is organized

```
src/
  app/
    layout.tsx            frame around every page (nav + content)
    page.tsx              home: Calendar/Planning + Photo Management sections
    login/                sign-in page
    schedule/             Calendar/Planning page
    photos/               Photo Management list; photos/[id]/ is one photo + the cleanup tool
    assistant/            Smart Photographer: the chat, or the setup wizard until one exists;
                          assistant/setup/ edits it
    p/[slug]/             public availability page (no login)
    api/
      auth/               google, email/start, email/verify, logout
      bookings/           booked dates (list, add, delete)
      schedule/           current schedule; generate (AI or rules); finalize; unpublish
      photos/             upload/list; [id] details + delete; [id]/file bytes;
                          [id]/analyze runs the scan; [id]/answers builds the plan
      assistant/          the configuration; assistant/messages sends a message and returns the
                          reply; assistant/skills/assess checks the brief against CAPABILITIES;
                          assistant/workflow/screen + analyze are the two passes of the workflow
                          analysis; assistant/workflow/send emails the team and keeps a copy
  components/             React components (ScheduleBuilder, PhotoCleanup, MonthCalendar, …)
  instrumentation.ts      startup configuration check (runs once, before any request)
  lib/
    ai.ts                 every model call (structured, schema-validated outputs)
    parts.ts              morning / afternoon / evening, and how they are named
    discounts.ts          standing offer rules and how they tag open slots
    enquiries.ts          messages from couples: validation and storage
    rateLimit.ts          in-memory limiter guarding the public endpoint
    assistant/
      catalog.ts          the skills, style presets, CAPABILITIES and configuration schema (browser-safe)
      tools.ts            what each skill can do, as tools; the propose-then-confirm gate
      run.ts              the system prompt and the tool-use loop for one message
      touchUp.ts          the no-questions-asked touch-up pipeline
      store.ts            SQL for the configuration, conversation and proposed actions
    faces.ts              face descriptors and matching (arithmetic only, no ML)
    faceClient.ts         browser-side face detection; lazily loads the model
    schedule.ts           schedule types, the rule-based generator, applyHardRules
    scheduleStore.ts      SQL for bookings/schedules/public availability
    photos.ts             file storage, image resizing, blur metric, applying edits
    adjustments.ts        putting a set of adjustments into words (browser-safe)
    photoStore.ts         SQL for photos/analyses + non-AI fallbacks
    auth.ts, google.ts    sessions (signed cookie) and Google token verification
    mailer.ts             where to plug in an email provider
    db.ts                 SQLite connection + table definitions
    clientApi.ts          safe response parsing for browser components
    dates.ts, util.ts     small helpers
```

Design notes:

- Every AI call in `lib/ai.ts` asks the model (its id is set once, at the top of `lib/ai.ts`) for JSON that matches a Zod schema, so
  the rest of the app works with typed data and never parses free text.
- The AI and rule-based generators return the same `ScheduleDraft` shape; the UI does not know
  which one ran (it just shows a "drafted by AI" or "rule-based draft" badge).
- Uploaded files are never served from a public folder — `/api/photos/:id/file` checks ownership,
  and every photo/analysis query is scoped to the signed-in user in SQL rather than by convention.
- `applyHardRules` runs on every schedule before it is stored, so a part of a day you have already
  booked can never be published as available — whoever produced the slots (the AI, the rules, or a
  request sent straight to the API) and whenever the booking was added.
- The database migrates itself on start-up. Moving to parts-of-day rebuilt the bookings table (to
  drop the old one-booking-per-day constraint) and expanded stored schedules from one slot per date
  to three, so an already-published page keeps showing couples exactly what it showed before.
- The assistant is one configurable assistant per photographer, not an open agent builder. Each
  built-in skill is a fixed set of tools plus a prompt section. Skills that are off are not
  disallowed — their tools are simply absent. Everything the photographer writes goes into one
  brief, which the model splits into items — a change to a built-in skill, or a new skill — and
  checks against `CAPABILITIES` (the honest list of what the assistant can and cannot do). The
  result is stored with the exact brief it was made for, so a later edit is visibly "unchecked"
  and is re-checked on save; while current, the verdicts and per-item operating instructions go
  into the prompt alongside the brief itself. A brief may read everything the photographer owns
  but change nothing: the write tools stay behind the Scheduling skill's own switch. Anything that
  changes data goes through `add_booking` → recorded as a proposal → `confirm_action`, which
  refuses to run in the same message the proposal was made in, so the photographer always gets a
  turn in between.
- The workflow analysis runs on the cheapest model (Haiku 4.5): about a cent per analysis plus a
  cent per web search. It is two passes: a screen (reasonable or not, the steps, each routed to a
  backend, and the brief lines) and the pricing, which is **one small call per step, all at
  once** — so the wait is the slowest step, not the sum — with at most one search each. Steps on
  a backend with a known tariff (texts, scheduled checks, payment requests) and steps that cost
  nothing (the assistant's, the photographer's, engineering) need no call at all, so a request
  the assistant can do by itself is analysed in about five seconds.
- Where another supported backend would do a step clearly faster or clearly cheaper — water
  from Instacart in about an hour rather than Amazon by tomorrow — the analysis says so under
  the step, with that option's own price, time and trade-off (it is priced in the same parallel
  pass). "Use Instacart instead" swaps it in and re-totals the report; "Analyse again" brings
  the original back.
- Amazon, AWS, Fiverr and TaskRabbit each have a list of specialities (Amazon Prints, S3,
  Rekognition, Nova Canvas, MediaConvert, photo retouching, wedding video editing, album design,
  Wait for Delivery, Event Staffing, and so on — about fifty in all, named as the vendors name
  them). A step on one of those backends names its speciality, "Fiverr › Wedding video editing"
  rather than just "Fiverr", and is priced from that speciality's typical rate. The AgentDex page
  shows three or four per backend, with the rest behind "more".
- **Texting** (beta, Twilio): under Smart Photographer → Texting a photographer verifies their
  mobile with a six-digit code, then texts the assistant and gets short replies back on its own
  "sms" channel; the assistant can also text them (`send_text`), and only them. Twilio posts
  each incoming text to `/api/sms/twilio`, signature-checked; the webhook is acknowledged at
  once and the answer follows as its own text once the assistant has it. Thirty texts a day per
  photographer, replies cut at about three segments, photos not supported by text. Without
  `TWILIO_*` configured, outgoing texts go to the server console and the code is shown on the
  page in development. Setup steps are in DEPLOY.md.
- **Create Agent** (beta): once the analysis looks right, the button keeps a snapshot of the
  workflow as the photographer's agent and opens its chat at `/agentdex/agent`. The agent is the
  Smart Photographer on its own conversation channel ("agent"), with the workflow's steps in its
  prompt and the step titles as tap-to-ask chips. In this beta it does the steps it can do
  itself — lookups, the calendar, a photo touch-up — and for anything on a backend or with a
  person it says it cannot run it yet and lays out exactly what it would do, with the cost and
  time from the analysis. It never claims to have ordered, hired, edited or sent anything. A **dev code** (`ANALYSIS_DEV_CODE`, entered once on the
  Skills step) unlocks a model picker — *Balanced* (Sonnet 5, ~5–10¢) and *Thorough* (Opus 5 with
  thinking, ~15–40¢) — and a readout of what each run actually used and cost. The code is checked
  on every request, in constant time, with guesses rate-limited and upgraded runs capped at 100 a
  day, so a leaked code cannot run up the bill. Two passes: a screen (reasonable or not, the steps, each
  with a route) and an estimate (money and time per step). Tiers, human cost and totals are
  computed in code from the route, not by the model — so a tier can never be wrong for its route,
  steps the assistant or the photographer does never bill anything, a step on a supported backend
  costs what the vendor charges and no team time (Tier I for a service, II for Fiverr and
  TaskRabbit, where a person does the work), and a step that needs engineering — now only what no
  backend covers — is not priced at all: it says "needs the developers" and goes to the team.
  `INTEGRATIONS` in `catalog.ts` is the backend catalogue; adding one there puts it in the prompt,
  the tiers and the AgentDex page at once.
  Requests sent to the team go to `TEAM_EMAIL` (a single beta inbox by default).
- Analyses are paid for from prepaid credit, kept as a ledger (`credit_ledger`): top-ups in,
  charges out, the balance is the sum. Money comes in only through Stripe Checkout — a hosted
  page, so no card detail ever reaches this site — and is credited by Stripe's signed webhook,
  idempotently on the session id, never on the "thank you" page (landing pages can be faked;
  signatures cannot). Each analysis pass is charged its actual API cost rounded up to the cent,
  a run is refused before it starts if the balance could not cover one, and runs made with the
  dev code are not charged. The credit pays for the analysis only, not for the goods or services
  it prices.
- The stored configuration is one JSON document with a default for every field, so a setting can
  be added without a migration; `parseAssistantConfig` also upgrades earlier shapes (house rules →
  standing instructions, the old tone names, per-skill notes and separately described custom
  skills → lines of the brief).
- Dates are plain `YYYY-MM-DD` strings everywhere so time zones can't shift a wedding by a day.
  "Today" is worked out on the server and passed to the browser, so the two always agree.

## Beta limitations

- Email codes are sent through [Resend](https://resend.com) when `RESEND_API_KEY` is set; without
  it they are printed to the server console and shown on the login page. The login page stops
  showing the code the moment real delivery is configured, and in production with no mailer,
  email sign-in refuses the request rather than claiming to have sent an email.
- Face matching is biometric processing of people who never signed up for anything. Under GDPR
  those guests' explicit consent is needed, and Illinois, Texas and Washington have their own
  statutes with per-person penalties. Running it all locally reduces exposure but does not satisfy
  those rules by itself — it belongs in the client contract.
- Face scanning runs on the photographer's machine, so it is as fast as that machine. A large
  library takes a while, and the model weights (~13 MB) download once per visit.
- Edits are applied to the uploaded JPEG, which has far less latitude than a RAW file — recovering
  blown highlights from a JPEG recovers much less. Good for proofs and quick fixes, not a
  replacement for a RAW workflow.
- There is no generative editing: nothing in the stack can rebuild a clipped head or remove an
  object, so those steps stay manual. The model reads images but does not produce them.
- SQLite + a local disk means a single instance. That is fine well past a beta, but the app cannot
  be scaled horizontally, and serverless hosts like Vercel will not work at all (their filesystems
  are temporary). Outgrowing it means moving to Postgres + object storage.
- Enquiries hold other people's personal data (a name, an email or phone number). There is a Delete
  button that really deletes, but no automatic retention limit yet — worth adding before this has
  many real users, alongside a privacy policy.
- The assistant answers in the app only. Text messages need a business texting number (a Twilio
  toll-free number with verification — US carriers block unverified business texting), and the
  reply must be sent asynchronously; that is the next channel to build. Each message costs the model
  calls (a photo touch-up is two vision calls plus the conversation), and a web search or page
  read is billed per use, so there is a cap of 150 messages per account per day, and at most three
  searches and three page reads per message. Replies are synchronous — a
  photo takes half a minute or so, which the chat shows as a progress stripe.
- The enquiry rate limiter keeps its counters in memory. That is accurate while Blinked runs as one
  instance, which it must anyway because of SQLite; on more than one it would become per-instance
  and silently allow more through.

## Deploying

See **[DEPLOY.md](./DEPLOY.md)** for the full walkthrough (Render + a custom domain, ~$8/month).

The app ships as a Docker image and `render.yaml` defines the service, so the deployment is
described in the repo rather than clicked into a dashboard. Two environment variables matter in
production and have no effect locally:

| Variable     | Purpose                                                        |
| ------------ | -------------------------------------------------------------- |
| `DATA_DIR`   | Where `app.db` lives. Must be on a disk that survives redeploys. |
| `UPLOAD_DIR` | Where photos are written. Same requirement.                     |

Build and run the production image locally with:

```bash
docker build -t blinked .
docker run -p 3000:3000 -v "$PWD/.localdata:/var/data" \
  -e SESSION_SECRET="$(openssl rand -hex 32)" blinked
```

## Scripts

| Command             | What it does                        |
| ------------------- | ----------------------------------- |
| `npm run dev`       | development server with hot reload |
| `npm run build`     | production build + type check      |
| `npm start`         | serve the production build         |
| `npm run typecheck` | TypeScript only                    |
