import { randomUUID } from "node:crypto";
import { investigationsAccepted } from "../config/production.js";

export type ProcessLifecycle = {
  bootId: string;
  startedAt: number;
  accepting: boolean;
  shuttingDown: boolean;
};

let state: ProcessLifecycle = createLifecycle();

function createLifecycle(): ProcessLifecycle {
  return {
    bootId: randomUUID(),
    startedAt: Date.now(),
    accepting: investigationsAccepted(),
    shuttingDown: false,
  };
}

export function lifecycle(): ProcessLifecycle {
  return state;
}

export function resetLifecycle(env: NodeJS.ProcessEnv = process.env): ProcessLifecycle {
  state = {
    bootId: randomUUID(),
    startedAt: Date.now(),
    accepting: investigationsAccepted(env),
    shuttingDown: false,
  };
  return state;
}

export function pauseAdmissions(): void {
  state.accepting = false;
}

export function resumeAdmissions(env: NodeJS.ProcessEnv = process.env): void {
  if (!state.shuttingDown) state.accepting = investigationsAccepted(env);
}

export function beginShutdown(): void {
  state.shuttingDown = true;
  state.accepting = false;
}

export function canAcceptInvestigations(): boolean {
  return state.accepting && !state.shuttingDown;
}
