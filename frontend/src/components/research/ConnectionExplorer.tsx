"use client";

import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import type { ConnectionView, ResearchView } from "@/lib/research-view";
import { EvidenceDetail, connectionDetail } from "./EvidenceDetail";

/** Up/Down (and Home/End) move between the selectable rows of one list. Enter or Space selects. */
export function onListKey(event: KeyboardEvent<HTMLElement>) {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  const rows = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("[data-row]")];
  const index = rows.indexOf(document.activeElement as HTMLButtonElement);
  if (index < 0) return;
  event.preventDefault();
  const next = event.key === "Home" ? 0 : event.key === "End" ? rows.length - 1 : event.key === "ArrowDown" ? Math.min(rows.length - 1, index + 1) : Math.max(0, index - 1);
  rows[next]?.focus();
}

/**
 * List and detail side by side on wide screens. On narrow screens the detail replaces the list, with a back
 * control; browser back does the same because the selection lives in the URL.
 */
export function MasterDetail({ list, detail, selected, empty, collapse = false }: { list: ReactNode; detail: ReactNode | null; selected: boolean; empty: ReactNode; collapse?: boolean }) {
  return (
    <div className="rw-split" data-selected={selected ? "true" : "false"} data-collapse={collapse ? "true" : undefined}>
      <div className="rw-split__list">{list}</div>
      <div className="rw-split__detail">{detail ?? <div className="rw-split__empty">{empty}</div>}</div>
    </div>
  );
}

export function ConnectionExplorer({ view, selectedKey, onSelect, onClear }: {
  view: ResearchView;
  selectedKey: string | null;
  onSelect: (key: string) => void;
  onClear: () => void;
}) {
  const selected = view.connections.find((item) => item.key === selectedKey) ?? null;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const lastSelected = useRef<string | null>(null);

  useEffect(() => {
    if (selected) { headingRef.current?.focus({ preventScroll: false }); lastSelected.current = selected.key; return; }
    if (lastSelected.current) {
      document.querySelector<HTMLButtonElement>(`[data-row="${CSS.escape(lastSelected.current)}"]`)?.focus();
      lastSelected.current = null;
    }
  }, [selected?.key]);

  const groups: { id: string; title: string; note: string; items: ConnectionView[] }[] = [
    ...view.collections.map((collection) => ({ id: collection.domain, title: collection.title, note: collection.qualifier, items: collection.items })),
    ...(view.tasteTags.length ? [{ id: "taste", title: "Cultural tags", note: `Tags Qloo associates with ${view.brand.name}.`, items: view.tasteTags }] : []),
    ...(view.keywords.length ? [{ id: "keywords", title: "Descriptive keywords", note: "Loose keywords, not curated categories.", items: view.keywords }] : []),
    ...(view.core.categories.length ? [{ id: "core", title: "How Qloo categorises the brand", note: "These describe the brand itself, not new directions.", items: view.core.categories }] : []),
  ];

  const list = groups.length ? (
    <nav aria-label="Cultural connections" onKeyDown={onListKey}>
      <p className="quiet">Each connection is something Qloo returned for {view.brand.name}. None of them is a recommendation. Use the arrow keys to move through a list.</p>
      {groups.map((group) => (
        <section key={group.id} aria-labelledby={`rw-group-${group.id}`} className="rw-group">
          <h3 id={`rw-group-${group.id}`}>{group.title} <span className="quiet">({group.items.length})</span></h3>
          <p className="quiet">{group.note}</p>
          <ul className="rw-rows">
            {group.items.map((item) => (
              <li key={item.key}>
                <button type="button" data-row={item.key} aria-current={item.key === selectedKey ? "true" : undefined} onClick={() => onSelect(item.key)}>
                  <strong>{item.name}</strong>
                  {item.possibleDuplicateOf ? <small>May repeat “{item.possibleDuplicateOf}”</small> : item.kind === "tag" ? <small>{item.contextLine}</small> : null}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </nav>
  ) : <p>Qloo returned no cultural connections in this research.</p>;

  return (
    <MasterDetail
      selected={Boolean(selected)}
      list={list}
      detail={selected ? <EvidenceDetail ref={headingRef} detail={connectionDetail(selected)} origin={view.origin} onBack={onClear} backLabel="Back to all connections" /> : null}
      empty={<><h2>Select a connection</h2><p>You&apos;ll see what Qloo returned, what it might mean, what it can&apos;t tell you, and what to research next.</p></>}
    />
  );
}
