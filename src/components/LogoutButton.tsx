"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Signs the user out and returns to the home page. */
export default function LogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/");
    router.refresh(); // re-render server components with the cookie gone
  }

  return (
    <button type="button" className="btn-secondary" onClick={signOut} disabled={busy}>
      Sign out
    </button>
  );
}
