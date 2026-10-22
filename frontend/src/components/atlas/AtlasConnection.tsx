import { edgePath } from "./atlas-model";

export function AtlasConnection({ from, to }: { from: { x: number; y: number }; to: { x: number; y: number } }) {
  return <path d={edgePath(from, to)} />;
}
