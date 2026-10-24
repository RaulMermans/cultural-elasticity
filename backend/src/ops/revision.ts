/**
 * Hosted build identity for operator diagnostics. Never include secrets, env values, or commit messages.
 * Railway injects RAILWAY_GIT_* only when the service is Git-connected. CLI uploads have no Git SHA
 * unless CE_GIT_SHA is set at deploy time.
 */
export type RevisionSource = "railway_git" | "explicit" | "unknown";

export type DeploymentRevision = {
  repository: string | null;
  gitSha: string | null;
  gitBranch: string | null;
  source: RevisionSource;
};

function trimToNull(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function deploymentRevision(env: NodeJS.ProcessEnv = process.env): DeploymentRevision {
  const railwaySha = trimToNull(env.RAILWAY_GIT_COMMIT_SHA);
  const explicitSha = trimToNull(env.CE_GIT_SHA);
  const owner = trimToNull(env.RAILWAY_GIT_REPO_OWNER);
  const repo = trimToNull(env.RAILWAY_GIT_REPO_NAME);
  return {
    repository: owner && repo ? `${owner}/${repo}` : null,
    gitSha: railwaySha ?? explicitSha,
    gitBranch: trimToNull(env.RAILWAY_GIT_BRANCH) ?? trimToNull(env.CE_GIT_BRANCH),
    source: railwaySha ? "railway_git" : explicitSha ? "explicit" : "unknown",
  };
}
