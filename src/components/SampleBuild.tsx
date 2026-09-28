/**
 * A build, start to finish, as a static specimen for the landing page. The
 * figures are from a real run of the analysis on the request shown — not a
 * mock-up — so the page promises what the tool actually does.
 */

const REQUEST =
  "If the forecast for the wedding day goes above 100°F, order two cases of bottled water from Amazon to the venue for the morning, and text me every 15 minutes with a delivery update until it arrives.";

const STEPS = [
  {
    title: "Watch the forecast, trigger on heat",
    via: "Scheduled checks",
    tier: "Tier I",
    cost: "no direct cost",
    time: "runs the moment the condition is met",
  },
  {
    title: "Order two cases of water to the venue",
    via: "Amazon › Same-Day & Prime delivery",
    tier: "Tier I",
    cost: "$16–$24",
    time: "about 1–2 hours by Same-Day; 1–2 days shipped",
    recommendation: {
      label: "Faster with Instacart",
      detail: "Two cases from a nearby store, delivered in about an hour.",
      figures: "$18–$28 · about an hour · usually a few dollars more",
    },
  },
  {
    title: "Text a delivery update every 15 minutes",
    via: "SMS, email & calls",
    tier: "Tier I",
    cost: "30 texts × $0.01 = $0.30",
    time: "seconds per message",
  },
];

const CHAT = [
  { role: "user", text: "Order two cases of water to the venue for the Rivera wedding." },
  {
    role: "agent",
    text:
      "I can't place the order yet — that step runs on a backend that isn't live in this beta, so nothing has been ordered. Here's exactly what it would be, against your calendar entry (Rivera wedding, Oak Hollow Barn, Sat 17 Oct, afternoon): two cases of bottled water by Amazon delivery, roughly $12–$24, in about a two-hour window. I'd need the venue's street address and a name for whoever receives it. Want me to keep those details ready?",
  },
];

function Stage({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-4 border-t border-stone-200 py-6 md:grid-cols-[10rem_1fr]">
      <div>
        <p className="eyebrow">{n}</p>
        <h3 className="mt-1 text-xl">{title}</h3>
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export default function SampleBuild() {
  return (
    <div>
      <Stage n="01 / Describe" title="Say what you want done">
        <p className="rounded-md border border-stone-200 bg-surface p-4 text-[15px] leading-relaxed text-stone-800">
          {REQUEST}
        </p>
        <p className="mt-2 text-sm text-stone-500">
          Plain words. No forms, no picking from a menu of tasks.
        </p>
      </Stage>

      <Stage n="02 / Analyse" title="Get the plan, priced and timed">
        <ol className="space-y-4">
          {STEPS.map((s, i) => (
            <li key={s.title} className="grid gap-x-4 gap-y-1 sm:grid-cols-[1.5rem_1fr]">
              <span className="text-sm font-semibold text-stone-400">{i + 1}.</span>
              <div className="space-y-1">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="font-medium">{s.title}</span>
                  <span className="badge bg-rose-100 text-rose-800">{s.via}</span>
                  <span className="badge bg-stone-200 text-stone-700">{s.tier}</span>
                </div>
                <p className="text-sm text-stone-600">
                  {s.cost} <span className="text-stone-400">·</span> {s.time}
                </p>
                {s.recommendation && (
                  <p className="rounded-md bg-signal-soft px-3 py-2 text-sm text-stone-800">
                    <span className="font-medium">{s.recommendation.label}.</span> {s.recommendation.detail}{" "}
                    <span className="text-stone-600">{s.recommendation.figures}</span>
                  </p>
                )}
              </div>
            </li>
          ))}
        </ol>
        <p className="mt-4 border-t border-stone-200 pt-3 text-sm font-semibold text-stone-800">
          Roughly $16.30–$24.30 all-in · analysed in 14 s · charged 4¢
        </p>
      </Stage>

      <Stage n="03 / Adjust" title="Take a suggestion, or send it on">
        <p className="text-[15px] leading-relaxed text-stone-700">
          One click swaps the Amazon step for the Instacart option and re-totals the plan. A step that
          needs a person, or something the app can&apos;t do yet, goes to the team with the analysis
          attached, and you can see every request you&apos;ve sent.
        </p>
      </Stage>

      <Stage n="04 / Create the agent" title="Hand it over">
        <div className="space-y-3">
          {CHAT.map((m) => (
            <div key={m.text} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <p
                className={`max-w-[90%] rounded-md px-4 py-2.5 text-sm leading-relaxed ${
                  m.role === "user" ? "bg-stone-900 text-stone-50" : "border border-stone-200 bg-surface text-stone-800"
                }`}
              >
                {m.text}
              </p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-sm text-stone-500">
          The agent does the steps it can do now — the calendar, lookups, a photo — and for the rest
          it says plainly what it would do, and what it needs from you, until that backend goes live.
        </p>
      </Stage>
    </div>
  );
}
