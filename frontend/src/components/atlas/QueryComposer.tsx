"use client";

import { useEffect, useState } from "react";

export function QueryComposer({ busy, onSubmit }: { busy: boolean; onSubmit: (query: string) => void }) {
  const [value, setValue] = useState("");
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  return (
    <form
      className="composer"
      data-hydrated={ready ? "true" : "false"}
      onSubmit={(event) => {
        event.preventDefault();
        const query = value.trim();
        if (!query) return;
        onSubmit(query);
        setValue("");
      }}
    >
      <label htmlFor="question">Your question</label>
      <input
        id="question"
        data-testid="query-input"
        value={value}
        placeholder="Where could your brand go next?"
        maxLength={2000}
        onChange={(event) => setValue(event.target.value)}
      />
      <button className="ask" type="submit" data-testid="query-submit" disabled={busy || value.trim().length === 0}>
        {busy ? "Investigating" : "Ask"}
      </button>
    </form>
  );
}
