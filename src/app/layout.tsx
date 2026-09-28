import type { Metadata } from "next";
import { IBM_Plex_Mono, Inter, Plus_Jakarta_Sans } from "next/font/google";
import Link from "next/link";
import Nav from "@/components/Nav";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  variable: "--font-jakarta",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-inter",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Blinked",
  description:
    "Describe a job in plain words, get a plan with who does each step, what it costs and how long, then hand it to an agent that runs on Amazon, Instacart, AWS, Fiverr, TaskRabbit and SMS.",
};

/** The frame around every page: navigation bar on top, content below, a short footer. */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${jakarta.variable} ${inter.variable} ${plexMono.variable}`}>
      <body className="flex min-h-screen flex-col">
        <Nav />
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">{children}</main>
        <footer className="border-t border-stone-200 bg-surface">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-sm text-stone-500 sm:px-6">
            <span>Blinked · beta · built for photographers first</span>
            <span className="flex gap-5">
              <Link href="/login" className="hover:text-stone-900">
                Sign in
              </Link>
              {process.env.TEAM_EMAIL && (
                <a href={`mailto:${process.env.TEAM_EMAIL}`} className="hover:text-stone-900">
                  Contact
                </a>
              )}
            </span>
          </div>
        </footer>
      </body>
    </html>
  );
}
