import type { JobManager } from "../agent/query/jobs.js";

let jobs: JobManager | undefined;

export function registerJobManager(manager: JobManager): void {
  jobs = manager;
}

export function registeredJobs(): JobManager | undefined {
  return jobs;
}

export function resetRegisteredJobs(): void {
  jobs = undefined;
}
