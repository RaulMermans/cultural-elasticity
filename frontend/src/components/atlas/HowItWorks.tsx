"use client";

import { useEffect, useRef } from "react";

export function HowItWorks({ onClose }: { onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="dialog-back">
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="how-title" data-testid="how-it-works">
        <h2 id="how-title">How the observatory works</h2>
        <ol className="how-list">
          <li>Ask where a brand could expand. The atlas starts empty until that investigation returns territories.</li>
          <li>Territories appear as a lineage of research objects. An edge means investigated-from, not cultural distance.</li>
          <li>Select a territory to read the finding, remaining uncertainty, and the next useful action.</li>
          <li>Inspect evidence in layers: observed, calculated, inferred, and missing. Support is not a prediction of commercial success.</li>
        </ol>
        <button className="primary" type="button" ref={closeRef} onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
