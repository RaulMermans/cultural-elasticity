/**
 * Railway watch-path matcher (gitignore-style, as documented by Railway).
 * Used by tests and local verification. Railway itself evaluates the patterns in railway.json.
 * SYNTHETIC path lists only; this module never talks to Qloo or GitHub.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type RailwayWatchConfig = {
  build?: {
    watchPatterns?: string[];
  };
};

export const RAILWAY_JSON_PATH = join(dirname(fileURLToPath(import.meta.url)), "../../railway.json");

export function readRailwayWatchPatterns(configPath = RAILWAY_JSON_PATH): string[] {
  const parsed = JSON.parse(readFileSync(configPath, "utf8")) as RailwayWatchConfig;
  const patterns = parsed.build?.watchPatterns;
  if (!Array.isArray(patterns) || patterns.length === 0) {
    throw new Error("railway.json is missing build.watchPatterns");
  }
  return patterns;
}

export function posixPath(filePath: string): string {
  return filePath.replaceAll("\\", "/").replace(/^\.\//u, "");
}

function escapeRegex(value: string): string {
  return value.replace(/[.+^${}()|[\]\\]/gu, "\\$&");
}

function gitignoreToRegExp(pattern: string, rooted: boolean): RegExp {
  let source = "^";
  if (!rooted && !pattern.includes("/")) source += "(?:.*/)?";
  let index = 0;
  while (index < pattern.length) {
    if (pattern.startsWith("**/", index)) {
      source += "(?:.*/)?";
      index += 3;
      continue;
    }
    if (pattern.startsWith("**", index)) {
      source += ".*";
      index += 2;
      continue;
    }
    if (pattern[index] === "*") {
      source += "[^/]*";
      index += 1;
      continue;
    }
    if (pattern[index] === "?") {
      source += "[^/]";
      index += 1;
      continue;
    }
    source += escapeRegex(pattern[index] ?? "");
    index += 1;
  }
  source += "$";
  return new RegExp(source, "u");
}

export function pathMatchesWatchPattern(filePath: string, pattern: string): boolean {
  const posix = posixPath(filePath);
  let normalized = pattern.replaceAll("\\", "/");
  const rooted = normalized.startsWith("/");
  if (rooted) normalized = normalized.slice(1);
  if (normalized.endsWith("/")) normalized += "**";
  return gitignoreToRegExp(normalized, rooted).test(posix);
}

/** Railway deploys when any changed path matches a watch pattern. */
export function backendShouldRedeploy(changedFiles: string[], patterns: string[]): boolean {
  return changedFiles.some((file) => patterns.some((pattern) => pathMatchesWatchPattern(file, pattern)));
}
