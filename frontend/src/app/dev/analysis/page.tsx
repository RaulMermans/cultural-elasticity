import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Ingredient } from "@cultural-elasticity/shared";
import { notFound } from "next/navigation";
import { postAnalysisIngredients } from "@/lib/backend";

// Developer-only contract check: a SYNTHETIC fixture → backend analysis endpoint → shared types.
// Not a product page, and never available in production builds.
export const dynamic = "force-dynamic";

// `next dev` runs with the frontend package as the working directory.
const FIXTURES_DIR = join(process.cwd(), "..", "evals", "fixtures", "synthetic");

function show(ingredient: Ingredient<unknown>): string {
  if (ingredient.value === null) return "—";
  return typeof ingredient.value === "number" ? String(Number(ingredient.value.toFixed(4))) : JSON.stringify(ingredient.value);
}

export default async function DevAnalysisPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  if (process.env.NODE_ENV === "production") notFound();

  const files = (await readdir(FIXTURES_DIR)).filter((file) => file.endsWith(".json")).sort();
  const requested = (await searchParams).case;
  const selected = files.find((file) => file === requested) ?? files[0];
  if (!selected) return <main>No synthetic fixtures found in evals/fixtures/synthetic.</main>;

  const fixture = JSON.parse(await readFile(join(FIXTURES_DIR, selected), "utf8")) as { title: string; notice: string; packet: unknown };
  const result = await postAnalysisIngredients(fixture.packet);

  return (
    <main className="dev">
      <h1>/dev/analysis</h1>
      <p className="notice">{fixture.notice}</p>
      <nav>
        {files.map((file) => (
          <a key={file} href={`?case=${encodeURIComponent(file)}`} aria-current={file === selected ? "page" : undefined}>
            {file.replace(/\.json$/, "")}
          </a>
        ))}
      </nav>
      <h2>{fixture.title}</h2>
      {result.status === "unavailable" && <p data-status="unavailable">Backend unavailable.</p>}
      {result.status === "rejected" && <pre data-status="unavailable">{result.detail}</pre>}
      {result.status === "ok" && (
        <>
          <p>
            Evidence origin: <strong>{result.ingredients.evidenceOrigin}</strong> · Evidence quality: <strong>{result.ingredients.evidenceQuality.overall.level}</strong> · Distance formula:{" "}
            <strong>{result.ingredients.distanceProxy.formula}</strong>
          </p>
          <table>
            <thead>
              <tr>
                <th>Distance-proxy ingredient</th>
                <th>Status</th>
                <th>Value</th>
                <th>Limitations</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(result.ingredients.distanceProxy)
                .flatMap(([name, entry]) => (typeof entry === "string" ? [] : [[name, entry as Ingredient<unknown>] as const]))
                .map(([name, ingredient]) => (
                  <tr key={name}>
                    <td>{name}</td>
                    <td>{ingredient.status}</td>
                    <td>{show(ingredient)}</td>
                    <td>{ingredient.limitations.map((limitation) => limitation.code).join(", ")}</td>
                  </tr>
                ))}
            </tbody>
          </table>
          <table>
            <thead>
              <tr>
                <th>Quality indicator</th>
                <th>Level</th>
                <th>Reasons</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(result.ingredients.evidenceQuality.indicators).map(([name, indicator]) => (
                <tr key={name}>
                  <td>{name}</td>
                  <td>{indicator.level}</td>
                  <td>{indicator.reasons.join("; ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <details>
            <summary>AnalysisIngredients JSON</summary>
            <pre>{JSON.stringify(result.ingredients, null, 2)}</pre>
          </details>
        </>
      )}
    </main>
  );
}
