"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Operator link target, with no screen of its own. `/operator#token=…` (opened by scripts/live-test-open.sh)
 * hands the credential to the HttpOnly session route and returns to brand research; `/operator#signout` clears
 * it. A fragment never reaches a server or its logs, and it is removed from the address bar before the request
 * is sent. Railway decides on every paid start whether the credential is valid and unexpired, so this page
 * grants nothing by itself. Without a fragment it simply returns home.
 */
export default function OperatorPage() {
  const [rejected, setRejected] = useState(false);
  // The fragment is read once: a second effect run (React strict mode) must not see the cleared URL and leave.
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const token = fragment.get("token");
    window.history.replaceState(null, "", window.location.pathname);
    if (fragment.has("signout")) {
      void fetch("/api/operator/session", { method: "DELETE" }).catch(() => null).then(() => window.location.replace("/"));
      return;
    }
    if (!token) {
      window.location.replace("/");
      return;
    }
    void fetch("/api/operator/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) })
      .catch(() => null)
      .then((response) => {
        if (response?.status === 204) window.location.replace("/");
        else setRejected(true);
      });
  }, []);

  return (
    <main style={{ maxWidth: 560, margin: "64px auto", padding: "0 16px" }}>
      <p role="status" data-testid="operator-status">
        {rejected ? "This link was not accepted. Nothing was stored." : "Opening brand research…"}
      </p>
      {rejected && <p><a href="/">Back to brand research</a></p>}
    </main>
  );
}
