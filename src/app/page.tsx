import Link from "next/link";
import SampleBuild from "@/components/SampleBuild";
import { INTEGRATIONS, INTEGRATION_IDS, SPECIALTIES } from "@/lib/assistant/catalog";
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

const USES = [
  {
    title: "The hot wedding day",
    text: "Water to the venue if the forecast tips over, a text when it lands. The plan above, built in a minute.",
  },
  {
    title: "The week after",
    text: "The clips cut into a highlight film, an album designed and printed for the couple, and the RAW files archived somewhere cheap for ten years.",
  },
  {
    title: "“All the ones with Grandma”",
    text: "Every photo of one guest picked out of two thousand, the best thirty retouched, framed prints delivered and received.",
  },
  {
    title: "On the road",
    text: "Text the assistant from the car: what's booked Saturday, is the 24th free, is there a reply from the couple.",
  },
];

function Landing() {
  const backends = INTEGRATION_IDS.map((id) => INTEGRATIONS[id].name);
  return (
    <div className="space-y-20">
      {/* Masthead */}
      <section className="grid gap-8 pt-6 md:grid-cols-[1.4fr_1fr] md:items-end">
        <div className="space-y-6">
          <p className="eyebrow">Agent builder · beta</p>
          <h1 className="max-w-3xl text-[2.6rem] leading-[1.05] sm:text-6xl">
            Describe the job. Get the plan. Hand it to an agent.
          </h1>
          <p className="max-w-2xl text-lg leading-relaxed text-stone-700">
            Blinked turns a plain description of what you want done into a step-by-step plan — who does
            each step, what it costs, how long it takes — and then into an agent set up to carry it out.
            It is built for photographers first, whose weeks are full of exactly this kind of work.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Link href="/login" className="btn-primary">
              Sign in and build one
            </Link>
            <a href="#build" className="btn-secondary">
              See a build
            </a>
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-5 border-l border-stone-200 pl-6 text-sm md:grid-cols-1">
          <div>
            <dt className="eyebrow">Backends</dt>
            <dd className="mt-1 font-mono text-2xl">{INTEGRATION_IDS.length}</dd>
            <dd className="text-stone-600">{backends.join(", ")}</dd>
          </div>
          <div>
            <dt className="eyebrow">Named specialities</dt>
            <dd className="mt-1 font-mono text-2xl">{SPECIALTIES.length}</dd>
            <dd className="text-stone-600">from photo retouching to Wait for Delivery</dd>
          </div>
          <div>
            <dt className="eyebrow">An analysis</dt>
            <dd className="mt-1 font-mono text-2xl">10–15 s</dd>
            <dd className="text-stone-600">a few cents, charged at cost</dd>
          </div>
        </dl>
      </section>

      {/* The sample build */}
      <section id="build" className="scroll-mt-8 space-y-6">
        <div className="max-w-2xl">
          <p className="eyebrow">A build, start to finish</p>
          <h2 className="mt-2 text-3xl">One request, from words to a working agent</h2>
          <p className="mt-3 text-stone-700">
            The figures below are from a real run on this exact request. Nothing is mocked up.
          </p>
        </div>
        <SampleBuild />
      </section>

      {/* Uses */}
      <section className="space-y-6">
        <div className="max-w-2xl">
          <p className="eyebrow">Where it earns its keep</p>
          <h2 className="mt-2 text-3xl">Things a photographer actually asks for</h2>
        </div>
        <dl className="grid gap-px overflow-hidden rounded-md border border-stone-200 bg-stone-200 sm:grid-cols-2">
          {USES.map((u) => (
            <div key={u.title} className="bg-surface p-5">
              <dt className="font-display text-lg">{u.title}</dt>
              <dd className="mt-1.5 text-sm leading-relaxed text-stone-700">{u.text}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* Features */}
      <section id="features" className="scroll-mt-8 space-y-6">
        <div className="max-w-2xl">
          <p className="eyebrow">What works today</p>
          <h2 className="mt-2 text-3xl">Live, and not yet</h2>
          <p className="mt-3 text-stone-700">
            This is a beta. The list is kept honest: what is live, and what the agent still only
            describes.
          </p>
        </div>
        <div className="grid gap-8 md:grid-cols-[1.4fr_1fr]">
          <ul className="space-y-4 text-[15px] leading-relaxed">
            <Feature title="The analysis">
              Any request in plain words becomes steps, each on the backend that handles it, with a
              rough cost and a time. Three depths, from a quick pass to a careful one, priced at what
              they use.
            </Feature>
            <Feature title="A catalogue of backends">
              {backends.join(", ")} — each with its sub-services named as the vendor names them, so a
              step reads &ldquo;Fiverr › Wedding video editing&rdquo;, not just &ldquo;Fiverr&rdquo;.
            </Feature>
            <Feature title="Recommendations">
              Where another backend would be clearly faster or cheaper, the plan says so, prices it, and
              swaps it in with one click.
            </Feature>
            <Feature title="Create Agent">
              A chat set up for the workflow, with each step one tap away. It reads your calendar and
              enquiries, looks things up, and touches up a photo you send it.
            </Feature>
            <Feature title="Texting">
              Verify your mobile once, then text the assistant from your phone and get short replies
              back. It can text you, and only you.
            </Feature>
            <Feature title="The photographer's kit">
              A schedule with a public availability page and standing offers, a photo library with a
              cleanup pass and a people finder, and enquiries from couples — all of it what the agent
              draws on.
            </Feature>
            <Feature title="Send it to the team">
              A step that needs a person, or something the app can&apos;t do yet, goes to the team with
              the analysis attached. Credit is prepaid and each analysis is charged its actual cost.
            </Feature>
          </ul>
          <div className="rounded-md border border-stone-200 bg-stone-100 p-5 text-sm leading-relaxed text-stone-700">
            <p className="eyebrow">Not yet</p>
            <ul className="mt-3 list-disc space-y-2 pl-5">
              <li>
                Agents plan, price and explain. They do not place orders, hire anyone or pay for anything
                yet — the backends are assumed when a plan is made, and executing on them is the next
                piece.
              </li>
              <li>Texts go to you. Nothing is sent to couples or vendors.</li>
              <li>One trade so far: photographers. The kit is theirs; the builder is general.</li>
            </ul>
          </div>
        </div>
      </section>

      {/* Close */}
      <section className="border-t border-stone-200 pt-10">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-xl">
            <h2 className="text-3xl">Try it on something real</h2>
            <p className="mt-2 text-stone-700">
              Sign in with Google or an email code. The first analysis is on us.
            </p>
          </div>
          <Link href="/login" className="btn-primary">
            Sign in
          </Link>
        </div>
      </section>
    </div>
  );
}

function Feature({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <li className="grid gap-1 sm:grid-cols-[11rem_1fr] sm:gap-4">
      <span className="font-medium">{title}</span>
      <span className="text-stone-700">{children}</span>
    </li>
  );
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
      <ul className="divide-y divide-stone-200 border-y border-stone-200">
        {rows.map((r) => (
          <li key={r.title} className="grid gap-2 py-4 sm:grid-cols-[9rem_1fr_auto] sm:items-center sm:gap-6">
            <Link href={r.href} className="font-display text-xl hover:text-rose-700">
              {r.title}
            </Link>
            <p className="text-sm text-stone-700">{r.text}</p>
            <Link href={r.href} className="btn-secondary justify-self-start sm:justify-self-end">
              {r.cta}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
