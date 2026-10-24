import { shortStatus, type AtlasDraft } from "./atlas-model";

export function TerritoryBranchNav({
  nodes,
  selectedId,
  onSelect,
}: {
  nodes: AtlasDraft[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const selected = nodes.find((node) => node.id === selectedId) ?? nodes[0];
  if (!selected) return null;
  const parent = nodes.find((node) => node.id === selected.parentId);
  const children = nodes.filter((node) => node.parentId === selected.id);
  const siblings = nodes.filter((node) => node.parentId === selected.parentId && node.id !== selected.id);
  return (
    <nav aria-label="Territories in this investigation">
      <ol className="branch-list">
        {parent ? <Item node={parent} selected={false} onSelect={onSelect} hint="From" /> : null}
        <Item node={selected} selected onSelect={onSelect} hint="Selected" />
        {children.map((node) => <Item key={node.id} node={node} selected={false} onSelect={onSelect} hint="Investigated from here" />)}
        {siblings.map((node) => <Item key={node.id} node={node} selected={false} onSelect={onSelect} hint="Also investigated" />)}
      </ol>
    </nav>
  );
}

function Item({ node, selected, onSelect, hint }: { node: AtlasDraft; selected: boolean; onSelect: (id: string) => void; hint: string }) {
  return (
    <li>
      <button type="button" aria-pressed={selected} onClick={() => onSelect(node.id)} data-testid={`branch-${node.id}`}>
        <small>{hint}</small>
        <strong>{node.label}</strong>
        <small>{shortStatus(node.tone, node.statusLabel)}</small>
      </button>
    </li>
  );
}
