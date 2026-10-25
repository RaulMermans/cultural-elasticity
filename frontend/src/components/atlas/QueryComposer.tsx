"use client";

import { useEffect, useState } from "react";

export function QueryComposer({
  busy,
  onSubmit,
  compact = false,
  initial = "",
}: {
  busy: boolean;
  onSubmit: (query: string) => void;
  compact?: boolean;
  initial?: string;
}) {
  const [value, setValue] = useState(initial);
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  return (
    <form
      className={compact ? "composer composer--compact" : "composer composer--landing"}
      data-hydrated={ready ? "true" : "false"}
      onSubmit={(event) => {
        event.preventDefault();
        const query = value.trim();
        if (!query) return;
        onSubmit(query);
        setValue("");
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <label htmlFor="question" className="sr-only">Your question</label>
        <input
          id="question"
          data-testid="query-input"
          value={value}
          placeholder={compact ? "Ask a new cultural question" : "Where could your brand go next?"}
          maxLength={2000}
          onChange={(event) => setValue(event.target.value)}
        />
      </div>
      <button className="ask" type="submit" data-testid="query-submit" disabled={busy || value.trim().length === 0}>
        {busy ? "Investigating" : "Ask"}
      </button>
    </form>
  );
}
