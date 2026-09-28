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
    <header className="sticky top-0 z-20 border-b border-stone-200/80 bg-surface/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center">
          <Logo />
        </Link>

        <nav className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm font-medium text-stone-700">
          {user ? (
            <>
              <Link href="/agentdex" className="hover:text-rose-600">
                Build
              </Link>
              <Link href="/assistant" className="hover:text-rose-600">
                Assistant
              </Link>
              <Link href="/schedule" className="hover:text-rose-600">
                Schedule
              </Link>
              <Link href="/photos" className="hover:text-rose-600">
                Photos
              </Link>
              <Link href="/people" className="hover:text-rose-600">
                People
              </Link>
              <Link href="/messages" className="flex items-center gap-1.5 hover:text-rose-600">
                Enquiries
                {unread > 0 && <span className="badge bg-rose-600 text-white">{unread}</span>}
              </Link>
              <span className="hidden text-xs text-stone-500 sm:inline">{user.name ?? user.email}</span>
              <LogoutButton />
            </>
          ) : (
            <>
              <Link href="/#backends" className="hidden hover:text-rose-600 sm:inline">
                Backends
              </Link>
              <Link href="/#how" className="hidden hover:text-rose-600 sm:inline">
                How it works
              </Link>
              <Link href="/#features" className="hidden hover:text-rose-600 sm:inline">
                Features
              </Link>
              <Link href="/login" className="btn-primary">
                Start building
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
