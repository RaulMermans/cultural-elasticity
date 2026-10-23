import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@qloo/qloo-harness"],
  outputFileTracingIncludes: {
    "/api/poc": ["./node_modules/@qloo/qloo-harness/**/*"],
  },
};

export default withWorkflow(nextConfig);
