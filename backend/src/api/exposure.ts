/** Public deployment closes development execution paths. The baseline policy is one of them. */
export function publicDeployment(): boolean {
  return process.env.NODE_ENV === "production" || process.env.CE_PUBLIC_DEPLOYMENT === "1";
}

export function baselineAllowed(): boolean {
  return !publicDeployment();
}

export function developmentRoutesOpen(): boolean {
  return !publicDeployment();
}
