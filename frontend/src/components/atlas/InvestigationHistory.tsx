import type { AtlasDraft } from "./atlas-model";

export function InvestigationHistory({ nodes, onSelect }: { nodes: AtlasDraft[]; onSelect: (id: string) => void }) {
  const brands = nodes.filter((node) => node.kind === "brand");
  if (brands.length < 2) return null;
  return (
    <nav aria-label="Investigations" className="compare">
      {brands.map((node) => (
        <button className="ghost" type="button" key={node.id} onClick={() => onSelect(node.id)}>
          {node.label}
        </button>
      ))}
    </nav>
  );
}
