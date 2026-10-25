// Secret leakage check. Run with `pnpm check:secrets` (CI runs it after the frontend build).
// Fails if:
//   - any committed or committable file assigns a non-empty QLOO_API_KEY or ANTHROPIC_API_KEY;
//   - any such file carries an Anthropic key literal (sk-ant-…), or the local ANTHROPIC_API_KEY value;
//   - the local QLOO_API_KEY value (if set) appears in any such file;
//   - any such file carries a literal X-Api-Key header value;
//   - backend/.env is not gitignored, or .dockerignore does not exclude .env files;
//   - the browser bundle (frontend/.next/static) contains credential names, key literals, or a configured secret value.
// The public hackathon base URL (QLOO_API_BASE_URL) is configuration, not a secret, and is allowed.
// It never prints the key itself.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
// The local key (env, else backend/.env) is only compared against file contents; it is never printed.
function keyFromEnvFile(name = "QLOO_API_KEY") {
  const envFile = join(root, "backend/.env");
  if (!existsSync(envFile)) return undefined;
  const line = readFileSync(envFile, "utf8").split(/\r?\n/).find((l) => new RegExp(`^\\s*${name}\\s*=`).test(l));
  return line?.split("=").slice(1).join("=").trim().replace(/^["']|["']$/g, "") || undefined;
}
const localKey = process.env.QLOO_API_KEY?.trim() || keyFromEnvFile();
const localModelKey = process.env.ANTHROPIC_API_KEY?.trim() || keyFromEnvFile("ANTHROPIC_API_KEY");
const findings = [];

const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: root, encoding: "utf8" })
  .split("\0")
  .filter(Boolean);

// .env-style lines (`QLOO_API_KEY=value`) and quoted literals (`QLOO_API_KEY: "value"`).
// Assigning a variable (e.g. `QLOO_API_KEY: TEST_KEY` in tests) is not a leak by itself.
const assignments = [/^\s*(?:export\s+)?QLOO_API_KEY\s*=\s*["']?[^\s"'#]{8,}/m, /QLOO_API_KEY["']?\s*[:=]\s*["'`][^"'`\s]{8,}["'`]/];
// A header literal such as `"X-Api-Key": "abc123..."`; placeholders like [redacted] or a variable are fine.
const modelKeyAssignments = [/^\s*(?:export\s+)?ANTHROPIC_API_KEY\s*=\s*["']?[^\s"'#]{8,}/m, /ANTHROPIC_API_KEY["']?\s*[:=]\s*["'`][^"'`\s]{8,}["'`]/];
const anthropicKeyLiteral = /sk-ant-[A-Za-z0-9_-]{16,}/;
const headerLiteral = /x-api-key["']?\s*[:=]\s*["'`](?!\[redacted\])[A-Za-z0-9_-]{16,}["'`]/i;

try {
  execFileSync("git", ["check-ignore", "-q", "backend/.env"], { cwd: root });
} catch {
  findings.push("backend/.env is not gitignored");
}
const dockerignore = existsSync(join(root, ".dockerignore")) ? readFileSync(join(root, ".dockerignore"), "utf8") : "";
if (!/^\*\*\/\.env$/m.test(dockerignore)) findings.push(".dockerignore does not exclude **/.env");

for (const file of files) {
  const path = join(root, file);
  if (!existsSync(path) || statSync(path).size > 2_000_000) continue;
  const text = readFileSync(path, "utf8");
  if (assignments.some((pattern) => pattern.test(text))) findings.push(`${file}: non-empty QLOO_API_KEY assignment`);
  if (headerLiteral.test(text)) findings.push(`${file}: literal X-Api-Key header value`);
  if (localKey && localKey.length >= 8 && text.includes(localKey)) findings.push(`${file}: contains the local QLOO_API_KEY value`);
  if (modelKeyAssignments.some((pattern) => pattern.test(text))) findings.push(`${file}: non-empty ANTHROPIC_API_KEY assignment`);
  if (anthropicKeyLiteral.test(text)) findings.push(`${file}: Anthropic key literal`);
  if (localModelKey && localModelKey.length >= 8 && text.includes(localModelKey)) findings.push(`${file}: contains the local ANTHROPIC_API_KEY value`);
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
    if (/QLOO_API_KEY|ANTHROPIC_API_KEY|CE_INTERNAL_API_SECRET|x-ce-internal-auth|x-api-key|sk-ant-/i.test(text)) {
      findings.push(`${path.slice(root.length)}: browser bundle mentions a credential`);
    }
    if (localKey && localKey.length >= 8 && text.includes(localKey)) findings.push(`${path.slice(root.length)}: browser bundle contains the local key`);
    if (localModelKey && localModelKey.length >= 8 && text.includes(localModelKey)) findings.push(`${path.slice(root.length)}: browser bundle contains the local model key`);
  }
}

console.log(`check-secrets: scanned ${files.length} repo files, ${bundleFiles} browser bundle files${bundleFiles ? "" : " (no frontend build present)"}.`);
if (findings.length > 0) {
  for (const finding of findings) console.error(`  ✗ ${finding}`);
  process.exit(1);
}
console.log("check-secrets: no credential leakage found.");
