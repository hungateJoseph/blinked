import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { countUnread } from "@/lib/enquiries";
import Logo from "./Logo";
import LogoutButton from "./LogoutButton";

/**
 * Top navigation. Runs on the server so it can read the session cookie.
 * The order follows the work: build a workflow, talk to the assistant, then
 * the things the assistant draws on — the schedule, the photos, the people
 * in them, the enquiries.
 */
export default async function Nav() {
  const user = await getCurrentUser();
  const unread = user ? countUnread(user.id) : 0;

  return (
    <header className="border-b border-stone-200 bg-surface">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <Link href="/" className="flex items-center">
          <Logo />
        </Link>

        <nav className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          {user ? (
            <>
              <Link href="/agentdex" className="hover:text-rose-700">
                Build
              </Link>
              <Link href="/assistant" className="hover:text-rose-700">
                Assistant
              </Link>
              <Link href="/schedule" className="hover:text-rose-700">
                Schedule
              </Link>
              <Link href="/photos" className="hover:text-rose-700">
                Photos
              </Link>
              <Link href="/people" className="hover:text-rose-700">
                People
              </Link>
              <Link href="/messages" className="flex items-center gap-1.5 hover:text-rose-700">
                Enquiries
                {unread > 0 && <span className="badge bg-rose-600 text-white">{unread}</span>}
              </Link>
              <span className="hidden font-mono text-xs text-stone-500 sm:inline">{user.name ?? user.email}</span>
              <LogoutButton />
            </>
          ) : (
            <>
              <Link href="/#build" className="hidden hover:text-rose-700 sm:inline">
                How it works
              </Link>
              <Link href="/#features" className="hidden hover:text-rose-700 sm:inline">
                What works today
              </Link>
              <Link href="/login" className="btn-primary">
                Sign in
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
