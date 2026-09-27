import type { Metadata } from "next";
import { Fraunces, IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import Link from "next/link";
import Nav from "@/components/Nav";
import "./globals.css";

const fraunces = Fraunces({
  subsets: ["latin"],
  style: ["normal", "italic"],
  variable: "--font-fraunces",
  display: "swap",
});

const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex",
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
    "Describe a job in plain words, get a plan with who does each step, what it costs and how long, then hand it to an agent. Built for photographers first.",
};

/** The frame around every page: navigation bar on top, content below, a short footer. */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${fraunces.variable} ${plexSans.variable} ${plexMono.variable}`}>
      <body className="flex min-h-screen flex-col">
        <Nav />
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">{children}</main>
        <footer className="border-t border-stone-200">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-5 text-xs text-stone-500">
            <span className="font-mono">Blinked · beta · built for photographers first</span>
            <span className="flex gap-4">
              <Link href="/login" className="hover:text-stone-900">
                Sign in
              </Link>
              <a href="mailto:jbabyjbaby1@gmail.com" className="hover:text-stone-900">
                Contact
              </a>
            </span>
          </div>
        </footer>
      </body>
    </html>
  );
}
