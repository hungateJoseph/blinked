import Link from "next/link";
import { BackendGrid, BackendMark, BackendStrip } from "@/components/Backends";
import SampleBuild from "@/components/SampleBuild";
import { INTEGRATION_IDS, SPECIALTIES } from "@/lib/assistant/catalog";
import { getAssistant } from "@/lib/assistant/store";
import { getCurrentUser } from "@/lib/auth";
import { countUnread } from "@/lib/enquiries";

/** Home: the landing page for visitors, a short dashboard for people signed in. */
export default async function HomePage() {
  const user = await getCurrentUser();
  if (user) {
    const config = getAssistant(user.id);
    return <Dashboard name={user.name} unread={countUnread(user.id)} hasAssistant={config !== null} hasAgent={!!config?.agent} />;
  }
  return <Landing />;
}

const STEPS = [
  {
    n: "1",
    title: "Describe",
    text: "Type the job the way you would say it to a person. No forms, no menu of tasks.",
  },
  {
    n: "2",
    title: "Get the plan",
    text: "Each step lands on the backend that handles it, with a price and a time. Faster or cheaper options are flagged and swap in with one click.",
  },
  {
    n: "3",
    title: "Create the agent",
    text: "A chat set up for that workflow, every step one tap away. Text it from your phone or hand a step to the team.",
  },
];

const FEATURES = [
  {
    icon: "plan",
    title: "Priced, timed plans",
    text: "Every request becomes steps with a cost and a duration. Three depths of analysis, from a quick pass to a careful one, charged at what they use.",
  },
  {
    icon: "route",
    title: "Routed to real backends",
    text: "Amazon, Instacart, AWS, Fiverr, TaskRabbit, payments, texting and scheduled checks, each with its sub-services named the way the vendor names them.",
  },
  {
    icon: "swap",
    title: "Recommendations",
    text: "Where another backend would be clearly faster or cheaper, the plan says so, prices it, and swaps it in with one click.",
  },
  {
    icon: "agent",
    title: "Create Agent",
    text: "One click turns the plan into an agent with its own chat. It reads your calendar and enquiries, looks things up, and touches up a photo you send it.",
  },
  {
    icon: "sms",
    title: "Text it from anywhere",
    text: "Verify your mobile once, then text the agent from the road and get short replies back. It can text you, and only you.",
  },
  {
    icon: "team",
    title: "Hand-off to the team",
    text: "A step that needs a person, or something the app can't do yet, goes to the team with the analysis attached. Credit is prepaid and charged at cost.",
  },
];

const USES = [
  {
    title: "The hot wedding day",
    text: "Water to the venue if the forecast tips over, a text when it lands.",
    via: ["automation", "amazon", "comms"] as const,
  },
  {
    title: "The week after",
    text: "Clips cut into a highlight film, an album designed and printed, the RAW files archived for ten years.",
    via: ["fiverr", "amazon", "aws"] as const,
  },
  {
    title: "All the ones with Grandma",
    text: "Every photo of one guest picked out of two thousand, the best thirty retouched, framed prints delivered.",
    via: ["fiverr", "amazon", "taskrabbit"] as const,
  },
  {
    title: "On the road",
    text: "Text from the car: what's booked Saturday, is the 24th free, has the couple replied.",
    via: ["comms"] as const,
  },
];

function Landing() {
  return (
    <div className="space-y-24">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-3xl bg-stone-950 px-6 py-14 text-white sm:px-10 sm:py-20">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-40 right-[-10%] h-[28rem] w-[28rem] rounded-full opacity-60 blur-3xl"
          style={{ background: "radial-gradient(closest-side, #6366f1, transparent)" }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute bottom-[-12rem] left-[-6rem] h-[24rem] w-[24rem] rounded-full opacity-40 blur-3xl"
          style={{ background: "radial-gradient(closest-side, #0ea5e9, transparent)" }}
        />
        <div className="relative grid gap-12 lg:grid-cols-[1.1fr_1fr] lg:items-center">
          <div className="space-y-7">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-semibold text-stone-200">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              Beta · agent builder
            </span>
            <h1 className="max-w-xl text-[2.75rem] leading-[1.02] sm:text-6xl">
              Describe the job.
              <br />
              Get an agent that runs it.
            </h1>
            <p className="max-w-lg text-lg leading-relaxed text-stone-300">
              Blinked turns a plain request into a step-by-step plan, priced and timed on real backends,
              and then into an agent set up to carry it out. Built for photographers first.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Link href="/login" className="btn-primary px-5 py-3 text-base">
                Start building
              </Link>
              <a
                href="#how"
                className="btn border border-white/20 bg-white/5 px-5 py-3 text-base text-white hover:bg-white/10"
              >
                See a live build
              </a>
            </div>
            <dl className="flex flex-wrap gap-x-8 gap-y-3 pt-2 text-sm text-stone-400">
              <div>
                <dt className="sr-only">Backends</dt>
                <dd>
                  <span className="font-display text-xl font-bold text-white">{INTEGRATION_IDS.length}</span> backends
                </dd>
              </div>
              <div>
                <dt className="sr-only">Specialities</dt>
                <dd>
                  <span className="font-display text-xl font-bold text-white">{SPECIALTIES.length}</span> named
                  specialities
                </dd>
              </div>
              <div>
                <dt className="sr-only">Analysis time</dt>
                <dd>
                  <span className="font-display text-xl font-bold text-white">10–15 s</span> per analysis
                </dd>
              </div>
            </dl>
          </div>
          <HeroPanel />
        </div>
      </section>

      {/* Backend strip */}
      <section className="-mt-12 space-y-4">
        <p className="text-sm font-medium text-stone-500">Plans route to</p>
        <BackendStrip />
      </section>

      {/* Backends */}
      <section id="backends" className="scroll-mt-24 space-y-8">
        <div className="max-w-2xl">
          <p className="eyebrow">Backends</p>
          <h2 className="mt-2 text-3xl sm:text-4xl">Every step lands somewhere real</h2>
          <p className="mt-3 text-lg text-stone-600">
            A step reads &ldquo;Fiverr › Wedding video editing&rdquo;, not just &ldquo;Fiverr&rdquo;. Each
            backend comes with its sub-services and typical prices, so the plan is priced from the
            speciality that fits.
          </p>
        </div>
        <BackendGrid />
      </section>

      {/* How it works */}
      <section id="how" className="scroll-mt-24 space-y-8">
        <div className="max-w-2xl">
          <p className="eyebrow">How it works</p>
          <h2 className="mt-2 text-3xl sm:text-4xl">From words to a working agent</h2>
        </div>
        <ol className="grid gap-4 md:grid-cols-3">
          {STEPS.map((s) => (
            <li key={s.n} className="card p-6">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-rose-600 font-display text-base font-bold text-white">
                {s.n}
              </span>
              <h3 className="mt-4 text-xl">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-stone-600">{s.text}</p>
            </li>
          ))}
        </ol>
        <div className="overflow-hidden rounded-2xl border border-stone-200 bg-surface shadow-sm">
          <div className="flex items-center gap-2 border-b border-stone-200 bg-stone-50 px-4 py-2.5">
            <span className="h-2.5 w-2.5 rounded-full bg-stone-300" />
            <span className="h-2.5 w-2.5 rounded-full bg-stone-300" />
            <span className="h-2.5 w-2.5 rounded-full bg-stone-300" />
            <span className="ml-3 text-xs font-medium text-stone-500">
              A real run, start to finish. Nothing is mocked up.
            </span>
          </div>
          <div className="px-5 sm:px-8">
            <SampleBuild />
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="scroll-mt-24 space-y-8">
        <div className="max-w-2xl">
          <p className="eyebrow">Features</p>
          <h2 className="mt-2 text-3xl sm:text-4xl">Everything the agent brings with it</h2>
        </div>
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <li key={f.title} className="card p-6">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-rose-50 text-rose-600">
                <Icon name={f.icon} />
              </span>
              <h3 className="mt-4 text-lg">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-stone-600">{f.text}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* Uses */}
      <section className="space-y-8">
        <div className="max-w-2xl">
          <p className="eyebrow">Built for photographers first</p>
          <h2 className="mt-2 text-3xl sm:text-4xl">Things a photographer actually asks for</h2>
        </div>
        <ul className="grid gap-4 sm:grid-cols-2">
          {USES.map((u) => (
            <li key={u.title} className="card flex items-start gap-4 p-5">
              <div className="flex -space-x-2">
                {u.via.map((id) => (
                  <span key={id} className="rounded-xl ring-2 ring-white">
                    <BackendMark id={id} size={32} />
                  </span>
                ))}
              </div>
              <div>
                <h3 className="text-base">{u.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-stone-600">{u.text}</p>
              </div>
            </li>
          ))}
        </ul>
        <div className="rounded-xl border border-stone-200 bg-stone-100 p-5 text-sm leading-relaxed text-stone-600">
          <p className="font-semibold text-stone-800">What the beta does and doesn&apos;t do yet</p>
          <p className="mt-1">
            Agents plan, price and explain, and do the steps they can today: the calendar, lookups, a
            photo, a text to you. They do not place orders, hire anyone or pay for anything yet. Executing
            on the backends is the next piece.
          </p>
        </div>
      </section>

      {/* Close */}
      <section className="rounded-3xl bg-rose-600 px-6 py-12 text-white sm:px-10">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-xl">
            <h2 className="text-3xl sm:text-4xl">Try it on something real</h2>
            <p className="mt-2 text-lg text-rose-100">
              Sign in with Google or an email code. The first analysis is on us.
            </p>
          </div>
          <Link href="/login" className="btn bg-white px-5 py-3 text-base text-rose-700 hover:bg-rose-50">
            Start building
          </Link>
        </div>
      </section>
    </div>
  );
}

/** A compact picture of the product: the request, the routed steps, the total. */
function HeroPanel() {
  const rows = [
    { id: "automation", title: "Watch the forecast, trigger on heat", via: "Scheduled checks", cost: "no cost" },
    { id: "amazon", title: "Two cases of water to the venue", via: "Amazon › Same-Day delivery", cost: "$16–24" },
    { id: "comms", title: "Delivery update every 15 min", via: "SMS", cost: "$0.30" },
  ] as const;
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-4 shadow-2xl backdrop-blur sm:p-5">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-stone-400">Request</p>
      <p className="mt-2 rounded-lg bg-stone-900/80 px-4 py-3 text-sm leading-relaxed text-stone-100 ring-1 ring-white/10">
        If the forecast for the wedding day goes above 100°F, order two cases of water to the venue and
        text me every 15 minutes until it arrives.
      </p>
      <p className="mt-4 text-xs font-semibold uppercase tracking-[0.12em] text-stone-400">Plan</p>
      <ul className="mt-2 space-y-2">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center gap-3 rounded-lg bg-stone-900/60 px-3 py-2.5 ring-1 ring-white/10">
            <BackendMark id={r.id} size={30} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-white">{r.title}</p>
              <p className="truncate text-xs text-stone-400">{r.via}</p>
            </div>
            <span className="text-xs font-semibold text-stone-200">{r.cost}</span>
          </li>
        ))}
      </ul>
      <div className="mt-3 rounded-lg bg-signal-soft px-3 py-2 text-xs text-stone-800">
        <span className="font-semibold">Faster with Instacart.</span> Delivered in about an hour, a few
        dollars more. <span className="font-semibold text-rose-700">Swap in</span>
      </div>
      <div className="mt-4 flex items-center justify-between border-t border-white/10 pt-3 text-sm">
        <span className="text-stone-400">$16.30–24.30 all-in · analysed in 14 s</span>
        <span className="rounded-md bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white">Create agent</span>
      </div>
    </div>
  );
}

/** Small line icons for the feature cards. Drawn inline so they take the current colour. */
function Icon({ name }: { name: string }) {
  const common = {
    width: 20,
    height: 20,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  switch (name) {
    case "plan":
      return (
        <svg {...common}>
          <path d="M9 6h11M9 12h11M9 18h11" />
          <path d="M4 6h.01M4 12h.01M4 18h.01" />
        </svg>
      );
    case "route":
      return (
        <svg {...common}>
          <circle cx="6" cy="6" r="2.5" />
          <circle cx="18" cy="18" r="2.5" />
          <path d="M8.5 6H14a4 4 0 0 1 0 8h-4a4 4 0 0 0 0 8h5.5" />
        </svg>
      );
    case "swap":
      return (
        <svg {...common}>
          <path d="M4 8h13l-3-3M20 16H7l3 3" />
        </svg>
      );
    case "agent":
      return (
        <svg {...common}>
          <rect x="4" y="7" width="16" height="12" rx="3" />
          <path d="M12 4v3M9 13h.01M15 13h.01M9 16.5h6" />
        </svg>
      );
    case "sms":
      return (
        <svg {...common}>
          <path d="M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9l-4 4v-4H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <circle cx="9" cy="8" r="3" />
          <path d="M3 20a6 6 0 0 1 12 0" />
          <circle cx="17" cy="9" r="2.5" />
          <path d="M15 20a5 5 0 0 1 6-4.5" />
        </svg>
      );
  }
}

function Dashboard({
  name,
  unread,
  hasAssistant,
  hasAgent,
}: {
  name: string | null;
  unread: number;
  hasAssistant: boolean;
  hasAgent: boolean;
}) {
  const rows = [
    {
      href: "/agentdex",
      title: "Build",
      text: "Describe what your agent should do and get the steps, the cost and the time. Then create the agent.",
      cta: hasAgent ? "Open AgentDex" : "Start a build",
    },
    {
      href: hasAgent ? "/agentdex/agent" : "/assistant",
      title: hasAgent ? "Your agent" : "Assistant",
      text: hasAgent
        ? "The chat set up for your workflow. It does the steps it can now and describes the rest."
        : "Your assistant: ask about the calendar, send it a photo, or text it from your phone.",
      cta: hasAgent ? "Open your agent" : hasAssistant ? "Open the assistant" : "Set it up",
    },
    {
      href: "/schedule",
      title: "Schedule",
      text: "Bookings and the times you offer. What the assistant checks before it answers a date question.",
      cta: "Open",
    },
    {
      href: "/photos",
      title: "Photos",
      text: "The library the assistant can see and touch up. Upload from your computer or Google Drive.",
      cta: "Open",
    },
    {
      href: "/people",
      title: "People",
      text: "Pick a guest out of your photos and get back every photo they appear in.",
      cta: "Open",
    },
    {
      href: "/messages",
      title: "Enquiries",
      text: "What couples send from your availability page. The assistant reads these when you ask.",
      cta: unread > 0 ? `Read ${unread} new` : "Open",
    },
  ];
  return (
    <div className="space-y-8">
      <div>
        <p className="eyebrow">Signed in</p>
        <h1 className="mt-2 text-4xl">{name ? `Hello, ${name.split(" ")[0]}.` : "Hello."}</h1>
      </div>
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((r) => (
          <li key={r.title} className="card flex flex-col p-5">
            <Link href={r.href} className="font-display text-lg font-bold hover:text-rose-600">
              {r.title}
            </Link>
            <p className="mt-1.5 flex-1 text-sm text-stone-600">{r.text}</p>
            <Link href={r.href} className="btn-secondary mt-4 self-start">
              {r.cta}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
