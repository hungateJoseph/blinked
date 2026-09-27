"use client";

import Script from "next/script";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { errorFrom } from "@/lib/clientApi";

// The shape of window.google lives in src/types/google.d.ts, shared with the
// Drive import, which uses a different part of the same library.

/**
 * "Continue with Google" using Google Identity Services.
 *
 * Google's script draws the button and, because the user is usually already
 * signed in to Google in their browser, can also show the One Tap prompt.
 * When they pick an account we receive an ID token and POST it to our server,
 * which verifies it and starts the session.
 */
export default function GoogleSignInButton({ clientId }: { clientId: string }) {
  const router = useRouter();
  const buttonHost = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  const handleCredential = useCallback(
    async (response: { credential: string }) => {
      const res = await fetch("/api/auth/google", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credential: response.credential }),
      });
      if (!res.ok) {
        setError(await errorFrom(res));
        return;
      }
      router.push("/");
      router.refresh();
    },
    [router],
  );

  const setUpGoogle = useCallback(() => {
    if (!window.google || !buttonHost.current) return;
    window.google.accounts.id.initialize({ client_id: clientId, callback: handleCredential });
    window.google.accounts.id.renderButton(buttonHost.current, {
      theme: "outline",
      size: "large",
      width: 320,
      text: "continue_with",
    });
    window.google.accounts.id.prompt(); // One Tap, for the account already signed in
  }, [clientId, handleCredential]);

  // If the script was already loaded on a previous visit to this page, the
  // <Script onLoad> below will not fire again — so set up right away.
  useEffect(() => {
    if (window.google) setUpGoogle();

    // Leaving the page (signing in, or just navigating away) unmounts this
    // component while the One Tap prompt may still be waiting for an answer.
    // Cancelling it first closes the request cleanly; without this the browser
    // tears it down instead and Google logs
    // "FedCM get() rejects with AbortError: signal is aborted without reason".
    return () => window.google?.accounts.id.cancel();
  }, [setUpGoogle]);

  return (
    <div className="space-y-2">
      <Script src="https://accounts.google.com/gsi/client" strategy="afterInteractive" onLoad={setUpGoogle} />
      <div ref={buttonHost} />
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
