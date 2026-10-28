"use client";

import { useState } from "react";

/**
 * Sprint 9J operator page. Unlinked from the product; it only hands the operator's credential to the
 * HttpOnly session route (or clears it). Railway decides on every paid start whether it is valid and
 * unexpired, so this page grants nothing by itself, and a visitor without the credential gains nothing here.
 */
export default function OperatorPage() {
  const [token, setToken] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "stored" | "cleared" | "rejected">("idle");

  async function authorize(event: React.FormEvent) {
    event.preventDefault();
    setState("busy");
    const response = await fetch("/api/operator/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) }).catch(() => null);
    setToken("");
    setState(response?.status === 204 ? "stored" : "rejected");
  }

  async function signOut() {
    setState("busy");
    const response = await fetch("/api/operator/session", { method: "DELETE" }).catch(() => null);
    setState(response?.status === 204 ? "cleared" : "rejected");
  }

  return (
    <main style={{ maxWidth: 560, margin: "64px auto", padding: "0 16px" }}>
      <h1>Operator authorization</h1>
      <p>Paid research (live Qloo and Claude Haiku calls) is limited to an authorized operator. The credential stays in this browser as an HttpOnly cookie for at most 4 hours; the server checks it, and its expiry, on every paid start.</p>
      <form onSubmit={authorize}>
        <label htmlFor="operator-credential">Operator credential</label>
        <input id="operator-credential" type="password" autoComplete="off" value={token} onChange={(event) => setToken(event.target.value)} style={{ display: "block", width: "100%", margin: "8px 0 16px" }} />
        <button type="submit" disabled={state === "busy" || token.length < 32}>Authorize this browser</button>{" "}
        <button type="button" onClick={signOut} disabled={state === "busy"}>Sign out</button>
      </form>
      <p role="status" data-testid="operator-status">
        {state === "stored" && "Credential stored for this browser. The server verifies it when research starts."}
        {state === "cleared" && "Operator credential removed from this browser."}
        {state === "rejected" && "The credential was not accepted. Nothing was stored."}
      </p>
      <p><a href="/">Back to brand research</a></p>
    </main>
  );
}
