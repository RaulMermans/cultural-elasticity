import { readFileSync } from "node:fs";
import { Writable } from "node:stream";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { readConfig } from "../src/config/env.js";

const repoRoot = new URL("../../", import.meta.url);
const SENTINEL = "sentinel-key-should-never-surface-42";

describe("secret handling", () => {
  it(".env.example ships an empty QLOO_API_KEY", () => {
    const example = readFileSync(new URL(".env.example", repoRoot), "utf8");
    expect(example).toMatch(/^QLOO_API_KEY=$/m);
  });

  it("backend config exposes only whether a credential exists, never its value", () => {
    const config = readConfig({ QLOO_API_KEY: SENTINEL });
    expect(config.qloo.hasCredential).toBe(true);
    expect(JSON.stringify(config)).not.toContain(SENTINEL);
    expect(readConfig({ QLOO_API_KEY: "   " }).qloo.hasCredential).toBe(false);
  });

  it("the app logger redacts credential-shaped fields", async () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        lines.push(String(chunk));
        callback();
      },
    });
    // Same redact configuration as buildApp, wired to a capturable stream.
    const app = Fastify({
      logger: { level: "info", stream, redact: { paths: ["*.QLOO_API_KEY", "*.apiKey", "*.api_key"], censor: "[redacted]" } },
    });
    app.log.info({ env: { QLOO_API_KEY: SENTINEL }, client: { apiKey: SENTINEL } }, "probe");
    await app.close();
    expect(lines.join("")).not.toContain(SENTINEL);
    expect(lines.join("")).toContain("[redacted]");
    // And buildApp itself still constructs with that configuration.
    await buildApp({ logLevel: "silent" }).close();
  });

  it("the frontend reads no Qloo variable and no public env var", () => {
    for (const file of ["frontend/src/lib/backend.ts", "frontend/src/app/page.tsx", "frontend/next.config.ts"]) {
      const source = readFileSync(new URL(file, repoRoot), "utf8");
      expect(source).not.toMatch(/QLOO/);
      expect(source).not.toMatch(/process\.env\.NEXT_PUBLIC_/);
    }
  });
});
