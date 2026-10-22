import type { AtlasDraft } from "./atlas-model";

export function AtlasNavigation({ nodes, selectedId, onSelect }: { nodes: AtlasDraft[]; selectedId: string | null; onSelect: (id: string) => void }) {
  const selected = nodes.find((node) => node.id === selectedId);
  if (!selected) return null;
  const trail: AtlasDraft[] = [];
  let current: AtlasDraft | undefined = selected;
  const seen = new Set<string>();
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    trail.unshift(current);
    current = nodes.find((node) => node.id === current?.parentId);
  }
  return (
    <nav aria-label="Path through this investigation">
      <ol className="crumb">
        {trail.map((node) => (
          <li key={node.id}>
            <button type="button" aria-current={node.id === selectedId} onClick={() => onSelect(node.id)}>
              {node.label}
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}
