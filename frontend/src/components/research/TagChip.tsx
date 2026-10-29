"use client";

import { createContext, useContext } from "react";
import type { TagKind } from "@/lib/tag-question";

/** Drafts a question about a tag into the composer. Null while research is read-only: chips then stay plain text. */
export const AskAboutTag = createContext<((topic: string, kind: TagKind) => void) | null>(null);

/** One tag in a chip list. Tapping it drafts a question about it; it never sends one. */
export function TagChip({ label, kind, title, dataKind }: { label: string; kind: TagKind; title?: string; dataKind?: string }) {
  const draft = useContext(AskAboutTag);
  if (!draft) return <li data-kind={dataKind} title={title}>{label}</li>;
  return <li data-kind={dataKind} className="rr-chip--ask">
    <button type="button" className="rr-chip-button" data-testid="tag-chip" title={title ? `${title}. Tap to ask about it` : "Tap to ask about it"} onClick={() => draft(label, kind)}>{label}</button>
  </li>;
}

/** The same draft action on an inline name (outside a chip list). */
export function TagButton({ label, kind }: { label: string; kind: TagKind }) {
  const draft = useContext(AskAboutTag);
  if (!draft) return <strong>{label}</strong>;
  return <button type="button" className="rr-chip-button rr-chip-button--inline" data-testid="tag-chip" title="Tap to ask about it" onClick={() => draft(label, kind)}>{label}</button>;
}
