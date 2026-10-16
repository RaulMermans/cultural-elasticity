// Secret leakage check. Run with `pnpm check:secrets` (CI runs it after the frontend build).
// Fails if:
//   - any committed or committable file assigns a non-empty QLOO_API_KEY;
//   - the local QLOO_API_KEY value (if set) appears in any such file;
//   - the browser bundle (frontend/.next/static) mentions QLOO at all, or contains the local key.
// It never prints the key itself.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const localKey = process.env.QLOO_API_KEY?.trim();
const findings = [];

const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: root, encoding: "utf8" })
  .split("\0")
  .filter(Boolean);

// .env-style lines (`QLOO_API_KEY=value`) and quoted literals (`QLOO_API_KEY: "value"`).
// Assigning a variable (e.g. `QLOO_API_KEY: TEST_KEY` in tests) is not a leak by itself.
const assignments = [/^\s*(?:export\s+)?QLOO_API_KEY\s*=\s*["']?[^\s"'#]{8,}/m, /QLOO_API_KEY["']?\s*[:=]\s*["'`][^"'`\s]{8,}["'`]/];
for (const file of files) {
  const path = join(root, file);
  if (!existsSync(path) || statSync(path).size > 2_000_000) continue;
  const text = readFileSync(path, "utf8");
  if (assignments.some((pattern) => pattern.test(text))) findings.push(`${file}: non-empty QLOO_API_KEY assignment`);
  if (localKey && localKey.length >= 8 && text.includes(localKey)) findings.push(`${file}: contains the local QLOO_API_KEY value`);
}

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

const bundleDir = join(root, "frontend/.next/static");
let bundleFiles = 0;
if (existsSync(bundleDir)) {
  for (const path of walk(bundleDir)) {
    bundleFiles += 1;
    const text = readFileSync(path, "utf8");
    if (/QLOO/i.test(text)) findings.push(`${path.slice(root.length)}: browser bundle mentions QLOO`);
    if (localKey && localKey.length >= 8 && text.includes(localKey)) findings.push(`${path.slice(root.length)}: browser bundle contains the local key`);
  }
}

console.log(`check-secrets: scanned ${files.length} repo files, ${bundleFiles} browser bundle files${bundleFiles ? "" : " (no frontend build present)"}.`);
if (findings.length > 0) {
  for (const finding of findings) console.error(`  ✗ ${finding}`);
  process.exit(1);
}
console.log("check-secrets: no credential leakage found.");
