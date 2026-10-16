import { getBackendHealth } from "@/lib/backend";

// Render per request so the status reflects the backend right now, not at build time.
export const dynamic = "force-dynamic";

export default async function Home() {
  const backend = await getBackendHealth();

  return (
    <main>
      <h1>CULTURAL ELASTICITY</h1>
      <p className="sprint">Sprint 0</p>
      <p>Qloo Technical Feasibility</p>
      <p>
        Backend: <strong data-status={backend}>{backend}</strong>
      </p>
    </main>
  );
}
