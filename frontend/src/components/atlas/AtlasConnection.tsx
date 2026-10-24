import { edgePath, type AtlasBox } from "./atlas-model";

export function AtlasConnection({ from, to, active = false }: { from: AtlasBox; to: AtlasBox; active?: boolean }) {
  return <path d={edgePath(from, to)} className={active ? "is-active" : undefined} />;
}
