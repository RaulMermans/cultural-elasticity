"use client";

import { useEffect, useRef, useState } from "react";

export function ClarificationDialog({ question, options, onAnswer, onDismiss }: { question: string; options: { id: string; label: string }[]; onAnswer: (answer: string) => void; onDismiss: () => void }) {
  const [value, setValue] = useState("");
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => { field.current?.focus(); }, []);
  return (
    <div className="dialog-back">
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="clarify-title" data-testid="clarification-dialog">
        <h2 id="clarify-title">One detail first</h2>
        <p>{question}</p>
        <div className="actions">
          {options.map((option) => (
            <button className="ghost" type="button" key={option.id} onClick={() => onAnswer(option.label)}>
              {option.label}
            </button>
          ))}
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (value.trim()) onAnswer(value.trim());
          }}
        >
          <label htmlFor="clarification">Your answer</label>
          <input id="clarification" ref={field} data-testid="clarification-input" value={value} maxLength={1000} onChange={(event) => setValue(event.target.value)} />
          <div className="actions">
            <button className="primary" type="submit" disabled={value.trim().length === 0}>Continue</button>
            <button className="ghost" type="button" onClick={onDismiss}>Not now</button>
          </div>
        </form>
      </div>
    </div>
  );
}
